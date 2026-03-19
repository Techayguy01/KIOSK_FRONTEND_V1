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

from agent.intent_config import INTENT_EXAMPLES, VALID_INTENTS_PER_SCREEN

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
    # If embeddings are unavailable (missing deps / disabled), it's better to
    # disable this classifier entirely than to log a warning per phrase.
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
                    "[SemanticClassifier] Semantic embeddings unavailable; disabling classifier. Reason: %s",
                    exc,
                )
                _is_ready = False
                _intent_embeddings = {}
                return
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

    from core.llm import get_embedding, translate_to_english

    try:
        english_text = await asyncio.to_thread(translate_to_english, text)
        english_text = (english_text or text).strip()
    except Exception:
        english_text = text

    try:
        query_vector = await asyncio.to_thread(get_embedding, english_text)
    except Exception as exc:
        logger.warning("[SemanticClassifier] Embedding failed: %s - falling through to LLM", exc)
        return None

    if not query_vector:
        return None

    valid_intents = VALID_INTENTS_PER_SCREEN.get(current_screen, list(INTENT_EXAMPLES.keys()))
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
        text,
    )

    if best_intent is None:
        return None

    is_out_of_domain = best_score < OUT_OF_DOMAIN_THRESHOLD
    should_escalate = LOW_CONFIDENCE_THRESHOLD <= best_score < HIGH_CONFIDENCE_THRESHOLD
    return SemanticResult(
        intent=best_intent,
        confidence=round(best_score, 3),
        matched_phrase=best_phrase,
        is_out_of_domain=is_out_of_domain,
        should_escalate_to_llm=should_escalate,
    )
