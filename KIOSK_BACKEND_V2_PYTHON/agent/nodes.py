"""
agent/nodes.py

The individual "nodes" in the LangGraph agent graph.
Each node receives the full KioskState, does one specific job, and returns
updates to the conversation state.
"""

import json
import re
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

When analyzing the user's transcript, first identify the intent: is it an Action Command (e.g., booking a room) or a Question?
If it is a Question, review the provided faq_context. You must use your reasoning capabilities to answer the user. For example, if they ask to check in at 9:00 AM, and the context says check-in is at 10:00 AM, politely explain that check-in starts at 10:00 AM.
If the faq_context provides the necessary information to answer the question (even if phrased differently), frame a natural, polite response. If the information is NOT present in the context at all, politely apologize and state that you do not have that information.

You can:
- Welcome guests and answer general questions
- Describe room types, amenities, pool timings, restaurants, etc.
- Help initiate a booking if the guest expresses interest

Keep responses concise (2-3 sentences max) since this is a voice interface.
Do not make up specific prices or room details you do not know.
End your response by naturally offering further assistance.
"""


def _format_faq_context(faq_context) -> str:
    if faq_context is None:
        return "No faq_context provided."
    if isinstance(faq_context, str):
        return faq_context
    try:
        return json.dumps(faq_context, indent=2, ensure_ascii=False)
    except Exception:
        return str(faq_context)


def build_general_chat_prompt(language: str, faq_context) -> str:
    return "\n".join(
        [
            GENERAL_CHAT_SYSTEM_PROMPT.strip(),
            "",
            "FAQ Context:",
            _format_faq_context(faq_context),
            "",
            f"Language rule: {_response_language_instruction(language)}",
        ]
    )


def general_chat(state: KioskState) -> dict:
    """Node 2: Handle general hotel questions and greetings."""
    print("[GeneralChat] Handling general query...")

    if state.faq_context:
        faq_answer = _answer_from_faq_context(state)
        if faq_answer:
            updated_history = state.history + [
                ConversationTurn(role="user", content=state.latest_transcript),
                ConversationTurn(role="assistant", content=faq_answer),
            ]
            return {
                "speech_response": faq_answer,
                "history": updated_history,
                "next_ui_screen": state.current_ui_screen,
            }

    if state.support_phone:
        response = (
            f"I'm sorry, I don't have that information. "
            f"Please contact our support at {state.support_phone}."
        )
        updated_history = state.history + [
            ConversationTurn(role="user", content=state.latest_transcript),
            ConversationTurn(role="assistant", content=response),
        ]
        return {
            "speech_response": response,
            "history": updated_history,
            "next_ui_screen": state.current_ui_screen,
        }

    history_messages = [
        {"role": turn.role, "content": turn.content}
        for turn in state.history[-6:]
    ]

    messages = (
        [{"role": "system", "content": build_general_chat_prompt(state.language, state.faq_context)}]
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


def _normalize_text(text: str) -> str:
    return "".join(ch.lower() if ch.isalnum() or ch.isspace() else " " for ch in text).strip()


def _normalize_time_expressions(text: str) -> str:
    # Normalize times like "9:00 a.m.", "9 am", "09:00am" to "09:00"
    cleaned = _normalize_text(text)
    cleaned = re.sub(r"\b(\d{1,2})\s*(am|pm)\b", r"\1:00 \2", cleaned)
    cleaned = re.sub(r"\b(\d{1,2})\s*:\s*(\d{2})\s*(am|pm)\b", r"\1:\2 \3", cleaned)

    def _to_24h(match):
        hour = int(match.group(1))
        minute = match.group(2)
        period = match.group(3)
        if period == "pm" and hour != 12:
            hour += 12
        if period == "am" and hour == 12:
            hour = 0
        return f"{hour:02d}:{minute}"

    cleaned = re.sub(r"\b(\d{1,2}):(\d{2})\s*(am|pm)\b", _to_24h, cleaned)
    return cleaned


def _tokenize(text: str) -> list[str]:
    stopwords = {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
        "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was",
        "were", "will", "with", "you", "your", "we", "our", "they", "their", "me", "my", "us"
    }
    tokens = _normalize_time_expressions(text).split()
    return [t for t in tokens if len(t) > 2 and t not in stopwords]


def _build_trigrams(text: str) -> set[str]:
    compact = _normalize_time_expressions(text).replace(" ", "")
    if not compact:
        return set()
    if len(compact) < 3:
        return {compact}
    return {compact[i:i + 3] for i in range(len(compact) - 2)}


def _dice_similarity(a: str, b: str) -> float:
    a_grams = _build_trigrams(a)
    b_grams = _build_trigrams(b)
    if not a_grams or not b_grams:
        return 0.0
    overlap = sum(1 for gram in a_grams if gram in b_grams)
    return (2 * overlap) / (len(a_grams) + len(b_grams))


def _match_faq(transcript: str, faq_context) -> dict | None:
    if not transcript or not faq_context:
        return None
    if isinstance(faq_context, str):
        return None

    tokens = _tokenize(transcript)
    if not tokens:
        return None

    best = None
    best_score = 0.0
    for item in faq_context:
        question = str(item.get("question", "") if isinstance(item, dict) else "")
        answer = str(item.get("answer", "") if isinstance(item, dict) else "")
        combined = f"{question} {answer}".strip()
        if not combined:
            continue
        combined_norm = _normalize_time_expressions(combined)
        hits = sum(1 for t in tokens if t in combined_norm)
        keyword_score = hits / max(1, len(tokens))
        fuzzy_score = max(
            _dice_similarity(transcript, question),
            _dice_similarity(transcript, combined)
        )
        score = max(keyword_score, fuzzy_score)
        if score > best_score:
            best_score = score
            best = {"question": question, "answer": answer, "score": score}

    return best if best and best["score"] >= 0.26 else None


def _format_faq_response(transcript: str, faq_match: dict) -> str:
    question = faq_match.get("question") or ""
    answer = faq_match.get("answer") or ""
    if not answer:
        return "I'm sorry, I don't have that information right now."
    # If the user asks about checking in at a specific time and the FAQ contains a time,
    # craft a concise, policy-consistent response.
    transcript_norm = _normalize_time_expressions(transcript)
    answer_norm = _normalize_time_expressions(answer)
    requested_time_match = re.search(r"\b(\d{2}:\d{2})\b", transcript_norm)
    policy_time_match = re.search(r"\b(\d{2}:\d{2})\b", answer_norm)
    if requested_time_match and policy_time_match and "check" in transcript_norm:
        requested_time = requested_time_match.group(1)
        policy_time = policy_time_match.group(1)
        return (
            f"Check-in starts at {policy_time} per hotel policy, "
            f"so {requested_time} isn't available."
        )
    if faq_match.get("score", 0) < 0.45 and question:
        return f"{answer}"
    return answer


def _answer_from_faq_context(state: KioskState) -> str | None:
    system_prompt = """
You are an assistant for a hotel kiosk. You must answer ONLY using the provided FAQ context.
Your task:
1) Decide if the user's question can be answered from the FAQ context (including paraphrases and follow-ups).
2) If yes, respond with a polite, natural answer that does NOT contradict the FAQ.
3) If not, respond with a JSON saying has_answer=false.

Important rules:
- Do NOT invent information.
- If the guest asks for a time earlier/later than policy in the FAQ, explain the policy from the FAQ.
- Keep responses concise (1-2 sentences).

Return ONLY JSON:
{"has_answer": true|false, "response": "..." }
"""

    messages = [
        {"role": "system", "content": system_prompt.strip()},
        {"role": "system", "content": f"FAQ_CONTEXT: {json.dumps(state.faq_context, ensure_ascii=False)}"},
        {"role": "system", "content": f"Recent conversation (last 4 turns): {json.dumps([t.model_dump() for t in state.history[-4:]], ensure_ascii=False)}"},
        {"role": "user", "content": state.latest_transcript},
    ]

    raw = get_llm_response(messages, temperature=0.2)
    try:
        result = json.loads(raw.strip())
        if result.get("has_answer") and result.get("response"):
            return str(result.get("response")).strip()
    except Exception:
        return None
    return None


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
