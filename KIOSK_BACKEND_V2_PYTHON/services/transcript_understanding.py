"""
Backend transcript-repair helpers for routing.

These helpers are intentionally conservative: they only rewrite known
speech-to-text artifacts that have already shown up in kiosk logs and that
should deterministically route into transactional room discovery.
"""

from __future__ import annotations

import re


_WHITESPACE_RE = re.compile(r"\s+")

_ROOM_DISCOVERY_REPAIR_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(
            r"\b(?:i\s+want\s+(?:a\s+)?room\s+for\s+)?what\s+hotel\s+rooms?\s+are\s+available(?:\s+in\s+this(?:\s+hotel)?)?\b",
            re.IGNORECASE,
        ),
        "what rooms are available in this hotel",
    ),
    (
        re.compile(
            r"\bwhat\s+hotel\s+rooms?\s+are\s+available(?:\s+in\s+this(?:\s+hotel)?)?\b",
            re.IGNORECASE,
        ),
        "what rooms are available in this hotel",
    ),
    (
        re.compile(
            r"\bwhich\s+hotel\s+rooms?\s+are\s+available(?:\s+in\s+this(?:\s+hotel)?)?\b",
            re.IGNORECASE,
        ),
        "which rooms are available in this hotel",
    ),
)


def _collapse_whitespace(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value).strip()


def repair_transcript_for_routing(transcript: str) -> str:
    cleaned = _collapse_whitespace(str(transcript or ""))
    if not cleaned:
        return ""

    for pattern, replacement in _ROOM_DISCOVERY_REPAIR_RULES:
        if pattern.search(cleaned):
            return replacement

    lowered = cleaned.lower()
    if (
        re.search(r"\bhotel\s+rooms?\b", lowered)
        and re.search(r"\bavailable|availability|options?\b", lowered)
        and re.search(r"\bwhat|which|show|see|view|want|need|looking|browse|book\b", lowered)
    ):
        return "what rooms are available in this hotel"

    return cleaned


def looks_like_room_discovery_repairable(transcript: str) -> bool:
    cleaned = _collapse_whitespace(str(transcript or "")).lower()
    if not cleaned:
        return False

    if re.search(r"\bhotel\s+rooms?\b", cleaned) and re.search(r"\bavailable|availability|options?\b", cleaned):
        return True

    repaired = repair_transcript_for_routing(cleaned)
    return repaired != cleaned and "rooms" in repaired and "available" in repaired
