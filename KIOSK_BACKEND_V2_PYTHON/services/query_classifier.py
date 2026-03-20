from __future__ import annotations

import re
from typing import Literal

from services.faq_service import is_faq_candidate_query, normalize_faq_query
from services.transcript_understanding import (
    looks_like_room_discovery_repairable,
    repair_transcript_for_routing,
)


QueryType = Literal[
    "ROOM_DISCOVERY",
    "ROOM_COMPARISON",
    "ROOM_PREVIEW_QUERY",
    "BOOKING_FLOW",
    "CHECK_IN",
    "FAQ_INFO",
    "UNKNOWN",
]


CHECK_IN_RE = re.compile(
    r"\b("
    r"check[\s-]?in|"
    r"check\s+me\s+in|"
    r"start\s+check[\s-]?in|"
    r"begin\s+check[\s-]?in|"
    r"i\s+have\s+a\s+booking|"
    r"existing\s+booking|"
    r"my\s+reservation"
    r")\b",
    re.IGNORECASE,
)

ROOM_COMPARISON_RE = re.compile(
    r"\b("
    r"compare|comparison|"
    r"difference\s+between|"
    r"which\s+is\s+better|"
    r"which\s+(?:one|room|suite)?\s*is\s+better|"
    r"versus|vs\.?"
    r")\b",
    re.IGNORECASE,
)

ROOM_DISCOVERY_RE = re.compile(
    r"\b("
    r"show\s+(?:me\s+)?(?:the\s+)?(?:hotel\s+)?rooms?|"
    r"see\s+(?:the\s+)?(?:hotel\s+)?rooms?|"
    r"view\s+(?:the\s+)?(?:hotel\s+)?rooms?|"
    r"explore\s+(?:the\s+)?(?:hotel\s+)?rooms?|"
    r"available\s+(?:hotel\s+)?rooms?|"
    r"(?:hotel\s+)?rooms?\s+available|"
    r"room\s+availability|"
    r"hotel\s+room\s+availability|"
    r"room\s+options|"
    r"hotel\s+room\s+options|"
    r"what\s+(?:hotel\s+)?rooms?|"
    r"which\s+(?:hotel\s+)?rooms?|"
    r"(?:need|want|looking\s+for)\s+(?:a\s+)?room|"
    r"book\s+me\s+(?:a\s+)?room|"
    r"(?:affordable|budget|cheapest|lowest\s+price)\s+(?:room|suite)|"
    r"best\s+(?:room|suite)\s+for|"
    r"recommend(?:\s+me)?\s+(?:a\s+)?(?:room|suite)|"
    r"suggest(?:\s+me)?\s+(?:a\s+)?(?:room|suite)|"
    r"family\s+of\s+(?:\d+|one|two|three|four|five|six|seven|eight)"
    r")\b",
    re.IGNORECASE,
)

ROOM_DISCOVERY_CONTEXT_RE = re.compile(
    r"\b(room|rooms|suite|suites|hotel\s+room|hotel\s+rooms)\b",
    re.IGNORECASE,
)

ROOM_DISCOVERY_ACTION_RE = re.compile(
    r"\b(available|availability|options?|show|see|view|explore|browse|book|need|want|looking|recommend|suggest|best|affordable|budget|cheapest)\b",
    re.IGNORECASE,
)

ROOM_PREVIEW_QUERY_RE = re.compile(
    r"\b("
    r"this\s+room|"
    r"balcony|view|city\s+view|sea\s+view|ocean\s+view|"
    r"bathroom|bathtub|washroom|shower|"
    r"bed|bedroom|workspace|desk|wifi|tv|feature|features|amenit(?:y|ies)"
    r")\b",
    re.IGNORECASE,
)

BOOKING_FLOW_RE = re.compile(
    r"\b("
    r"my\s+name\s+is|"
    r"\d+\s+adults?|"
    r"\d+\s+children?|"
    r"guest\s+name|"
    r"check\s+in\s+on|"
    r"for\s+\d+\s+nights?|"
    r"proceed\s+to\s+payment|"
    r"continue\s+to\s+payment|"
    r"everything\s+is\s+correct|"
    r"details\s+are\s+correct|"
    r"change\s+the\s+guest\s+name|"
    r"change\s+the\s+stay|"
    r"change\s+the\s+dates|"
    r"modify\s+booking"
    r")\b",
    re.IGNORECASE,
)

FAQ_INFO_HINT_RE = re.compile(
    r"\b("
    r"breakfast|wifi|wi[\s-]?fi|internet|parking|pool|gym|spa|restaurant|"
    r"check[\s-]?(?:in|out)\s+time|check[\s-]?(?:in|out)\s+timing|"
    r"timing|hours?|password|facility|facilities|manager|support|help"
    r")\b",
    re.IGNORECASE,
)


def _texts_for_matching(transcript: str, repaired_transcript: str) -> tuple[str, ...]:
    normalized_raw = normalize_faq_query(transcript)
    normalized_repaired = normalize_faq_query(repaired_transcript)
    return tuple(
        value
        for value in (
            transcript.strip(),
            repaired_transcript.strip(),
            normalized_raw,
            normalized_repaired,
        )
        if value
    )


def _matches(pattern: re.Pattern[str], texts: tuple[str, ...]) -> bool:
    return any(pattern.search(text) for text in texts)


def classify_query_type(
    transcript: str,
    current_screen: str,
    *,
    repaired_transcript: str | None = None,
) -> QueryType:
    raw_text = str(transcript or "").strip()
    if not raw_text:
        return "UNKNOWN"

    screen = str(current_screen or "").strip().upper()
    repaired_text = str(repaired_transcript or repair_transcript_for_routing(raw_text)).strip()
    texts = _texts_for_matching(raw_text, repaired_text)

    if screen == "ROOM_PREVIEW" and _matches(ROOM_PREVIEW_QUERY_RE, texts):
        return "ROOM_PREVIEW_QUERY"

    if screen in {"BOOKING_COLLECT", "BOOKING_SUMMARY", "PAYMENT"}:
        return "BOOKING_FLOW"

    if _matches(CHECK_IN_RE, texts):
        return "CHECK_IN"

    if _matches(ROOM_COMPARISON_RE, texts):
        return "ROOM_COMPARISON"

    if looks_like_room_discovery_repairable(raw_text):
        return "ROOM_DISCOVERY"

    if _matches(ROOM_DISCOVERY_RE, texts):
        return "ROOM_DISCOVERY"

    if _matches(ROOM_DISCOVERY_CONTEXT_RE, texts) and _matches(ROOM_DISCOVERY_ACTION_RE, texts):
        return "ROOM_DISCOVERY"

    if _matches(BOOKING_FLOW_RE, texts):
        return "BOOKING_FLOW"

    if _matches(FAQ_INFO_HINT_RE, texts) and is_faq_candidate_query(raw_text):
        return "FAQ_INFO"

    if is_faq_candidate_query(raw_text) and not _matches(ROOM_DISCOVERY_CONTEXT_RE, texts):
        return "FAQ_INFO"

    return "UNKNOWN"
