"""
agent/nodes.py

The individual "nodes" in the LangGraph agent graph.
Each node receives the full KioskState, does one specific job, and returns
updates to the conversation state.
"""

import json
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


ROUTER_SYSTEM_PROMPT = """
You are an intent classifier for a luxury hotel kiosk AI named "Siya".
Given the user's message, classify their intent into ONE of these categories:

- BOOK_ROOM: User wants to book a hotel room
- GENERAL_QUERY: User is asking about hotel amenities, pricing, or just chatting
- PROVIDE_GUESTS: User is providing the number of guests
- PROVIDE_DATES: User is providing check-in or check-out dates
- PROVIDE_NAME: User is providing their name
- CONFIRM_BOOKING: User is confirming the booking
- CANCEL_BOOKING: User wants to cancel
- MODIFY_BOOKING: User wants to change booking details
- IDLE: No meaningful input

Rules:
- Greetings like "hello", "hi", "namaste" are GENERAL_QUERY, NOT IDLE.
- IDLE is ONLY for empty/silent input.
- If the current screen is BOOKING_COLLECT and the user gives a name, it is PROVIDE_NAME.
- If the current screen is BOOKING_COLLECT and the user gives numbers, it is PROVIDE_GUESTS.

Respond ONLY with a JSON object:
{"intent": "<INTENT>", "confidence": <0.0-1.0>}
"""


def route_intent(state: KioskState) -> dict:
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


def general_chat(state: KioskState) -> dict:
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


def booking_logic(state: KioskState) -> dict:
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
    current_slots = state.booking_slots.model_dump()
    for key, value in extracted.items():
        if value is not None:
            current_slots[key] = value

    updated_slots = BookingSlots(**current_slots)
    speech = result.get("speech", "Let me note that down.")
    is_complete = result.get("is_complete", False) or updated_slots.is_complete()
    next_slot = result.get("next_slot_to_ask")

    updated_history = state.history + [
        ConversationTurn(role="user", content=state.latest_transcript),
        ConversationTurn(role="assistant", content=speech),
    ]

    next_screen = "BOOKING_SUMMARY" if is_complete else "BOOKING_COLLECT"

    print(f"[BookingLogic] Slots: {updated_slots.model_dump()} | Complete: {is_complete}")

    return {
        "speech_response": speech,
        "booking_slots": updated_slots,
        "active_slot": next_slot,
        "history": updated_history,
        "next_ui_screen": next_screen,
    }
