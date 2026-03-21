"""
Layer 2: Semantic Intent Classifier

Uses pre-computed embeddings of example phrases to classify user intent.
This is screen-aware: only considers intents valid for the current UI screen.

Key properties:
- Does NOT call LLM -> fast and cheap
- Handles STT errors via embeddings
- Handles Hinglish by translating before embedding
- Screen-aware: "yes" on BOOKING_SUMMARY -> CONFIRM_BOOKING
- Returns None if no intent matches well enough
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from agent.intent_config import (
    INTENT_EXAMPLES,
    get_min_confidence,
    get_valid_intents,
    should_llm_fallback,
)
from agent.stt_normalizer import normalize_for_routing

logger = logging.getLogger(__name__)

_NOT_INITIALIZED = object()
_intent_embeddings: dict[str, list[tuple[str, list[float]]]] = {}
_is_ready: bool = False

HIGH_CONFIDENCE_THRESHOLD = 0.82
LOW_CONFIDENCE_THRESHOLD = 0.60
OUT_OF_DOMAIN_THRESHOLD = 0.45


@dataclass
class SemanticResult:
    intent: str
    confidence: float
    matched_phrase: str
    is_out_of_domain: bool
    should_escalate_to_llm: bool
    normalized_transcript: str
    source: str = "semantic_classifier"


async def initialize_semantic_classifier() -> None:
    """
    Pre-compute embeddings for all example phrases.
    Call this once at startup, not on every request.
    """
    global _intent_embeddings, _is_ready

    from core.llm import get_embedding

    logger.info(
        "[SemanticClassifier] Initializing - embedding %d intents...",
        len(INTENT_EXAMPLES),
    )
    results: dict[str, list[tuple[str, list[float]]]] = {}
    for intent_name, phrases in INTENT_EXAMPLES.items():
        embedded_phrases: list[tuple[str, list[float]]] = []
        for phrase in phrases:
            if not phrase.strip():
                continue
            try:
                vector = await asyncio.to_thread(get_embedding, phrase)
                if vector:
                    embedded_phrases.append((phrase, vector))
            except Exception as exc:
                logger.warning(
                    "[SemanticClassifier] Failed to embed '%s' for intent %s: %s",
                    phrase,
                    intent_name,
                    exc,
                )
        results[intent_name] = embedded_phrases
        logger.info(
            "[SemanticClassifier] Intent %s: %d phrases embedded",
            intent_name,
            len(embedded_phrases),
        )

    _intent_embeddings = results
    _is_ready = True
    logger.info(
        "[SemanticClassifier] Ready. Total phrases: %d",
        sum(len(v) for v in results.values()),
    )


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Local cosine similarity to avoid cross-module coupling."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


async def classify_intent_semantically(
    transcript: str,
    current_screen: str,
    *,
    session_id: str = "",
    language: str = "en",
) -> Optional[SemanticResult]:
    """
    Classify the user's transcript by embedding similarity.

    Returns None if:
    - The classifier is not initialized
    - The transcript is empty
    - No valid intents are configured for this screen
    """
    if not _is_ready:
        logger.warning("[SemanticClassifier] Not initialized - skipping (will use LLM)")
        return None

    text = (transcript or "").strip()
    if not text:
        return None

    normalized_text, is_filler = normalize_for_routing(text)
    if is_filler:
        return SemanticResult(
            intent="IDLE",
            confidence=1.0,
            matched_phrase="",
            is_out_of_domain=False,
            should_escalate_to_llm=False,
            normalized_transcript=normalized_text,
            source="stt_normalizer",
        )

    from core.llm import get_embedding, translate_to_english

    try:
        english_text = await asyncio.to_thread(translate_to_english, normalized_text)
        english_text = (english_text or normalized_text).strip()
    except Exception:
        english_text = normalized_text

    try:
        query_vector = await asyncio.to_thread(get_embedding, english_text)
    except Exception as exc:
        logger.warning("[SemanticClassifier] Embedding failed: %s - falling through to LLM", exc)
        return None

    if not query_vector:
        return None

    valid_intents = get_valid_intents(current_screen)
    if not valid_intents:
        return None

    best_intent: Optional[str] = None
    best_score = 0.0
    best_phrase = ""

    for intent_name in valid_intents:
        examples = _intent_embeddings.get(intent_name, [])
        for phrase, vector in examples:
            score = _cosine_similarity(query_vector, vector)
            if score > best_score:
                best_score = score
                best_intent = intent_name
                best_phrase = phrase

    logger.info(
        "[SemanticClassifier] screen=%s best_intent=%s score=%.3f phrase='%s' transcript='%s'",
        current_screen,
        best_intent,
        best_score,
        best_phrase,
        normalized_text,
    )

    if best_intent is None:
        return None

    is_out_of_domain = best_score < OUT_OF_DOMAIN_THRESHOLD
    min_confidence = get_min_confidence(best_intent)
    should_escalate = False

    if best_score < min_confidence:
        should_escalate = True
    elif should_llm_fallback(best_intent) and best_score < HIGH_CONFIDENCE_THRESHOLD:
        should_escalate = True
    elif LOW_CONFIDENCE_THRESHOLD <= best_score < HIGH_CONFIDENCE_THRESHOLD:
        should_escalate = True

    return SemanticResult(
        intent=best_intent,
        confidence=round(best_score, 3),
        matched_phrase=best_phrase,
        is_out_of_domain=is_out_of_domain,
        should_escalate_to_llm=should_escalate,
        normalized_transcript=normalized_text,
    )
