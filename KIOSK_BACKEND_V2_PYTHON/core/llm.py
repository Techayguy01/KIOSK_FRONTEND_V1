"""
core/llm.py

LLM configuration with automatic fallback via LiteLLM.

Fallback tiers (genuinely independent providers):
  Tier 1 — Groq  (Llama 3.3 70B → Llama 3 8B): fast, cheap, same account.
            Both models are tried before leaving this tier.
  Tier 2 — OpenAI GPT-4o-mini: independent provider, final safety net.

Key fixes over the previous version:
  - Per-model timeout (8s) so a hanging connection fails fast.
  - Thread-safe embedding model load (threading.Lock).
  - translate_to_english() guards with fast language detection before
    calling the LLM — avoids wasted LLM calls on already-English text.
  - rephrase_faq_answer() is now opt-in via needs_rephrasing=True.
    By default it returns the stored answer as-is, keeping the FAQ path fast.
  - Exponential backoff between same-tier retries on rate-limit errors.
  - load_dotenv() is called only when a .env file actually exists,
    so containerised deployments are not affected.
"""

from __future__ import annotations

import asyncio
import os
import threading
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Environment — only load .env if the file exists (safe for containers)
# ---------------------------------------------------------------------------
_env_file = Path(".env")
if _env_file.exists():
    from dotenv import load_dotenv
    load_dotenv()

# Prevent LiteLLM from fetching a remote model-cost map during import.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "true")

# ---------------------------------------------------------------------------
# Model tiers
# Models within a tier share a provider account.
# Tiers are tried in order; failure of a full tier moves to the next.
# ---------------------------------------------------------------------------
_MODEL_TIERS: list[list[str]] = [
    [
        "groq/llama-3.3-70b-versatile",
        "groq/llama3-8b-8192",
    ],
    [
        "openai/gpt-4o-mini",
    ],
]

# Per-model request timeout in seconds.
# Keeps the fallback chain responsive under hung connections.
_MODEL_TIMEOUT_SECONDS = 8

# Backoff between same-tier retries on rate-limit errors (seconds).
_RATE_LIMIT_BACKOFF = 1.0

# ---------------------------------------------------------------------------
# LiteLLM — thread-safe lazy singleton
# ---------------------------------------------------------------------------
_litellm_module = None
_litellm_completion = None
_litellm_lock = threading.Lock()


def _get_litellm():
    global _litellm_module, _litellm_completion
    if _litellm_module is None or _litellm_completion is None:
        with _litellm_lock:
            if _litellm_module is None or _litellm_completion is None:
                import litellm
                from litellm import completion
                litellm.set_verbose = False
                _litellm_module = litellm
                _litellm_completion = completion
    return _litellm_module, _litellm_completion


# ---------------------------------------------------------------------------
# Core LLM call with tier-aware fallback
# ---------------------------------------------------------------------------

def get_llm_response(
    messages: list[dict],
    temperature: float = 0.4,
    max_tokens: int = 200,
) -> str:
    """
    Call the LLM with tiered fallback and per-model timeout.

    Within a tier, rate-limit errors trigger a brief backoff before
    trying the next model. Exhausting a tier moves to the next tier.
    Raises RuntimeError only if every model in every tier fails.
    CancelledError (client disconnect / async timeout) is re-raised
    immediately without attempting further models.
    """
    _, completion = _get_litellm()
    last_error = None

    for tier_index, tier_models in enumerate(_MODEL_TIERS):
        for model_index, model in enumerate(tier_models):
            try:
                response = completion(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=_MODEL_TIMEOUT_SECONDS,
                )
                content = response.choices[0].message.content
                # LiteLLM can return None for content on content-filter or
                # max-token truncation. Treat as a failure and try next model.
                if content is None:
                    raise ValueError(f"Model {model} returned None content")
                print(f"[LLM] responded model={model} tier={tier_index}")
                return content
            except asyncio.CancelledError:
                # Request was cancelled (client disconnect or async timeout).
                # Re-raise immediately — do not attempt further models.
                print("[LLM] request cancelled, aborting fallback chain")
                raise
            except Exception as e:
                error_str = str(e).lower()
                is_rate_limit = "rate" in error_str or "429" in error_str
                print(
                    f"[LLM] failed model={model} tier={tier_index} "
                    f"rate_limit={is_rate_limit} error={e}"
                )
                last_error = e
                # Only backoff between models within the same tier.
                # Do not penalise the next tier for this tier's rate limits.
                has_next_model_in_tier = model_index < len(tier_models) - 1
                if is_rate_limit and has_next_model_in_tier:
                    time.sleep(_RATE_LIMIT_BACKOFF)

    raise RuntimeError(f"[LLM] All models and tiers exhausted. Last error: {last_error}")


# ---------------------------------------------------------------------------
# Embedding model — thread-safe lazy singleton
# ---------------------------------------------------------------------------
_embedding_model = None
_embedding_lock = threading.Lock()


def _get_embedding_model():
    """
    Lazy-load the local SentenceTransformer model.
    Thread-safe: concurrent cold-start requests won't double-load.
    """
    global _embedding_model
    if _embedding_model is None:
        with _embedding_lock:
            # Re-check inside lock — another thread may have loaded it
            # while we were waiting.
            if _embedding_model is None:
                from sentence_transformers import SentenceTransformer
                print("[LLM][Embedding] Loading all-MiniLM-L6-v2 ...")
                _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
                print("[LLM][Embedding] Loaded (384-dim, CPU)")
    return _embedding_model


def get_embedding(text: str) -> list[float]:
    """
    384-dim embedding via local all-MiniLM-L6-v2.
    No API key required. Runs on CPU.
    """
    try:
        model = _get_embedding_model()
        vector = model.encode(text, normalize_embeddings=True)
        return vector.tolist()
    except Exception as e:
        print(f"[LLM][Embedding] Error: {e}")
        raise


# ---------------------------------------------------------------------------
# Language detection — fast, no LLM call
# ---------------------------------------------------------------------------

# Seed langdetect once at module load for deterministic results.
# Without this, langdetect is probabilistic and can flip on short Hinglish phrases.
try:
    from langdetect import DetectorFactory as _DetectorFactory
    _DetectorFactory.seed = 0
except Exception:
    pass


def _is_already_english(text: str) -> bool:
    """
    Quick heuristic: returns True if text is very likely plain English.
    Tries langdetect first (seeded for determinism); falls back to ASCII-ratio.
    """
    if not text or not text.strip():
        return True
    try:
        from langdetect import detect
        return detect(text) == "en"
    except Exception:
        pass
    # Fallback: if >85% of characters are ASCII printable, treat as English.
    ascii_chars = sum(1 for c in text if ord(c) < 128)
    return (ascii_chars / max(len(text), 1)) > 0.85


# ---------------------------------------------------------------------------
# Module-level constants
# ---------------------------------------------------------------------------

_REJECTION_FALLBACK = (
    "I'm sorry, I don't have information on that topic. "
    "Please contact our front desk or support team for assistance."
)


# ---------------------------------------------------------------------------
# Translation
# ---------------------------------------------------------------------------

def translate_to_english(text: str) -> str:
    """
    Translates Hinglish / mixed-language text to English.
    Skips the LLM call entirely if the text is already English.
    """
    if not text or not text.strip():
        return ""

    if _is_already_english(text):
        print("[LLM][Translate] Skipped — text already English")
        return text

    messages = [
        {
            "role": "system",
            "content": (
                "You are a translation assistant. "
                "Convert the following user input into clear, concise English. "
                "If it is already in English, return it unchanged. "
                "If it is in Hindi, Hinglish, or mixed languages, translate it. "
                "Return ONLY the translated text, nothing else."
            ),
        },
        {"role": "user", "content": text},
    ]
    try:
        translated = get_llm_response(messages, temperature=0.0, max_tokens=200)
        return translated.strip()
    except Exception as e:
        print(f"[LLM][Translate] Error: {e}")
        return text


# ---------------------------------------------------------------------------
# FAQ answer rephrasing — opt-in only
# ---------------------------------------------------------------------------

def rephrase_faq_answer(
    user_query: str,
    faq_answer: str,
    needs_rephrasing: bool = False,
) -> str:
    """
    Rephrases a stored FAQ answer to match the guest's phrasing.

    By default (needs_rephrasing=False) returns faq_answer unchanged,
    keeping the FAQ path fast and deterministic. Pass needs_rephrasing=True
    only when the stored answer is known to be terse or formulaic and
    natural-language rephrasing genuinely improves the guest experience.
    """
    if not needs_rephrasing or not user_query or not faq_answer:
        return faq_answer

    messages = [
        {
            "role": "system",
            "content": (
                "The guest asked a question in their own words. "
                "Rephrase the provided FAQ answer naturally to address their phrasing. "
                "Keep it accurate, concise, and conversational. "
                "Do not add information not present in the FAQ answer."
            ),
        },
        {
            "role": "user",
            "content": f"Guest question: {user_query}\n\nFAQ answer: {faq_answer}",
        },
    ]
    try:
        rephrased = get_llm_response(messages, temperature=0.3, max_tokens=200)
        return rephrased.strip()
    except Exception as e:
        print(f"[LLM][Rephrase] Error: {e}")
        return faq_answer


# ---------------------------------------------------------------------------
# Polite rejection for unmatched FAQ queries
# ---------------------------------------------------------------------------

def generate_polite_rejection(user_query: str) -> str:
    """
    Returns a polite refusal for questions not covered by the FAQ.
    Falls back to _REJECTION_FALLBACK if the LLM call fails.
    """
    if not user_query:
        return "I'm sorry, I didn't quite catch that. Could you please repeat?"

    messages = [
        {
            "role": "system",
            "content": (
                "The guest asked a question not covered in the hotel FAQ. "
                "Politely explain that you can only help with hotel stays, "
                "facilities, and bookings. Suggest they contact the front desk "
                "for anything else. Do not fabricate an answer."
            ),
        },
        {"role": "user", "content": user_query},
    ]
    try:
        rejection = get_llm_response(messages, temperature=0.3, max_tokens=150)
        return rejection.strip()
    except Exception as e:
        print(f"[LLM][Rejection] Error: {e}")
        return _REJECTION_FALLBACK