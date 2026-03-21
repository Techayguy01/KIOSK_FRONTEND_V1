"""
api/chat.py

The main chat endpoint that the React frontend calls.
Receives a transcript and current UI state, runs it through LangGraph, and returns
the speech response and next UI screen.
"""

from __future__ import annotations

import difflib
import re
import traceback
from datetime import date, datetime
from typing import Optional, get_args
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from agent.graph import kiosk_agent
from agent.nodes import _is_room_change_request, log_decision_trace
from agent.state import (
    BookingSlots,
    ConversationTurn,
    KioskState,
    RoomInventoryItem,
    UIScreen,
)
from core import database as database_runtime
from core.database import get_session
from core.voice import normalize_language_code, normalize_language_list
from models.booking import Booking
from models.room_instance import RoomInstance
from models.tenant import Tenant
from models.tenant_config import TenantConfig
from services.booking_guards import (
    resolve_effective_room_payload,
    sanitize_booking_constraints,
)
from services.faq_service import (
    FAQ_MATCH_THRESHOLD,
    find_best_faq_match,
    is_faq_candidate_query,
    normalize_faq_query,
)
from services.query_classifier import QueryType, classify_query_type
from services.transcript_understanding import repair_transcript_for_routing

router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory session store (replace with Redis in production)
# ---------------------------------------------------------------------------
_sessions: dict[str, KioskState] = {}
_persisted_booking_by_session: dict[str, str] = {}
_persisted_room_id_by_session: dict[str, str] = {}
_persisted_room_number_by_session: dict[str, str] = {}

# ---------------------------------------------------------------------------
# Slot name mappings
# ---------------------------------------------------------------------------
SLOT_NAME_MAP: dict[str, str] = {
    "room_type": "roomType",
    "adults": "adults",
    "children": "children",
    "check_in_date": "checkInDate",
    "check_out_date": "checkOutDate",
    "guest_name": "guestName",
}
CONTRACT_TO_BACKEND_SLOT_MAP: dict[str, str] = {v: k for k, v in SLOT_NAME_MAP.items()}

# Frontend camelCase -> backend snake_case (includes "nights" which has no inverse)
_FRONTEND_TO_BACKEND_SLOT: dict[str, str] = {
    "roomType": "room_type",
    "adults": "adults",
    "children": "children",
    "checkInDate": "check_in_date",
    "checkOutDate": "check_out_date",
    "guestName": "guest_name",
    "nights": "nights",
}
_NUMERIC_SLOTS: frozenset[str] = frozenset({"adults", "children", "nights"})

# ---------------------------------------------------------------------------
# UI screen normalization
# ---------------------------------------------------------------------------
UI_SCREEN_VALUES: set[str] = {v for v in get_args(UIScreen)}

UI_STATE_ALIASES: dict[str, str] = {
    "AI-CHAT": "AI_CHAT",
    "AICHAT": "AI_CHAT",
    "MANUAL-MENU": "MANUAL_MENU",
    "MANUALMENU": "MANUAL_MENU",
    "SCAN-ID": "SCAN_ID",
    "ID-VERIFY": "ID_VERIFY",
    "IDVERIFY": "ID_VERIFY",
    "CHECK-IN-SUMMARY": "CHECK_IN_SUMMARY",
    "CHECKINSUMMARY": "CHECK_IN_SUMMARY",
    "ROOMSELECT": "ROOM_SELECT",
    "ROOM-PREVIEW": "ROOM_PREVIEW",
    "ROOMPREVIEW": "ROOM_PREVIEW",
    "BOOKINGCOLLECT": "BOOKING_COLLECT",
    "BOOKINGSUMMARY": "BOOKING_SUMMARY",
    "KEY-DISPENSING": "KEY_DISPENSING",
}

FAQ_BLOCKED_SCREENS: frozenset[str] = frozenset({
    "SCAN_ID", "ID_VERIFY", "CHECK_IN_SUMMARY", "ROOM_SELECT",
    "ROOM_PREVIEW", "BOOKING_COLLECT", "BOOKING_SUMMARY",
    "PAYMENT", "KEY_DISPENSING", "COMPLETE",
})

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------
TRANSACTIONAL_BOOKING_RE = re.compile(
    r"\b("
    r"book(?:\s+a)?\s+room|room\s+booking|book(?:ing)?\b|"
    r"reserve(?:\s+a)?\s+room|make\s+a\s+booking|"
    r"start\s+booking|new\s+reservation"
    r")\b",
    re.IGNORECASE,
)
TRANSACTIONAL_CHECKIN_RE = re.compile(
    r"\b("
    r"check[\s-]?in|check\s+me\s+in|start\s+check[\s-]?in|"
    r"begin\s+check[\s-]?in|i\s+have\s+a\s+booking|"
    r"existing\s+booking|my\s+reservation"
    r")\b",
    re.IGNORECASE,
)
ROOM_RECOMMENDATION_RE = re.compile(
    r"\b("
    r"(?:which|what)\s+room\s+(?:should|would|is)|"
    r"recommend(?:\s+me)?\s+(?:a\s+)?(?:room|suite)|"
    r"suggest(?:\s+me)?\s+(?:a\s+)?(?:room|suite)|"
    r"best\s+(?:room|suite)\s+for|"
    r"(?:affordable|budget|cheapest|lowest\s+price)\s+(?:room|suite)|"
    r"compare\s+(?:rooms?|the\s+.+)|"
    r"difference\s+between\s+.+\s+and\s+.+|"
    r"which\s+is\s+better|which\s+one\s+is\s+better|"
    r"which\s+(?:room|suite)\s+(?:is|would\s+be)\s+best|"
    r"which\s+(?:room|suite)\s+is\s+better"
    r")\b",
    re.IGNORECASE,
)
ROOM_GUEST_FIT_RE = re.compile(
    r"\b("
    r"family\s+of\s+(?:\d+|one|two|three|four|five|six|seven|eight)|"
    r"(?:\d+|one|two|three|four|five|six|seven|eight)\s+adults?"
    r"(?:\s+and\s+(?:\d+|one|two|three|four|five|six|seven|eight)\s+children?)?"
    r")\b",
    re.IGNORECASE,
)
ROOM_DISCOVERY_CONTEXT_RE = re.compile(
    r"\b("
    r"room|suite|rooms|suites|fit|fits|good\s+for|best\s+for|suitable|"
    r"recommend|suggest|choose|look\s+at|look\s+for|"
    r"compare|difference|better|vs|versus|affordable|budget|cheapest|lowest\s+price"
    r")\b",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Visual / amenity topic maps
# ---------------------------------------------------------------------------
VISUAL_TOPIC_ALIASES: dict[str, list[str]] = {
    "bathroom": ["bathroom", "washroom", "restroom", "toilet", "shower", "bathtub", "bath"],
    "bedroom": ["bedroom", "bed room", "sleeping area", "sleep area", "bed"],
    "balcony": ["balcony", "sit out", "sit-out", "sitout", "terrace", "patio", "veranda", "verandah"],
    "living area": ["living area", "living room", "lounge", "seating area", "sofa area"],
    "view": ["view", "window", "ocean view", "sea view", "city view", "garden view"],
    "dining": ["dining", "dining area", "breakfast table", "table"],
    "workspace": ["workspace", "work desk", "desk", "study area"],
}
VISUAL_TAG_MATCH_REQUIRES_TOPIC_CATEGORY: frozenset[str] = frozenset({
    "living area", "workspace", "dining",
})
AMENITY_ALIASES: dict[str, list[str]] = {
    "fireplace": ["fireplace", "fire place"],
    "ac": ["ac", "a c", "air conditioning", "air conditioner", "aircon"],
    "wifi": ["wifi", "wi fi", "internet"],
    "tv": ["tv", "television"],
    "bathtub": ["bathtub", "bath tub", "tub"],
}

# Phrases that hint the user wants to *see* something (visual concierge path)
_VISUAL_HINT_PHRASES: tuple[str, ...] = (
    "show", "see", "look", "tell me about", "what", "how", "facility",
    "facilities", "feature", "features", "amenity", "amenities", "have", "has",
)
_VISUAL_VERB_PHRASES: tuple[str, ...] = (
    "show", "see", "look", "view", "image", "photo", "picture", "display",
)
_ROOM_OVERVIEW_PHRASES: tuple[str, ...] = (
    "tell me more", "describe", "about this room", "about the room",
    "about ocean", "about suite", "all its features", "all the features",
    "what does this room have", "what does the room have",
    "what amenities", "what features", "know about",
)

# ---------------------------------------------------------------------------
# Text normalization helpers
# ---------------------------------------------------------------------------

def _normalize_visual_text(value: object) -> str:
    text_val = str(value or "").strip().lower()
    if not text_val:
        return ""
    text_val = re.sub(r"[_\-]", " ", text_val)
    text_val = re.sub(r"[^a-z0-9\s]", " ", text_val)
    return re.sub(r"\s+", " ", text_val).strip()


def _humanize_visual_label(value: object) -> str:
    words = _normalize_visual_text(value).split()
    if not words:
        return ""
    return " ".join([words[0].capitalize(), *words[1:]])


def _phrase_in_text(text_value: str, phrase: str) -> bool:
    n_text = _normalize_visual_text(text_value)
    n_phrase = _normalize_visual_text(phrase)
    if not n_text or not n_phrase:
        return False
    pattern = r"\b" + re.escape(n_phrase).replace(r"\ ", r"\s+") + r"\b"
    return bool(re.search(pattern, n_text))


# ---------------------------------------------------------------------------
# Room catalog helpers
# ---------------------------------------------------------------------------

def _resolve_selected_room_catalog_entry(
    room_catalog: Optional[list[dict]],
    selected_room_payload: Optional[dict],
    slots_dict: Optional[dict],
) -> Optional[dict]:
    if not room_catalog:
        return None

    selected_id = str((selected_room_payload or {}).get("id") or "").strip()
    selected_name = _normalize_visual_text(
        (selected_room_payload or {}).get("name")
        or (selected_room_payload or {}).get("displayName")
        or (slots_dict or {}).get("room_type")
        or (slots_dict or {}).get("roomType")
    )

    for room in room_catalog:
        if isinstance(room, dict) and selected_id and str(room.get("id") or "").strip() == selected_id:
            return room

    for room in room_catalog:
        if isinstance(room, dict):
            room_name = _normalize_visual_text(room.get("name") or room.get("displayName"))
            if selected_name and room_name == selected_name:
                return room

    return None


def _extract_selected_room_images(
    room_catalog: Optional[list[dict]],
    selected_room_payload: Optional[dict],
    slots_dict: Optional[dict],
) -> list[dict]:
    payload_images = (selected_room_payload or {}).get("images")
    if isinstance(payload_images, list):
        enriched = [
            img for img in payload_images
            if isinstance(img, dict) and str(img.get("url") or "").strip()
        ]
        if enriched:
            return enriched

    room_entry = _resolve_selected_room_catalog_entry(room_catalog, selected_room_payload, slots_dict)
    if not room_entry:
        return []
    raw = room_entry.get("images")
    if not isinstance(raw, list):
        return []
    return [img for img in raw if isinstance(img, dict) and str(img.get("url") or "").strip()]


def _extract_selected_room_features(
    room_catalog: Optional[list[dict]],
    selected_room_payload: Optional[dict],
    slots_dict: Optional[dict],
) -> list[str]:
    room_entry = _resolve_selected_room_catalog_entry(room_catalog, selected_room_payload, slots_dict)
    features = room_entry.get("features") if isinstance(room_entry, dict) else None
    if not isinstance(features, list):
        features = (selected_room_payload or {}).get("features")
    if not isinstance(features, list):
        return []
    return [str(f).strip() for f in features if str(f or "").strip()]


# ---------------------------------------------------------------------------
# Visual topic matching
# ---------------------------------------------------------------------------

def _extract_requested_visual_topics(transcript: str) -> list[str]:
    n = _normalize_visual_text(transcript)
    if not n:
        return []
    matches: list[str] = []
    for topic, aliases in VISUAL_TOPIC_ALIASES.items():
        if any(_phrase_in_text(n, alias) for alias in aliases):
            matches.append(topic)
    return matches


def _topic_aliases(topic: str) -> list[str]:
    return [
        _normalize_visual_text(topic),
        *[_normalize_visual_text(a) for a in VISUAL_TOPIC_ALIASES.get(topic, [])],
    ]


def _text_matches_topic(text_value: str, topic: str) -> bool:
    return any(_phrase_in_text(text_value, a) for a in _topic_aliases(topic) if a)


def _resolve_visual_focus(
    transcript: str,
    room_catalog: Optional[list[dict]],
    selected_room_payload: Optional[dict],
    slots_dict: Optional[dict],
) -> Optional[dict]:
    images = _extract_selected_room_images(room_catalog, selected_room_payload, slots_dict)
    n_transcript = _normalize_visual_text(transcript)
    if not images or not n_transcript:
        return None

    requested_topics = _extract_requested_visual_topics(transcript)
    transcript_tokens = {t for t in n_transcript.split() if len(t) >= 4}

    best_match: Optional[dict] = None
    best_score = 0

    for image in images:
        category_text = _normalize_visual_text(image.get("category"))
        caption_text = _normalize_visual_text(image.get("caption"))
        tag_texts = [_normalize_visual_text(t) for t in (image.get("tags") or []) if _normalize_visual_text(t)]
        searchable_text = " ".join([category_text, caption_text, *tag_texts]).strip()
        if not searchable_text:
            continue

        score = 0
        matched_topic = category_text or None

        for topic in requested_topics:
            aliases = [a for a in _topic_aliases(topic) if a]
            for alias in aliases:
                if _phrase_in_text(category_text, alias):
                    score = max(score, 12)
                    matched_topic = topic
                elif _phrase_in_text(caption_text, alias):
                    score = max(score, 10)
                    matched_topic = topic
                elif any(_phrase_in_text(tag, alias) for tag in tag_texts):
                    if topic in VISUAL_TAG_MATCH_REQUIRES_TOPIC_CATEGORY and not (
                        _text_matches_topic(category_text, topic)
                        or _text_matches_topic(caption_text, topic)
                    ):
                        continue
                    score = max(score, 7)
                    matched_topic = topic

        if score == 0 and transcript_tokens:
            image_tokens = {t for t in searchable_text.split() if len(t) >= 4}
            overlap = transcript_tokens & image_tokens
            if overlap:
                score = len(overlap)
                matched_topic = category_text or sorted(overlap)[0]

        if score > best_score:
            best_score = score
            best_match = {
                "imageId": str(image.get("id") or "").strip() or None,
                "topic": _humanize_visual_label(matched_topic),
                "category": _humanize_visual_label(image.get("category") or matched_topic),
                "caption": str(image.get("caption") or "").strip() or None,
                "tags": [_humanize_visual_label(t) for t in (image.get("tags") or []) if _humanize_visual_label(t)],
            }

    return best_match if best_match and best_match.get("imageId") else None


def _should_use_visual_concierge_reply(transcript: str) -> bool:
    n = _normalize_visual_text(transcript)
    if not n:
        return False
    return any(_phrase_in_text(n, p) for p in _VISUAL_HINT_PHRASES) or bool(
        _extract_requested_visual_topics(transcript)
    )


def _looks_like_visual_request(transcript: str) -> bool:
    n = _normalize_visual_text(transcript)
    return bool(n) and any(_phrase_in_text(n, p) for p in _VISUAL_VERB_PHRASES)


def _find_requested_amenity(transcript: str, room_features: list[str]) -> Optional[dict]:
    n_transcript = _normalize_visual_text(transcript)
    if not n_transcript:
        return None

    normalized_features = [
        {"label": f, "normalized": _normalize_visual_text(f)}
        for f in room_features
        if _normalize_visual_text(f)
    ]

    for amenity_label, aliases in AMENITY_ALIASES.items():
        all_aliases = [_normalize_visual_text(amenity_label), *[_normalize_visual_text(a) for a in aliases]]
        if not any(a and _phrase_in_text(n_transcript, a) for a in all_aliases):
            continue
        matched_feature = next(
            (
                feat for feat in normalized_features
                if feat["normalized"] == _normalize_visual_text(amenity_label)
                or any(_phrase_in_text(feat["normalized"], a) for a in all_aliases if a)
            ),
            None,
        )
        return {
            "label": matched_feature["label"] if matched_feature else _humanize_visual_label(amenity_label),
            "matched": matched_feature is not None,
        }

    for feature in normalized_features:
        if _phrase_in_text(n_transcript, feature["normalized"]):
            return {"label": feature["label"], "matched": True}

    return None


# ---------------------------------------------------------------------------
# Concierge reply builders
# ---------------------------------------------------------------------------

def _build_visual_concierge_reply(
    transcript: str,
    visual_focus: Optional[dict],
    selected_room_payload: Optional[dict],
    language: str,
) -> Optional[str]:
    if not visual_focus or normalize_language_code(language) != "en":
        return None
    if not _should_use_visual_concierge_reply(transcript):
        return None

    room_name = str(
        (selected_room_payload or {}).get("displayName")
        or (selected_room_payload or {}).get("name")
        or ""
    ).strip()
    category_label = str(visual_focus.get("category") or visual_focus.get("topic") or "room detail").strip() or "room detail"
    caption = str(visual_focus.get("caption") or "").strip()
    tag_values = [str(t).strip() for t in (visual_focus.get("tags") or []) if str(t).strip()]

    normalized_category = _normalize_visual_text(category_label)
    supporting_tags: list[str] = []
    seen_tags: set[str] = set()
    _skip_tags = {"luxury", "interior", "outdoor", "view"}
    for tag in tag_values:
        n_tag = _normalize_visual_text(tag)
        if not n_tag or n_tag == normalized_category or n_tag in _skip_tags or n_tag in seen_tags:
            continue
        if normalized_category.endswith(n_tag) or n_tag.endswith(normalized_category):
            continue
        supporting_tags.append(_humanize_visual_label(tag))
        seen_tags.add(n_tag)

    room_features = [
        str(f).strip()
        for f in ((selected_room_payload or {}).get("features") or [])
        if str(f or "").strip()
    ]
    room_phrase = f" in {room_name}" if room_name else ""

    detail_sentence = ""
    if normalized_category == "bathroom":
        has_bathtub = (
            any(_phrase_in_text(t, "bathtub") or _phrase_in_text(t, "soaking tub") for t in supporting_tags)
            or any(_phrase_in_text(f, "bathtub") for f in room_features)
        )
        detail_sentence = (
            "It is a private bathroom, and it also includes a bathtub."
            if has_bathtub else
            "It is a private bathroom."
        )
    elif normalized_category == "balcony":
        has_view = any(_phrase_in_text(t, "view") for t in tag_values)
        has_seating = any(_phrase_in_text(t, "seating") for t in tag_values)
        if has_view and has_seating:
            detail_sentence = "It includes a private balcony with seating and a view."
        elif has_view:
            detail_sentence = "It includes a private balcony with a view."
    elif normalized_category == "bedroom" and caption:
        detail_sentence = f"It shows {caption[:1].lower() + caption[1:]}."

    cat_lower = category_label.lower()
    closing = "If you'd like, I can continue with your booking whenever you're ready."
    if caption:
        return (
            f"Absolutely. Let me show you the {cat_lower}{room_phrase} on screen. "
            f"{detail_sentence or caption}. {closing}"
        )
    if supporting_tags:
        detail_text = ", ".join(supporting_tags[:3])
        return (
            f"Absolutely. I'm bringing up the {cat_lower}{room_phrase} now. "
            f"{detail_sentence or f'You can spot details like {detail_text}.'} "
            f"If you'd like, I can carry on with your booking after this."
        )
    return (
        f"Absolutely. I'm bringing up the {cat_lower}{room_phrase} on screen for you now. "
        f"{detail_sentence + ' ' if detail_sentence else ''}{closing}"
    )


def _build_missing_visual_or_amenity_reply(
    transcript: str,
    visual_focus: Optional[dict],
    selected_room_payload: Optional[dict],
    room_catalog: Optional[list[dict]],
    slots_dict: Optional[dict],
    language: str,
) -> Optional[str]:
    if visual_focus or normalize_language_code(language) != "en":
        return None

    requested_topics = _extract_requested_visual_topics(transcript)
    visual_request = _looks_like_visual_request(transcript) or _should_use_visual_concierge_reply(transcript)
    room_name = str(
        (selected_room_payload or {}).get("displayName")
        or (selected_room_payload or {}).get("name")
        or ""
    ).strip()

    if requested_topics and visual_request:
        topic = _humanize_visual_label(requested_topics[0]) or "that area"
        room_phrase = f" for {room_name}" if room_name else ""
        return (
            f"I do not have a dedicated {topic.lower()} image{room_phrase} right now, "
            "so I am keeping the current room photos visible."
        )

    room_features = _extract_selected_room_features(room_catalog, selected_room_payload, slots_dict)
    requested_amenity = _find_requested_amenity(transcript, room_features)
    if not requested_amenity:
        return None

    amenity_label = str(requested_amenity.get("label") or "that feature").strip() or "that feature"
    room_phrase = f" in {room_name}" if room_name else ""

    if requested_amenity.get("matched"):
        base = f"Yes, {room_name or 'this room'} includes {amenity_label.lower()}."
        if visual_request:
            return (
                f"{base} I do not have a dedicated {amenity_label.lower()} image to show on screen right now, "
                "so I am keeping the current room photos visible."
            )
        return f"{base} I do not have a dedicated {amenity_label.lower()} image on screen right now."

    if visual_request:
        return (
            f"I cannot find a dedicated {amenity_label.lower()} image{room_phrase} right now, "
            "so I am keeping the current room photos visible."
        )
    return f"No, {room_name or 'this room'} does not include {amenity_label.lower()}."


def _should_use_room_overview_reply(transcript: str) -> bool:
    n = _normalize_visual_text(transcript)
    return bool(n) and any(_phrase_in_text(n, p) for p in _ROOM_OVERVIEW_PHRASES)


def _build_room_overview_reply(
    transcript: str,
    selected_room_payload: Optional[dict],
    room_catalog: Optional[list[dict]],
    slots_dict: Optional[dict],
    language: str,
) -> Optional[str]:
    if normalize_language_code(language) != "en" or not _should_use_room_overview_reply(transcript):
        return None

    room_entry = _resolve_selected_room_catalog_entry(room_catalog, selected_room_payload, slots_dict)
    if not room_entry and selected_room_payload:
        room_entry = dict(selected_room_payload)
    if not room_entry:
        return None

    room_name = str(room_entry.get("name") or room_entry.get("displayName") or "this room").strip() or "this room"
    price_value = room_entry.get("price")
    currency = str(room_entry.get("currency") or "INR").strip().upper() or "INR"
    price_text = f"{currency} {price_value:,.0f}" if isinstance(price_value, (int, float)) else None

    max_adults = room_entry.get("maxAdults")
    occupancy_text = (
        f"It is suited for up to {int(max_adults)} adult{'s' if int(max_adults) != 1 else ''}."
        if isinstance(max_adults, (int, float)) else ""
    )

    image_descriptions: list[str] = []
    seen_desc: set[str] = set()
    for img in _extract_selected_room_images(room_catalog, selected_room_payload, slots_dict):
        phrase = str(img.get("caption") or "").strip() or _humanize_visual_label(img.get("category"))
        n_phrase = _normalize_visual_text(phrase)
        if not n_phrase or n_phrase in seen_desc:
            continue
        seen_desc.add(n_phrase)
        image_descriptions.append(phrase)
        if len(image_descriptions) >= 3:
            break

    features = _extract_selected_room_features(room_catalog, selected_room_payload, slots_dict)[:4]

    detail_segments: list[str] = []
    if image_descriptions:
        parts = image_descriptions[:-1] + ([f"and {image_descriptions[-1]}"] if len(image_descriptions) > 1 else image_descriptions)
        detail_segments.append("It includes " + ", ".join(parts) + ".")
    if features:
        if len(features) == 1:
            feature_text = features[0]
        elif len(features) == 2:
            feature_text = f"{features[0]} and {features[1]}"
        else:
            feature_text = f"{', '.join(features[:-1])}, and {features[-1]}"
        detail_segments.append(f"It also comes with {feature_text}.")
    if not detail_segments and occupancy_text:
        detail_segments.append(occupancy_text)

    intro = (
        f"Certainly. {room_name} is available for {price_text}."
        if price_text
        else f"Certainly. Let me tell you more about {room_name}."
    )
    closing = "If you'd like, I can also show you the bathroom, balcony, bedroom, or another room."

    return " ".join(
        s for s in [
            intro,
            occupancy_text if occupancy_text and occupancy_text not in detail_segments else "",
            *detail_segments,
            closing,
        ]
        if s
    ).strip()


# ---------------------------------------------------------------------------
# Slot / UUID helpers
# ---------------------------------------------------------------------------

def _to_contract_slot_name(slot_name: Optional[str]) -> Optional[str]:
    return SLOT_NAME_MAP.get(slot_name, slot_name) if slot_name else None


def _normalize_backend_slot_name(slot_name: Optional[str]) -> Optional[str]:
    normalized = (slot_name or "").strip()
    return CONTRACT_TO_BACKEND_SLOT_MAP.get(normalized, normalized) if normalized else None


def _parse_uuid(raw_value: Optional[str]) -> Optional[UUID]:
    if not raw_value:
        return None
    try:
        return UUID(str(raw_value))
    except Exception:
        return None


def _restore_invalid_booking_slot(
    updated_state: KioskState,
    previous_state: KioskState,
    invalid_slot: Optional[str],
) -> None:
    backend_slot = _normalize_backend_slot_name(invalid_slot)
    if not backend_slot or not hasattr(updated_state.booking_slots, backend_slot):
        return
    previous_value = getattr(previous_state.booking_slots, backend_slot, None)
    updated_state.booking_slots = updated_state.booking_slots.model_copy(update={backend_slot: previous_value})
    updated_state.active_slot = backend_slot
    if backend_slot == "room_type" and previous_state.selected_room is not None:
        updated_state.selected_room = previous_state.selected_room.model_copy(deep=True)


def _resolve_room_type_uuid(
    selected_room_payload: Optional[dict],
    room_type_slot_value: Optional[str],
    room_inventory: list[dict],
) -> Optional[UUID]:
    if selected_room_payload:
        parsed = _parse_uuid(selected_room_payload.get("id"))
        if parsed:
            return parsed

    normalized_hint = (room_type_slot_value or "").strip().lower()
    if not normalized_hint:
        return None

    for room in room_inventory:
        if normalized_hint in {
            str(room.get("name") or "").strip().lower(),
            str(room.get("code") or "").strip().lower(),
        }:
            return _parse_uuid(str(room.get("id")))

    return None


# ---------------------------------------------------------------------------
# Session / slot merging
# ---------------------------------------------------------------------------

def _merge_filled_slots(state: KioskState, filled_slots: dict, room_inventory: list[dict]) -> None:
    """Sync frontend state overrides into the backend session."""
    if not filled_slots:
        return

    explicit_room_type = filled_slots.get("roomType")
    current_slots = state.booking_slots.model_dump()
    has_updates = False

    for frontend_key, backend_key in _FRONTEND_TO_BACKEND_SLOT.items():
        val = filled_slots.get(frontend_key)
        if val is None or str(val).strip() == "":
            continue
        if backend_key in _NUMERIC_SLOTS:
            try:
                current_slots[backend_key] = int(val)
                has_updates = True
            except ValueError:
                pass
        else:
            current_slots[backend_key] = val
            has_updates = True

    if has_updates:
        state.booking_slots = BookingSlots(**current_slots)
        print(f"[ChatAPI][SlotSync] Merged frontend slots: {current_slots}")

    target_room_name = current_slots.get("room_type")
    if not target_room_name:
        return

    normalized_target = target_room_name.strip().lower()
    should_refresh = (
        explicit_room_type is not None and str(explicit_room_type).strip() != ""
    ) or state.selected_room is None
    if not should_refresh or (
        state.selected_room and (state.selected_room.name or "").lower() == normalized_target
    ):
        return

    # Exact match
    for room in room_inventory:
        room_name = (room.get("name") or "").strip().lower()
        room_code = (room.get("code") or "").strip().lower()
        if normalized_target in {room_name, room_code}:
            state.selected_room = RoomInventoryItem(**room)
            print(f"[ChatAPI][SlotSync] Auto-selected room from payload: {state.selected_room.name}")
            return

    # Fuzzy fallback
    room_names = [r.get("name") for r in room_inventory if r.get("name")]
    matches = difflib.get_close_matches(normalized_target, room_names, n=1, cutoff=0.6)
    if matches:
        for room in room_inventory:
            if room.get("name") == matches[0]:
                state.selected_room = RoomInventoryItem(**room)
                print(f"[ChatAPI][SlotSync] Fuzzy auto-selected room from payload: {state.selected_room.name}")
                return


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _database_target_hint() -> str:
    raw_url = getattr(database_runtime, "DATABASE_URL", "") or ""
    if not raw_url:
        return "DATABASE_URL=unset"
    parsed = urlparse(raw_url)
    host = parsed.hostname or "unknown-host"
    port = parsed.port or 5432
    db_name = (parsed.path or "/").lstrip("/") or "unknown-db"
    return f"{parsed.scheme}://{host}:{port}/{db_name}"


async def _acquire_room_type_allocation_lock(
    session: AsyncSession,
    tenant_id: UUID,
    room_type_id: UUID,
) -> None:
    await session.exec(
        text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
        params={"lock_key": f"{tenant_id}:{room_type_id}:room-allocation"},
    )


async def _load_room_instances(
    session: AsyncSession,
    tenant_id: UUID,
    room_type_id: UUID,
) -> list[RoomInstance]:
    result = await session.exec(
        select(RoomInstance)
        .where(
            RoomInstance.tenant_id == tenant_id,
            RoomInstance.room_type_id == room_type_id,
            RoomInstance.status == "ACTIVE",
        )
        .order_by(RoomInstance.room_number, RoomInstance.id)
    )
    return result.all()


def _build_fallback_room_number(room_type_id: UUID, room_inventory: list[dict]) -> str:
    room_type_id_str = str(room_type_id)
    matched = next(
        (r for r in room_inventory if str(r.get("id") or "") == room_type_id_str),
        None,
    )
    if matched:
        code = str(matched.get("code") or "").strip()
        if code:
            return code
        name = str(matched.get("name") or "").strip()
        if name:
            normalized = "".join(c if c.isalnum() else "-" for c in name.upper()).strip("-")
            if normalized:
                return normalized
    return f"ROOM-{room_type_id_str[:6].upper()}"


async def _ensure_room_instance_exists(
    session: AsyncSession,
    tenant_id: UUID,
    room_type_id: UUID,
    room_inventory: list[dict],
) -> list[RoomInstance]:
    instances = await _load_room_instances(session, tenant_id, room_type_id)
    if instances:
        return instances

    fallback_number = _build_fallback_room_number(room_type_id, room_inventory)
    fallback = RoomInstance(
        tenant_id=tenant_id,
        room_type_id=room_type_id,
        room_number=fallback_number,
        status="ACTIVE",
    )
    session.add(fallback)
    await session.flush()
    print(
        "[ChatAPI][RoomAllocation] created_fallback_instance "
        f"tenant_id={tenant_id} room_type_id={room_type_id} room_number={fallback_number}"
    )
    return [fallback]


async def _find_overlapping_bookings_for_room_type(
    session: AsyncSession,
    tenant_id: UUID,
    room_type_id: UUID,
    check_in: date,
    check_out: date,
) -> list[Booking]:
    result = await session.exec(
        select(Booking).where(
            Booking.tenant_id == tenant_id,
            Booking.room_type_id == room_type_id,
            Booking.status.in_(["CONFIRMED", "CHECKED_IN"]),
            Booking.check_in_date < check_out,
            Booking.check_out_date > check_in,
        )
    )
    return result.all()


async def _allocate_available_room_instance(
    session: AsyncSession,
    tenant_id: UUID,
    room_type_id: UUID,
    check_in: date,
    check_out: date,
    room_inventory: list[dict],
) -> Optional[RoomInstance]:
    instances = await _ensure_room_instance_exists(session, tenant_id, room_type_id, room_inventory)
    overlapping = await _find_overlapping_bookings_for_room_type(session, tenant_id, room_type_id, check_in, check_out)

    occupied_ids = {b.assigned_room_id for b in overlapping if b.assigned_room_id}
    available = [i for i in instances if i.id not in occupied_ids]
    legacy_unassigned = sum(1 for b in overlapping if not b.assigned_room_id)

    if legacy_unassigned >= len(available):
        return None
    return available[legacy_unassigned]


async def _resolve_tenant_id(
    session: AsyncSession,
    tenant_id: Optional[str],
    tenant_slug: Optional[str],
) -> Optional[str]:
    if tenant_slug:
        result = await session.exec(select(Tenant).where(Tenant.slug == tenant_slug))
        tenant = result.first()
        if tenant:
            return str(tenant.id)

    if tenant_id and tenant_id != "default":
        parsed = _parse_uuid(tenant_id)
        if parsed:
            return str(parsed)
        print(f"[ChatAPI] Ignoring invalid tenant_id (not UUID): {tenant_id}")

    return None


async def _load_room_inventory(session: AsyncSession, resolved_tenant_id: Optional[str]) -> list[dict]:
    if not resolved_tenant_id:
        return []
    tenant_uuid = _parse_uuid(resolved_tenant_id)
    if not tenant_uuid:
        print(f"[ChatAPI] Skipping room inventory load; tenant_id is not UUID: {resolved_tenant_id}")
        return []

    cols_result = await session.exec(
        text("SELECT column_name FROM information_schema.columns WHERE table_name = 'room_types'")
    )
    available_columns = {row[0] for row in cols_result.all()}

    select_fields = ["id", "name", "code", "price"]
    if "amenities" in available_columns:
        select_fields.append("amenities")
    for optional_col in ("max_adults", "max_children", "max_total_guests"):
        if optional_col in available_columns:
            select_fields.append(optional_col)

    rooms_result = await session.exec(
        text(f"SELECT {', '.join(select_fields)} FROM room_types WHERE tenant_id = CAST(:tenant_id AS uuid)"),
        params={"tenant_id": str(tenant_uuid)},
    )
    return [
        {
            "id": str(row._mapping.get("id")),
            "name": row._mapping.get("name"),
            "code": row._mapping.get("code"),
            "price": float(row._mapping.get("price")),
            "currency": "INR",
            "features": list(row._mapping.get("amenities") or []),
            "maxAdults": row._mapping.get("max_adults"),
            "maxChildren": row._mapping.get("max_children"),
            "maxTotalGuests": row._mapping.get("max_total_guests"),
        }
        for row in rooms_result.all()
    ]


async def _load_tenant_config(session: AsyncSession, resolved_tenant_id: Optional[str]) -> Optional[TenantConfig]:
    tenant_uuid = _parse_uuid(resolved_tenant_id)
    if not tenant_uuid:
        return None
    result = await session.exec(select(TenantConfig).where(TenantConfig.tenant_id == tenant_uuid))
    return result.first()


def _resolve_effective_language(requested_language: Optional[str], tenant_config: Optional[TenantConfig]) -> str:
    requested = normalize_language_code(requested_language or "")
    if not tenant_config:
        return requested

    allowed = normalize_language_list(tenant_config.available_lang or [])
    default = normalize_language_code(tenant_config.default_lang or "en")

    if allowed:
        if requested in allowed:
            return requested
        return default if default in allowed else allowed[0]

    return default


# ---------------------------------------------------------------------------
# UI screen normalization helpers
# ---------------------------------------------------------------------------

def _normalize_ui_screen(raw_screen: Optional[str]) -> UIScreen:
    """Normalize frontend currentState to a valid UIScreen. Defaults to WELCOME."""
    if not raw_screen:
        return "WELCOME"
    candidate = raw_screen.strip()
    if candidate in UI_SCREEN_VALUES:
        return candidate  # type: ignore[return-value]
    canonical = candidate.upper().replace(" ", "_")
    mapped = (
        UI_STATE_ALIASES.get(canonical)
        or UI_STATE_ALIASES.get(canonical.replace("_", ""))
        or canonical
    )
    if mapped in UI_SCREEN_VALUES:
        return mapped  # type: ignore[return-value]
    print(f"[ChatAPI] Unknown current_ui_screen='{raw_screen}', defaulting to WELCOME")
    return "WELCOME"


def _coerce_booking_context_screen(requested_screen: UIScreen, state: KioskState) -> UIScreen:
    """Preserve active booking/preview context when the frontend regresses to WELCOME/IDLE."""
    if requested_screen not in {"WELCOME", "IDLE"}:
        return requested_screen

    previous_screen = state.current_ui_screen
    has_selected_room = state.selected_room is not None or bool(state.booking_slots.room_type)

    if previous_screen == "ROOM_SELECT":
        print(f"[ChatAPI] Preserving room selection context from={previous_screen} requested={requested_screen}")
        return "ROOM_SELECT"

    if previous_screen in {"ROOM_PREVIEW", "BOOKING_COLLECT", "BOOKING_SUMMARY"}:
        print(f"[ChatAPI] Preserving booking context from={previous_screen} requested={requested_screen} -> {previous_screen}")
        return previous_screen

    if has_selected_room:
        print(f"[ChatAPI] Restoring preview context from selected room requested={requested_screen}")
        return "ROOM_PREVIEW"

    return requested_screen


def _looks_like_room_recommendation_prompt(transcript: str) -> bool:
    cleaned = (transcript or "").strip()
    if not cleaned:
        return False
    normalized = normalize_faq_query(cleaned)
    if ROOM_RECOMMENDATION_RE.search(cleaned) or ROOM_RECOMMENDATION_RE.search(normalized):
        return True
    if ROOM_GUEST_FIT_RE.search(cleaned) and ROOM_DISCOVERY_CONTEXT_RE.search(cleaned):
        return True
    if ROOM_GUEST_FIT_RE.search(normalized) and ROOM_DISCOVERY_CONTEXT_RE.search(normalized):
        return True
    return False


def _should_attempt_faq(transcript: str, normalized_ui_screen: UIScreen, query_type: QueryType) -> bool:
    if normalized_ui_screen in FAQ_BLOCKED_SCREENS:
        print(f"[ChatAPI][FAQ] candidate screen={normalized_ui_screen} allowed=False reason=blocked_screen")
        return False

    cleaned = (transcript or "").strip()
    if not cleaned:
        return False

    if query_type != "FAQ_INFO":
        print(f"[ChatAPI][FAQ] candidate screen={normalized_ui_screen} allowed=False reason=query_type_{query_type.lower()}")
        return False

    if len(cleaned) > 240:
        return False

    normalized = normalize_faq_query(cleaned)
    if normalized in {"why", "what", "how", "when", "where", "which", "who", "reason"}:
        print(f"[ChatAPI][FAQ] candidate screen={normalized_ui_screen} allowed=False reason=too_vague")
        return False

    is_candidate = is_faq_candidate_query(cleaned)
    print(f"[ChatAPI][FAQ] candidate screen={normalized_ui_screen} allowed={is_candidate} query_type={query_type}")
    return is_candidate


def _enforce_response_state_invariants(
    updated_state: KioskState,
    response_next_screen: str,
    selected_room_payload: Optional[dict],
    room_inventory: list[dict],
    transcript: str,
) -> tuple[KioskState, str, dict, Optional[dict]]:
    if selected_room_payload:
        try:
            updated_state.selected_room = RoomInventoryItem(**selected_room_payload)
        except Exception:
            pass

    slots_dict = updated_state.booking_slots.model_dump()
    selected_room_name = str(
        (selected_room_payload or {}).get("name")
        or (selected_room_payload or {}).get("displayName")
        or ""
    ).strip()

    if selected_room_name and slots_dict.get("room_type") != selected_room_name:
        updated_state.booking_slots = updated_state.booking_slots.model_copy(
            update={"room_type": selected_room_name}
        )
        slots_dict = updated_state.booking_slots.model_dump()
        print(
            f"[ChatAPI][Invariant] synced room_type from selected room "
            f"session={updated_state.session_id} room={selected_room_name}"
        )

    if not selected_room_payload and slots_dict.get("room_type"):
        selected_room_payload = resolve_effective_room_payload(None, slots_dict, room_inventory)
        if selected_room_payload:
            try:
                updated_state.selected_room = RoomInventoryItem(**selected_room_payload)
            except Exception:
                pass

    room_change_requested = (
        updated_state.current_ui_screen == "BOOKING_SUMMARY"
        and updated_state.resolved_intent == "MODIFY_BOOKING"
        and _is_room_change_request(transcript)
    )
    if (
        updated_state.current_ui_screen == "BOOKING_SUMMARY"
        and response_next_screen == "ROOM_SELECT"
        and not room_change_requested
    ):
        print(f"[ChatAPI][Invariant] preventing BOOKING_SUMMARY -> ROOM_SELECT session={updated_state.session_id}")
        response_next_screen = "BOOKING_COLLECT"

    return updated_state, response_next_screen, slots_dict, selected_room_payload


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    """Accepts the frontend adapter's camelCase payload via aliases."""
    transcript: str
    session_id: str = Field(default="default", alias="sessionId")
    current_ui_screen: str = Field(default="WELCOME", alias="currentState")
    tenant_id: str = Field(default="default", alias="tenantId")
    tenant_slug: Optional[str] = Field(default=None, alias="tenantSlug")
    language: str = "en"
    active_slot: Optional[str] = Field(default=None, alias="activeSlot")
    expected_type: Optional[str] = Field(default=None, alias="expectedType")
    last_system_prompt: Optional[str] = Field(default=None, alias="lastSystemPrompt")
    filled_slots: Optional[dict] = Field(default=None, alias="filledSlots")
    conversation_history: Optional[list[ConversationTurn]] = Field(default=None, alias="conversationHistory")
    room_catalog: Optional[list[dict]] = Field(default=None, alias="roomCatalog")
    selected_room: Optional[dict] = Field(default=None, alias="selectedRoom")

    class Config:
        populate_by_name = True


class ChatResponse(BaseModel):
    """Response contract — camelCase to match frontend brain.service.ts."""
    speech: str
    intent: str
    confidence: float
    nextUiScreen: str
    visualFocus: Optional[dict] = None
    accumulatedSlots: dict
    extractedSlots: Optional[dict] = None
    missingSlots: list[str] = []
    nextSlotToAsk: Optional[str] = None
    selectedRoom: Optional[dict] = None
    isComplete: bool
    persistedBookingId: Optional[str] = None
    assignedRoomId: Optional[str] = None
    assignedRoomNumber: Optional[str] = None
    error: Optional[str] = None
    answerSource: str = "LLM"
    faqId: Optional[str] = None
    normalizedQuery: Optional[str] = None
    sessionId: str
    language: str
    roomDisplayMode: Optional[str] = None
    focusRoomIds: Optional[list[str]] = None
    roomIntroSequence: Optional[list[dict]] = None

    class Config:
        populate_by_name = True


# ---------------------------------------------------------------------------
# Helper: build a ChatResponse from FAQ/fallback paths (DRY)
# ---------------------------------------------------------------------------

def _make_faq_response(
    state: KioskState,
    speech: str,
    intent: str,
    confidence: float,
    normalized_ui_screen: UIScreen,
    persisted_booking_id: Optional[str],
    assigned_room_id: Optional[str],
    assigned_room_number: Optional[str],
    answer_source: str,
    faq_id: Optional[str] = None,
    normalized_query: Optional[str] = None,
    error: Optional[str] = None,
) -> ChatResponse:
    return ChatResponse(
        speech=speech,
        intent=intent,
        confidence=confidence,
        nextUiScreen=normalized_ui_screen,
        accumulatedSlots=state.booking_slots.model_dump(by_alias=True),
        extractedSlots={},
        missingSlots=[],
        nextSlotToAsk=None,
        selectedRoom=state.selected_room.model_dump(by_alias=True) if state.selected_room else None,
        isComplete=state.booking_slots.is_complete(),
        persistedBookingId=persisted_booking_id,
        assignedRoomId=assigned_room_id,
        assignedRoomNumber=assigned_room_number,
        error=error,
        answerSource=answer_source,
        faqId=faq_id,
        normalizedQuery=normalized_query,
        sessionId=state.session_id,
        language=state.language,
    )


def _update_history_and_state(
    state: KioskState,
    session_id: str,
    speech: str,
    intent: str,
    confidence: float,
    next_ui_screen: UIScreen,
) -> None:
    """Append user+assistant turns, update state fields, and persist session."""
    state.history = state.history + [
        ConversationTurn(role="user", content=state.latest_transcript),
        ConversationTurn(role="assistant", content=speech),
    ]
    state.speech_response = speech
    state.resolved_intent = intent
    state.confidence = confidence
    state.next_ui_screen = next_ui_screen
    _sessions[session_id] = state


# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    session: AsyncSession = Depends(get_session),
    x_tenant_slug: Optional[str] = Header(default=None, alias="x-tenant-slug"),
):
    """
    Main conversational endpoint.

    1. Loads or creates the session state.
    2. Updates the state with the incoming transcript + screen.
    3. Runs the LangGraph agent.
    4. Returns the AI response and updated state.
    5. Saves booking to database when complete.
    """
    try:
        # ------------------------------------------------------------------
        # Setup: tenant, language, inventory
        # ------------------------------------------------------------------
        requested_tenant_slug = req.tenant_slug or x_tenant_slug
        resolved_tenant_id = await _resolve_tenant_id(session, req.tenant_id, requested_tenant_slug)
        tenant_config = await _load_tenant_config(session, resolved_tenant_id)
        effective_language = _resolve_effective_language(req.language, tenant_config)
        routing_transcript = repair_transcript_for_routing(req.transcript)
        room_inventory = await _load_room_inventory(session, resolved_tenant_id)

        if not room_inventory and req.room_catalog:
            room_inventory = [
                {
                    "id": str(room.get("id") or ""),
                    "name": room.get("name"),
                    "code": room.get("code"),
                    "price": float(room.get("price") or 0) if room.get("price") is not None else None,
                    "currency": room.get("currency") or "INR",
                    "maxAdults": room.get("maxAdults"),
                    "maxChildren": room.get("maxChildren"),
                    "maxTotalGuests": room.get("maxTotalGuests"),
                }
                for room in req.room_catalog
                if room.get("id") and room.get("name")
            ]
            print(f"[ChatAPI] Using frontend room catalog fallback session={req.session_id} rooms={len(room_inventory)}")

        normalized_ui_screen = _normalize_ui_screen(req.current_ui_screen)
        persisted_booking_id = _persisted_booking_by_session.get(req.session_id)
        assigned_room_id = _persisted_room_id_by_session.get(req.session_id)
        assigned_room_number = _persisted_room_number_by_session.get(req.session_id)

        frontend_selected_room_payload = resolve_effective_room_payload(
            req.selected_room,
            req.filled_slots,
            req.room_catalog or room_inventory,
        )

        # ------------------------------------------------------------------
        # Session load / create
        # ------------------------------------------------------------------
        if req.session_id not in _sessions:
            _sessions[req.session_id] = KioskState(
                session_id=req.session_id,
                tenant_id=resolved_tenant_id or req.tenant_id,
                current_ui_screen=normalized_ui_screen,
                language=effective_language,
                tenant_room_inventory=room_inventory,
            )

        state = _sessions[req.session_id]
        previous_state = state.model_copy(deep=True)

        state.latest_transcript = routing_transcript
        state.language = effective_language
        state.tenant_id = resolved_tenant_id or state.tenant_id
        state.tenant_room_inventory = [RoomInventoryItem(**room) for room in room_inventory]

        if req.filled_slots:
            _merge_filled_slots(state, req.filled_slots, room_inventory)

        if frontend_selected_room_payload:
            try:
                state.selected_room = RoomInventoryItem(**frontend_selected_room_payload)
            except Exception:
                pass
            selected_room_name = str(
                frontend_selected_room_payload.get("name")
                or frontend_selected_room_payload.get("displayName")
                or ""
            ).strip()
            if selected_room_name and state.booking_slots.room_type != selected_room_name:
                state.booking_slots = state.booking_slots.model_copy(update={"room_type": selected_room_name})

        normalized_ui_screen = _coerce_booking_context_screen(normalized_ui_screen, state)
        state.current_ui_screen = normalized_ui_screen

        query_type = classify_query_type(
            req.transcript,
            normalized_ui_screen,
            repaired_transcript=routing_transcript,
        )
        print(
            f"[ChatAPI] request session={req.session_id} screen={normalized_ui_screen} "
            f"tenant={resolved_tenant_id or req.tenant_id} language={effective_language} "
            f"rooms={len(room_inventory)} db={_database_target_hint()} query_type={query_type}"
        )
        if routing_transcript != (req.transcript or "").strip():
            print(f"[ChatAPI] repaired transcript session={req.session_id} raw='{req.transcript}' routed='{routing_transcript}'")

        updated_state: Optional[KioskState] = None

        # ------------------------------------------------------------------
        # FAQ retrieval layer
        # ------------------------------------------------------------------
        if _should_attempt_faq(routing_transcript, normalized_ui_screen, query_type):
            normalized_transcript = normalize_faq_query(routing_transcript)
            print(
                f"[ChatAPI][FAQ] attempt session={req.session_id} "
                f"tenant={resolved_tenant_id or req.tenant_id} query='{normalized_transcript}'"
            )
            faq_lookup = await find_best_faq_match(
                session=session,
                tenant_id=resolved_tenant_id or req.tenant_id,
                user_query=routing_transcript,
                language=state.language,
            )
            if faq_lookup.localizations_synced:
                await session.commit()

            faq_match = faq_lookup.match
            print(
                f"[ChatAPI][FAQ] loaded session={req.session_id} "
                f"faq_count={faq_lookup.faq_count} normalized='{faq_lookup.normalized_query}'"
            )

            if faq_match and faq_match.confidence >= FAQ_MATCH_THRESHOLD:
                print(
                    f"[ChatAPI][FAQ] matched session={req.session_id} faq_id={faq_match.faq_id} "
                    f"confidence={faq_match.confidence:.3f} match_type={faq_match.match_type}"
                )
                _update_history_and_state(state, req.session_id, faq_match.answer, "GENERAL_QUERY", faq_match.confidence, normalized_ui_screen)
                print(f"[ChatAPI][FAQ] respond session={req.session_id} answerSource=FAQ_DB faq_id={faq_match.faq_id}")
                log_decision_trace(
                    "chat_api", intent="GENERAL_QUERY", intent_source="faq_db",
                    selected_room=state.selected_room.model_dump(by_alias=True) if state.selected_room else None,
                    next_screen=normalized_ui_screen, transcript=routing_transcript,
                    raw_transcript=req.transcript, query_type=query_type,
                )
                return _make_faq_response(
                    state, faq_match.answer, "GENERAL_QUERY", faq_match.confidence,
                    normalized_ui_screen, persisted_booking_id, assigned_room_id, assigned_room_number,
                    "FAQ_DB", faq_id=faq_match.faq_id, normalized_query=faq_lookup.normalized_query,
                )

            # No FAQ match — deterministic fallback to avoid hallucination
            fallback_text = (
                "I'm sorry, I don't have that hotel detail right now, "
                "but I'm happy to help with your booking or another question."
            )
            reason = "no_match" if not faq_match else f"low_confidence:{faq_match.confidence:.3f}"
            _update_history_and_state(state, req.session_id, fallback_text, "GENERAL_QUERY", 1.0, normalized_ui_screen)
            print(f"[ChatAPI][FAQ] fallback session={req.session_id} reason={reason} faq_count={faq_lookup.faq_count}")
            log_decision_trace(
                "chat_api", intent="GENERAL_QUERY", intent_source="faq_fallback",
                selected_room=state.selected_room.model_dump(by_alias=True) if state.selected_room else None,
                next_screen=normalized_ui_screen, transcript=routing_transcript,
                raw_transcript=req.transcript, query_type=query_type,
            )
            return _make_faq_response(
                state, fallback_text, "GENERAL_QUERY", 1.0,
                normalized_ui_screen, _persisted_booking_by_session.get(req.session_id),
                None, None, "FAQ_FALLBACK",
            )

        # ------------------------------------------------------------------
        # LangGraph agent
        # ------------------------------------------------------------------
        if not updated_state:
            result: dict = await kiosk_agent.ainvoke(state.model_dump())
            updated_state = KioskState(**result)
            _sessions[req.session_id] = updated_state

        slots_dict = updated_state.booking_slots.model_dump()
        previous_slots_dict = previous_state.booking_slots.model_dump()
        is_complete = updated_state.booking_slots.is_complete()
        missing_slots = [_to_contract_slot_name(s) for s in updated_state.booking_slots.missing_required_slots()]
        next_slot_to_ask = _to_contract_slot_name(updated_state.active_slot)

        persistence_error: Optional[str] = None
        persistence_error_detail: Optional[str] = None

        selected_room_payload = (
            updated_state.selected_room.model_dump(by_alias=True) if updated_state.selected_room else None
        )
        selected_room_payload = resolve_effective_room_payload(selected_room_payload, slots_dict, room_inventory)

        if frontend_selected_room_payload:
            selected_room_payload = resolve_effective_room_payload(
                selected_room_payload or frontend_selected_room_payload,
                slots_dict,
                req.room_catalog or room_inventory,
            ) or selected_room_payload or frontend_selected_room_payload
            if selected_room_payload:
                for media_key in ("images", "imageUrls", "features", "image", "imageUrl"):
                    if not selected_room_payload.get(media_key) and frontend_selected_room_payload.get(media_key):
                        selected_room_payload[media_key] = frontend_selected_room_payload[media_key]

        if selected_room_payload:
            try:
                updated_state.selected_room = RoomInventoryItem(**selected_room_payload)
            except Exception:
                pass
            if selected_room_payload.get("name"):
                selected_room_payload["displayName"] = selected_room_payload["name"]

        response_next_screen = updated_state.next_ui_screen or normalized_ui_screen
        response_speech = updated_state.speech_response or "I'm not sure how to help with that."

        # ------------------------------------------------------------------
        # Booking constraint validation
        # ------------------------------------------------------------------
        sanitized_slots, constraint_error, constraint_slot, constraint_screen = sanitize_booking_constraints(
            slots_dict, previous_slots_dict, selected_room_payload,
        )
        if constraint_error:
            for backend_slot, sanitized_value in sanitized_slots.items():
                if slots_dict.get(backend_slot) != sanitized_value:
                    _restore_invalid_booking_slot(updated_state, previous_state, backend_slot)
            updated_state.active_slot = _normalize_backend_slot_name(constraint_slot)
            _sessions[req.session_id] = updated_state
            slots_dict = updated_state.booking_slots.model_dump()
            is_complete = False
            missing_slots = [_to_contract_slot_name(s) for s in updated_state.booking_slots.missing_required_slots()]
            selected_room_payload = (
                updated_state.selected_room.model_dump(by_alias=True) if updated_state.selected_room else None
            )
            selected_room_payload = resolve_effective_room_payload(selected_room_payload, slots_dict, room_inventory)
            if selected_room_payload and selected_room_payload.get("name"):
                selected_room_payload["displayName"] = selected_room_payload["name"]
            response_speech = constraint_error
            response_next_screen = constraint_screen
            next_slot_to_ask = constraint_slot
            print(
                f"[ChatAPI][BookingValidation] rejected session={req.session_id} "
                f"slot={constraint_slot} screen={constraint_screen} reason={constraint_error}"
            )

        # ------------------------------------------------------------------
        # Booking persistence
        # ------------------------------------------------------------------
        should_persist_booking = (
            not constraint_error
            and normalized_ui_screen == "BOOKING_SUMMARY"
            and updated_state.resolved_intent == "CONFIRM_BOOKING"
            and is_complete
        )
        print(
            f"[ChatAPI][PersistBooking] gate session={req.session_id} "
            f"intent={updated_state.resolved_intent} is_complete={is_complete} "
            f"screen={normalized_ui_screen} allowed={should_persist_booking}"
        )

        if should_persist_booking:
            if not persisted_booking_id:
                print(
                    f"[ChatAPI][PersistBooking] attempt session={req.session_id} "
                    f"room_hint={slots_dict.get('room_type')} "
                    f"check_in={slots_dict.get('check_in_date')} check_out={slots_dict.get('check_out_date')}"
                )
                try:
                    tenant_uuid = _parse_uuid(resolved_tenant_id or updated_state.tenant_id or req.tenant_id)
                    if not tenant_uuid:
                        raise ValueError("Missing or invalid tenant_id for booking persistence.")

                    room_type_uuid = _resolve_room_type_uuid(
                        selected_room_payload, slots_dict.get("room_type"), room_inventory,
                    )
                    if not room_type_uuid:
                        raise ValueError("Could not resolve a valid room_type_id UUID for booking persistence.")

                    check_in = datetime.strptime(slots_dict["check_in_date"], "%Y-%m-%d").date()
                    check_out = datetime.strptime(slots_dict["check_out_date"], "%Y-%m-%d").date()
                    nights_value = slots_dict.get("nights") or max(1, (check_out - check_in).days)

                    await _acquire_room_type_allocation_lock(session, tenant_uuid, room_type_uuid)
                    assigned_room = await _allocate_available_room_instance(
                        session, tenant_uuid, room_type_uuid, check_in, check_out, room_inventory,
                    )
                    if not assigned_room:
                        raise ValueError(
                            "No physical room is available for the selected dates. "
                            "Please choose another room type or change your stay dates."
                        )

                    new_booking = Booking(
                        tenant_id=tenant_uuid,
                        room_type_id=room_type_uuid,
                        assigned_room_id=assigned_room.id,
                        assigned_room_number=assigned_room.room_number,
                        guest_name=slots_dict.get("guest_name", "Unknown"),
                        check_in_date=check_in,
                        check_out_date=check_out,
                        adults=slots_dict.get("adults", 1) or 1,
                        children=slots_dict.get("children", 0) or 0,
                        nights=nights_value,
                        status="CONFIRMED",
                    )
                    session.add(new_booking)
                    await session.commit()

                    persisted_booking_id = str(new_booking.id)
                    assigned_room_id = str(assigned_room.id)
                    assigned_room_number = assigned_room.room_number
                    _persisted_booking_by_session[req.session_id] = persisted_booking_id
                    _persisted_room_id_by_session[req.session_id] = assigned_room_id
                    _persisted_room_number_by_session[req.session_id] = assigned_room_number
                    print(
                        f"[ChatAPI][PersistBooking] success session={req.session_id} "
                        f"booking_id={persisted_booking_id} assigned_room_number={assigned_room_number}"
                    )
                except Exception as db_err:
                    await session.rollback()
                    persistence_error_detail = str(db_err)
                    persistence_error = f"BOOKING_PERSIST_FAILED: {persistence_error_detail}"
                    print(f"[ChatAPI][PersistBooking] failure session={req.session_id} error={db_err}")
            else:
                print(
                    f"[ChatAPI][PersistBooking] skip session={req.session_id} "
                    f"reason=already_persisted booking_id={persisted_booking_id}"
                )

            if persistence_error:
                response_next_screen = "BOOKING_SUMMARY"
                response_speech = (
                    persistence_error_detail
                    if persistence_error_detail and not persistence_error_detail.startswith("Missing or invalid tenant_id")
                    else "I could not finalize your booking due to a system issue. Please try confirm again or use the touch confirm button."
                )
            else:
                response_next_screen = "PAYMENT"
                if not response_speech.strip():
                    response_speech = "Your booking is confirmed. Taking you to payment now."

        # ------------------------------------------------------------------
        # Visual concierge layer
        # ------------------------------------------------------------------
        visual_focus = None
        if normalized_ui_screen in {"ROOM_PREVIEW", "BOOKING_COLLECT"}:
            visual_focus = _resolve_visual_focus(
                transcript=req.transcript,
                room_catalog=req.room_catalog,
                selected_room_payload=selected_room_payload,
                slots_dict=slots_dict,
            )
            is_general_preview = (
                updated_state.resolved_intent == "GENERAL_QUERY"
                and response_next_screen in {"ROOM_PREVIEW", "BOOKING_COLLECT"}
                and not constraint_error
                and not persistence_error
            )
            if is_general_preview:
                concierge_reply = _build_visual_concierge_reply(
                    transcript=req.transcript,
                    visual_focus=visual_focus,
                    selected_room_payload=selected_room_payload,
                    language=updated_state.language,
                )
                if concierge_reply:
                    response_speech = concierge_reply
                    if updated_state.history and updated_state.history[-1].role == "assistant":
                        updated_state.history[-1] = ConversationTurn(role="assistant", content=response_speech)

                missing_visual_reply = _build_missing_visual_or_amenity_reply(
                    transcript=req.transcript,
                    visual_focus=visual_focus,
                    selected_room_payload=selected_room_payload,
                    room_catalog=req.room_catalog,
                    slots_dict=slots_dict,
                    language=updated_state.language,
                )
                if missing_visual_reply and (
                    updated_state.resolved_intent == "GENERAL_QUERY"
                    or _looks_like_visual_request(req.transcript)
                ):
                    response_speech = missing_visual_reply
                    if updated_state.history and updated_state.history[-1].role == "assistant":
                        updated_state.history[-1] = ConversationTurn(role="assistant", content=response_speech)

        room_overview_reply = _build_room_overview_reply(
            transcript=req.transcript,
            selected_room_payload=selected_room_payload,
            room_catalog=req.room_catalog,
            slots_dict=slots_dict,
            language=updated_state.language,
        )
        if (
            room_overview_reply
            and updated_state.resolved_intent == "GENERAL_QUERY"
            and response_next_screen in {"ROOM_PREVIEW", "BOOKING_COLLECT"}
            and not constraint_error
            and not persistence_error
        ):
            response_speech = room_overview_reply
            if updated_state.history and updated_state.history[-1].role == "assistant":
                updated_state.history[-1] = ConversationTurn(role="assistant", content=response_speech)

        if (
            normalized_ui_screen == "ROOM_PREVIEW"
            and updated_state.resolved_intent == "GENERAL_QUERY"
            and response_next_screen in {"WELCOME", "IDLE"}
            and not constraint_error
            and not persistence_error
        ):
            print(f"[ChatAPI] Preventing regressive preview transition session={req.session_id} from={response_next_screen} -> ROOM_PREVIEW")
            response_next_screen = "ROOM_PREVIEW"

        # ------------------------------------------------------------------
        # Final invariants + response
        # ------------------------------------------------------------------
        updated_state, response_next_screen, slots_dict, selected_room_payload = _enforce_response_state_invariants(
            updated_state, response_next_screen, selected_room_payload, room_inventory, req.transcript,
        )
        _sessions[req.session_id] = updated_state
        is_complete = updated_state.booking_slots.is_complete()
        missing_slots = [_to_contract_slot_name(s) for s in updated_state.booking_slots.missing_required_slots()]
        next_slot_to_ask = _to_contract_slot_name(updated_state.active_slot)

        if selected_room_payload and selected_room_payload.get("name"):
            selected_room_payload["displayName"] = selected_room_payload["name"]

        log_decision_trace(
            "chat_api",
            intent=updated_state.resolved_intent,
            intent_source="api_response",
            extracted_slots=slots_dict,
            selected_room=selected_room_payload or updated_state.booking_slots.room_type,
            next_screen=response_next_screen,
            transcript=routing_transcript,
            raw_transcript=req.transcript,
            query_type=query_type,
        )

        return ChatResponse(
            speech=response_speech,
            intent=updated_state.resolved_intent or "GENERAL_QUERY",
            confidence=updated_state.confidence,
            nextUiScreen=response_next_screen,
            visualFocus=visual_focus,
            accumulatedSlots=updated_state.booking_slots.model_dump(by_alias=True),
            extractedSlots={},
            missingSlots=[s for s in missing_slots if s],
            nextSlotToAsk=next_slot_to_ask,
            selectedRoom=selected_room_payload,
            isComplete=is_complete,
            persistedBookingId=persisted_booking_id,
            assignedRoomId=assigned_room_id,
            assignedRoomNumber=assigned_room_number,
            error=constraint_error or persistence_error,
            answerSource="LLM",
            faqId=None,
            sessionId=req.session_id,
            language=updated_state.language,
            roomDisplayMode=result.get("roomDisplayMode"),
            focusRoomIds=result.get("focusRoomIds"),
            roomIntroSequence=result.get("roomIntroSequence"),
        )

    except Exception as e:
        print(f"[ChatAPI] ❌ Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/chat/{session_id}")
async def clear_session(session_id: str):
    """Clear a session (called when guest leaves or kiosk resets)."""
    _sessions.pop(session_id, None)
    _persisted_booking_by_session.pop(session_id, None)
    _persisted_room_id_by_session.pop(session_id, None)
    _persisted_room_number_by_session.pop(session_id, None)
    return {"status": "cleared", "session_id": session_id}
