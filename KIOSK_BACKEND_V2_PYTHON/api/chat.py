"""
api/chat.py

The main chat endpoint that the React frontend calls.
Receives a transcript and current UI state, runs it through LangGraph, and returns
the speech response and next UI screen.
"""

from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel, Field
from typing import Optional, get_args
from uuid import UUID
from urllib.parse import urlparse
from datetime import date, datetime
import re
from agent.graph import kiosk_agent
from agent.nodes import _is_summary_confirmation_transcript
from agent.state import KioskState, ConversationTurn, RoomInventoryItem, UIScreen
from core.voice import normalize_language_code, normalize_language_list
from core.database import get_session
from core import database as database_runtime
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from sqlalchemy import text
from models.tenant import Tenant
from models.tenant_config import TenantConfig
from services.faq_service import (
    FAQ_MATCH_THRESHOLD,
    find_best_faq_match,
    is_faq_candidate_query,
    normalize_faq_query,
)
from services.booking_guards import (
    resolve_effective_room_payload,
    sanitize_booking_constraints,
)
from models.booking import Booking
from models.room_instance import RoomInstance

router = APIRouter()

# In-memory session store (replace with Redis in production)
_sessions: dict[str, KioskState] = {}
_persisted_booking_by_session: dict[str, str] = {}
_persisted_room_id_by_session: dict[str, str] = {}
_persisted_room_number_by_session: dict[str, str] = {}

SLOT_NAME_MAP = {
    "room_type": "roomType",
    "adults": "adults",
    "children": "children",
    "check_in_date": "checkInDate",
    "check_out_date": "checkOutDate",
    "guest_name": "guestName",
}

CONTRACT_TO_BACKEND_SLOT_MAP = {value: key for key, value in SLOT_NAME_MAP.items()}

UI_SCREEN_VALUES = {value for value in get_args(UIScreen)}
UI_STATE_ALIASES = {
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

FAQ_BLOCKED_SCREENS = {
    "SCAN_ID",
    "ID_VERIFY",
    "CHECK_IN_SUMMARY",
    "ROOM_SELECT",
    "ROOM_PREVIEW",
    "BOOKING_COLLECT",
    "BOOKING_SUMMARY",
    "PAYMENT",
    "KEY_DISPENSING",
    "COMPLETE",
}

TRANSACTIONAL_BOOKING_RE = re.compile(
    r"\b("
    r"book(?:\s+a)?\s+room|"
    r"room\s+booking|"
    r"book(?:ing)?\b|"
    r"reserve(?:\s+a)?\s+room|"
    r"make\s+a\s+booking|"
    r"start\s+booking|"
    r"new\s+reservation"
    r")\b",
    re.IGNORECASE,
)

TRANSACTIONAL_CHECKIN_RE = re.compile(
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

VISUAL_TOPIC_ALIASES: dict[str, list[str]] = {
    "bathroom": ["bathroom", "washroom", "restroom", "toilet", "shower", "bathtub", "bath"],
    "bedroom": ["bedroom", "bed room", "sleeping area", "sleep area", "bed"],
    "balcony": ["balcony", "sit out", "sit-out", "sitout", "terrace", "patio", "veranda", "verandah"],
    "living area": ["living area", "living room", "lounge", "seating area", "sofa area"],
    "view": ["view", "window", "ocean view", "sea view", "city view", "garden view"],
    "dining": ["dining", "dining area", "breakfast table", "table"],
    "workspace": ["workspace", "work desk", "desk", "study area"],
}

VISUAL_TAG_MATCH_REQUIRES_TOPIC_CATEGORY = {
    "living area",
    "workspace",
    "dining",
}

AMENITY_ALIASES: dict[str, list[str]] = {
    "fireplace": ["fireplace", "fire place"],
    "ac": ["ac", "a c", "air conditioning", "air conditioner", "aircon"],
    "wifi": ["wifi", "wi fi", "internet"],
    "tv": ["tv", "television"],
    "bathtub": ["bathtub", "bath tub", "tub"],
}


def _normalize_visual_text(value: object) -> str:
    text_value = str(value or "").strip().lower()
    if not text_value:
        return ""
    text_value = text_value.replace("_", " ").replace("-", " ")
    text_value = re.sub(r"[^a-z0-9\s]", " ", text_value)
    return re.sub(r"\s+", " ", text_value).strip()


def _humanize_visual_label(value: object) -> str:
    normalized = _normalize_visual_text(value)
    if not normalized:
        return ""
    words = normalized.split()
    if not words:
        return ""
    return " ".join([words[0].capitalize(), *words[1:]])


def _phrase_in_text(text_value: str, phrase: str) -> bool:
    normalized_text = _normalize_visual_text(text_value)
    normalized_phrase = _normalize_visual_text(phrase)
    if not normalized_text or not normalized_phrase:
        return False
    pattern = r"\b" + re.escape(normalized_phrase).replace(r"\ ", r"\s+") + r"\b"
    return bool(re.search(pattern, normalized_text))


def _resolve_selected_room_catalog_entry(
    room_catalog: Optional[list[dict]],
    selected_room_payload: Optional[dict],
    slots_dict: Optional[dict],
) -> Optional[dict]:
    if not room_catalog:
        return None

    selected_room_id = str((selected_room_payload or {}).get("id") or "").strip()
    selected_room_name = _normalize_visual_text(
        (selected_room_payload or {}).get("name")
        or (selected_room_payload or {}).get("displayName")
        or (slots_dict or {}).get("room_type")
        or (slots_dict or {}).get("roomType")
    )

    for room in room_catalog:
        if not isinstance(room, dict):
            continue
        if selected_room_id and str(room.get("id") or "").strip() == selected_room_id:
            return room

    for room in room_catalog:
        if not isinstance(room, dict):
            continue
        room_name = _normalize_visual_text(room.get("name") or room.get("displayName"))
        if selected_room_name and room_name == selected_room_name:
            return room

    return None


def _extract_selected_room_images(
    room_catalog: Optional[list[dict]],
    selected_room_payload: Optional[dict],
    slots_dict: Optional[dict],
) -> list[dict]:
    room_entry = _resolve_selected_room_catalog_entry(room_catalog, selected_room_payload, slots_dict)
    if not room_entry:
        return []

    raw_images = room_entry.get("images")
    if not isinstance(raw_images, list):
        return []

    return [
        image for image in raw_images
        if isinstance(image, dict) and str(image.get("url") or "").strip()
    ]


def _extract_selected_room_features(
    room_catalog: Optional[list[dict]],
    selected_room_payload: Optional[dict],
    slots_dict: Optional[dict],
) -> list[str]:
    room_entry = _resolve_selected_room_catalog_entry(room_catalog, selected_room_payload, slots_dict)
    feature_values = room_entry.get("features") if isinstance(room_entry, dict) else None
    if not isinstance(feature_values, list):
        feature_values = (selected_room_payload or {}).get("features")
    if not isinstance(feature_values, list):
        return []

    return [
        str(feature).strip()
        for feature in feature_values
        if str(feature or "").strip()
    ]


def _extract_requested_visual_topics(transcript: str) -> list[str]:
    normalized_transcript = _normalize_visual_text(transcript)
    if not normalized_transcript:
        return []

    matches: list[str] = []
    for topic, aliases in VISUAL_TOPIC_ALIASES.items():
        for alias in aliases:
            if _phrase_in_text(normalized_transcript, alias):
                matches.append(topic)
                break
    return matches


def _topic_aliases(topic: str) -> list[str]:
    return [
        _normalize_visual_text(topic),
        *[_normalize_visual_text(alias) for alias in VISUAL_TOPIC_ALIASES.get(topic, [])],
    ]


def _text_matches_topic(text_value: str, topic: str) -> bool:
    aliases = [alias for alias in _topic_aliases(topic) if alias]
    return any(_phrase_in_text(text_value, alias) for alias in aliases)


def _resolve_visual_focus(
    transcript: str,
    room_catalog: Optional[list[dict]],
    selected_room_payload: Optional[dict],
    slots_dict: Optional[dict],
) -> Optional[dict]:
    images = _extract_selected_room_images(room_catalog, selected_room_payload, slots_dict)
    if not images:
        return None

    normalized_transcript = _normalize_visual_text(transcript)
    if not normalized_transcript:
        return None

    requested_topics = _extract_requested_visual_topics(transcript)
    transcript_tokens = {
        token for token in normalized_transcript.split()
        if len(token) >= 4
    }

    best_match: Optional[dict] = None
    best_score = 0

    for image in images:
        category_text = _normalize_visual_text(image.get("category"))
        caption_text = _normalize_visual_text(image.get("caption"))
        tag_texts = [
            _normalize_visual_text(tag)
            for tag in (image.get("tags") or [])
            if _normalize_visual_text(tag)
        ]
        searchable_text = " ".join([category_text, caption_text, *tag_texts]).strip()
        if not searchable_text:
            continue

        score = 0
        matched_topic = category_text or None

        for topic in requested_topics:
            aliases = [alias for alias in _topic_aliases(topic) if alias]
            for alias in aliases:
                if not alias:
                    continue
                if _phrase_in_text(category_text, alias):
                    score = max(score, 12)
                    matched_topic = topic
                elif _phrase_in_text(caption_text, alias):
                    score = max(score, 10)
                    matched_topic = topic
                elif any(_phrase_in_text(tag_text, alias) for tag_text in tag_texts):
                    category_supports_topic = _text_matches_topic(category_text, topic)
                    caption_supports_topic = _text_matches_topic(caption_text, topic)
                    if topic in VISUAL_TAG_MATCH_REQUIRES_TOPIC_CATEGORY and not (
                        category_supports_topic or caption_supports_topic
                    ):
                        continue
                    score = max(score, 7)
                    matched_topic = topic

        if score == 0 and transcript_tokens:
            image_tokens = {
                token for token in searchable_text.split()
                if len(token) >= 4
            }
            overlap = transcript_tokens.intersection(image_tokens)
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
                "tags": [
                    _humanize_visual_label(tag)
                    for tag in (image.get("tags") or [])
                    if _humanize_visual_label(tag)
                ],
            }

    if not best_match or not best_match.get("imageId"):
        return None

    return best_match


def _should_use_visual_concierge_reply(transcript: str) -> bool:
    normalized_transcript = _normalize_visual_text(transcript)
    if not normalized_transcript:
        return False

    hint_phrases = [
        "show", "see", "look", "tell me about", "what", "how", "facility",
        "facilities", "feature", "features", "amenity", "amenities", "have", "has",
    ]
    return any(_phrase_in_text(normalized_transcript, phrase) for phrase in hint_phrases) or bool(
        _extract_requested_visual_topics(transcript)
    )


def _looks_like_visual_request(transcript: str) -> bool:
    normalized_transcript = _normalize_visual_text(transcript)
    if not normalized_transcript:
        return False

    visual_verbs = ["show", "see", "look", "view", "image", "photo", "picture", "display"]
    return any(_phrase_in_text(normalized_transcript, phrase) for phrase in visual_verbs)


def _find_requested_amenity(transcript: str, room_features: list[str]) -> Optional[dict]:
    normalized_transcript = _normalize_visual_text(transcript)
    if not normalized_transcript:
        return None

    normalized_features = [
        {"label": feature, "normalized": _normalize_visual_text(feature)}
        for feature in room_features
        if _normalize_visual_text(feature)
    ]

    for amenity_label, aliases in AMENITY_ALIASES.items():
        normalized_aliases = [_normalize_visual_text(amenity_label), *[_normalize_visual_text(alias) for alias in aliases]]
        matched_alias = next((alias for alias in normalized_aliases if alias and _phrase_in_text(normalized_transcript, alias)), None)
        if not matched_alias:
            continue

        matched_feature = next(
            (
                feature for feature in normalized_features
                if feature["normalized"] == _normalize_visual_text(amenity_label)
                or any(_phrase_in_text(feature["normalized"], alias) for alias in normalized_aliases if alias)
            ),
            None,
        )
        return {
            "label": matched_feature["label"] if matched_feature else _humanize_visual_label(amenity_label),
            "matched": matched_feature is not None,
        }

    for feature in normalized_features:
        if _phrase_in_text(normalized_transcript, feature["normalized"]):
            return {
                "label": feature["label"],
                "matched": True,
            }

    return None


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

    room_name = str((selected_room_payload or {}).get("displayName") or (selected_room_payload or {}).get("name") or "").strip()
    category_label = str(visual_focus.get("category") or visual_focus.get("topic") or "room detail").strip() or "room detail"
    caption = str(visual_focus.get("caption") or "").strip()
    tag_values = [str(tag).strip() for tag in (visual_focus.get("tags") or []) if str(tag).strip()]
    normalized_category = _normalize_visual_text(category_label)
    supporting_tags = []
    seen_supporting_tags: set[str] = set()
    for tag in tag_values:
        normalized_tag = _normalize_visual_text(tag)
        if not normalized_tag:
            continue
        if normalized_tag == normalized_category:
            continue
        if normalized_category.endswith(normalized_tag) or normalized_tag.endswith(normalized_category):
            continue
        if normalized_tag in {"luxury", "interior", "outdoor", "view"}:
            continue
        if normalized_tag in seen_supporting_tags:
            continue
        supporting_tags.append(_humanize_visual_label(tag))
        seen_supporting_tags.add(normalized_tag)

    room_features = [
        str(feature).strip()
        for feature in ((selected_room_payload or {}).get("features") or [])
        if str(feature or "").strip()
    ]
    room_phrase = f" in {room_name}" if room_name else ""

    detail_sentence = ""
    if normalized_category == "bathroom":
        has_bathtub = (
            any(_phrase_in_text(tag, "bathtub") or _phrase_in_text(tag, "soaking tub") for tag in supporting_tags)
            or any(_phrase_in_text(feature, "bathtub") for feature in room_features)
        )
        detail_sentence = "It is a private bathroom."
        if has_bathtub:
            detail_sentence = "It is a private bathroom, and it also includes a bathtub."
    elif normalized_category == "balcony":
        has_view = any(_phrase_in_text(tag, "view") for tag in tag_values)
        has_seating = any(_phrase_in_text(tag, "seating") for tag in tag_values)
        if has_view and has_seating:
            detail_sentence = "It includes a private balcony with seating and a view."
        elif has_view:
            detail_sentence = "It includes a private balcony with a view."
    elif normalized_category == "bedroom" and caption:
        detail_sentence = f"It shows {caption[:1].lower() + caption[1:]}."

    if caption:
        return (
            f"Absolutely. Let me show you the {category_label.lower()}{room_phrase} on screen. "
            f"{detail_sentence or caption}. If you'd like, I can continue with your booking whenever you're ready."
        )

    if supporting_tags:
        detail_text = ", ".join(supporting_tags[:3])
        return (
            f"Absolutely. I'm bringing up the {category_label.lower()}{room_phrase} now. "
            f"{detail_sentence or f'You can spot details like {detail_text}.'} If you'd like, I can carry on with your booking after this."
        )

    return (
        f"Absolutely. I'm bringing up the {category_label.lower()}{room_phrase} on screen for you now. "
        f"{detail_sentence + ' ' if detail_sentence else ''}If you'd like, I can continue with your booking as soon as you're ready."
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
    room_name = str((selected_room_payload or {}).get("displayName") or (selected_room_payload or {}).get("name") or "").strip()

    if requested_topics and visual_request:
        requested_topic = _humanize_visual_label(requested_topics[0]) or "that area"
        room_phrase = f" for {room_name}" if room_name else ""
        return (
            f"I do not have a dedicated {requested_topic.lower()} image{room_phrase} right now, "
            "so I am keeping the current room photos visible."
        )

    room_features = _extract_selected_room_features(room_catalog, selected_room_payload, slots_dict)
    requested_amenity = _find_requested_amenity(transcript, room_features)
    if not requested_amenity:
        return None

    amenity_label = str(requested_amenity.get("label") or "that feature").strip() or "that feature"
    room_phrase = f" in {room_name}" if room_name else ""

    if requested_amenity.get("matched"):
        if visual_request:
            return (
                f"Yes, {room_name or 'this room'} includes {amenity_label.lower()}. "
                f"I do not have a dedicated {amenity_label.lower()} image to show on screen right now, "
                "so I am keeping the current room photos visible."
            )
        return (
            f"Yes, {room_name or 'this room'} includes {amenity_label.lower()}. "
            f"I do not have a dedicated {amenity_label.lower()} image on screen right now."
        )

    if visual_request:
        return (
            f"I cannot find a dedicated {amenity_label.lower()} image{room_phrase} right now, "
            "so I am keeping the current room photos visible."
        )

    return f"No, {room_name or 'this room'} does not include {amenity_label.lower()}."


def _should_use_room_overview_reply(transcript: str) -> bool:
    normalized_transcript = _normalize_visual_text(transcript)
    if not normalized_transcript:
        return False

    overview_phrases = [
        "tell me more",
        "describe",
        "about this room",
        "about the room",
        "about ocean",
        "about suite",
        "all its features",
        "all the features",
        "what does this room have",
        "what does the room have",
        "what amenities",
        "what features",
        "know about",
    ]
    return any(_phrase_in_text(normalized_transcript, phrase) for phrase in overview_phrases)


def _build_room_overview_reply(
    transcript: str,
    selected_room_payload: Optional[dict],
    room_catalog: Optional[list[dict]],
    slots_dict: Optional[dict],
    language: str,
) -> Optional[str]:
    if normalize_language_code(language) != "en":
        return None
    if not _should_use_room_overview_reply(transcript):
        return None

    room_entry = _resolve_selected_room_catalog_entry(room_catalog, selected_room_payload, slots_dict)
    if not room_entry and selected_room_payload:
        room_entry = dict(selected_room_payload)
    if not room_entry:
        return None

    room_name = str(room_entry.get("name") or room_entry.get("displayName") or "this room").strip() or "this room"
    price_value = room_entry.get("price")
    currency = str(room_entry.get("currency") or "INR").strip().upper() or "INR"
    if isinstance(price_value, (int, float)):
        price_text = f"{currency} {price_value:,.0f}"
    else:
        price_text = None

    max_adults = room_entry.get("maxAdults")
    occupancy_text = (
        f"It is suited for up to {int(max_adults)} adult{'s' if int(max_adults) != 1 else ''}."
        if isinstance(max_adults, (int, float))
        else ""
    )

    image_descriptions: list[str] = []
    seen_descriptions: set[str] = set()
    for image in _extract_selected_room_images(room_catalog, selected_room_payload, slots_dict):
        category = _humanize_visual_label(image.get("category"))
        caption = str(image.get("caption") or "").strip()
        phrase = caption or category
        normalized_phrase = _normalize_visual_text(phrase)
        if not normalized_phrase or normalized_phrase in seen_descriptions:
            continue
        seen_descriptions.add(normalized_phrase)
        image_descriptions.append(phrase)
        if len(image_descriptions) >= 3:
            break

    feature_values = _extract_selected_room_features(room_catalog, selected_room_payload, slots_dict)
    feature_values = [feature for feature in feature_values if feature][:4]

    detail_segments: list[str] = []
    if image_descriptions:
        detail_segments.append(
            "It includes "
            + ", ".join(image_descriptions[:-1] + ([f"and {image_descriptions[-1]}"] if len(image_descriptions) > 1 else image_descriptions))
            + "."
        )
    if feature_values:
        if len(feature_values) == 1:
            feature_text = feature_values[0]
        elif len(feature_values) == 2:
            feature_text = f"{feature_values[0]} and {feature_values[1]}"
        else:
            feature_text = f"{', '.join(feature_values[:-1])}, and {feature_values[-1]}"
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
        segment for segment in [
            intro,
            occupancy_text if occupancy_text and occupancy_text not in detail_segments else "",
            *detail_segments,
            closing,
        ]
        if segment
    ).strip()

# Retrieval-first hotel policy architecture:
# 1. FAQ / policy DB answers deterministic, tenant-scoped questions first.
# 2. Only unmatched requests fall through to router + LLM.
# 3. Do not stuff full hotel policy into every prompt; retrieve only relevant snippets later.
# 4. Browser IndexedDB is a secondary cache, not the source of truth.


def _to_contract_slot_name(slot_name: Optional[str]) -> Optional[str]:
    if not slot_name:
        return None
    return SLOT_NAME_MAP.get(slot_name, slot_name)


def _parse_uuid(raw_value: Optional[str]) -> Optional[UUID]:
    if not raw_value:
        return None
    try:
        return UUID(str(raw_value))
    except Exception:
        return None


def _normalize_backend_slot_name(slot_name: Optional[str]) -> Optional[str]:
    if not slot_name:
        return None
    normalized = str(slot_name).strip()
    if not normalized:
        return None
    return CONTRACT_TO_BACKEND_SLOT_MAP.get(normalized, normalized)


def _restore_invalid_booking_slot(
    updated_state: KioskState,
    previous_state: KioskState,
    invalid_slot: Optional[str],
) -> None:
    backend_slot = _normalize_backend_slot_name(invalid_slot)
    if not backend_slot or not hasattr(updated_state.booking_slots, backend_slot):
        return

    previous_value = getattr(previous_state.booking_slots, backend_slot, None)
    slot_updates = {backend_slot: previous_value}
    updated_state.booking_slots = updated_state.booking_slots.model_copy(update=slot_updates)
    updated_state.active_slot = backend_slot

    if backend_slot == "room_type" and previous_state.selected_room is not None:
        updated_state.selected_room = previous_state.selected_room.model_copy(deep=True)


def _resolve_room_type_uuid(
    selected_room_payload: Optional[dict],
    room_type_slot_value: Optional[str],
    room_inventory: list[dict],
) -> Optional[UUID]:
    selected_room_id = None
    if selected_room_payload:
        selected_room_id = selected_room_payload.get("id")
    parsed_selected_room_id = _parse_uuid(selected_room_id)
    if parsed_selected_room_id:
        return parsed_selected_room_id

    normalized_room_hint = (room_type_slot_value or "").strip().lower()
    if not normalized_room_hint:
        return None

    for room in room_inventory:
        room_name = str(room.get("name") or "").strip().lower()
        room_code = str(room.get("code") or "").strip().lower()
        if normalized_room_hint == room_name or (room_code and normalized_room_hint == room_code):
            return _parse_uuid(str(room.get("id")))

    return None


def _database_target_hint() -> str:
    raw_url = getattr(database_runtime, "DATABASE_URL", "") or ""
    if not raw_url:
        return "DATABASE_URL=unset"
    parsed = urlparse(raw_url)
    host = parsed.hostname or "unknown-host"
    port = parsed.port or 5432
    database_name = (parsed.path or "/").lstrip("/") or "unknown-db"
    return f"{parsed.scheme}://{host}:{port}/{database_name}"


def _merge_filled_slots(state: KioskState, filled_slots: dict, room_inventory: list[dict]) -> None:
    """
    Sync frontend state overrides (like manual touch input) into the backend session logic.
    Only overwrites backend state if the frontend actually provided a value.
    """
    if not filled_slots:
        return

    # Map camelCase from React to snake_case for Pydantic
    slot_mapping = {
        "roomType": "room_type",
        "adults": "adults",
        "children": "children",
        "checkInDate": "check_in_date",
        "checkOutDate": "check_out_date",
        "guestName": "guest_name",
        "nights": "nights"
    }

    current_slots = state.booking_slots.model_dump()
    has_updates = False

    for frontend_key, backend_key in slot_mapping.items():
        val = filled_slots.get(frontend_key)
        if val is not None and str(val).strip() != "":
            # Convert numeric fields
            if backend_key in ["adults", "children", "nights"]:
                try:
                    current_slots[backend_key] = int(val)
                    has_updates = True
                except ValueError:
                    pass
            else:
                current_slots[backend_key] = val
                has_updates = True

    if has_updates:
        # Rebuild the model to ensure validation
        from agent.state import BookingSlots
        state.booking_slots = BookingSlots(**current_slots)
        print(f"[ChatAPI][SlotSync] Merged frontend slots: {current_slots}")

    # If frontend told us the room type, ensure selected_room is populated
    # so capacity constraints use the correct limits.
    target_room_name = current_slots.get("room_type")
    if target_room_name:
        normalized_target = target_room_name.strip().lower()
        if not state.selected_room or (state.selected_room.name or "").lower() != normalized_target:
            import difflib
            # Find the best match in the inventory
            for room in room_inventory:
                room_name = (room.get("name") or "").strip().lower()
                room_code = (room.get("code") or "").strip().lower()
                
                if normalized_target == room_name or (room_code and normalized_target == room_code):
                    from agent.state import RoomInventoryItem
                    state.selected_room = RoomInventoryItem(**room)
                    print(f"[ChatAPI][SlotSync] Auto-selected room from payload: {state.selected_room.name}")
                    break
            else:
                # Fallback to fuzzy match if exact fails
                room_names = [r.get("name") for r in room_inventory if r.get("name")]
                matches = difflib.get_close_matches(normalized_target, room_names, n=1, cutoff=0.6)
                if matches:
                    best_match = matches[0]
                    for room in room_inventory:
                        if room.get("name") == best_match:
                            from agent.state import RoomInventoryItem
                            state.selected_room = RoomInventoryItem(**room)
                            print(f"[ChatAPI][SlotSync] Fuzzy auto-selected room from payload: {state.selected_room.name}")
                            break


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
        select(RoomInstance).where(
            RoomInstance.tenant_id == tenant_id,
            RoomInstance.room_type_id == room_type_id,
            RoomInstance.status == "ACTIVE",
        ).order_by(RoomInstance.room_number, RoomInstance.id)
    )
    return result.all()


def _build_fallback_room_number(
    room_type_id: UUID,
    room_inventory: list[dict],
) -> str:
    room_type_id_str = str(room_type_id)
    matched_room = next(
        (room for room in room_inventory if str(room.get("id") or "") == room_type_id_str),
        None,
    )
    if matched_room:
        room_code = str(matched_room.get("code") or "").strip()
        if room_code:
            return room_code
        room_name = str(matched_room.get("name") or "").strip()
        if room_name:
            normalized_name = "".join(
                char if char.isalnum() else "-"
                for char in room_name.upper()
            ).strip("-")
            if normalized_name:
                return normalized_name
    return f"ROOM-{room_type_id_str[:6].upper()}"


async def _ensure_room_instance_exists(
    session: AsyncSession,
    tenant_id: UUID,
    room_type_id: UUID,
    room_inventory: list[dict],
) -> list[RoomInstance]:
    room_instances = await _load_room_instances(session, tenant_id, room_type_id)
    if room_instances:
        return room_instances

    fallback_room_number = _build_fallback_room_number(room_type_id, room_inventory)
    fallback_instance = RoomInstance(
        tenant_id=tenant_id,
        room_type_id=room_type_id,
        room_number=fallback_room_number,
        status="ACTIVE",
    )
    session.add(fallback_instance)
    await session.flush()
    print(
        "[ChatAPI][RoomAllocation] created_fallback_instance "
        f"tenant_id={tenant_id} "
        f"room_type_id={room_type_id} "
        f"room_number={fallback_room_number}"
    )
    return [fallback_instance]


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
    room_instances = await _ensure_room_instance_exists(
        session=session,
        tenant_id=tenant_id,
        room_type_id=room_type_id,
        room_inventory=room_inventory,
    )

    overlapping_bookings = await _find_overlapping_bookings_for_room_type(
        session=session,
        tenant_id=tenant_id,
        room_type_id=room_type_id,
        check_in=check_in,
        check_out=check_out,
    )
    occupied_assigned_room_ids = {
        booking.assigned_room_id
        for booking in overlapping_bookings
        if booking.assigned_room_id
    }
    available_instances = [
        room_instance
        for room_instance in room_instances
        if room_instance.id not in occupied_assigned_room_ids
    ]
    legacy_unassigned_overlap_count = sum(
        1 for booking in overlapping_bookings if not booking.assigned_room_id
    )
    if legacy_unassigned_overlap_count >= len(available_instances):
        return None

    return available_instances[legacy_unassigned_overlap_count]


def _normalize_ui_screen(raw_screen: Optional[str]) -> UIScreen:
    """
    Compatibility normalization between frontend `currentState` and backend UIScreen.
    Unknown values safely collapse to WELCOME instead of failing validation.
    """
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
    """
    Preserve active booking/preview context when the frontend accidentally regresses
    the current screen back to WELCOME/IDLE on a follow-up voice turn.
    """
    if requested_screen not in {"WELCOME", "IDLE"}:
        return requested_screen

    previous_screen = state.current_ui_screen
    has_selected_room = state.selected_room is not None or bool(state.booking_slots.room_type)

    if previous_screen == "ROOM_SELECT":
        print(
            "[ChatAPI] Preserving room selection context "
            f"from={previous_screen} requested={requested_screen}"
        )
        return "ROOM_SELECT"

    if previous_screen in {"ROOM_PREVIEW", "BOOKING_COLLECT", "BOOKING_SUMMARY"} and has_selected_room:
        preserved_screen = "ROOM_PREVIEW" if not state.booking_slots.is_complete() else previous_screen
        print(
            "[ChatAPI] Preserving booking context "
            f"from={previous_screen} requested={requested_screen} -> {preserved_screen}"
        )
        return preserved_screen

    if has_selected_room:
        print(
            "[ChatAPI] Restoring preview context from selected room "
            f"requested={requested_screen}"
        )
        return "ROOM_PREVIEW"

    return requested_screen


def _should_attempt_faq(transcript: str, normalized_ui_screen: UIScreen) -> bool:
    if normalized_ui_screen in FAQ_BLOCKED_SCREENS:
        print(
            "[ChatAPI][FAQ] candidate "
            f"screen={normalized_ui_screen} "
            "allowed=False reason=blocked_screen"
        )
        return False

    # Do not rely on language-specific candidate detection; instead attempt FAQ
    # retrieval on allowed screens and let the matcher decide.
    cleaned = (transcript or "").strip()
    if not cleaned:
        return False
    # Avoid running FAQ retrieval on very long turns (likely conversational/transactional).
    if len(cleaned) > 240:
        return False
    normalized = normalize_faq_query(cleaned)
    if normalized in {"why", "what", "how", "when", "where", "which", "who", "reason"}:
        print(
            "[ChatAPI][FAQ] candidate "
            f"screen={normalized_ui_screen} "
            "allowed=False reason=too_vague"
        )
        return False
    if TRANSACTIONAL_BOOKING_RE.search(cleaned) or TRANSACTIONAL_BOOKING_RE.search(normalized):
        print(
            "[ChatAPI][FAQ] candidate "
            f"screen={normalized_ui_screen} "
            "allowed=False reason=transactional_booking"
        )
        return False
    if TRANSACTIONAL_CHECKIN_RE.search(cleaned) or TRANSACTIONAL_CHECKIN_RE.search(normalized):
        print(
            "[ChatAPI][FAQ] candidate "
            f"screen={normalized_ui_screen} "
            "allowed=False reason=transactional_checkin"
        )
        return False
    # Room browsing / virtual tour phrases are transactional (trigger BOOK_ROOM),
    # not informational.  They must reach the LangGraph agent, not the FAQ pipeline.
    from agent.nodes import _looks_like_room_browsing_request
    if _looks_like_room_browsing_request(cleaned):
        print(
            "[ChatAPI][FAQ] candidate "
            f"screen={normalized_ui_screen} "
            "allowed=False reason=transactional_room_browsing"
        )
        return False

    is_candidate = is_faq_candidate_query(cleaned)
    print(
        "[ChatAPI][FAQ] candidate "
        f"screen={normalized_ui_screen} "
        f"allowed={is_candidate}"
    )
    return is_candidate


async def _resolve_tenant_id(
    session: AsyncSession,
    tenant_id: Optional[str],
    tenant_slug: Optional[str],
) -> Optional[str]:
    if tenant_slug:
        tenant_result = await session.exec(select(Tenant).where(Tenant.slug == tenant_slug))
        tenant = tenant_result.first()
        if tenant:
            return str(tenant.id)

    if tenant_id and tenant_id != "default":
        parsed_tenant_id = _parse_uuid(tenant_id)
        if parsed_tenant_id:
            return str(parsed_tenant_id)
        print(f"[ChatAPI] Ignoring invalid tenant_id (not UUID): {tenant_id}")

    return None


async def _load_room_inventory(session: AsyncSession, resolved_tenant_id: Optional[str]) -> list[dict]:
    if not resolved_tenant_id:
        return []

    tenant_uuid = _parse_uuid(resolved_tenant_id)
    if not tenant_uuid:
        print(f"[ChatAPI] Skipping room inventory load; tenant_id is not UUID: {resolved_tenant_id}")
        return []

    available_columns_result = await session.exec(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'room_types'
            """
        )
    )
    available_columns = {row[0] for row in available_columns_result.all()}

    select_fields = [
        "id",
        "name",
        "code",
        "price",
    ]
    if "max_adults" in available_columns:
        select_fields.append("max_adults")
    if "max_children" in available_columns:
        select_fields.append("max_children")
    if "max_total_guests" in available_columns:
        select_fields.append("max_total_guests")

    rooms_result = await session.exec(
        text(
            f"""
            SELECT {", ".join(select_fields)}
            FROM room_types
            WHERE tenant_id = CAST(:tenant_id AS uuid)
            """
        ),
        params={"tenant_id": str(tenant_uuid)},
    )
    rooms = rooms_result.all()
    return [
        {
            "id": str(row._mapping.get("id")),
            "name": row._mapping.get("name"),
            "code": row._mapping.get("code"),
            "price": float(row._mapping.get("price")),
            "currency": "INR",
            "maxAdults": row._mapping.get("max_adults"),
            "maxChildren": row._mapping.get("max_children"),
            "maxTotalGuests": row._mapping.get("max_total_guests"),
        }
        for row in rooms
    ]


async def _load_tenant_config(session: AsyncSession, resolved_tenant_id: Optional[str]) -> Optional[TenantConfig]:
    tenant_uuid = _parse_uuid(resolved_tenant_id)
    if not tenant_uuid:
        return None

    config_result = await session.exec(
        select(TenantConfig).where(TenantConfig.tenant_id == tenant_uuid)
    )
    return config_result.first()


def _resolve_effective_language(requested_language: Optional[str], tenant_config: Optional[TenantConfig]) -> str:
    requested = normalize_language_code(requested_language or "")
    if not tenant_config:
        return requested

    allowed_languages = normalize_language_list(tenant_config.available_lang or [])
    default_language = normalize_language_code(tenant_config.default_lang or "en")

    if allowed_languages:
        if requested in allowed_languages:
            return requested
        if default_language in allowed_languages:
            return default_language
        return allowed_languages[0]

    return default_language


class ChatRequest(BaseModel):
    """
    Accepts the frontend adapter's camelCase payload via aliases.
    """
    transcript: str
    session_id: str = Field(default="default", alias="sessionId")
    current_ui_screen: str = Field(default="WELCOME", alias="currentState")
    tenant_id: str = Field(default="default", alias="tenantId")
    tenant_slug: Optional[str] = Field(default=None, alias="tenantSlug")
    language: str = "en"
    # Extra fields the frontend sends — accepted but not required by the agent
    active_slot: Optional[str] = Field(default=None, alias="activeSlot")
    expected_type: Optional[str] = Field(default=None, alias="expectedType")
    last_system_prompt: Optional[str] = Field(default=None, alias="lastSystemPrompt")
    filled_slots: Optional[dict] = Field(default=None, alias="filledSlots")
    conversation_history: Optional[list[ConversationTurn]] = Field(default=None, alias="conversationHistory")
    room_catalog: Optional[list[dict]] = Field(default=None, alias="roomCatalog")

    class Config:
        populate_by_name = True  # Allow both camelCase and snake_case


class ChatResponse(BaseModel):
    """
    Response contract - matches exactly what the React brain.service.ts expects.
    Uses camelCase to be compatible with the existing frontend without any changes.
    """
    speech: str
    intent: str
    confidence: float
    # camelCase to match frontend contract
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

    class Config:
        # Allow camelCase output for JSON serialization
        populate_by_name = True


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
        requested_tenant_slug = req.tenant_slug or x_tenant_slug
        resolved_tenant_id = await _resolve_tenant_id(session, req.tenant_id, requested_tenant_slug)
        tenant_config = await _load_tenant_config(session, resolved_tenant_id)
        effective_language = _resolve_effective_language(req.language, tenant_config)
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
            print(
                "[ChatAPI] Using frontend room catalog fallback "
                f"session={req.session_id} rooms={len(room_inventory)}"
            )
        normalized_ui_screen = _normalize_ui_screen(req.current_ui_screen)
        persisted_booking_id = _persisted_booking_by_session.get(req.session_id)
        assigned_room_id = _persisted_room_id_by_session.get(req.session_id)
        assigned_room_number = _persisted_room_number_by_session.get(req.session_id)

        # Load or create session
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

        # Update state with current request data
        state.latest_transcript = req.transcript
        state.current_ui_screen = normalized_ui_screen
        state.language = effective_language
        state.tenant_id = resolved_tenant_id or state.tenant_id
        state.tenant_room_inventory = [RoomInventoryItem(**room) for room in room_inventory]

        # Sync frontend-filled slots into session so manual (touch) booking path
        # keeps backend slot state coherent with UI state.
        if req.filled_slots:
            _merge_filled_slots(state, req.filled_slots, room_inventory)

        normalized_ui_screen = _coerce_booking_context_screen(normalized_ui_screen, state)
        state.current_ui_screen = normalized_ui_screen
        print(
            "[ChatAPI] request "
            f"session={req.session_id} "
            f"screen={normalized_ui_screen} "
            f"tenant={resolved_tenant_id or req.tenant_id} "
            f"language={effective_language} "
            f"rooms={len(room_inventory)} "
            f"db={_database_target_hint()}"
        )

        summary_confirm_short_circuit = (
            normalized_ui_screen == "BOOKING_SUMMARY"
            and state.booking_slots.is_complete()
            and _is_summary_confirmation_transcript(req.transcript)
        )

        updated_state: Optional[KioskState] = None

        if summary_confirm_short_circuit:
            speech = "Perfect. Your booking details are confirmed. Taking you to payment now."
            updated_history = state.history + [
                ConversationTurn(role="user", content=req.transcript),
                ConversationTurn(role="assistant", content=speech),
            ]
            updated_state = state.model_copy(
                update={
                    "resolved_intent": "CONFIRM_BOOKING",
                    "speech_response": speech,
                    "active_slot": None,
                    "history": updated_history,
                    "next_ui_screen": "PAYMENT",
                }
            )
            _sessions[req.session_id] = updated_state

        # Deterministic FAQ retrieval layer (tenant-scoped), only for non-transactional turns.
        if not updated_state and _should_attempt_faq(req.transcript, normalized_ui_screen):
            normalized_transcript = normalize_faq_query(req.transcript)
            print(
                "[ChatAPI][FAQ] attempt "
                f"session={req.session_id} "
                f"tenant={resolved_tenant_id or req.tenant_id} "
                f"query='{normalized_transcript}'"
            )
            faq_lookup = await find_best_faq_match(
                session=session,
                tenant_id=resolved_tenant_id or req.tenant_id,
                user_query=req.transcript,
                language=state.language,
            )
            if faq_lookup.localizations_synced:
                await session.commit()
            faq_match = faq_lookup.match
            print(
                "[ChatAPI][FAQ] loaded "
                f"session={req.session_id} "
                f"faq_count={faq_lookup.faq_count} "
                f"normalized='{faq_lookup.normalized_query}'"
            )
            if faq_match and faq_match.confidence >= FAQ_MATCH_THRESHOLD:
                print(
                    "[ChatAPI][FAQ] matched "
                    f"session={req.session_id} "
                    f"faq_id={faq_match.faq_id} "
                    f"confidence={faq_match.confidence:.3f} "
                    f"match_type={faq_match.match_type}"
                )
                faq_response = faq_match.answer
                state.history = state.history + [
                    ConversationTurn(role="user", content=state.latest_transcript),
                    ConversationTurn(role="assistant", content=faq_response),
                ]
                state.speech_response = faq_response
                state.resolved_intent = "GENERAL_QUERY"
                state.confidence = faq_match.confidence
                state.next_ui_screen = normalized_ui_screen
                _sessions[req.session_id] = state
                print(
                    "[ChatAPI][FAQ] respond "
                    f"session={req.session_id} "
                    f"answerSource=FAQ_DB faq_id={faq_match.faq_id}"
                )

                return ChatResponse(
                    speech=faq_response,
                    intent="GENERAL_QUERY",
                    confidence=faq_match.confidence,
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
                    error=None,
                    answerSource="FAQ_DB",
                    faqId=faq_match.faq_id,
                    normalizedQuery=faq_lookup.normalized_query,
                    sessionId=req.session_id,
                    language=state.language,
                )

            # Deterministic fallback for FAQ-style questions with no tenant FAQ match.
            # Avoid hallucinated policy answers from the LLM path.
            fallback_text = (
                "I'm sorry, I don't have that hotel detail right now, "
                "but I'm happy to help with your booking or another question."
            )
            state.history = state.history + [
                ConversationTurn(role="user", content=state.latest_transcript),
                ConversationTurn(role="assistant", content=fallback_text),
            ]
            state.speech_response = fallback_text
            state.resolved_intent = "GENERAL_QUERY"
            state.confidence = 1.0
            state.next_ui_screen = normalized_ui_screen
            _sessions[req.session_id] = state
            print(
                "[ChatAPI][FAQ] fallback "
                f"session={req.session_id} "
                f"reason={'no_match' if not faq_match else f'low_confidence:{faq_match.confidence:.3f}'} "
                f"faq_count={faq_lookup.faq_count}"
            )
            return ChatResponse(
                speech=fallback_text,
                intent="GENERAL_QUERY",
                confidence=1.0,
                nextUiScreen=normalized_ui_screen,
                accumulatedSlots=state.booking_slots.model_dump(by_alias=True),
                extractedSlots={},
                missingSlots=[],
                nextSlotToAsk=None,
                selectedRoom=state.selected_room.model_dump(by_alias=True) if state.selected_room else None,
                isComplete=state.booking_slots.is_complete(),
                persistedBookingId=_persisted_booking_by_session.get(req.session_id),
                error=None,
                answerSource="FAQ_FALLBACK",
                faqId=None,
                sessionId=req.session_id,
                language=state.language,
            )

        if not updated_state:
            # Run LangGraph agent
            # ainvoke() returns a dict of the final state fields
            result: dict = await kiosk_agent.ainvoke(state.model_dump())

            # Reconstruct updated state from result dict
            updated_state = KioskState(**result)
            _sessions[req.session_id] = updated_state

        slots_dict = updated_state.booking_slots.model_dump()
        previous_slots_dict = previous_state.booking_slots.model_dump()
        is_complete = updated_state.booking_slots.is_complete()
        missing_slots = [
            _to_contract_slot_name(slot_name)
            for slot_name in updated_state.booking_slots.missing_required_slots()
        ]
        next_slot_to_ask = _to_contract_slot_name(updated_state.active_slot)
        persistence_error: Optional[str] = None
        persistence_error_detail: Optional[str] = None
        selected_room_payload = updated_state.selected_room.model_dump(by_alias=True) if updated_state.selected_room else None
        selected_room_payload = resolve_effective_room_payload(
            selected_room_payload,
            slots_dict,
            room_inventory,
        )
        if selected_room_payload:
            try:
                updated_state.selected_room = RoomInventoryItem(**selected_room_payload)
            except Exception:
                pass
        if selected_room_payload and selected_room_payload.get("name"):
            selected_room_payload["displayName"] = selected_room_payload.get("name")
        response_next_screen = updated_state.next_ui_screen or normalized_ui_screen
        response_speech = updated_state.speech_response or "I'm not sure how to help with that."

        sanitized_slots, constraint_error, constraint_slot, constraint_screen = sanitize_booking_constraints(
            slots_dict,
            previous_slots_dict,
            selected_room_payload,
        )
        if constraint_error:
            for backend_slot, sanitized_value in sanitized_slots.items():
                if slots_dict.get(backend_slot) != sanitized_value:
                    _restore_invalid_booking_slot(updated_state, previous_state, backend_slot)
            updated_state.active_slot = _normalize_backend_slot_name(constraint_slot)
            _sessions[req.session_id] = updated_state
            slots_dict = updated_state.booking_slots.model_dump()
            is_complete = False
            missing_slots = [
                _to_contract_slot_name(slot_name)
                for slot_name in updated_state.booking_slots.missing_required_slots()
            ]
            selected_room_payload = updated_state.selected_room.model_dump(by_alias=True) if updated_state.selected_room else None
            selected_room_payload = resolve_effective_room_payload(
                selected_room_payload,
                slots_dict,
                room_inventory,
            )
            if selected_room_payload and selected_room_payload.get("name"):
                selected_room_payload["displayName"] = selected_room_payload.get("name")
            response_speech = constraint_error
            response_next_screen = constraint_screen
            next_slot_to_ask = constraint_slot
            print(
                "[ChatAPI][BookingValidation] rejected "
                f"session={req.session_id} "
                f"slot={constraint_slot} "
                f"screen={constraint_screen} "
                f"reason={constraint_error}"
            )

        # Authoritative booking confirmation path:
        # confirm on BOOKING_SUMMARY + all slots complete => persist + move to PAYMENT.
        should_persist_booking = (
            not constraint_error
            and normalized_ui_screen == "BOOKING_SUMMARY"
            and updated_state.resolved_intent == "CONFIRM_BOOKING"
            and is_complete
        )
        print(
            "[ChatAPI][PersistBooking] gate "
            f"session={req.session_id} "
            f"intent={updated_state.resolved_intent} "
            f"is_complete={is_complete} "
            f"screen={normalized_ui_screen} "
            f"allowed={should_persist_booking}"
        )
        if should_persist_booking:
            if not persisted_booking_id:
                print(
                    "[ChatAPI][PersistBooking] attempt "
                    f"session={req.session_id} "
                    f"room_hint={slots_dict.get('room_type')} "
                    f"check_in={slots_dict.get('check_in_date')} "
                    f"check_out={slots_dict.get('check_out_date')}"
                )
                try:
                    tenant_uuid = _parse_uuid(resolved_tenant_id or updated_state.tenant_id or req.tenant_id)
                    if not tenant_uuid:
                        raise ValueError("Missing or invalid tenant_id for booking persistence.")

                    room_type_uuid = _resolve_room_type_uuid(
                        selected_room_payload,
                        slots_dict.get("room_type"),
                        room_inventory,
                    )
                    if not room_type_uuid:
                        raise ValueError("Could not resolve a valid room_type_id UUID for booking persistence.")

                    check_in = datetime.strptime(slots_dict["check_in_date"], "%Y-%m-%d").date()
                    check_out = datetime.strptime(slots_dict["check_out_date"], "%Y-%m-%d").date()
                    nights_value = slots_dict.get("nights")
                    if not nights_value:
                        nights_value = max(1, (check_out - check_in).days)

                    await _acquire_room_type_allocation_lock(
                        session=session,
                        tenant_id=tenant_uuid,
                        room_type_id=room_type_uuid,
                    )

                    assigned_room = await _allocate_available_room_instance(
                        session=session,
                        tenant_id=tenant_uuid,
                        room_type_id=room_type_uuid,
                        check_in=check_in,
                        check_out=check_out,
                        room_inventory=room_inventory,
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
                        "[ChatAPI][PersistBooking] success "
                        f"session={req.session_id} "
                        f"booking_id={persisted_booking_id} "
                        f"assigned_room_number={assigned_room_number}"
                    )
                except Exception as db_err:
                    await session.rollback()
                    persistence_error_detail = str(db_err)
                    persistence_error = f"BOOKING_PERSIST_FAILED: {persistence_error_detail}"
                    print(
                        "[ChatAPI][PersistBooking] failure "
                        f"session={req.session_id} "
                        f"error={db_err}"
                    )
            else:
                print(
                    "[ChatAPI][PersistBooking] skip "
                    f"session={req.session_id} "
                    f"reason=already_persisted "
                    f"booking_id={persisted_booking_id}"
                )

            if persistence_error:
                response_next_screen = "BOOKING_SUMMARY"
                if persistence_error_detail and not persistence_error_detail.startswith("Missing or invalid tenant_id"):
                    response_speech = persistence_error_detail
                else:
                    response_speech = (
                        "I could not finalize your booking due to a system issue. "
                        "Please try confirm again or use the touch confirm button."
                    )
            else:
                response_next_screen = "PAYMENT"
                if not response_speech.strip():
                    response_speech = "Your booking is confirmed. Taking you to payment now."

        visual_focus = None
        if normalized_ui_screen in {"ROOM_PREVIEW", "BOOKING_COLLECT"}:
            visual_focus = _resolve_visual_focus(
                transcript=req.transcript,
                room_catalog=req.room_catalog,
                selected_room_payload=selected_room_payload,
                slots_dict=slots_dict,
            )
            concierge_reply = _build_visual_concierge_reply(
                transcript=req.transcript,
                visual_focus=visual_focus,
                selected_room_payload=selected_room_payload,
                language=updated_state.language,
            )
            if (
                concierge_reply
                and updated_state.resolved_intent == "GENERAL_QUERY"
                and response_next_screen in {"ROOM_PREVIEW", "BOOKING_COLLECT"}
                and not constraint_error
                and not persistence_error
            ):
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
            if (
                missing_visual_reply
                and (
                    updated_state.resolved_intent == "GENERAL_QUERY"
                    or _looks_like_visual_request(req.transcript)
                )
                and response_next_screen in {"ROOM_PREVIEW", "BOOKING_COLLECT"}
                and not constraint_error
                and not persistence_error
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
            print(
                "[ChatAPI] Preventing regressive preview transition "
                f"session={req.session_id} from={response_next_screen} -> ROOM_PREVIEW"
            )
            response_next_screen = "ROOM_PREVIEW"

        return ChatResponse(
            speech=response_speech,
            intent=updated_state.resolved_intent or "GENERAL_QUERY",
            confidence=updated_state.confidence,
            nextUiScreen=response_next_screen,
            visualFocus=visual_focus,
            accumulatedSlots=updated_state.booking_slots.model_dump(by_alias=True),
            extractedSlots={},
            missingSlots=[slot for slot in missing_slots if slot],
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
        )

    except Exception as e:
        import traceback
        print(f"[ChatAPI] ❌ Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/chat/{session_id}")
async def clear_session(session_id: str):
    """Clear a session (called when guest leaves or kiosk resets)."""
    if session_id in _sessions:
        del _sessions[session_id]
    _persisted_booking_by_session.pop(session_id, None)
    _persisted_room_id_by_session.pop(session_id, None)
    _persisted_room_number_by_session.pop(session_id, None)
    return {"status": "cleared", "session_id": session_id}
