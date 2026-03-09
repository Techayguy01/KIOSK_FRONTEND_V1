import json
import difflib
import re
from datetime import date, datetime, timedelta
from typing import Optional
from agent.state import KioskState, BookingSlots, ConversationTurn, RoomInventoryItem
from core.llm import get_llm_response


LANGUAGE_DISPLAY_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "bn": "Bengali",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "mr": "Marathi",
    "or": "Odia",
    "pa": "Punjabi",
    "ta": "Tamil",
    "te": "Telugu",
}


def _response_language_instruction(language: str) -> str:
    code = (language or "en").strip().lower()
    language_name = LANGUAGE_DISPLAY_NAMES.get(code, code)
    return f"Respond in {language_name} (language code: {code})."


def find_best_room_match(extracted: str, valid_options: list[str]) -> Optional[str]:
    """Uses fuzzy matching to find the closest valid room type."""
    if not extracted or not valid_options:
        return None
    
    # Try exact match first (case-insensitive)
    for opt in valid_options:
        if extracted.lower() == opt.lower():
            return opt
            
    # Try fuzzy match
    matches = difflib.get_close_matches(extracted, valid_options, n=1, cutoff=0.6)
    return matches[0] if matches else None


def _room_prompt_catalog(room_inventory: list[RoomInventoryItem]) -> list[dict]:
    return [
        {
            "name": room.name,
            "code": room.code,
            "price": room.price,
            "currency": room.currency,
        }
        for room in room_inventory
    ]


def _normalize_text(value: str) -> str:
    text = (value or "").strip().lower()
    return (
        text
        .replace("sweet", "suite")
        .replace("sweets", "suites")
        .replace("luxary", "luxury")
    )


def _normalize_slot_name(slot_name: Optional[str]) -> Optional[str]:
    if not slot_name:
        return None
    canonical = str(slot_name).strip()
    if not canonical:
        return None

    mapping = {
        "roomType": "room_type",
        "checkInDate": "check_in_date",
        "checkOutDate": "check_out_date",
        "guestName": "guest_name",
    }
    if canonical in mapping:
        return mapping[canonical]
    return canonical


def _fallback_booking_prompt(next_slot: Optional[str], selected_room_name: Optional[str]) -> str:
    slot = _normalize_slot_name(next_slot)
    if slot == "room_type":
        return "Please tell me which room you would like to book."
    if slot == "adults":
        if selected_room_name:
            return f"Great choice. {selected_room_name} is selected. How many adults will be staying?"
        return "How many adults will be staying?"
    if slot == "check_in_date":
        return "What is your check in date?"
    if slot == "check_out_date":
        return "What is your check out date?"
    if slot == "guest_name":
        return "What name should I use for this booking?"
    return "Please share the next booking detail when you're ready."


def _has_explicit_year(transcript: str) -> bool:
    return bool(re.search(r"\b(?:19|20)\d{2}\b", transcript or ""))


def _parse_iso_date(raw_value: Optional[str]) -> Optional[date]:
    if not raw_value:
        return None
    try:
        return datetime.strptime(str(raw_value), "%Y-%m-%d").date()
    except Exception:
        return None


def _replace_year_safely(value: date, target_year: int) -> date:
    try:
        return value.replace(year=target_year)
    except ValueError:
        # Leap-day fallback for non-leap target years.
        return value.replace(year=target_year, day=28)


def _anchor_yearless_date(raw_value: Optional[str], transcript: str, today: date) -> Optional[str]:
    parsed = _parse_iso_date(raw_value)
    if not parsed:
        return raw_value

    if _has_explicit_year(transcript):
        return parsed.isoformat()

    anchored = parsed
    # Keep yearless dates in the present/future booking window.
    while anchored < today:
        anchored = _replace_year_safely(anchored, anchored.year + 1)

    if anchored != parsed:
        print(
            f"[DateNormalize] Anchored yearless date {parsed.isoformat()} -> {anchored.isoformat()} "
            f"(today={today.isoformat()})"
        )
    return anchored.isoformat()


def _extract_requested_nights(transcript: str) -> Optional[int]:
    if not transcript:
        return None

    normalized = transcript.lower()
    digit_match = re.search(r"\b(?:for\s+)?(\d{1,2})\s+nights?\b", normalized)
    if digit_match:
        nights = int(digit_match.group(1))
        return nights if nights > 0 else None

    word_to_number = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "nine": 9,
        "ten": 10,
        "eleven": 11,
        "twelve": 12,
    }
    word_match = re.search(
        r"\b(?:for\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+nights?\b",
        normalized,
    )
    if not word_match:
        return None

    return word_to_number.get(word_match.group(1))


def _normalize_booking_dates(
    slots: BookingSlots,
    transcript: str,
    selected_room: Optional[RoomInventoryItem],
) -> BookingSlots:
    today = date.today()
    slot_values = slots.model_dump()

    # Anchor yearless model output to current/future dates.
    slot_values["check_in_date"] = _anchor_yearless_date(slot_values.get("check_in_date"), transcript, today)
    slot_values["check_out_date"] = _anchor_yearless_date(slot_values.get("check_out_date"), transcript, today)

    check_in = _parse_iso_date(slot_values.get("check_in_date"))
    check_out = _parse_iso_date(slot_values.get("check_out_date"))

    requested_nights = _extract_requested_nights(transcript)
    if requested_nights is not None:
        slot_values["nights"] = requested_nights

    nights_value = slot_values.get("nights")
    nights = int(nights_value) if isinstance(nights_value, int) and nights_value > 0 else None

    # If user says "for N nights", derive checkout from check-in deterministically.
    if check_in and nights:
        inferred_checkout = check_in + timedelta(days=nights)
        if not check_out or requested_nights is not None:
            slot_values["check_out_date"] = inferred_checkout.isoformat()
            check_out = inferred_checkout
            print(
                f"[DateNormalize] Derived check_out_date={check_out.isoformat()} "
                f"from check_in_date={check_in.isoformat()} + nights={nights}"
            )

    # Never allow checkout to regress behind or equal check-in.
    if check_in and check_out and check_out <= check_in:
        check_out = check_in + timedelta(days=1)
        slot_values["check_out_date"] = check_out.isoformat()
        print(
            f"[DateNormalize] Adjusted check_out_date forward to {check_out.isoformat()} "
            f"to keep it after check_in_date={check_in.isoformat()}"
        )

    # Keep nights coherent with final date pair.
    if check_in and check_out:
        computed_nights = max(1, (check_out - check_in).days)
        slot_values["nights"] = computed_nights

    if selected_room and slot_values.get("nights"):
        room_price = float(selected_room.price or 0)
        slot_values["total_price"] = round(room_price * int(slot_values["nights"]), 2)

    return BookingSlots(**slot_values)


def _find_room_from_inventory(room_inventory: list[RoomInventoryItem], extracted: str) -> Optional[RoomInventoryItem]:
    if not extracted or not room_inventory:
        return None

    normalized = _normalize_text(extracted)
    if not normalized:
        return None

    for room in room_inventory:
        if _normalize_text(room.name) == normalized:
            return room
        if room.code and _normalize_text(room.code) == normalized:
            return room

    alias_to_room: dict[str, RoomInventoryItem] = {}
    candidates: list[str] = []
    for room in room_inventory:
        name_key = _normalize_text(room.name)
        if name_key:
            alias_to_room[name_key] = room
            candidates.append(name_key)
        code_key = _normalize_text(room.code or "")
        if code_key:
            alias_to_room[code_key] = room
            candidates.append(code_key)

    best_match = find_best_room_match(normalized, candidates)
    if not best_match:
        return None

    return alias_to_room.get(best_match)


def _build_room_options_text(room_inventory: list[RoomInventoryItem]) -> str:
    if not room_inventory:
        return "No catalog data available."
    names = [room.name for room in room_inventory if room.name][:5]
    if not names:
        return "No room names available."
    return ", ".join(names)


def _is_summary_confirmation_transcript(transcript: str) -> bool:
    text = (transcript or "").strip().lower()
    if not text:
        return False
    return bool(
        re.search(
            r"\b(confirm|confirmed|correct|yes|yeah|yep|proceed|continue|pay|payment|card|looks good|it's correct|its correct)\b",
            text,
        )
    )


def _is_summary_modify_transcript(transcript: str) -> bool:
    text = (transcript or "").strip().lower()
    if not text:
        return False
    return bool(re.search(r"\b(change|modify|edit|update|wrong|not correct|go back)\b", text))


ROUTER_SYSTEM_PROMPT = """
You are a highly critical intent classifier for a luxury hotel kiosk AI named "Siya".
The user's text may contain mixed intentions, conversational filler, or mid-sentence corrections (e.g., "Wait, no, I mean check in").
Your job is to read the ENTIRE message carefully before deciding the final intent.

- BOOK_ROOM: User explicitly wants to start a NEW reservation.
- CHECK_IN: User is at the kiosk to get their room key for an EXISTING booking.
- GENERAL_QUERY: User is asking about amenities (pool, gym, etc.), prices, or just greeting.
- PROVIDE_GUESTS: User is giving the number of people staying.
- PROVIDE_DATES: User is giving check-in or check-out dates.
- PROVIDE_NAME: User is giving the guest name for the booking.
- CONFIRM_BOOKING: User is confirming the details shown.
- CANCEL_BOOKING: User wants to stop the current process or cancel.
- MODIFY_BOOKING: User wants to change something they just said.
- IDLE: No meaningful input or silence.

Rules:
- If the user corrects themselves (e.g., "I want a room... no wait, check in"), prioritize the LAST clear intention.
- Greetings are GENERAL_QUERY.
- Do not be "eager". If the intent is ambiguous (e.g. just a partial word or silence), default to GENERAL_QUERY or IDLE.
- If the user says "sorry" or "wait", they are likely correcting their previous thought. Ignore the part before the correction.

Respond ONLY with a JSON object:
{"intent": "<INTENT>", "confidence": <0.0-1.0>}
"""


async def route_intent(state: KioskState) -> dict:
    """Node 1: Classify the user's intent."""
    print(f"[Router] Classifying: '{state.latest_transcript}'")

    # Deterministic summary control avoids LLM drift on "confirm and pay"/"it's correct"/"card".
    if state.current_ui_screen == "BOOKING_SUMMARY":
        if _is_summary_modify_transcript(state.latest_transcript):
            return {"resolved_intent": "MODIFY_BOOKING", "confidence": 0.96}
        if state.booking_slots.is_complete() and _is_summary_confirmation_transcript(state.latest_transcript):
            return {"resolved_intent": "CONFIRM_BOOKING", "confidence": 0.97}

    messages = [
        {"role": "system", "content": ROUTER_SYSTEM_PROMPT},
        {"role": "system", "content": f"Current UI screen: {state.current_ui_screen}"},
        {"role": "system", "content": f"Guest language preference: {state.language}"},
        {"role": "user", "content": state.latest_transcript},
    ]

    raw = get_llm_response(messages, temperature=0.1)

    try:
        result = json.loads(raw.strip())
        intent = result.get("intent", "GENERAL_QUERY")
        confidence = float(result.get("confidence", 0.7))
    except Exception:
        print("[Router] Failed to parse JSON, defaulting to GENERAL_QUERY")
        intent = "GENERAL_QUERY"
        confidence = 0.5

    print(f"[Router] -> Intent: {intent} (confidence: {confidence})")
    return {"resolved_intent": intent, "confidence": confidence}


GENERAL_CHAT_SYSTEM_PROMPT = """
You are "Siya", a warm and professional AI concierge at a luxury hotel kiosk.
Your role is to assist guests with information about the hotel.

You can:
- Welcome guests and answer general questions
- Describe room types, amenities, pool timings, restaurants, etc.
- Help initiate a booking if the guest expresses interest

Keep responses concise (2-3 sentences max) since this is a voice interface.
Do not make up specific prices or room details you do not know.
End your response by naturally offering further assistance.
"""


def build_general_chat_prompt(language: str) -> str:
    return "\n".join(
        [
            GENERAL_CHAT_SYSTEM_PROMPT.strip(),
            "",
            f"Language rule: {_response_language_instruction(language)}",
        ]
    )


async def general_chat(state: KioskState) -> dict:
    """Node 2: Handle general hotel questions and greetings."""
    print("[GeneralChat] Handling general query...")

    history_messages = [
        {"role": turn.role, "content": turn.content}
        for turn in state.history[-6:]
    ]

    messages = (
        [{"role": "system", "content": build_general_chat_prompt(state.language)}]
        + history_messages
        + [{"role": "user", "content": state.latest_transcript}]
    )

    response = get_llm_response(messages, temperature=0.6)

    updated_history = state.history + [
        ConversationTurn(role="user", content=state.latest_transcript),
        ConversationTurn(role="assistant", content=response),
    ]

    return {
        "speech_response": response,
        "history": updated_history,
        "next_ui_screen": state.current_ui_screen,
    }


def build_booking_prompt(state: KioskState) -> str:
    slots = state.booking_slots
    missing = slots.missing_required_slots()
    filled = {k: v for k, v in slots.model_dump().items() if v is not None}
    available_rooms = _room_prompt_catalog(state.tenant_room_inventory)
    today_iso = date.today().isoformat()

    return f"""
You are "Siya", a hotel booking assistant. You are collecting booking information from a guest.

Already collected:
{json.dumps(filled, indent=2) if filled else "Nothing yet."}

Still needed (in order of priority):
{missing}

Available tenant rooms (authoritative catalog):
{json.dumps(available_rooms, indent=2) if available_rooms else "[]"}

Current kiosk date (authoritative):
{today_iso}

The guest just said: "{state.latest_transcript}"

Your job:
1. Extract any booking information from what the guest said and update the JSON.
2. Ask conversationally and naturally for the next missing piece.
3. If all slots are filled, confirm the booking summary warmly.

Respond ONLY with a JSON object like this:
{{
  "extracted_slots": {{
    "room_type": null,
    "adults": null,
    "children": null,
    "check_in_date": null,
    "check_out_date": null,
    "guest_name": null
  }},
  "speech": "Your natural response to the guest",
  "is_complete": false,
  "next_slot_to_ask": "guest_name"
}}

Rules:
- {_response_language_instruction(state.language)}
- Only include slots in extracted_slots if they were mentioned in this turn.
- Dates must be in YYYY-MM-DD format.
- If user says month/day without year, choose the nearest upcoming future date from current kiosk date.
- If room_type is present, normalize it to one of the available tenant room names when possible.
- is_complete is true ONLY when all required slots (room_type, adults, check_in_date, check_out_date, guest_name) are available (combining already collected + newly extracted).
- next_slot_to_ask is null if is_complete is true.
"""


async def booking_logic(state: KioskState) -> dict:
    """Node 3: Collect booking details slot by slot."""
    print("[BookingLogic] Running slot collection...")

    # Backend-authoritative confirmation path:
    # If the guest confirms on BOOKING_SUMMARY and all required slots are present,
    # move to PAYMENT directly instead of looping in booking collection prompts.
    if state.resolved_intent == "CONFIRM_BOOKING":
        missing_required = state.booking_slots.missing_required_slots()
        selected_room_name = (
            state.selected_room.name
            if state.selected_room and state.selected_room.name
            else state.booking_slots.room_type
        )
        if not missing_required and state.current_ui_screen == "BOOKING_SUMMARY":
            speech = "Perfect. Your booking details are confirmed. Taking you to payment now."
            updated_history = state.history + [
                ConversationTurn(role="user", content=state.latest_transcript),
                ConversationTurn(role="assistant", content=speech),
            ]
            return {
                "speech_response": speech,
                "booking_slots": state.booking_slots,
                "active_slot": None,
                "selected_room": state.selected_room,
                "history": updated_history,
                "next_ui_screen": "PAYMENT",
            }
        if missing_required:
            next_slot = missing_required[0]
            speech = _fallback_booking_prompt(next_slot, selected_room_name)
            updated_history = state.history + [
                ConversationTurn(role="user", content=state.latest_transcript),
                ConversationTurn(role="assistant", content=speech),
            ]
            return {
                "speech_response": speech,
                "booking_slots": state.booking_slots,
                "active_slot": next_slot,
                "selected_room": state.selected_room,
                "history": updated_history,
                "next_ui_screen": "BOOKING_COLLECT",
            }

    messages = [
        {"role": "system", "content": build_booking_prompt(state)},
        {"role": "user", "content": state.latest_transcript},
    ]

    raw = get_llm_response(messages, temperature=0.3)

    try:
        result = json.loads(raw.strip())
    except Exception:
        print("[BookingLogic] Failed to parse JSON response.")
        return {
            "speech_response": "I'm sorry, I did not quite catch that. Could you repeat?",
            "next_ui_screen": "BOOKING_COLLECT",
        }

    extracted = result.get("extracted_slots", {})
    speech = result.get("speech", "Let me note that down.")
    room_inventory = state.tenant_room_inventory or []
    selected_room = state.selected_room

    # VALIDATION LAYER: tenant-aware room check using DB-backed room inventory.
    if extracted.get("room_type"):
        original_room = extracted["room_type"]
        best_match = _find_room_from_inventory(room_inventory, original_room)

        if best_match:
            if best_match.name != original_room:
                print(f"[Validation] Fuzzy match: '{original_room}' -> '{best_match.name}'")
            extracted["room_type"] = best_match.name
            selected_room = best_match
        else:
            # Rejection: If the room doesn't exist, we don't save it and we ask for clarification.
            print(f"[Validation] Rejected room type: '{original_room}'")
            extracted["room_type"] = None
            if room_inventory:
                available = _build_room_options_text(room_inventory)
                speech = f"I'm sorry, we don't have a '{original_room}' room. Available options are {available}. Which would you prefer?"
            else:
                speech = "I'm sorry, I could not validate that room right now. Please pick a room shown on screen."

    current_slots = state.booking_slots.model_dump()
    for key, value in extracted.items():
        if value is not None:
            current_slots[key] = value

    updated_slots = BookingSlots(**current_slots)
    if updated_slots.room_type and room_inventory:
        selected_room = _find_room_from_inventory(room_inventory, updated_slots.room_type) or selected_room
    updated_slots = _normalize_booking_dates(updated_slots, state.latest_transcript, selected_room)

    is_complete = result.get("is_complete", False) or updated_slots.is_complete()
    next_slot = _normalize_slot_name(result.get("next_slot_to_ask"))

    missing_required = updated_slots.missing_required_slots()
    if not is_complete:
        if not next_slot or next_slot not in missing_required:
            next_slot = missing_required[0] if missing_required else None
        if not str(speech or "").strip():
            speech = _fallback_booking_prompt(next_slot, selected_room.name if selected_room else updated_slots.room_type)

    updated_history = state.history + [
        ConversationTurn(role="user", content=state.latest_transcript),
        ConversationTurn(role="assistant", content=speech),
    ]

    # Determine next screen based on what's still missing
    next_screen = _determine_next_screen(updated_slots, is_complete)

    print(f"[BookingLogic] Slots: {updated_slots.model_dump()} | Complete: {is_complete} | Screen: {next_screen}")

    return {
        "speech_response": speech,
        "booking_slots": updated_slots,
        "active_slot": next_slot,
        "selected_room": selected_room,
        "history": updated_history,
        "next_ui_screen": next_screen,
    }


def _determine_next_screen(slots: BookingSlots, is_complete: bool) -> str:
    """Map missing slots to the correct UI screen.
    
    Flow:  ROOM_SELECT  ?  BOOKING_COLLECT  ?  BOOKING_SUMMARY
    """
    if is_complete:
        return "BOOKING_SUMMARY"

    # If we don't know the room yet, show the room picker
    if slots.room_type is None:
        return "ROOM_SELECT"

    # For all other missing info (dates, guests, name), use the conversational collector
    return "BOOKING_COLLECT"


