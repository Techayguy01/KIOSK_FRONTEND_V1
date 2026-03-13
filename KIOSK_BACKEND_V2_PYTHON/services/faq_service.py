"""
services/faq_service.py

Deterministic tenant-scoped FAQ retrieval without embeddings.
"""

from __future__ import annotations

import re
import json
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
import numpy as np
from models.faq import FAQ
from models.faq_localization import FAQLocalization
from core.voice import normalize_language_code
from core.llm import get_llm_response, get_embedding, translate_to_english, rephrase_faq_answer, generate_polite_rejection
from services.faq_localization_service import ensure_faq_localizations

@dataclass
class FAQMatchResult:
    faq_id: str
    question: str
    answer: str
    confidence: float
    match_type: str


@dataclass
class FAQLookupResult:
    normalized_query: str
    faq_count: int
    match: Optional[FAQMatchResult]
    localizations_synced: bool = False


_WHITESPACE_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^\w\s]", flags=re.UNICODE)

# Thresholds
FAQ_MATCH_THRESHOLD = 0.75  # Requirement: 0.75

_FAQ_CANDIDATE_RE = re.compile(
    r"\b(can|how|what|when|where|why|is|do|does|tell|info|information)\b", 
    re.IGNORECASE
)
_CHECKIN_INFO_RE = re.compile(r"check[ -]?in", re.IGNORECASE)
_CHECKOUT_INFO_RE = re.compile(r"check[ -]?out", re.IGNORECASE)


def _faq_matching_text(faq: FAQ) -> str:
    return str(faq.canonical_question_en or faq.question or "").strip()


async def _resolve_localized_faq_content(
    session: AsyncSession,
    faq: FAQ,
    language: str,
) -> tuple[str, str]:
    requested_language = normalize_language_code(language)
    source_language = normalize_language_code(faq.source_lang or "en")
    result = await session.exec(
        select(FAQLocalization).where(FAQLocalization.faq_id == faq.id)
    )
    localizations = result.all()
    localization_map = {
        normalize_language_code(localization.lang_code): localization
        for localization in localizations
    }

    preferred = localization_map.get(requested_language)
    if preferred:
        return preferred.localized_question, preferred.localized_answer

    source = localization_map.get(source_language)
    if source:
        return source.localized_question, source.localized_answer

    fallback_question = str(faq.question or _faq_matching_text(faq) or "").strip()
    fallback_answer = str(faq.answer or "").strip()
    return fallback_question, fallback_answer


def normalize_faq_query(text: str) -> str:
    """Basic normalization for keyword checks."""
    if not text:
        return ""
    # Remove punctuation
    text = _NON_ALNUM_RE.sub(" ", text)
    # Collapse whitespace
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text.lower()

# In-memory cache for FAQ embeddings to avoid redundant API calls
# Structure: {faq_id: embedding_vector}
_FAQ_EMBEDDING_CACHE: dict[str, list[float]] = {}


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Calculates cosine similarity between two vectors."""
    if not v1 or not v2:
        return 0.0
    vec1 = np.array(v1)
    vec2 = np.array(v2)
    dot_product = np.dot(vec1, vec2)
    norm1 = np.linalg.norm(vec1)
    norm2 = np.linalg.norm(vec2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return float(dot_product / (norm1 * norm2))


def _get_cached_faq_embedding(faq: FAQ) -> list[float]:
    faq_id_str = str(faq.id)
    if faq_id_str not in _FAQ_EMBEDDING_CACHE:
        matching_text = _faq_matching_text(faq)
        print(f"[FAQService] Generating embedding for FAQ: {matching_text}")
        _FAQ_EMBEDDING_CACHE[faq_id_str] = get_embedding(matching_text)
    return _FAQ_EMBEDDING_CACHE[faq_id_str]


def is_faq_candidate_query(transcript: str) -> bool:
    raw = (transcript or "").strip().lower()
    normalized = normalize_faq_query(transcript)
    if not raw and not normalized:
        return False
        
    # Check if the query is actually a question or a general info request
    faq_keywords = (
        "checkin", "checkout", "breakfast", "wifi", "internet", "parking", 
        "pool", "timing", "hours", "time", "password", "facility", 
        "restaurant", "gym", "spa", "kiosk", "manager", "help", "support"
    )
    
    # Candidate phrasing ("what/when/how...") must be checked on raw text.
    if _FAQ_CANDIDATE_RE.search(raw):
        return True
    if "?" in raw:
        return True
    if _CHECKIN_INFO_RE.search(raw) or _CHECKOUT_INFO_RE.search(raw):
        return True
        
    # Check for FAQ keywords in normalized text
    if any(keyword in normalized for keyword in faq_keywords):
        return True
        
    return False


def _is_irrelevant_query(user_query: str, normalized_query: str) -> bool:
    """Detect queries that are clearly out of hotel scope."""
    # This is a simple heuristic. In a real system, this would be an LLM call or a larger keyword set.
    irrelevant_keywords = (
        "rocket", "mars", "politics", "president", "weather in", "movie", "song",
        "calculate", "who is", "what is the capital"
    )
    # But wait, "who is the manager" is relevant. So we check against some safe ones.
    relevant_context = ("hotel", "room", "stay", "booking", "checkin", "checkout", "kiosk")
    
    q = normalized_query.lower()
    if any(kw in q for kw in irrelevant_keywords):
        if not any(ctx in q for ctx in relevant_context):
            return True
    return False


def _safe_json_loads(text: str) -> Optional[dict]:
    if not text:
        return None
    raw = text.strip()
    if not raw:
        return None
    # Allow the model to wrap JSON in prose.
    first = raw.find("{")
    last = raw.rfind("}")
    if first == -1 or last == -1 or last <= first:
        return None
    try:
        return json.loads(raw[first : last + 1])
    except Exception:
        return None


def _llm_pick_faq_id(user_query: str, faqs: list[FAQ]) -> tuple[Optional[str], float]:
    """
    Constrained LLM selector: returns (faq_id | None, confidence).
    This avoids language/phrasing hardcoding while keeping outputs bounded.
    """
    if not user_query.strip() or not faqs:
        return None, 0.0

    shortlist = faqs[:_LLM_MAX_FAQS]
    faq_lines = "\n".join(
        f"- id: {str(faq.id)} | q: {faq.question}"
        for faq in shortlist
        if faq.question
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are a strict FAQ matcher. Given a user question and a list of FAQs, "
                "pick the single best matching FAQ id. If none match, return null. "
                "Respond with JSON only: {\"faqId\": string|null, \"confidence\": number}."
            ),
        },
        {
            "role": "user",
            "content": f"User question:\n{user_query}\n\nFAQs:\n{faq_lines}",
        },
    ]

    # temperature=0.0 for stability; selection should be deterministic.
    raw = get_llm_response(messages=messages, temperature=0.0)
    parsed = _safe_json_loads(raw) or {}
    faq_id = parsed.get("faqId", None)
    confidence = parsed.get("confidence", 0.0)

    if faq_id is not None:
        faq_id = str(faq_id).strip()
        if not faq_id:
            faq_id = None

    try:
        confidence_val = float(confidence)
    except Exception:
        confidence_val = 0.0
    confidence_val = max(0.0, min(1.0, confidence_val))

    if faq_id is None:
        return None, confidence_val

    # Validate that the returned id exists in the provided set.
    allowed = {str(faq.id) for faq in shortlist}
    if faq_id not in allowed:
        return None, 0.0

    return faq_id, confidence_val


async def find_best_faq_match(
    session: AsyncSession,
    tenant_id: Optional[str],
    user_query: str,
    language: str = "en",
) -> FAQLookupResult:
    # --- STEP 0: MANDATORY TENANT-SCOPED GUARD ---
    # We must filter by tenant before any LLM/embedding calls.
    if not tenant_id or tenant_id == "default":
        return FAQLookupResult(normalized_query=user_query, faq_count=0, match=None, localizations_synced=False)

    try:
        tenant_uuid = UUID(str(tenant_id))
    except Exception:
        return FAQLookupResult(normalized_query=user_query, faq_count=0, match=None, localizations_synced=False)

    # Fetch candidate pool first
    stmt = select(FAQ).where(FAQ.tenant_id == tenant_uuid, FAQ.is_active.is_(True))
    faq_result = await session.exec(stmt)
    faqs = faq_result.all()
    
    # If no FAQs exist for this tenant, exit immediately.
    if not faqs:
        print(f"[FAQService] Guard: No FAQs found for tenant {tenant_id}. Stopping pipeline.")
        return FAQLookupResult(normalized_query=user_query, faq_count=0, match=None, localizations_synced=False)

    # --- STEP 1: TRANSLATION & NORMALIZATION (LLM CALLS DISALLOWED BEFORE GUARD) ---
    print(f"[FAQService] Normalizing query: '{user_query}'")
    try:
        translated_query = translate_to_english(user_query)
    except Exception as e:
        print(f"[FAQService] Translation failed: {e}")
        translated_query = user_query
    print(f"[FAQService] Translated/Normalized query: '{translated_query}'")

    # Detect irrelevance on the translated text
    if _is_irrelevant_query(user_query, translated_query):
        return FAQLookupResult(
            normalized_query=translated_query,
            faq_count=len(faqs),
            match=FAQMatchResult(
                faq_id="irrelevant",
                question=user_query,
                answer="I apologize, but I can only assist with questions related to your hotel stay and booking. I don't have information about that topic.",
                confidence=1.0,
                match_type="irrelevant",
            ),
            localizations_synced=False,
        )

    # 2. Semantic Search Layer (Embeddings)
    try:
        query_embedding = get_embedding(translated_query)
    except Exception as e:
        print(f"[FAQService] Embedding generation failed: {e}. Falling back to fuzzy matching.")
        # Minimal legacy fallback if embedding service is down
        return FAQLookupResult(normalized_query=translated_query, faq_count=len(faqs), match=None, localizations_synced=False)

    faq_by_id = {str(faq.id): faq for faq in faqs}
    best_match: Optional[FAQMatchResult] = None
    max_similarity = -1.0

    for faq in faqs:
        try:
            faq_embedding = _get_cached_faq_embedding(faq)
            similarity = cosine_similarity(query_embedding, faq_embedding)

            if similarity > max_similarity:
                max_similarity = similarity
                matching_text = _faq_matching_text(faq)
                best_match = FAQMatchResult(
                    faq_id=str(faq.id),
                    question=matching_text,
                    answer=str(faq.answer or "").strip(),
                    confidence=similarity,
                    match_type="semantic",
                )
        except Exception as e:
            print(f"[FAQService] Error comparing against FAQ {faq.id}: {e}")

    # 3. Threshold Check
    if best_match and best_match.confidence >= FAQ_MATCH_THRESHOLD:
        print(f"[FAQService] Semantic Hit: score={best_match.confidence:.3f} match='{best_match.question}'")
        matched_faq = faq_by_id.get(best_match.faq_id)
        localizations_synced = False
        if matched_faq:
            localizations_synced = await ensure_faq_localizations(
                session,
                matched_faq,
                available_languages=[language],
                requested_language=language,
            )
            localized_question, localized_answer = await _resolve_localized_faq_content(
                session,
                matched_faq,
                language,
            )
            best_match.question = localized_question or best_match.question
            if normalize_language_code(language) == "en":
                best_match.answer = rephrase_faq_answer(user_query, localized_answer)
            else:
                best_match.answer = localized_answer

        return FAQLookupResult(
            normalized_query=translated_query,
            faq_count=len(faqs),
            match=best_match,
            localizations_synced=localizations_synced,
        )

    print(f"[FAQService] Semantic Miss: top_score={max_similarity:.3f}")
    
    # Generate a polite rejection instead of returning None
    rejection_answer = generate_polite_rejection(user_query)
    return FAQLookupResult(
        normalized_query=translated_query,
        faq_count=len(faqs),
        match=FAQMatchResult(
            faq_id="no-match",
            question=user_query,
            answer=rejection_answer,
            confidence=max_similarity if max_similarity > 0 else 0.0,
            match_type="rejection",
        ),
        localizations_synced=False,
    )
