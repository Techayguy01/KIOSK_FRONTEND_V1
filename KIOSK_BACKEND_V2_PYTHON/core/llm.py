"""
core/llm.py

LLM configuration with automatic fallback via LiteLLM.

Priority:
  1. Groq (Llama 3.3 70B) - blazing fast, primary
  2. Groq (Llama 3 8B) - faster fallback if main model hits rate limits
  3. OpenAI GPT-4o-mini - final fallback

All nodes in the LangGraph agent call get_llm() and never hard-code a model.
"""

import os

from dotenv import load_dotenv

load_dotenv()

# Prevent LiteLLM from fetching a remote model-cost map during import.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "true")

_litellm_module = None
_litellm_completion = None

# Model priority list
LLM_MODELS = [
    "groq/llama-3.3-70b-versatile",
    "groq/llama3-8b-8192",
    "openai/gpt-4o-mini",
]


def _get_litellm():
    global _litellm_module, _litellm_completion

    if _litellm_module is None or _litellm_completion is None:
        import litellm
        from litellm import completion

        litellm.set_verbose = False
        _litellm_module = litellm
        _litellm_completion = completion

    return _litellm_module, _litellm_completion


def get_llm_response(messages: list[dict], temperature: float = 0.4, max_tokens: int = 200) -> str:
    """
    Calls the LLM with automatic fallback.
    """
    _, completion = _get_litellm()
    last_error = None
    for model in LLM_MODELS:
        try:
            response = completion(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            content = response.choices[0].message.content
            print(f"[LLM] Model responded: {model}")
            return content
        except Exception as e:
            print(f"[LLM] {model} failed: {e}. Trying next...")
            last_error = e

    raise RuntimeError(f"[LLM] All models failed. Last error: {last_error}")


_embedding_model = None
_embedding_init_error = None  # Cache first failure so we don't spam logs / retry endlessly.
_embedding_backend = (os.getenv("KIOSK_EMBEDDINGS_BACKEND") or "local").strip().lower()


def _get_embedding_model():
    """Lazy-load the local sentence-transformers model (cached after first call)."""
    global _embedding_model, _embedding_init_error

    if _embedding_backend in ("off", "none", "disabled", "false", "0"):
        raise RuntimeError(
            "Embeddings are disabled via KIOSK_EMBEDDINGS_BACKEND. "
            "Set it to 'local' (default) to use sentence-transformers."
        )

    # If we already tried and failed, do not retry on every call.
    if _embedding_init_error is not None:
        raise _embedding_init_error

    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
        except Exception as exc:
            _embedding_init_error = RuntimeError(
                "Local embeddings require the Python package 'sentence-transformers'. "
                "Install it (and its deps) in the backend environment, or set "
                "KIOSK_EMBEDDINGS_BACKEND=disabled to skip semantic embeddings."
            )
            _embedding_init_error.__cause__ = exc
            raise _embedding_init_error

        try:
            print("[LLM][Embedding] Loading local model: all-MiniLM-L6-v2 ...")
            _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
            print("[LLM][Embedding] Model loaded (384-dim, CPU, no API key needed)")
        except Exception as exc:
            _embedding_init_error = RuntimeError(
                "Failed to load the local embedding model (all-MiniLM-L6-v2). "
                "Install required deps (often torch) or disable embeddings."
            )
            _embedding_init_error.__cause__ = exc
            raise _embedding_init_error

    return _embedding_model


def get_embedding(text: str) -> list[float]:
    """
    Generates a 384-dim embedding using the local all-MiniLM-L6-v2 model.
    Runs on CPU, no API key required.
    """
    model = _get_embedding_model()
    vector = model.encode(text, normalize_embeddings=True)
    return vector.tolist()


def translate_to_english(text: str) -> str:
    """
    Translates or normalizes multilingual/Hinglish text to clear English.
    If the text is already English, it returns it as is.
    """
    if not text or not text.strip():
        return ""

    messages = [
        {
            "role": "system",
            "content": (
                "You are a translation and normalization assistant. "
                "Convert the following user input into clear, concise English. "
                "If it's already in English, just return it as is. "
                "If it's in Hindi, Hinglish, or mixed languages, translate it to English. "
                "Return ONLY the translated/normalized text."
            ),
        },
        {"role": "user", "content": text},
    ]

    try:
        translated = get_llm_response(messages, temperature=0.0)
        return translated.strip()
    except Exception as e:
        print(f"[LLM][Translate] Error translating text: {e}")
        return text


def rephrase_faq_answer(user_query: str, faq_answer: str) -> str:
    """
    Rephrases a stored FAQ answer to naturally address the guest's specific phrasing.
    """
    if not user_query or not faq_answer:
        return faq_answer

    messages = [
        {
            "role": "system",
            "content": (
                "The guest asked the following question in their own words. "
                "Use the provided FAQ answer as the source of truth and rephrase it naturally "
                "to directly address how the guest phrased their question. "
                "Keep the answer accurate, concise, and conversational."
            ),
        },
        {
            "role": "user",
            "content": f"Guest Question: {user_query}\n\nStored FAQ Answer: {faq_answer}",
        },
    ]

    try:
        rephrased = get_llm_response(messages, temperature=0.3)
        return rephrased.strip()
    except Exception as e:
        print(f"[LLM][Rephrase] Error rephrasing answer: {e}")
        return faq_answer


def generate_polite_rejection(user_query: str) -> str:
    """
    Generates a polite refusal for questions not covered by the FAQ.
    """
    if not user_query:
        return "I'm sorry, I didn't quite catch that. Could you please repeat?"

    messages = [
        {
            "role": "system",
            "content": (
                "The guest asked a question that is not covered in the available FAQs for this tenant. "
                "Respond politely that you can only help with topics relevant to the hotel stay, "
                "facilities, and bookings. Suggest they contact the front desk or support if they "
                "need further assistance with this specific query. Do not fabricate an answer."
            ),
        },
        {"role": "user", "content": user_query},
    ]

    try:
        rejection = get_llm_response(messages, temperature=0.3)
        return rejection.strip()
    except Exception as e:
        print(f"[LLM][Rejection] Error generating rejection: {e}")
        return (
            "I apologize, but I don't have information about that topic. "
            "Please contact our support team or the front desk for assistance."
        )
