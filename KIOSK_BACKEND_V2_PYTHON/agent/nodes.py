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

NUMBER_WORDS = {
    "zero": 0,
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

MONTH_NAME_TO_NUMBER = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

MONTH_REGEX = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|"
    r"jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
    r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)


def _response_language_instruction(language: str) -> str:
    code = (language or "en").strip().lower()
    language_name = LANGUAGE_DISPLAY_NAMES.get(code, code)
    if code == "hi":
        return (
            "Respond in conversational Indian Hindi with natural hotel terms. "
            "Light Hinglish is allowed. Avoid overly formal or literary Hindi."
        )
    if code == "mr":
        return (
            "Respond in conversational Marathi with natural hotel vocabulary. "
            "Keep the tone local, clear, and not overly formal."
        )
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
            "max_adults": room.max_adults,
        }
        for room in room_inventory
    ]


def _join_spoken_list(items: list[str]) -> str:
    clean = [item.strip() for item in items if item and item.strip()]
    if not clean:
        return ""
    if len(clean) == 1:
        return clean[0]
    if len(clean) == 2:
        return f"{clean[0]} and {clean[1]}"
    return f"{', '.join(clean[:-1])}, and {clean[-1]}"


def _format_price_for_speech(price: Optional[float], currency: Optional[str]) -> Optional[str]:
    if price is None:
        return None
    resolved_currency = (currency or "INR").upper()
    rounded = int(price) if float(price).is_integer() else round(float(price), 2)
    if resolved_currency == "INR":
        return f"INR {rounded}"
    return f"{resolved_currency} {rounded}"


def _parse_spoken_number(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    cleaned = re.sub(r"[^a-z0-9]", "", str(value).strip().lower())
    if not cleaned:
        return None
    if cleaned.isdigit():
        return int(cleaned)
    return NUMBER_WORDS.get(cleaned)


def _format_date_for_speech(raw_value: Optional[str]) -> Optional[str]:
    parsed = _parse_iso_date(raw_value)
    if not parsed:
        return None
    label = f"{parsed.strftime('%B')} {parsed.day}"
    if parsed.year != date.today().year:
        label = f"{label}, {parsed.year}"
    return label


def _build_room_presentation(room_inventory: list[RoomInventoryItem]) -> str:
    if not room_inventory:
        return "I can help you with a room booking whenever you're ready."

    if len(room_inventory) == 1:
        room = room_inventory[0]
        price_text = _format_price_for_speech(room.price, room.currency) or "our current rate"
        return f"We have the {room.name}, available at {price_text}. Would you like to take a look?"

    descriptions: list[str] = []
    for room in room_inventory[:3]:
        price_text = _format_price_for_speech(room.price, room.currency)
        descriptor = f"the {room.name}"
        if price_text:
            descriptor += f" at {price_text}"
        if room.max_adults:
            descriptor += f" for up to {room.max_adults} guest{'s' if room.max_adults != 1 else ''}"
        descriptions.append(descriptor)

    return (
        f"We have {len(room_inventory)} room options: {_join_spoken_list(descriptions)}. "
        "Which one interests you?"
    )


def _build_room_confirmation(room: RoomInventoryItem) -> str:
    parts = [f"Great choice. {room.name}"]
    price_text = _format_price_for_speech(room.price, room.currency)
    if price_text:
        parts[-1] += f" is available at {price_text} per night"
    if room.max_adults:
        parts[-1] += f" for up to {room.max_adults} adult{'s' if room.max_adults != 1 else ''}"
    parts.append("How many adults will be staying?")
    return ". ".join(parts)


def _build_room_recommendation_prompt(room_inventory: list[RoomInventoryItem]) -> str:
    if not room_inventory:
        return (
            "Certainly. I can help you with a room booking. "
            "If you already have a room in mind, please say the room name, "
            "or I can guide you through the available options."
        )

    room_count = len(room_inventory)
    described_rooms: list[str] = []
    for room in room_inventory[:2]:
        room_name = room.name or "This room"
        price_text = _format_price_for_speech(room.price, room.currency)
        occupancy_text = (
            f"for up to {room.max_adults} adult{'s' if room.max_adults != 1 else ''}"
            if room.max_adults
            else "for a comfortable stay"
        )
        if price_text:
            described_rooms.append(
                f"{room_name} is available for {price_text} and is suited {occupancy_text}."
            )
        else:
            described_rooms.append(
                f"{room_name} is available now and is suited {occupancy_text}."
            )

    remaining_count = room_count - len(described_rooms)
    follow_up = (
        f"I also have {remaining_count} more option{'s' if remaining_count != 1 else ''} available if you'd like to compare further."
        if remaining_count > 0
        else "If you'd like, I can walk you through either room in more detail."
    )

    return " ".join(
        [
            f"Certainly. We currently have {room_count} room option{'s' if room_count != 1 else ''} available, each with different amenities and room details.",
            *described_rooms,
            follow_up,
        ]
    ).strip()


def _normalize_text(value: str) -> str:
    text = (value or "").strip().lower()
    return (
        text
        .replace("sweet", "suite")
        .replace("sweets", "suites")
        .replace("luxary", "luxury")
    )


ROOM_TRANSCRIPT_PREFIX_PATTERNS = [
    r"^(?:i\s+want\s+to\s+book|i\s+want\s+to|i\s+want|i\s+would\s+like\s+to\s+book|i\s+would\s+like\s+to|would\s+like\s+to\s+book|would\s+like\s+to|can\s+i\s+get|can\s+i\s+have|please\s+book|please\s+choose|please\s+select|book|choose|select|take|prefer)\s+",
]
ROOM_TRANSCRIPT_STOPWORDS = {
    "i", "want", "to", "book", "booking", "would", "like", "please", "can", "get", "have",
    "need", "a", "an", "the", "for", "me", "my", "room", "rooms", "type", "option", "options",
    "choose", "select", "take", "prefer", "another", "different",
}


def _tokenize_text(value: str) -> list[str]:
    normalized = _normalize_text(value)
    if not normalized:
        return []
    return [token for token in re.split(r"[^a-z0-9]+", normalized) if token]


def _meaningful_room_tokens(value: str) -> list[str]:
    return [
        token for token in _tokenize_text(value)
        if len(token) >= 3 and token not in ROOM_TRANSCRIPT_STOPWORDS
    ]


def _extract_room_candidate_from_transcript(transcript: str) -> str:
    normalized = _normalize_text(transcript)
    candidate = normalized
    for pattern in ROOM_TRANSCRIPT_PREFIX_PATTERNS:
        candidate = re.sub(pattern, "", candidate).strip()
    return candidate


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


def _fallback_booking_prompt(
    next_slot: Optional[str],
    selected_room_name: Optional[str],
    room_inventory: Optional[list[RoomInventoryItem]] = None,
) -> str:
    slot = _normalize_slot_name(next_slot)
    if slot == "room_type":
        return _build_room_recommendation_prompt(room_inventory or [])
    if slot == "adults":
        if selected_room_name:
            return f"Certainly. {selected_room_name} is a lovely choice. How many adults will be staying?"
        return "Certainly. How many adults will be staying?"
    if slot == "check_in_date":
        return "Certainly. What is your check in date?"
    if slot == "check_out_date":
        return "And what is your check out date?"
    if slot == "guest_name":
        return "May I have the name for this booking?"
    return "Whenever you're ready, please share the next booking detail."


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


def _resolve_calendar_date(month_token: str, day_value: str, year_value: Optional[str], today: date) -> Optional[date]:
    month = MONTH_NAME_TO_NUMBER.get(str(month_token or "").strip().lower())
    day = _parse_spoken_number(day_value)
    if not month or day is None:
        return None

    target_year = int(year_value) if year_value else today.year
    try:
        parsed = date(target_year, month, day)
    except ValueError:
        return None

    if year_value:
        return parsed

    while parsed < today:
        parsed = _replace_year_safely(parsed, parsed.year + 1)
    return parsed


def _extract_dates_deterministically(transcript: str) -> dict[str, str]:
    if not transcript:
        return {}

    text = transcript.strip().lower()
    today = date.today()

    relative_range = re.search(
        r"\b(today|tomorrow|day after tomorrow)\b\s*(?:to|until|through|till|-)\s*\b(today|tomorrow|day after tomorrow)\b",
        text,
    )
    if relative_range:
        first = relative_range.group(1)
        second = relative_range.group(2)
        relative_dates = {
            "today": today,
            "tomorrow": today + timedelta(days=1),
            "day after tomorrow": today + timedelta(days=2),
        }
        check_in = relative_dates.get(first)
        check_out = relative_dates.get(second)
        if check_in and check_out:
            return {
                "check_in_date": check_in.isoformat(),
                "check_out_date": check_out.isoformat(),
            }

    month_range = re.search(
        rf"\b(?:from\s+)?(?P<month1>{MONTH_REGEX})\s+(?P<day1>\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s*(?P<year1>\d{{4}}))?"
        rf"\s*(?:to|until|through|till|-)\s*(?:(?P<month2>{MONTH_REGEX})\s+)?(?P<day2>\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s*(?P<year2>\d{{4}}))?\b",
        text,
    )
    if month_range:
        check_in = _resolve_calendar_date(
            month_range.group("month1"),
            month_range.group("day1"),
            month_range.group("year1"),
            today,
        )
        check_out = _resolve_calendar_date(
            month_range.group("month2") or month_range.group("month1"),
            month_range.group("day2"),
            month_range.group("year2") or month_range.group("year1"),
            today,
        )
        if check_in and check_out:
            return {
                "check_in_date": check_in.isoformat(),
                "check_out_date": check_out.isoformat(),
            }

    iso_dates = re.findall(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
    if len(iso_dates) >= 2:
        return {
            "check_in_date": iso_dates[0],
            "check_out_date": iso_dates[1],
        }

    single_relative: Optional[date] = None
    if re.search(r"\bday after tomorrow\b", text):
        single_relative = today + timedelta(days=2)
    elif re.search(r"\btomorrow\b", text):
        single_relative = today + timedelta(days=1)
    elif re.search(r"\btoday\b", text):
        single_relative = today
    if single_relative:
        return {"check_in_date": single_relative.isoformat()}

    if iso_dates:
        return {"check_in_date": iso_dates[0]}

    month_day_matches = list(
        re.finditer(
            rf"\b({MONTH_REGEX})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s*(\d{{4}}))?\b",
            text,
        )
    )
    if month_day_matches:
        parsed_dates: list[date] = []
        for match in month_day_matches[:2]:
            parsed = _resolve_calendar_date(match.group(1), match.group(2), match.group(3), today)
            if parsed:
                parsed_dates.append(parsed)
        if len(parsed_dates) >= 2:
            return {
                "check_in_date": parsed_dates[0].isoformat(),
                "check_out_date": parsed_dates[1].isoformat(),
            }
        if len(parsed_dates) == 1:
            return {"check_in_date": parsed_dates[0].isoformat()}

    return {}


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
    if normalized in {"suite", "room", "rooms"}:
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
        transcript_tokens = _meaningful_room_tokens(extracted)
        if not transcript_tokens:
            return None

        scored_matches: list[tuple[int, int, RoomInventoryItem]] = []
        for room in room_inventory:
            alias_tokens = _meaningful_room_tokens(f"{room.name} {room.code or ''}")
            if not alias_tokens:
                continue
            matched_tokens = sum(1 for token in alias_tokens if token in transcript_tokens)
            if matched_tokens == 0:
                continue
            scored_matches.append((matched_tokens, len(alias_tokens), room))

        if not scored_matches:
            return None

        scored_matches.sort(key=lambda item: (item[0], -item[1]), reverse=True)
        best_score, best_alias_len, best_room = scored_matches[0]
        if best_score < max(1, min(2, best_alias_len)):
            return None
        if len(scored_matches) > 1:
            next_score, next_alias_len, _ = scored_matches[1]
            if next_score == best_score and next_alias_len == best_alias_len:
                return None
        return best_room

    return alias_to_room.get(best_match)


def _build_room_options_text(room_inventory: list[RoomInventoryItem]) -> str:
    if not room_inventory:
        return "No catalog data available."
    names = [room.name for room in room_inventory if room.name][:5]
    if not names:
        return "No room names available."
    return _join_spoken_list(names)


def _should_stay_in_room_preview(
    state: KioskState,
    selected_room: Optional[RoomInventoryItem],
    room_type: Optional[str],
) -> bool:
    if not selected_room and not room_type:
        return False

    collection_intents = {"CONFIRM_BOOKING", "PROVIDE_GUESTS", "PROVIDE_DATES", "PROVIDE_NAME"}
    if state.resolved_intent in collection_intents:
        return False

    return state.current_ui_screen in {"WELCOME", "AI_CHAT", "MANUAL_MENU", "ROOM_SELECT", "ROOM_PREVIEW"}


def _is_booking_collection_prompt(speech: str) -> bool:
    text = (speech or "").strip().lower()
    if not text:
        return False
    return bool(
        re.search(
            r"\bhow many adults\b|\bcheck in date\b|\bcheck out date\b|\bname for this booking\b|\bconfirm booking\b|\bnext booking detail\b",
            text,
        )
    )


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


def _is_room_change_request(transcript: str) -> bool:
    text = (transcript or "").strip().lower()
    if not text:
        return False

    references_room = bool(
        re.search(r"\b(room|suite)\b", text)
        or re.search(r"\broom selection\b", text)
    )
    wants_change = bool(
        re.search(r"\b(change|modify|switch|different|another|edit|update|replace)\b", text)
        or re.search(r"\bgo back\b", text)
    )

    return references_room and wants_change


def _looks_like_check_in_request(transcript: str) -> bool:
    text = (transcript or "").strip().lower()
    if not text:
        return False
    # Guard: informational FAQ phrases like "what is check in time" are NOT transactional check-in.
    check_in_info_question = bool(
        (
            re.search(r"\bcheck[\s-]?in\b", text)
            or re.search(r"\b(check and|second time)\b", text)
        )
        and re.search(r"\b(what|when|time|timing|hours?|know|tell)\b", text)
    )
    if check_in_info_question:
        return False
    return bool(
        re.search(
            r"\b(check[\s-]?in|i have a booking|existing booking|have reservation|my reservation)\b",
            text,
        )
    )


def _looks_like_room_browsing_request(transcript: str) -> bool:
    """Deterministic check for room exploration/browsing intent."""
    text = (transcript or "").strip().lower()
    if not text:
        return False
    # Guard: if the user is asking an informational question about rooms
    # (e.g. "what time can I check into my room"), that is NOT a browsing request.
    info_question = bool(
        re.search(r"\b(room)\b", text)
        and re.search(r"\b(what|when|time|timing|hours?|policy|policies|rules?)\b", text)
        and not re.search(r"\b(show|see|view|explore|tour|browse|available|options?)\b", text)
    )
    if info_question:
        return False
    return bool(
        re.search(
            r"\b("
            r"show\s+(?:me\s+)?(?:the\s+)?rooms|"
            r"see\s+(?:the\s+)?rooms|"
            r"view\s+(?:the\s+)?rooms|"
            r"virtual\s+tour|"
            r"explore\s+(?:the\s+)?rooms|"
            r"room\s+options|"
            r"available\s+rooms|"
            r"rooms?\s+available|"
            r"(?:any|some)\s+rooms?\s+(?:available|free|open)|"
            r"(?:is|are)\s+(?:there\s+)?(?:any\s+)?rooms?\s+(?:available|free|open)|"
            r"(?:do\s+you\s+have|have\s+you\s+got)\s+(?:any\s+)?rooms?|"
            r"what\s+rooms|"
            r"browse\s+(?:the\s+)?rooms|"
            r"let\s+me\s+(?:see|explore|view|browse)\s+(?:the\s+)?rooms|"
            r"room\s+tour|"
            r"give\s+me\s+(?:a\s+)?(?:virtual\s+)?tour|"
            r"show\s+(?:me\s+)?(?:the\s+)?room\s+options|"
            r"i\s+want\s+to\s+(?:see|explore|view|browse)\s+(?:the\s+)?rooms"
            r")\b",
            text,
        )
    )


ROUTER_SYSTEM_PROMPT = """
You are a highly critical intent classifier for a luxury hotel kiosk AI named "Siya".
The user's text may contain mixed intentions, conversational filler, or mid-sentence corrections (e.g., "Wait, no, I mean check in").
Your job is to read the ENTIRE message carefully before deciding the final intent.

- BOOK_ROOM: User wants to start a NEW reservation, explore rooms, see room options, take a virtual tour, view available rooms, or browse what's available. Any expression of interest in seeing, exploring, or choosing rooms counts as BOOK_ROOM.
- CHECK_IN: User is at the kiosk to get their room key for an EXISTING booking.
- REQUEST_HELP: User is asking for staff assistance, a human, a manager, or general support contact info.
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

## Screen Context Rules
A "Current UI screen" message is provided. Use it to disambiguate ambiguous intents:
- WELCOME / IDLE: Opening screen. Any mention of rooms, availability, booking, or wanting to see/explore rooms -> BOOK_ROOM. Greetings, amenity questions, hotel info -> GENERAL_QUERY.
- ROOM_SELECT: User is browsing the room catalog. Selecting or asking about a specific room -> BOOK_ROOM. Feature questions -> GENERAL_QUERY.
- ROOM_PREVIEW: User is viewing a SPECIFIC room's image carousel.
  * "show me bathroom", "I want to see the balcony", "show me the view", or ANY request to focus on a room feature/area -> GENERAL_QUERY (this is a visual focus request, NOT a new booking).
  * "book this room", "I'll take it", "I want this one" -> BOOK_ROOM.
  * "show me another option", "different room", "I don't like this", "go back", "other rooms" -> MODIFY_BOOKING (user wants to browse different rooms).
- BOOKING_COLLECT: User is providing booking details (guests, dates, name).
  * Visual focus requests ("show me the balcony") -> GENERAL_QUERY.
  * Guest counts -> PROVIDE_GUESTS. Dates -> PROVIDE_DATES. Names -> PROVIDE_NAME.
- BOOKING_SUMMARY: Only CONFIRM_BOOKING or MODIFY_BOOKING are expected here.
CRITICAL: On ROOM_PREVIEW and BOOKING_COLLECT, phrases like "show me [room part]" are visual focus requests (GENERAL_QUERY), NOT booking requests. Do not classify them as BOOK_ROOM.

Respond ONLY with a JSON object:
{"intent": "<INTENT>", "confidence": <0.0-1.0>}
"""


async def route_intent(state: KioskState) -> dict:
    """Node 1: Classify the user's intent."""
    print(f"[Router] Classifying: '{state.latest_transcript}'")
    semantic_hint: Optional[str] = None

    if _looks_like_check_in_request(state.latest_transcript):
        return {
            "resolved_intent": "CHECK_IN",
            "confidence": 0.97,
            "speech_override": None,
            "consecutive_failures": 0,
            "last_failed_screen": None,
        }

    # Screen-aware visual focus guard: on ROOM_PREVIEW / BOOKING_COLLECT,
    # "show me bathroom / balcony / bedroom / view" is a visual focus request,
    # NOT a new booking.  Route as GENERAL_QUERY so the visual concierge
    # in chat.py handles the carousel focus + narration.
    if state.current_ui_screen in ("ROOM_PREVIEW", "BOOKING_COLLECT"):
        _vf_text = (state.latest_transcript or "").strip().lower()
        if re.search(
            r"\b(?:show|see|view|display|open|focus)\b.*"
            r"\b(?:bath(?:room|tub)?|balcony|terrace|bedroom|bed|living|lounge|"
            r"kitchen|view|ocean|fireplace|shower|pool|sofa|seating)\b",
            _vf_text,
        ):
            print(
                f"[Router] Visual focus guard on {state.current_ui_screen}: "
                f"'{state.latest_transcript}' -> GENERAL_QUERY"
            )
            return {
                "resolved_intent": "GENERAL_QUERY",
                "confidence": 0.95,
                "speech_override": None,
                "consecutive_failures": 0,
                "last_failed_screen": None,
            }

    if _looks_like_room_browsing_request(state.latest_transcript):
        print(f"[Router] Deterministic room browsing match: '{state.latest_transcript}'")
        return {
            "resolved_intent": "BOOK_ROOM",
            "confidence": 0.95,
            "speech_override": None,
            "consecutive_failures": 0,
            "last_failed_screen": None,
        }

    # Deterministic summary control avoids LLM drift on "confirm and pay"/"it's correct"/"card".
    if state.current_ui_screen == "BOOKING_SUMMARY":
        if _is_summary_modify_transcript(state.latest_transcript):
            return {
                "resolved_intent": "MODIFY_BOOKING",
                "confidence": 0.96,
                "speech_override": None,
                "consecutive_failures": 0,
                "last_failed_screen": None,
            }
        if state.booking_slots.is_complete() and _is_summary_confirmation_transcript(state.latest_transcript):
            return {
                "resolved_intent": "CONFIRM_BOOKING",
                "confidence": 0.97,
                "speech_override": None,
                "consecutive_failures": 0,
                "last_failed_screen": None,
            }

    # Layer 2: semantic classifier
    try:
        from agent.semantic_classifier import classify_intent_semantically

        semantic_result = await classify_intent_semantically(
            transcript=state.latest_transcript,
            current_screen=state.current_ui_screen,
        )
        if semantic_result is not None:
            if semantic_result.is_out_of_domain:
                print(
                    f"[Router][L2] Out-of-domain (score={semantic_result.confidence}), escalating to LLM"
                )
            elif not semantic_result.should_escalate_to_llm:
                print(
                    f"[Router][L2] HIGH confidence: intent={semantic_result.intent} "
                    f"score={semantic_result.confidence} phrase='{semantic_result.matched_phrase}'"
                )
                return {
                    "resolved_intent": semantic_result.intent,
                    "confidence": semantic_result.confidence,
                    "speech_override": None,
                    "consecutive_failures": 0,
                    "last_failed_screen": None,
                }
            else:
                print(
                    f"[Router][L2] MEDIUM confidence: intent={semantic_result.intent} "
                    f"score={semantic_result.confidence} - hinting to LLM"
                )
                semantic_hint = semantic_result.intent
    except Exception as exc:
        print(f"[Router][L2] Semantic classifier error (non-fatal): {exc}")

    hint_text = (
        f"\n\nSemantic pre-classifier suggests this might be: {semantic_hint}. "
        f"Confirm or override based on the full context."
    ) if semantic_hint else ""
    full_prompt = ROUTER_SYSTEM_PROMPT + hint_text
    messages = [
        {"role": "system", "content": full_prompt},
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

    # Low-confidence fallback: if LLM classified as GENERAL_QUERY but transcript
    # matches room browsing patterns, override to BOOK_ROOM.
    if intent == "GENERAL_QUERY" and confidence < 0.80:
        if _looks_like_room_browsing_request(state.latest_transcript):
            print(f"[Router] Low-confidence fallback: GENERAL_QUERY({confidence}) -> BOOK_ROOM")
            intent = "BOOK_ROOM"
            confidence = 0.85

    is_failure = intent in {"IDLE", "GENERAL_QUERY"} and confidence < 0.60
    current_screen = state.current_ui_screen
    if is_failure:
        if state.last_failed_screen == current_screen:
            consecutive_failures = (state.consecutive_failures or 0) + 1
        else:
            consecutive_failures = 1
        last_failed_screen = current_screen
    else:
        consecutive_failures = 0
        last_failed_screen = None

    escalation_threshold = 2
    if is_failure and consecutive_failures >= escalation_threshold:
        print(f"[Router][L4] {consecutive_failures} consecutive failures -> escalating")
        return {
            "resolved_intent": "IDLE",
            "confidence": 1.0,
            "speech_override": (
                "I'm sorry, I'm having trouble understanding. "
                "A staff member can assist you right away - "
                "please approach the front desk or press the call button on this screen."
            ),
            "consecutive_failures": consecutive_failures,
            "last_failed_screen": last_failed_screen,
        }

    if is_failure and consecutive_failures == 1:
        print("[Router][L4] First failure -> retry guidance")
        return {
            "resolved_intent": "IDLE",
            "confidence": 1.0,
            "speech_override": (
                "I didn't quite catch that. "
                "You can tap the screen buttons, or try saying it again in a different way."
            ),
            "consecutive_failures": consecutive_failures,
            "last_failed_screen": last_failed_screen,
        }

    print(f"[Router] -> Intent: {intent} (confidence: {confidence})")
    return {
        "resolved_intent": intent,
        "confidence": confidence,
        "speech_override": None,
        "consecutive_failures": consecutive_failures,
        "last_failed_screen": last_failed_screen,
    }


GENERAL_CHAT_SYSTEM_PROMPT = """
You are "Siya", a warm and professional AI concierge at a luxury hotel kiosk.
Siya is a female assistant. If you refer to yourself, do so naturally as a woman.
Your role is to assist guests with information about the hotel.

You can:
- Welcome guests and answer general questions
- Describe room types, amenities, pool timings, restaurants, etc.
- Help initiate a booking if the guest expresses interest

Keep responses concise (2-3 sentences max) since this is a voice interface.
Do not make up specific prices or room details you do not know.
For hotel-specific policies or rules, only answer when you have exact policy context.
If exact policy context is unavailable, say you are not certain and offer to connect the guest to assistance.
Never invent hotel regulations, timings, fees, or exceptions.
End your response by naturally offering further assistance.
"""


def build_general_chat_prompt(state: KioskState) -> str:
    selected_room_name = (
        state.selected_room.name
        if state.selected_room and state.selected_room.name
        else state.booking_slots.room_type
        or "not selected yet"
    )
    booking_context_lines = []
    if state.current_ui_screen in {"BOOKING_COLLECT", "BOOKING_SUMMARY"}:
        booking_context_lines = [
            "The guest is in the middle of booking a room.",
            f"Current selected room: {selected_room_name}.",
            "Answer like an enthusiastic luxury-hotel concierge.",
            "If the guest asks about the room or hotel, answer warmly first and then gently offer to continue the booking.",
        ]

    return "\n".join(
        [
            GENERAL_CHAT_SYSTEM_PROMPT.strip(),
            "",
            *booking_context_lines,
            f"Language rule: {_response_language_instruction(state.language)}",
        ]
    )


async def general_chat(state: KioskState) -> dict:
    """Node 2: Handle general hotel questions and greetings."""
    print("[GeneralChat] Handling general query...")

    if state.speech_override:
        response = state.speech_override
        updated_history = state.history + [
            ConversationTurn(role="user", content=state.latest_transcript),
            ConversationTurn(role="assistant", content=response),
        ]
        return {
            "speech_response": response,
            "speech_override": None,
            "history": updated_history,
            "next_ui_screen": state.current_ui_screen,
        }

    if state.resolved_intent == "CHECK_IN":
        response = "Sure. Let's begin check in. Please scan your ID to continue."
        updated_history = state.history + [
            ConversationTurn(role="user", content=state.latest_transcript),
            ConversationTurn(role="assistant", content=response),
        ]
        return {
            "speech_response": response,
            "speech_override": None,
            "history": updated_history,
            "next_ui_screen": "SCAN_ID",
        }

    if state.resolved_intent == "REQUEST_HELP":
        response = "Certainly, I will pull up the support contact details for you now."
        updated_history = state.history + [
            ConversationTurn(role="user", content=state.latest_transcript),
            ConversationTurn(role="assistant", content=response),
        ]
        return {
            "speech_response": response,
            "speech_override": None,
            "history": updated_history,
            "next_ui_screen": "HELP",
        }

    history_messages = [
        {"role": turn.role, "content": turn.content}
        for turn in state.history[-6:]
    ]

    messages = (
        [{"role": "system", "content": build_general_chat_prompt(state)}]
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
        "speech_override": None,
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
You are a booking fallback for Siya, a hotel kiosk voice assistant.
Use the live room inventory and already collected slots as the source of truth.

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
2. Give a short spoken response for ambiguous or open-ended booking turns.
3. If the guest wants to book a room but has not chosen one yet, present the available room options from the live inventory.
4. If a room is already selected, describe it briefly before asking for the next missing booking detail.
5. If all slots are filled, confirm the booking summary.

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
- Keep the speech concise and voice-friendly.
- Mention at most 2 or 3 concrete room details in one reply.
- Ask at most one follow-up question at the end of the speech.
- Prefer live tenant inventory over generic room wording.
- If the guest has not chosen a room yet, mention how many room options are available and briefly describe one or two of them by name, price, and occupancy when possible.
- While the guest is still browsing rooms or asking about room details, keep next_slot_to_ask as null and keep the speech focused on describing the selected room and offering to continue or show another option.
- If the guest mentions a preference but not a room name, match it to the closest suitable room from the live inventory when possible.
- If a specific room detail is not present in the authoritative inventory, do not invent it.
- Only include slots in extracted_slots if they were mentioned in this turn.
- Dates must be in YYYY-MM-DD format.
- If user says month/day without year, choose the nearest upcoming future date from current kiosk date.
- If room_type is present, normalize it to one of the available tenant room names when possible.
- is_complete is true ONLY when all required slots (room_type, adults, check_in_date, check_out_date, guest_name) are available (combining already collected + newly extracted).
- next_slot_to_ask is null if is_complete is true.
"""


def _is_initial_booking_turn(state: KioskState) -> bool:
    return state.resolved_intent == "BOOK_ROOM" and state.current_ui_screen in {
        "WELCOME",
        "AI_CHAT",
        "MANUAL_MENU",
    }


def _transcript_explicitly_identifies_room(
    transcript: str,
    room_inventory: list[RoomInventoryItem],
) -> Optional[RoomInventoryItem]:
    candidate = _extract_room_candidate_from_transcript(transcript)
    return _find_room_from_inventory(room_inventory, candidate or transcript)


def _extract_guest_counts_deterministically(transcript: str) -> dict[str, int]:
    text = (transcript or "").strip().lower()
    if not text:
        return {}

    slots: dict[str, int] = {}
    child_match = re.search(r"\b(\d+|one|two|three|four|five|six)\s*(?:child|children|kid|kids)\b", text)
    if child_match:
        child_count = _parse_spoken_number(child_match.group(1))
        if child_count is not None:
            slots["children"] = child_count

    adult_match = re.search(r"\b(\d+|one|two|three|four|five|six)\s*adults?\b", text)
    if adult_match:
        adult_count = _parse_spoken_number(adult_match.group(1))
        if adult_count is not None and adult_count >= 1:
            slots["adults"] = adult_count
            return slots

    if re.search(r"\bjust me\b|\balone\b|\bsolo\b|\b1 person\b", text):
        slots["adults"] = 1
        return slots

    total_match = re.search(r"\b(\d+|one|two|three|four|five|six)\s*(?:people|guests?|persons?)\b", text)
    if not total_match:
        total_match = re.search(r"\bwe are\s+(\d+|one|two|three|four|five|six)\b", text)
    if total_match:
        total_count = _parse_spoken_number(total_match.group(1))
        if total_count is not None and total_count >= 1:
            if "children" in slots and total_count > slots["children"]:
                slots["adults"] = total_count - slots["children"]
            elif "children" not in slots:
                slots["adults"] = total_count

    return slots


def _extract_guest_name_deterministically(transcript: str) -> Optional[str]:
    text = (transcript or "").strip()
    if not text:
        return None

    cleaned = re.sub(
        r"^(?:my name is|name is|i am|i'm|its|it's|this is)\s+",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip(" .")
    if not cleaned:
        return None
    return cleaned.title()


def _extract_slots_deterministically(state: KioskState) -> dict:
    text = (state.latest_transcript or "").strip()
    room_inventory = state.tenant_room_inventory or []
    slots: dict[str, object] = {}

    if state.resolved_intent == "BOOK_ROOM":
        matched_room = _transcript_explicitly_identifies_room(text, room_inventory)
        if matched_room:
            slots["room_type"] = matched_room.name
        elif (
            state.current_ui_screen == "ROOM_PREVIEW"
            and state.selected_room
            and re.search(r"\b(book|take|want|choose|confirm)\b.*\b(this|it|room|one)\b", text, re.IGNORECASE)
        ):
            slots["room_type"] = state.selected_room.name

    if state.resolved_intent == "PROVIDE_GUESTS":
        slots.update(_extract_guest_counts_deterministically(text))

    if state.resolved_intent == "PROVIDE_DATES":
        slots.update(_extract_dates_deterministically(text))

    if state.resolved_intent == "PROVIDE_NAME":
        guest_name = _extract_guest_name_deterministically(text)
        if guest_name:
            slots["guest_name"] = guest_name

    return slots


def _prepare_booking_state_update(
    state: KioskState,
    extracted_slots: Optional[dict] = None,
    selected_room: Optional[RoomInventoryItem] = None,
    reset_booking: bool = False,
    clear_room_selection: bool = False,
) -> tuple[BookingSlots, Optional[RoomInventoryItem]]:
    current_slots = (
        BookingSlots().model_dump()
        if reset_booking
        else state.booking_slots.model_dump()
    )
    if clear_room_selection:
        current_slots["room_type"] = None
        current_slots["total_price"] = None

    for key, value in (extracted_slots or {}).items():
        if value is not None:
            current_slots[key] = value

    resolved_selected_room = None if (reset_booking or clear_room_selection) else state.selected_room
    if selected_room is not None:
        resolved_selected_room = selected_room
        current_slots["room_type"] = selected_room.name

    updated_slots = BookingSlots(**current_slots)
    room_inventory = state.tenant_room_inventory or []
    if updated_slots.room_type and room_inventory:
        resolved_selected_room = _find_room_from_inventory(room_inventory, updated_slots.room_type) or resolved_selected_room
    updated_slots = _normalize_booking_dates(updated_slots, state.latest_transcript, resolved_selected_room)
    return updated_slots, resolved_selected_room


def _make_booking_response(
    state: KioskState,
    speech: str,
    next_ui_screen: str,
    *,
    active_slot: Optional[str] = None,
    extracted_slots: Optional[dict] = None,
    selected_room: Optional[RoomInventoryItem] = None,
    reset_booking: bool = False,
    clear_room_selection: bool = False,
) -> dict:
    updated_slots, resolved_selected_room = _prepare_booking_state_update(
        state,
        extracted_slots=extracted_slots,
        selected_room=selected_room,
        reset_booking=reset_booking,
        clear_room_selection=clear_room_selection,
    )
    updated_history = state.history + [
        ConversationTurn(role="user", content=state.latest_transcript),
        ConversationTurn(role="assistant", content=speech),
    ]
    return {
        "speech_response": speech,
        "booking_slots": updated_slots,
        "active_slot": active_slot,
        "selected_room": resolved_selected_room,
        "history": updated_history,
        "next_ui_screen": next_ui_screen,
    }


def _deterministic_booking_response(
    state: KioskState,
    extracted_slots: dict,
    room_inventory: list[RoomInventoryItem],
) -> Optional[dict]:
    intent = state.resolved_intent

    if intent == "CANCEL_BOOKING":
        return _make_booking_response(
            state,
            "No problem. Is there anything else I can help with?",
            "WELCOME",
            active_slot=None,
            reset_booking=True,
            clear_room_selection=True,
        )

    if intent == "BOOK_ROOM":
        room: Optional[RoomInventoryItem] = None
        if extracted_slots.get("room_type"):
            room = _find_room_from_inventory(room_inventory, str(extracted_slots["room_type"]))
        elif state.current_ui_screen == "ROOM_PREVIEW" and state.selected_room:
            room = state.selected_room
        elif state.booking_slots.room_type and state.current_ui_screen in {"ROOM_PREVIEW", "BOOKING_COLLECT"}:
            room = _find_room_from_inventory(room_inventory, state.booking_slots.room_type) or state.selected_room

        if room:
            extracted = dict(extracted_slots)
            extracted["room_type"] = room.name
            return _make_booking_response(
                state,
                _build_room_confirmation(room),
                "BOOKING_COLLECT",
                active_slot="adults",
                extracted_slots=extracted,
                selected_room=room,
            )

        if not state.booking_slots.room_type:
            if not room_inventory:
                return None
            return _make_booking_response(
                state,
                _build_room_presentation(room_inventory),
                "ROOM_SELECT",
                active_slot="room_type",
                clear_room_selection=True,
            )

    if intent == "PROVIDE_GUESTS" and extracted_slots.get("adults") is not None:
        adults = int(extracted_slots["adults"])
        children = extracted_slots.get("children")
        guest_text = f"{adults} adult{'s' if adults != 1 else ''}"
        if isinstance(children, int) and children > 0:
            guest_text += f" and {children} child{'ren' if children != 1 else ''}"
        return _make_booking_response(
            state,
            f"Got it, {guest_text}. When would you like to check in?",
            "BOOKING_COLLECT",
            active_slot="check_in_date",
            extracted_slots=extracted_slots,
        )

    if intent == "PROVIDE_DATES":
        preview_slots, preview_room = _prepare_booking_state_update(
            state,
            extracted_slots=extracted_slots,
        )
        check_in_text = _format_date_for_speech(preview_slots.check_in_date)
        check_out_text = _format_date_for_speech(preview_slots.check_out_date)
        if check_in_text and check_out_text:
            nights = preview_slots.nights or max(
                1,
                (_parse_iso_date(preview_slots.check_out_date) - _parse_iso_date(preview_slots.check_in_date)).days,
            )
            speech = (
                f"Check-in {check_in_text}, check-out {check_out_text}, that's {nights} "
                f"night{'s' if nights != 1 else ''}. And the name for this booking please?"
            )
            return _make_booking_response(
                state,
                speech,
                "BOOKING_COLLECT",
                active_slot="guest_name",
                extracted_slots=extracted_slots,
                selected_room=preview_room,
            )
        if check_in_text:
            return _make_booking_response(
                state,
                f"Check-in {check_in_text}. When would you like to check out?",
                "BOOKING_COLLECT",
                active_slot="check_out_date",
                extracted_slots=extracted_slots,
                selected_room=preview_room,
            )

    if intent == "PROVIDE_NAME" and extracted_slots.get("guest_name"):
        name = str(extracted_slots["guest_name"])
        return _make_booking_response(
            state,
            f"Thank you, {name}. Let me pull up your booking summary.",
            "BOOKING_SUMMARY",
            active_slot=None,
            extracted_slots=extracted_slots,
        )

    return None


async def booking_logic(state: KioskState) -> dict:
    """Node 3: Collect booking details slot by slot."""
    print("[BookingLogic] Running slot collection...")

    if state.speech_override:
        speech = state.speech_override
        updated_history = state.history + [
            ConversationTurn(role="user", content=state.latest_transcript),
            ConversationTurn(role="assistant", content=speech),
        ]
        return {
            "speech_response": speech,
            "speech_override": None,
            "booking_slots": state.booking_slots,
            "active_slot": state.active_slot,
            "selected_room": state.selected_room,
            "history": updated_history,
            "next_ui_screen": state.current_ui_screen,
        }

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
            speech = _fallback_booking_prompt(next_slot, selected_room_name, state.tenant_room_inventory)
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

    if state.resolved_intent == "MODIFY_BOOKING" and _is_room_change_request(state.latest_transcript):
        speech = "Of course. Let's take another look at the rooms and find a comfortable option for you."
        updated_history = state.history + [
            ConversationTurn(role="user", content=state.latest_transcript),
            ConversationTurn(role="assistant", content=speech),
        ]
        updated_slots = state.booking_slots.model_copy(
            update={
                "room_type": None,
                "total_price": None,
            }
        )
        return {
            "speech_response": speech,
            "booking_slots": updated_slots,
            "active_slot": "room_type",
            "selected_room": None,
            "history": updated_history,
            "next_ui_screen": "ROOM_SELECT",
        }

    extracted = _extract_slots_deterministically(state)
    deterministic = _deterministic_booking_response(
        state,
        extracted,
        state.tenant_room_inventory or [],
    )
    if deterministic:
        print("[BookingLogic] Deterministic response (no LLM)")
        return deterministic

    messages = [
        {"role": "system", "content": build_booking_prompt(state)},
        {"role": "user", "content": state.latest_transcript},
    ]

    raw = get_llm_response(messages, temperature=0.3)

    try:
        result = json.loads(raw.strip())
    except Exception:
        print("[BookingLogic] Failed to parse JSON response.")
        fallback_screen = "ROOM_SELECT" if _is_initial_booking_turn(state) else "BOOKING_COLLECT"
        return {
            "speech_response": "I'm sorry, I didn't quite catch that. Could you please say it once more?",
            "next_ui_screen": fallback_screen,
        }

    extracted = result.get("extracted_slots", {})
    speech = result.get("speech", "Let me note that down.")
    room_inventory = state.tenant_room_inventory or []
    selected_room = state.selected_room
    transcript_room_match = _transcript_explicitly_identifies_room(state.latest_transcript, room_inventory)

    # VALIDATION LAYER: tenant-aware room check using DB-backed room inventory.
    transcript_room_candidate = _extract_room_candidate_from_transcript(state.latest_transcript)
    if not extracted.get("room_type") and transcript_room_match:
        extracted["room_type"] = transcript_room_match.name

    if extracted.get("room_type"):
        original_room = extracted["room_type"]
        best_match = _find_room_from_inventory(room_inventory, original_room)

        if best_match:
            if best_match.name != original_room:
                print(f"[Validation] Fuzzy match: '{original_room}' -> '{best_match.name}'")
            extracted["room_type"] = best_match.name
            selected_room = best_match
        elif transcript_room_match:
            extracted["room_type"] = transcript_room_match.name
            selected_room = transcript_room_match
        else:
            # Rejection: If the room doesn't exist, we don't save it and we ask for clarification.
            print(f"[Validation] Rejected room type: '{original_room}'")
            extracted["room_type"] = None
            if room_inventory:
                available = _build_room_options_text(room_inventory)
                speech = (
                    f"I'm sorry, we don't currently have {original_room}. "
                    f"We do have {available}. If you'd like, I can help you choose one of these."
                )
            else:
                speech = "I'm sorry, I could not confirm that room just now. Please choose one of the rooms shown on screen."

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

    # First booking turn must stay on ROOM_SELECT unless the guest actually named a valid room.
    if _is_initial_booking_turn(state) and not transcript_room_match:
        if updated_slots.room_type is not None:
            print(
                "[BookingLogic] Guard forcing ROOM_SELECT on initial booking turn "
                f"transcript='{state.latest_transcript}' extracted_room='{updated_slots.room_type}'"
            )
        updated_slots = updated_slots.model_copy(update={"room_type": None, "total_price": None})
        selected_room = None
        is_complete = False
        next_slot = "room_type"
        if not str(speech or "").strip():
            speech = _fallback_booking_prompt("room_type", None, room_inventory)

    missing_required = updated_slots.missing_required_slots()
    stay_in_room_preview = _should_stay_in_room_preview(state, selected_room, updated_slots.room_type)
    if not is_complete:
        if not next_slot or next_slot not in missing_required:
            next_slot = missing_required[0] if missing_required else None
        if stay_in_room_preview:
            should_use_frontend_room_preview = (
                not str(speech or "").strip()
                or next_slot is not None
                or _is_booking_collection_prompt(speech)
            )
            next_slot = None
            if should_use_frontend_room_preview:
                speech = ""
        elif not str(speech or "").strip():
            speech = _fallback_booking_prompt(
                next_slot,
                selected_room.name if selected_room else updated_slots.room_type,
                room_inventory,
            )

    # Determine next screen based on what's still missing
    next_screen = _determine_next_screen(updated_slots, is_complete, stay_in_room_preview)
    history_speech = speech
    if not history_speech and next_screen == "ROOM_PREVIEW" and selected_room and selected_room.name:
        history_speech = f"Previewing {selected_room.name}."

    updated_history = state.history + [
        ConversationTurn(role="user", content=state.latest_transcript),
        ConversationTurn(role="assistant", content=history_speech),
    ]

    print(
        "[BookingLogic] "
        f"transcript_room_candidate={transcript_room_candidate or 'none'} "
        f"transcript_room_match={transcript_room_match.name if transcript_room_match else 'none'} "
        f"extracted_room={extracted.get('room_type')} "
        f"selected_room={selected_room.name if selected_room else 'none'} "
        f"slots={updated_slots.model_dump()} "
        f"complete={is_complete} screen={next_screen}"
    )

    return {
        "speech_response": speech,
        "booking_slots": updated_slots,
        "active_slot": None if next_screen == "ROOM_PREVIEW" else next_slot,
        "selected_room": selected_room,
        "history": updated_history,
        "next_ui_screen": next_screen,
    }


def _determine_next_screen(slots: BookingSlots, is_complete: bool, stay_in_room_preview: bool) -> str:
    """Map missing slots to the correct UI screen.
    
    Flow:  ROOM_SELECT  ?  BOOKING_COLLECT  ?  BOOKING_SUMMARY
    """
    if is_complete:
        return "BOOKING_SUMMARY"

    # If we don't know the room yet, show the room picker
    if slots.room_type is None:
        return "ROOM_SELECT"

    if stay_in_room_preview:
        return "ROOM_PREVIEW"

    # For all other missing info (dates, guests, name), use the conversational collector
    return "BOOKING_COLLECT"


