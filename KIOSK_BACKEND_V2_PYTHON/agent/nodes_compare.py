"""
agent/nodes_compare.py

Handles the COMPARE_ROOMS intent and the cross-category confirmation gate.

This module is intentionally isolated from nodes.py so the existing booking
and general-chat nodes are not touched at all.

Wire it into graph.py:

    from agent.nodes_compare import compare_rooms, resolve_cross_category

    graph.add_node("compare_rooms", compare_rooms)
    graph.add_node("resolve_cross_category", resolve_cross_category)

    # In route_to_node():
    if intent == "COMPARE_ROOMS":
        return "compare_rooms"
    if intent in ("AFFIRM", "DENY") and state.pending_cross_category:
        return "resolve_cross_category"

Flow
────
COMPARE_ROOMS intent arrives:
  1. LLM extracts roomA name and roomB name from the transcript.
  2. Both names are fuzzy-matched against tenant_room_inventory.
  3. Category check: same category? → build diff → return comparePayload.
     Cross category? → set pending_cross_category → ask guest to confirm.

AFFIRM while pending_cross_category:
  → Build diff across categories → return comparePayload.

DENY while pending_cross_category:
  → Clear pending state → return to ROOM_PREVIEW with current room.
"""

from __future__ import annotations

import json
import re
from typing import Optional

from agent.state import (
    CompareRoomsPayload,
    ConversationTurn,
    KioskState,
    RoomInventoryItem,
)
from core.llm import get_llm_response
import asyncio


# ─────────────────────────────────────────────────────────────────────────────
# FUZZY MATCHING (mirrors frontend resolveRoomByName logic)
# ─────────────────────────────────────────────────────────────────────────────

_FILLER_WORDS = re.compile(
    r"\b(room|the|a|an|our|your|suite|type)\b", re.IGNORECASE
)
_WHITESPACE = re.compile(r"\s+")


def _normalise(name: str) -> str:
    cleaned = _FILLER_WORDS.sub("", name.lower())
    return _WHITESPACE.sub(" ", cleaned).strip()


def _bigrams(s: str) -> set[str]:
    return {s[i : i + 2] for i in range(len(s) - 1)}


def _dice(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    bg_a = _bigrams(a)
    bg_b = _bigrams(b)
    if not bg_a or not bg_b:
        return 0.0
    intersection = len(bg_a & bg_b)
    return (2 * intersection) / (len(bg_a) + len(bg_b))


def resolve_room_by_name(
    query: str,
    inventory: list[RoomInventoryItem],
    threshold: float = 0.30,
) -> Optional[RoomInventoryItem]:
    """
    Fuzzy-match a natural-language room name against the inventory.
    Returns None when no room scores above the threshold.

    Lower threshold than the frontend (0.30 vs 0.35) because the backend
    receives cleaner extracted names, not raw transcripts.
    """
    if not query.strip() or not inventory:
        return None

    norm_query = _normalise(query)
    best_room: Optional[RoomInventoryItem] = None
    best_score = 0.0

    for room in inventory:
        norm_name = _normalise(room.name)
        score_name = _dice(norm_query, norm_name)

        norm_code = _normalise(room.code or "")
        score_code = _dice(norm_query, norm_code) if norm_code else 0.0

        score = max(score_name, score_code)
        if score > best_score:
            best_score = score
            best_room = room

    if best_room is None or best_score < threshold:
        return None

    return best_room


# ─────────────────────────────────────────────────────────────────────────────
# NAME EXTRACTION PROMPT
# ─────────────────────────────────────────────────────────────────────────────

_NAME_EXTRACTION_SYSTEM = """
You are a hotel room name extractor.
Given the guest's transcript, extract the two room names they want to compare.

Rules:
- If one room is the guest's current room, return the string "current" for that field.
- Strip filler words (the, a, our) and keep only the distinctive name.
- Return ONLY valid JSON, no markdown, no explanation.

Format:
{"roomA": "<name or 'current'>", "roomB": "<name or 'current'>"}
""".strip()


async def _extract_room_names_from_transcript(
    transcript: str,
    current_room_name: Optional[str],
) -> tuple[str, str]:
    """
    Returns (name_a, name_b).
    Either may be the sentinel "current" which the caller resolves.
    Falls back to ("current", "") on any parse failure.
    """
    user_msg = f"Transcript: {transcript}"
    if current_room_name:
        user_msg += f"\nCurrent room: {current_room_name}"

    try:
        raw = await asyncio.to_thread(
            get_llm_response,
            [
                {"role": "system", "content": _NAME_EXTRACTION_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            0.0,
            120,
        )
        # Strip markdown fences if the LLM added them despite instructions
        raw = re.sub(r"```(?:json)?|```", "", raw).strip()
        parsed = json.loads(raw)
        room_a = str(parsed.get("roomA") or "current").strip()
        room_b = str(parsed.get("roomB") or "").strip()
        return room_a, room_b
    except Exception as exc:
        print(f"[CompareNode] Name extraction failed: {exc}")
        return "current", ""


# ─────────────────────────────────────────────────────────────────────────────
# DIFF NARRATION PROMPT
# ─────────────────────────────────────────────────────────────────────────────

_DIFF_SYSTEM = """
You are a hotel concierge comparing two rooms for a guest at a kiosk.

Rules:
- Identify only the meaningful DIFFERENCES between the two rooms.
- Do NOT repeat attributes that are the same (e.g. if both are Deluxe, don't say "Both are Deluxe" unless it helps context).
- Keep it under 3 sentences. Be specific: name the view, price difference, and one feature difference if they exist.
- End by asking which the guest prefers.
- If the rooms are from different categories, acknowledge it briefly first.
- Speak naturally as if talking to a guest in the lobby.
""".strip()

_DIFF_USER_TEMPLATE = """
Room A: {name_a}
  Price: {price_a} {currency_a}/night
  Category: {category_a}
  Features: {features_a}

Room B: {name_b}
  Price: {price_b} {currency_b}/night
  Category: {category_b}
  Features: {features_b}

Cross-category: {is_cross}
""".strip()


def _room_feature_diff(
    room_a: RoomInventoryItem, room_b: RoomInventoryItem
) -> str:
    """Return a sentence describing the feature set difference."""
    set_a = set(room_a.features)
    set_b = set(room_b.features)
    only_a = list(set_a - set_b)[:2]
    only_b = list(set_b - set_a)[:2]
    parts = []
    if only_a:
        parts.append(f"Room A has {', '.join(only_a)}")
    if only_b:
        parts.append(f"Room B has {', '.join(only_b)}")
    return "; ".join(parts) if parts else "similar features"


async def _build_diff_speech(
    room_a: RoomInventoryItem,
    room_b: RoomInventoryItem,
    is_cross_category: bool,
) -> str:
    """
    Calls the LLM to generate a concise diff narration.
    Falls back to a deterministic template on failure.
    """
    price_a = f"{room_a.currency}{room_a.price:,.0f}" if room_a.price else "price not listed"
    price_b = f"{room_b.currency}{room_b.price:,.0f}" if room_b.price else "price not listed"
    category_a = room_a.category.name if room_a.category else "Standard"
    category_b = room_b.category.name if room_b.category else "Standard"
    feature_diff = _room_feature_diff(room_a, room_b)

    user_content = _DIFF_USER_TEMPLATE.format(
        name_a=room_a.name,
        price_a=price_a,
        currency_a=room_a.currency,
        category_a=category_a,
        features_a=", ".join(room_a.features) or "none listed",
        name_b=room_b.name,
        price_b=price_b,
        currency_b=room_b.currency,
        category_b=category_b,
        features_b=", ".join(room_b.features) or "none listed",
        is_cross="yes" if is_cross_category else "no",
    )

    try:
        speech = await asyncio.to_thread(
            get_llm_response,
            [
                {"role": "system", "content": _DIFF_SYSTEM},
                {"role": "user", "content": user_content},
            ],
            0.4,
            160,
        )
        return speech.strip()
    except Exception as exc:
        print(f"[CompareNode] Diff LLM failed, using template fallback: {exc}")
        # Deterministic fallback — always works
        cross_prefix = (
            f"These rooms are from different categories: {category_a} and {category_b}. "
            if is_cross_category
            else ""
        )
        price_line = ""
        if room_a.price and room_b.price:
            diff = abs(room_a.price - room_b.price)
            cheaper = room_a.name if room_a.price < room_b.price else room_b.name
            price_line = f"{cheaper} is {room_a.currency}{diff:,.0f} less per night. "
        return (
            f"{cross_prefix}{room_a.name} versus {room_b.name}. "
            f"{price_line}{feature_diff}. Which do you prefer?"
        )


# ─────────────────────────────────────────────────────────────────────────────
# NODE: compare_rooms
# ─────────────────────────────────────────────────────────────────────────────

async def compare_rooms(state: KioskState) -> dict:
    """
    LangGraph node — handles COMPARE_ROOMS intent.

    Steps:
      1. Extract room names from the transcript.
      2. Resolve both names against the inventory (fuzzy match).
      3. Check if rooms are in the same category.
         - Same category → build diff → return comparePayload.
         - Different category → set pending_cross_category, ask to confirm.
    """
    transcript = state.latest_transcript or ""
    inventory = state.tenant_room_inventory or []
    current_room = state.selected_room

    # ── Step 1: extract names ────────────────────────────────────────────────
    name_a_raw, name_b_raw = await _extract_room_names_from_transcript(
        transcript,
        current_room.name if current_room else None,
    )

    # ── Step 2: resolve to inventory items ───────────────────────────────────
    room_a: Optional[RoomInventoryItem] = (
        current_room
        if name_a_raw.lower() == "current" and current_room
        else resolve_room_by_name(name_a_raw, inventory)
    )
    room_b: Optional[RoomInventoryItem] = (
        current_room
        if name_b_raw.lower() == "current" and current_room
        else resolve_room_by_name(name_b_raw, inventory) if name_b_raw else None
    )

    # ── Fallback when extraction fails ───────────────────────────────────────
    if not room_a or not room_b:
        missing = []
        if not room_a:
            missing.append(name_a_raw or "first room")
        if not room_b:
            missing.append(name_b_raw or "second room")

        fallback_speech = (
            f"I couldn't find {' or '.join(missing)} in our room list. "
            "Could you say the room name again? For example, 'compare the Deluxe King with the Sea View Suite'."
        )
        updated_history = state.history + [
            ConversationTurn(role="user", content=transcript),
            ConversationTurn(role="assistant", content=fallback_speech),
        ]
        return {
            "speech_response": fallback_speech,
            "next_ui_screen": "ROOM_PREVIEW",
            "compare_payload": None,
            "pending_cross_category": False,
            "history": updated_history,
        }

    # ── Step 3: category check ────────────────────────────────────────────────
    cat_a = (room_a.category.id if room_a.category else "uncategorised")
    cat_b = (room_b.category.id if room_b.category else "uncategorised")
    is_cross_category = cat_a != cat_b

    if is_cross_category:
        # Don't compare yet — ask the guest to confirm
        category_b_name = room_b.category.name if room_b.category else "a different category"
        speech = (
            f"{room_b.name} is in our {category_b_name} collection — "
            "a different tier from what you're browsing right now. "
            "Would you still like me to compare the two?"
        )
        updated_history = state.history + [
            ConversationTurn(role="user", content=transcript),
            ConversationTurn(role="assistant", content=speech),
        ]
        return {
            "speech_response": speech,
            "next_ui_screen": "ROOM_PREVIEW",
            "pending_cross_category": True,
            "pending_compare_room_a": room_a,
            "pending_compare_room_b": room_b,
            "compare_payload": None,
            "history": updated_history,
        }

    # ── Same category → build diff immediately ────────────────────────────────
    diff_speech = await _build_diff_speech(room_a, room_b, is_cross_category=False)

    payload = CompareRoomsPayload(
        roomA=room_a,
        roomB=room_b,
        speech=diff_speech,
        isCrossCategory=False,
    )
    updated_history = state.history + [
        ConversationTurn(role="user", content=transcript),
        ConversationTurn(role="assistant", content=diff_speech),
    ]
    return {
        "speech_response": diff_speech,
        "next_ui_screen": "ROOM_PREVIEW",
        "compare_payload": payload,
        "pending_cross_category": False,
        "history": updated_history,
    }


# ─────────────────────────────────────────────────────────────────────────────
# NODE: resolve_cross_category
# ─────────────────────────────────────────────────────────────────────────────

async def resolve_cross_category(state: KioskState) -> dict:
    """
    LangGraph node — handles AFFIRM / DENY while pending_cross_category is True.

    AFFIRM → run the diff and activate compareMode.
    DENY   → clear the pending state and resume normal preview.
    """
    intent = state.resolved_intent
    room_a = state.pending_compare_room_a
    room_b = state.pending_compare_room_b
    transcript = state.latest_transcript or ""

    # ── DENY ─────────────────────────────────────────────────────────────────
    if intent == "DENY" or not room_a or not room_b:
        current_name = (
            state.selected_room.name if state.selected_room else "this room"
        )
        speech = f"No problem — let's continue with {current_name}."
        updated_history = state.history + [
            ConversationTurn(role="user", content=transcript),
            ConversationTurn(role="assistant", content=speech),
        ]
        return {
            "speech_response": speech,
            "next_ui_screen": "ROOM_PREVIEW",
            "pending_cross_category": False,
            "pending_compare_room_a": None,
            "pending_compare_room_b": None,
            "compare_payload": None,
            "history": updated_history,
        }

    # ── AFFIRM → build cross-category diff ───────────────────────────────────
    diff_speech = await _build_diff_speech(room_a, room_b, is_cross_category=True)

    payload = CompareRoomsPayload(
        roomA=room_a,
        roomB=room_b,
        speech=diff_speech,
        isCrossCategory=True,
    )
    updated_history = state.history + [
        ConversationTurn(role="user", content=transcript),
        ConversationTurn(role="assistant", content=diff_speech),
    ]
    return {
        "speech_response": diff_speech,
        "next_ui_screen": "ROOM_PREVIEW",
        "compare_payload": payload,
        "pending_cross_category": False,
        "pending_compare_room_a": None,
        "pending_compare_room_b": None,
        "history": updated_history,
    }


# ─────────────────────────────────────────────────────────────────────────────
# NODE: handle_category_selected
# ─────────────────────────────────────────────────────────────────────────────

async def handle_category_selected(state: KioskState) -> dict:
    """
    LangGraph node — handles CATEGORY_SELECTED intent.

    Sets selected_category_id and category_rooms so the frontend
    RoomPreviewPage can build its local carousel without another API call.
    """
    transcript = state.latest_transcript or ""

    # The frontend sends categoryId in the payload; it arrives in the transcript
    # field or a supplementary field depending on the adapter.
    # We also accept a voice-based category selection where the transcript
    # contains the category name.
    category_id: Optional[str] = None
    category_rooms: list[RoomInventoryItem] = []

    # Try to find the category from the inventory
    # (all rooms share the same category.id within a group)
    inventory = state.tenant_room_inventory or []

    # Prefer exact category ID match (from tap payload)
    # The adapter embeds categoryId in the transcript as "CATEGORY:<id>" sentinel
    id_match = re.search(r"CATEGORY:([^\s]+)", transcript)
    if id_match:
        category_id = id_match.group(1)
        category_rooms = [r for r in inventory if r.category and r.category.id == category_id]
    else:
        # Voice path: fuzzy match the transcript against category names
        transcript_norm = _normalise(transcript)
        best_cat_id: Optional[str] = None
        best_score = 0.0
        for room in inventory:
            if not room.category:
                continue
            cat_norm = _normalise(room.category.name)
            score = _dice(transcript_norm, cat_norm)
            if score > best_score:
                best_score = score
                best_cat_id = room.category.id
        if best_cat_id and best_score > 0.35:
            category_id = best_cat_id
            category_rooms = [r for r in inventory if r.category and r.category.id == category_id]

    if not category_id or not category_rooms:
        fallback_speech = "I couldn't match that to one of our room categories. Could you tap the category you'd like to explore?"
        updated_history = state.history + [
            ConversationTurn(role="user", content=transcript),
            ConversationTurn(role="assistant", content=fallback_speech),
        ]
        return {
            "speech_response": fallback_speech,
            "next_ui_screen": "ROOM_SELECT",
            "history": updated_history,
        }

    category_name = category_rooms[0].category.name if category_rooms[0].category else "this"
    speech = (
        f"Great choice. Let me show you our {category_name} rooms. "
        f"We have {len(category_rooms)} option{'s' if len(category_rooms) != 1 else ''}. "
        "Say 'show me another' at any time to browse through them."
    )
    updated_history = state.history + [
        ConversationTurn(role="user", content=transcript),
        ConversationTurn(role="assistant", content=speech),
    ]
    return {
        "speech_response": speech,
        "next_ui_screen": "ROOM_PREVIEW",
        "selected_category_id": category_id,
        "category_rooms": category_rooms,
        "compare_payload": None,
        "pending_cross_category": False,
        "history": updated_history,
    }


# ─────────────────────────────────────────────────────────────────────────────
# NODE: handle_show_next_room
# ─────────────────────────────────────────────────────────────────────────────

async def handle_show_next_room(state: KioskState) -> dict:
    """
    LangGraph node — handles SHOW_NEXT_ROOM intent.

    Sets show_next_room=True so the frontend increments currentRoomIndex.
    The backend also narrates the next room name.
    """
    transcript = state.latest_transcript or ""
    category_rooms = state.category_rooms or []
    num_rooms = len(category_rooms)

    if num_rooms <= 1:
        speech = (
            "There's only one room in this category. "
            "Say 'go back' to choose a different category, or 'book this room' to continue."
        )
    else:
        speech = "Sure, let me show you the next room."

    updated_history = state.history + [
        ConversationTurn(role="user", content=transcript),
        ConversationTurn(role="assistant", content=speech),
    ]
    return {
        "speech_response": speech,
        "next_ui_screen": "ROOM_PREVIEW",
        "show_next_room": num_rooms > 1,
        "compare_payload": None,
        "history": updated_history,
    }
