"""
Normalize speech-to-text artifacts before semantic intent matching.
"""

from __future__ import annotations

import re


STT_CORRECTIONS: dict[str, str] = {
    "virtual true": "virtual tour",
    "virtual chore": "virtual tour",
    "virtual tor": "virtual tour",
    "virtual tool": "virtual tour",
    "buck king": "booking",
    "book king": "booking",
    "bucking": "booking",
    "check een": "check in",
    "check inn": "check in",
    "chicken": "check in",
    "reserve asian": "reservation",
    "won adult": "1 adult",
    "to adults": "2 adults",
    "to adult": "2 adults",
    "for adults": "4 adults",
    "for adult": "4 adults",
    "won child": "1 child",
    "to children": "2 children",
    "won person": "1 person",
    "to people": "2 people",
    "for people": "4 people",
    "to morrow": "tomorrow",
    "to night": "tonight",
    "ball coney": "balcony",
    "balkony": "balcony",
    "bath rum": "bathroom",
    "sweet": "suite",
    "swede": "suite",
    "a meanest": "amenities",
    "amenity's": "amenities",
    "why fi": "wifi",
    "wife i": "wifi",
}

_FILLER_PATTERN = re.compile(
    r"^\s*(?:uh+|um+|ah+|er+|hmm+|hm+|oh+|eh+)\s*[.,!?]*\s*$",
    re.IGNORECASE,
)
_WHITESPACE_RE = re.compile(r"\s{2,}")
_LEADING_PUNCT_RE = re.compile(r"^[.,!?;:\-]+\s*")


def normalize(transcript: str) -> str:
    """Normalize a transcript while preserving proper-noun casing where possible."""
    if not transcript:
        return transcript

    cleaned = transcript.strip()
    cleaned = _LEADING_PUNCT_RE.sub("", cleaned)
    cleaned = _WHITESPACE_RE.sub(" ", cleaned).strip()

    lower = cleaned.lower()
    if lower in STT_CORRECTIONS:
        return STT_CORRECTIONS[lower]

    for wrong, right in STT_CORRECTIONS.items():
        pattern = r"(?<!\w)" + re.escape(wrong) + r"(?!\w)"
        if re.search(pattern, lower):
            cleaned = re.sub(pattern, right, cleaned, flags=re.IGNORECASE)
            lower = cleaned.lower()

    return cleaned


def is_filler_only(transcript: str) -> bool:
    """Return True when the transcript is only filler/noise."""
    text = (transcript or "").strip()
    if not text:
        return True
    return bool(_FILLER_PATTERN.match(text))


def normalize_for_routing(transcript: str) -> tuple[str, bool]:
    """Return a normalized transcript and a filler-only flag."""
    if is_filler_only(transcript):
        return (transcript or "").strip(), True
    return normalize(transcript), False
