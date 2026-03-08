import json
import difflib
from typing import Optional
from agent.state import KioskState, BookingSlots, ConversationTurn
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

    return f"""
You are "Siya", a hotel booking assistant. You are collecting booking information from a guest.

Already collected:
{json.dumps(filled, indent=2) if filled else "Nothing yet."}

Still needed (in order of priority):
{missing}

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
- is_complete is true ONLY when all required slots (room_type, adults, check_in_date, check_out_date, guest_name) are available (combining already collected + newly extracted).
- next_slot_to_ask is null if is_complete is true.
"""


async def booking_logic(state: KioskState) -> dict:
    """Node 3: Collect booking details slot by slot."""
    print("[BookingLogic] Running slot collection...")

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
    
    # VALIDATION LAYER: Fuzzy Room Check
    # In a real app, we would fetch these from the DB based on state.tenant_id
    VALID_ROOMS = ["Superior Room", "Deluxe Suite", "Executive Suite", "Presidential Suite"]
    
    if extracted.get("room_type"):
        original_room = extracted["room_type"]
        best_match = find_best_room_match(original_room, VALID_ROOMS)
        
        if best_match:
            if best_match != original_room:
                print(f"[Validation] Fuzzy match: '{original_room}' -> '{best_match}'")
            extracted["room_type"] = best_match
        else:
            # Rejection: If the room doesn't exist, we don't save it and we ask for clarification.
            print(f"[Validation] Rejected room type: '{original_room}'")
            extracted["room_type"] = None
            speech = f"I'm sorry, we don't have a '{original_room}' room. We have Superior, Deluxe, and Executive suites. Which would you prefer?"

    current_slots = state.booking_slots.model_dump()
    for key, value in extracted.items():
        if value is not None:
            current_slots[key] = value

    updated_slots = BookingSlots(**current_slots)
    is_complete = result.get("is_complete", False) or updated_slots.is_complete()
    next_slot = result.get("next_slot_to_ask")

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
        "history": updated_history,
        "next_ui_screen": next_screen,
    }


def _determine_next_screen(slots: BookingSlots, is_complete: bool) -> str:
    """Map missing slots to the correct UI screen.
    
    Flow:  ROOM_SELECT  →  BOOKING_COLLECT  →  BOOKING_SUMMARY
    """
    if is_complete:
        return "BOOKING_SUMMARY"

    # If we don't know the room yet, show the room picker
    if slots.room_type is None:
        return "ROOM_SELECT"

    # For all other missing info (dates, guests, name), use the conversational collector
    return "BOOKING_COLLECT"
