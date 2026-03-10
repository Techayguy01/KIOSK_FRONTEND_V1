"""
services/faq_service.py

Deterministic tenant-scoped FAQ retrieval without embeddings.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Optional
from uuid import UUID

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from models.faq import FAQ

_WHITESPACE_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9\s]")
_CHECKIN_VARIANT_RE = re.compile(r"\bcheck[\s-]*in\b")
_CHECKOUT_VARIANT_RE = re.compile(r"\bcheck[\s-]*out\b")
_FILLER_PHRASES_RE = re.compile(
    r"\b(i would like to know|i want to know|can you tell me|for this hotel)\b"
)
_FAQ_CANDIDATE_RE = re.compile(
    r"\b(what|when|where|do you|can you tell me|i want to know|i would like to know)\b"
)
_CHECKIN_INFO_RE = re.compile(
    r"(?:\b(what|when)\b.*\bcheckin\b|\bcheckin\b.*\b(time|timing|hours?)\b)"
)

# Fuzzy score threshold for direct FAQ answer.
FAQ_MATCH_THRESHOLD = 0.84


@dataclass
class FAQMatchResult:
    faq_id: str
    question: str
    answer: str
    confidence: float


def normalize_faq_query(text: str) -> str:
    lowered = (text or "").strip().lower()
    normalized = _CHECKIN_VARIANT_RE.sub("checkin", lowered)
    normalized = _CHECKOUT_VARIANT_RE.sub("checkout", normalized)
    normalized = _NON_ALNUM_RE.sub(" ", normalized)
    normalized = _FILLER_PHRASES_RE.sub(" ", normalized)
    cleaned = normalized
    return _WHITESPACE_RE.sub(" ", cleaned).strip()


def _token_key(text: str) -> str:
    tokens = [token for token in text.split(" ") if token]
    return " ".join(sorted(tokens))


def _fuzzy_score(query: str, candidate: str) -> float:
    query_norm = normalize_faq_query(query)
    candidate_norm = normalize_faq_query(candidate)
    if not query_norm or not candidate_norm:
        return 0.0

    char_ratio = SequenceMatcher(None, query_norm, candidate_norm).ratio()
    token_ratio = SequenceMatcher(None, _token_key(query_norm), _token_key(candidate_norm)).ratio()

    query_tokens = set(query_norm.split(" "))
    candidate_tokens = set(candidate_norm.split(" "))
    overlap = len(query_tokens & candidate_tokens)
    union = len(query_tokens | candidate_tokens) or 1
    jaccard = overlap / union

    score = (0.5 * char_ratio) + (0.35 * token_ratio) + (0.15 * jaccard)

    # Strong partial overlap (same phrase with minor additions) deserves a modest boost.
    if len(query_norm) >= 12 and (query_norm in candidate_norm or candidate_norm in query_norm):
        score = min(1.0, score + 0.05)

    return round(score, 4)


def is_faq_candidate_query(transcript: str) -> bool:
    normalized = normalize_faq_query(transcript)
    if not normalized:
        return False
    if _FAQ_CANDIDATE_RE.search(normalized):
        return True
    # Explicit guard for the common "what is check in time" family.
    if _CHECKIN_INFO_RE.search(normalized):
        return True
    return False


async def find_best_faq_match(
    session: AsyncSession,
    tenant_id: Optional[str],
    user_query: str,
) -> Optional[FAQMatchResult]:
    if not tenant_id or tenant_id == "default":
        return None

    try:
        tenant_uuid = UUID(str(tenant_id))
    except Exception:
        return None

    stmt = select(FAQ).where(FAQ.tenant_id == tenant_uuid, FAQ.is_active.is_(True))
    faq_result = await session.exec(stmt)
    faqs = faq_result.all()
    if not faqs:
        return None

    query_normalized = normalize_faq_query(user_query)
    if not query_normalized:
        return None

    # Deterministic first pass: exact normalized match.
    for faq in faqs:
        faq_question_normalized = normalize_faq_query(faq.question)
        if faq_question_normalized and faq_question_normalized == query_normalized:
            return FAQMatchResult(
                faq_id=str(faq.id),
                question=faq.question,
                answer=faq.answer,
                confidence=1.0,
            )

    best_match: Optional[FAQMatchResult] = None
    for faq in faqs:
        score = _fuzzy_score(user_query, faq.question)
        if not best_match or score > best_match.confidence:
            best_match = FAQMatchResult(
                faq_id=str(faq.id),
                question=faq.question,
                answer=faq.answer,
                confidence=score,
            )

    return best_match
