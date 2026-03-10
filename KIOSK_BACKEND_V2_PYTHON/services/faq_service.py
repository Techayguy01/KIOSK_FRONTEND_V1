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

# Fuzzy score threshold for direct FAQ answer.
FAQ_MATCH_THRESHOLD = 0.84


@dataclass
class FAQMatchResult:
    faq_id: str
    question: str
    answer: str
    confidence: float


def _normalize_text(text: str) -> str:
    lowered = (text or "").strip().lower()
    cleaned = _NON_ALNUM_RE.sub(" ", lowered)
    return _WHITESPACE_RE.sub(" ", cleaned).strip()


def _token_key(text: str) -> str:
    tokens = [token for token in text.split(" ") if token]
    return " ".join(sorted(tokens))


def _fuzzy_score(query: str, candidate: str) -> float:
    query_norm = _normalize_text(query)
    candidate_norm = _normalize_text(candidate)
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
