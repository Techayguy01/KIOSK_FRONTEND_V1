import json
import difflib
import re
from datetime import date, datetime, timedelta
from typing import Optional
from agent.state import KioskState, BookingSlots, ConversationTurn, RoomInventoryItem
from core.llm import get_llm_response
from services.transcript_understanding import looks_like_room_discovery_repairable


# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

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

# FIX DUP-01: Single authoritative number-word map used everywhere.
# The original re-declared a near-identical dict inside _extract_requested_nights().
NUMBER_WORDS: dict[str, int] = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "to": 2,
    "too": 2,
    "three": 3,
    "four": 4,
    "for": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "ate": 8,
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

# FIX DUP-02: Compile month-related patterns once at module load instead of
# re-compiling on every call to _extract_dates_deterministically().
_MONTH_DAY_RE = re.compile(
    rf"\b({MONTH_REGEX})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s*(\d{{4}}))?\b"
)
_MONTH_RANGE_RE = re.compile(
    rf"\b(?:from\s+)?(?P<month1>{MONTH_REGEX})\s+(?P<day1>\d{{1,2}})(?:st|nd|rd|th)?"
    rf"(?:,?\s*(?P<year1>\d{{4}}))?"
    rf"\s*(?:to|until|through|till|-)\s*"
    rf"(?:(?P<month2>{MONTH_REGEX})\s+)?(?P<day2>\d{{1,2}})(?:st|nd|rd|th)?"
    rf"(?:,?\s*(?P<year2>\d{{4}}))?\b"
)
_RELATIVE_RANGE_RE = re.compile(
    r"\b(today|tomorrow|day after tomorrow)\b\s*(?:to|until|through|till|-)\s*"
    r"\b(today|tomorrow|day after tomorrow)\b"
)
_ISO_DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
_SINGLE_RELATIVE_RE = re.compile(r"\b(day after tomorrow|tomorrow|today)\b")
_EXPLICIT_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_LABELED_DATE_VALUE_PATTERN = (
    rf"(?P<value>(?:day after tomorrow|tomorrow|today|20\d{{2}}-\d{{2}}-\d{{2}}|"
    rf"{MONTH_REGEX}\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s*\d{{4}})?))"
)
_CHECK_IN_LABELED_DATE_RE = re.compile(
    rf"\bcheck(?:[\s-]?in| and)(?:\s+date)?(?:\s+(?:it\s+is|is|for|on))?\s+{_LABELED_DATE_VALUE_PATTERN}\b"
)
_CHECK_OUT_LABELED_DATE_RE = re.compile(
    rf"\bcheck[\s-]?out(?:\s+date)?(?:\s+(?:it\s+is|is|for|on))?\s+{_LABELED_DATE_VALUE_PATTERN}\b"
)

# FIX DUP-01 (continued): Build the night-word pattern from NUMBER_WORDS once.
_NIGHT_WORD_PATTERN = re.compile(
    r"\b(?:for\s+)?(" + "|".join(k for k in NUMBER_WORDS if k != "zero") + r")\s+nights?\b"
)
_NIGHT_DIGIT_RE = re.compile(r"\b(?:for\s+)?(\d{1,2})\s+nights?\b")

# ─────────────────────────────────────────────────────────────────────────────
# ROOM TRANSCRIPT CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

ROOM_TRANSCRIPT_PREFIX_PATTERNS = [
    r"^(?:i\s+want\s+to\s+book|i\s+want\s+to|i\s+want|i\s+would\s+like\s+to\s+book|i\s+would\s+like\s+to|would\s+like\s+to\s+book|would\s+like\s+to|can\s+i\s+get|can\s+i\s+have|please\s+book|please\s+choose|please\s+select|book|choose|select|take|prefer)\s+",
]

# FIX LOGIC-02: Removed "book" and "booking" — they are already stripped by
# ROOM_TRANSCRIPT_PREFIX_PATTERNS, so including them here was redundant.
ROOM_TRANSCRIPT_STOPWORDS = {
    "i", "want", "to", "would", "like", "please", "can", "get", "have",
    "need", "a", "an", "the", "for", "me", "my", "room", "rooms", "type",
    "option", "options", "choose", "select", "take", "prefer", "another",
    "different",
}

# ─────────────────────────────────────────────────────────────────────────────
# LANGUAGE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# ROOM MATCHING
# ─────────────────────────────────────────────────────────────────────────────

def find_best_room_match(extracted: str, valid_options: list[str]) -> Optional[str]:
    """Uses fuzzy matching to find the closest valid room type."""
    if not extracted or not valid_options:
        return None
    for opt in valid_options:
        if extracted.lower() == opt.lower():
            return opt
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


# ─────────────────────────────────────────────────────────────────────────────
# FORMATTING HELPERS
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# ROOM PRESENTATION BUILDERS
# ─────────────────────────────────────────────────────────────────────────────

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


def _build_room_preview_intro(room: RoomInventoryItem) -> str:
    parts = [f"Here is the {room.name}"]
    price_text = _format_price_for_speech(room.price, room.currency)
    if price_text:
        parts[-1] += f", available at {price_text} per night"
    if room.max_adults:
        parts[-1] += f" for up to {room.max_adults} adult{'s' if room.max_adults != 1 else ''}"
    parts.append("Take a look and let me know if you'd like to book it or see another option.")
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


def _rooms_mentioned_in_transcript(
    transcript: str,
    room_inventory: list[RoomInventoryItem],
) -> list[RoomInventoryItem]:
    normalized_transcript = _normalize_text(transcript)
    if not normalized_transcript or not room_inventory:
        return []

    matches: list[tuple[int, RoomInventoryItem]] = []
    seen_ids: set[str] = set()

    for room in room_inventory:
        aliases = [
            _normalize_text(room.name or ""),
            _normalize_text(room.code or ""),
        ]
        best_index: Optional[int] = None
        for alias in aliases:
            if not alias:
                continue
            idx = normalized_transcript.find(alias)
            if idx >= 0 and (best_index is None or idx < best_index):
                best_index = idx
        if best_index is None:
            continue
        room_key = str(room.id or room.name or room.code or "")
        if room_key in seen_ids:
            continue
        seen_ids.add(room_key)
        matches.append((best_index, room))

    matches.sort(key=lambda item: item[0])
    return [room for _, room in matches]


def _build_room_comparison_prompt(compared_rooms: list[RoomInventoryItem]) -> str:
    if len(compared_rooms) < 2:
        return _build_room_recommendation_prompt(compared_rooms)

    described_rooms: list[str] = []
    for room in compared_rooms[:2]:
        room_name = room.name or "This room"
        price_text = _format_price_for_speech(room.price, room.currency)
        occupancy_text = (
            f"up to {room.max_adults} adult{'s' if room.max_adults != 1 else ''}"
            if room.max_adults
            else "a comfortable stay"
        )
        if price_text:
            described_rooms.append(
                f"{room_name} is available for {price_text} and suits {occupancy_text}"
            )
        else:
            described_rooms.append(f"{room_name} suits {occupancy_text}")

    return (
        f"{described_rooms[0]}. {described_rooms[1]}. "
        "Which one would you like to explore in more detail?"
    )


# ─────────────────────────────────────────────────────────────────────────────
# TEXT NORMALISATION & TOKENISATION
# ─────────────────────────────────────────────────────────────────────────────

# FIX BUG-01: Annotated as Optional[str] to match actual usage (callers pass
# None-guarded expressions, but the type hint previously claimed plain str).
def _normalize_text(value: Optional[str]) -> str:
    text = (value or "").strip().lower()
    return (
        text
        .replace("sweet", "suite")
        .replace("sweets", "suites")
        .replace("luxary", "luxury")
    )


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


# ─────────────────────────────────────────────────────────────────────────────
# DATE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _has_explicit_year(transcript: str) -> bool:
    return bool(_EXPLICIT_YEAR_RE.search(transcript or ""))


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


# Defensive cap for _anchor_yearless_date: prevents runaway iteration on
# malformed input. The loop is monotonically advancing for valid dates, but
# the cap keeps behaviour bounded on unexpected edge cases.
_MAX_YEAR_ADVANCE = 5


def _anchor_yearless_date(raw_value: Optional[str], transcript: str, today: date) -> Optional[str]:
    parsed = _parse_iso_date(raw_value)
    if not parsed:
        return raw_value

    if _has_explicit_year(transcript):
        return parsed.isoformat()

    anchored = parsed
    for _ in range(_MAX_YEAR_ADVANCE):
        if anchored >= today:
            break
        anchored = _replace_year_safely(anchored, anchored.year + 1)

    if anchored < today:
        # Safety: if still behind after max advances, leave the original value
        # and log — do not loop further.
        print(
            f"[DateNormalize] WARNING: Could not anchor {parsed.isoformat()} "
            f"to a future date within {_MAX_YEAR_ADVANCE} years. Keeping original."
        )
        return parsed.isoformat()

    if anchored != parsed:
        print(
            f"[DateNormalize] Anchored yearless date {parsed.isoformat()} -> {anchored.isoformat()} "
            f"(today={today.isoformat()})"
        )
    return anchored.isoformat()


def _resolve_calendar_date(
    month_token: str, day_value: str, year_value: Optional[str], today: date
) -> Optional[date]:
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
    # FIX DUP-02: Uses pre-compiled patterns (_RELATIVE_RANGE_RE, _MONTH_RANGE_RE,
    # _ISO_DATE_RE, _SINGLE_RELATIVE_RE, _MONTH_DAY_RE) instead of re-compiling
    # on every call.
    if not transcript:
        return {}

    text = transcript.strip().lower()
    today = date.today()
    relative_dates = {
        "today": today,
        "tomorrow": today + timedelta(days=1),
        "day after tomorrow": today + timedelta(days=2),
    }

    def _merge_labeled_dates(candidate: dict[str, str]) -> dict[str, str]:
        merged = dict(candidate)
        for key, value in labeled_dates.items():
            merged[key] = value
        return merged

    def _resolve_date_value(raw_value: Optional[str]) -> Optional[date]:
        normalized = str(raw_value or "").strip().lower().strip(" .")
        if not normalized:
            return None
        if normalized in relative_dates:
            return relative_dates[normalized]
        if _ISO_DATE_RE.fullmatch(normalized):
            return _parse_iso_date(normalized)
        month_match = _MONTH_DAY_RE.search(normalized)
        if month_match:
            return _resolve_calendar_date(month_match.group(1), month_match.group(2), month_match.group(3), today)
        return None

    labeled_dates: dict[str, str] = {}
    labeled_check_in = _CHECK_IN_LABELED_DATE_RE.search(text)
    if labeled_check_in:
        resolved_check_in = _resolve_date_value(labeled_check_in.group("value"))
        if resolved_check_in:
            labeled_dates["check_in_date"] = resolved_check_in.isoformat()
    labeled_check_out = _CHECK_OUT_LABELED_DATE_RE.search(text)
    if labeled_check_out:
        resolved_check_out = _resolve_date_value(labeled_check_out.group("value"))
        if resolved_check_out:
            labeled_dates["check_out_date"] = resolved_check_out.isoformat()
    if len(labeled_dates) == 2:
        return labeled_dates

    relative_range = _RELATIVE_RANGE_RE.search(text)
    if relative_range:
        first = relative_range.group(1)
        second = relative_range.group(2)
        check_in = relative_dates.get(first)
        check_out = relative_dates.get(second)
        if check_in and check_out:
            return _merge_labeled_dates({
                "check_in_date": check_in.isoformat(),
                "check_out_date": check_out.isoformat(),
            })

    month_range = _MONTH_RANGE_RE.search(text)
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
            return _merge_labeled_dates({
                "check_in_date": check_in.isoformat(),
                "check_out_date": check_out.isoformat(),
            })

    iso_dates = _ISO_DATE_RE.findall(text)
    if len(iso_dates) >= 2:
        return _merge_labeled_dates({
            "check_in_date": iso_dates[0],
            "check_out_date": iso_dates[1],
        })

    single_relative_match = _SINGLE_RELATIVE_RE.search(text)
    if single_relative_match:
        word = single_relative_match.group(1)
        single_relative = relative_dates.get(word)
        if single_relative:
            # FIX BUG-03: Log when only a check-in date is resolved so missing
            # checkout is traceable rather than silently incomplete.
            print(
                f"[DateNormalize] Only check_in_date resolved from relative '{word}'. "
                "check_out_date will require further input or nights derivation."
            )
            return _merge_labeled_dates({"check_in_date": single_relative.isoformat()})

    if iso_dates:
        return _merge_labeled_dates({"check_in_date": iso_dates[0]})

    month_day_matches = list(_MONTH_DAY_RE.finditer(text))
    if month_day_matches:
        parsed_dates: list[date] = []
        for match in month_day_matches[:2]:
            parsed = _resolve_calendar_date(match.group(1), match.group(2), match.group(3), today)
            if parsed:
                parsed_dates.append(parsed)
        if len(parsed_dates) >= 2:
            return _merge_labeled_dates({
                "check_in_date": parsed_dates[0].isoformat(),
                "check_out_date": parsed_dates[1].isoformat(),
            })
        if len(parsed_dates) == 1:
            # FIX BUG-03: Same log for single month/day match.
            print(
                f"[DateNormalize] Only check_in_date resolved from month/day pattern. "
                "check_out_date will require further input or nights derivation."
            )
            return _merge_labeled_dates({"check_in_date": parsed_dates[0].isoformat()})

    return labeled_dates


def _extract_requested_nights(transcript: str) -> Optional[int]:
    # FIX DUP-01: Uses module-level NUMBER_WORDS and pre-compiled _NIGHT_DIGIT_RE /
    # _NIGHT_WORD_PATTERN instead of a re-declared inline word_to_number dict.
    if not transcript:
        return None

    normalized = transcript.lower()

    digit_match = _NIGHT_DIGIT_RE.search(normalized)
    if digit_match:
        nights = int(digit_match.group(1))
        return nights if nights > 0 else None

    word_match = _NIGHT_WORD_PATTERN.search(normalized)
    if not word_match:
        return None

    return NUMBER_WORDS.get(word_match.group(1))


def _normalize_booking_dates(
    slots: BookingSlots,
    transcript: str,
    selected_room: Optional[RoomInventoryItem],
) -> BookingSlots:
    today = date.today()
    slot_values = slots.model_dump()

    slot_values["check_in_date"] = _anchor_yearless_date(slot_values.get("check_in_date"), transcript, today)
    slot_values["check_out_date"] = _anchor_yearless_date(slot_values.get("check_out_date"), transcript, today)

    check_in = _parse_iso_date(slot_values.get("check_in_date"))
    check_out = _parse_iso_date(slot_values.get("check_out_date"))

    requested_nights = _extract_requested_nights(transcript)
    if requested_nights is not None:
        slot_values["nights"] = requested_nights

    nights_value = slot_values.get("nights")
    nights = int(nights_value) if isinstance(nights_value, int) and nights_value > 0 else None

    if check_in and nights:
        inferred_checkout = check_in + timedelta(days=nights)
        if not check_out or requested_nights is not None:
            slot_values["check_out_date"] = inferred_checkout.isoformat()
            check_out = inferred_checkout
            print(
                f"[DateNormalize] Derived check_out_date={check_out.isoformat()} "
                f"from check_in_date={check_in.isoformat()} + nights={nights}"
            )

    if check_in and check_out and check_out <= check_in:
        check_out = check_in + timedelta(days=1)
        slot_values["check_out_date"] = check_out.isoformat()
        print(
            f"[DateNormalize] Adjusted check_out_date forward to {check_out.isoformat()} "
            f"to keep it after check_in_date={check_in.isoformat()}"
        )

    if check_in and check_out:
        computed_nights = max(1, (check_out - check_in).days)
        slot_values["nights"] = computed_nights

    # Guard: only write total_price when price is meaningful (> 0). A zero or
    # missing room price would store 0.0, which could cause incorrect billing
    # display in the booking summary and wrong downstream price calculations.
    # Note: BookingSlots.is_complete() does NOT check total_price — this guard
    # is purely about data correctness, not completion gating.
    if selected_room and slot_values.get("nights"):
        room_price = float(selected_room.price or 0)
        if room_price > 0:
            slot_values["total_price"] = round(room_price * int(slot_values["nights"]), 2)

    return BookingSlots(**slot_values)


# ─────────────────────────────────────────────────────────────────────────────
# ROOM INVENTORY LOOKUP
# ─────────────────────────────────────────────────────────────────────────────

def _find_room_from_inventory(
    room_inventory: list[RoomInventoryItem], extracted: str
) -> Optional[RoomInventoryItem]:
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

        # Token scoring: count how many of a room's alias tokens appear in the
        # transcript. Sort by (matched_tokens desc, alias_len asc) — more matched
        # tokens wins; among ties, prefer the shorter alias (more specific match).
        # NOTE: The tiebreak on alias_len is intentionally conservative. Two rooms
        # that share the same matched_tokens AND the same alias_len are genuinely
        # ambiguous and return None. If this proves too strict for a real catalog,
        # add regression tests before changing the tiebreak to a ratio-based sort.
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

        # Sort: most matched tokens first, then fewest alias tokens (more specific).
        scored_matches.sort(key=lambda item: (item[0], -item[1]), reverse=True)
        best_score, best_alias_len, best_room = scored_matches[0]

        # Minimum quality threshold.
        alias_tokens_best = _meaningful_room_tokens(f"{best_room.name} {best_room.code or ''}")
        if best_score < max(1, min(2, len(alias_tokens_best))):
            return None

        # Ambiguity suppressor: if top two rooms are indistinguishable on both
        # matched count and alias length, return None rather than pick arbitrarily.
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


# ─────────────────────────────────────────────────────────────────────────────
# TRACING
# ─────────────────────────────────────────────────────────────────────────────

def log_decision_trace(
    scope: str,
    *,
    intent: Optional[str],
    intent_source: str,
    extracted_slots: Optional[dict] = None,
    selected_room: Optional[object] = None,
    next_screen: Optional[str] = None,
    transcript: Optional[str] = None,
    raw_transcript: Optional[str] = None,
    query_type: Optional[str] = None,
) -> None:
    compact_slots = {key: value for key, value in (extracted_slots or {}).items() if value is not None}
    try:
        slot_text = json.dumps(compact_slots, sort_keys=True, default=str)
    except Exception:
        slot_text = str(compact_slots)

    selected_room_name = "-"
    if isinstance(selected_room, RoomInventoryItem):
        selected_room_name = selected_room.name or "-"
    elif isinstance(selected_room, dict):
        selected_room_name = str(
            selected_room.get("name")
            or selected_room.get("displayName")
            or selected_room.get("room_type")
            or selected_room.get("roomType")
            or "-"
        )
    elif selected_room:
        selected_room_name = str(selected_room)

    transcript_text = str(transcript or "-").replace("\n", " ").strip() or "-"
    raw_transcript_text = str(raw_transcript or "-").replace("\n", " ").strip() or "-"

    print(
        f"[DecisionTrace][{scope}] "
        f"intent={intent or '-'} "
        f"source={intent_source} "
        f"query_type={query_type or '-'} "
        f"slots={slot_text} "
        f"selected_room={selected_room_name} "
        f"next_screen={next_screen or '-'} "
        f"transcript={json.dumps(transcript_text)} "
        f"raw_transcript={json.dumps(raw_transcript_text)}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# BOOKING STATE PREDICATES
# ─────────────────────────────────────────────────────────────────────────────

def _record_semantic_classification(
    state: KioskState,
    semantic_result: object,
    *,
    override_intent: Optional[str] = None,
) -> None:
    if semantic_result is None:
        return

    try:
        from agent.misclassification_logger import record_classification

        predicted_intent = getattr(semantic_result, "intent", "") or ""
        normalized_transcript = getattr(semantic_result, "normalized_transcript", "") or ""
        confidence = float(getattr(semantic_result, "confidence", 0.0) or 0.0)
        matched_phrase = getattr(semantic_result, "matched_phrase", "") or ""
        final_override = override_intent if override_intent and override_intent != predicted_intent else None

        record_classification(
            session_id=state.session_id,
            screen=state.current_ui_screen,
            raw_transcript=state.latest_transcript or "",
            normalized_transcript=normalized_transcript,
            predicted_intent=predicted_intent,
            similarity_score=confidence,
            matched_example=matched_phrase,
            was_overridden=final_override is not None,
            override_intent=final_override,
            language=state.language,
        )
    except Exception as exc:
        print(f"[MisclassificationLogger] record failed: {exc}")


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


# ─────────────────────────────────────────────────────────────────────────────
# TRANSCRIPT PATTERN MATCHERS
# ─────────────────────────────────────────────────────────────────────────────

def _looks_like_explicit_preview_booking_request(transcript: str) -> bool:
    text = (transcript or "").strip().lower()
    if not text:
        return False
    return bool(
        re.search(
            r"\b("
            r"book\s+(?:this|the)?\s*(?:room|suite|one|it)|"
            r"reserve\s+(?:this|the)?\s*(?:room|suite|one|it)|"
            r"i(?:\s*would)?\s+like\s+to\s+book\s+(?:this|it|the\s+room)|"
            r"i\s+want\s+(?:this|it|the\s+room)|"
            r"i(?:'ll|\s+will)\s+take\s+(?:this|it|the\s+room)?|"
            r"go\s+ahead\s+with\s+(?:this|it|the\s+room)|"
            r"proceed\s+with\s+(?:this|it|the\s+room)|"
            r"confirm\s+(?:this|it|the\s+room)"
            r")\b",
            text,
        )
    )


def _looks_like_explicit_check_in_restart_request(transcript: str) -> bool:
    text = (transcript or "").strip().lower()
    if not text:
        return False
    return bool(
        re.search(
            r"\b("
            r"check\s+in\s+instead|"
            r"start\s+over\s+and\s+check\s+in|"
            r"restart\s+and\s+check\s+in|"
            r"cancel\s+(?:this|the)?\s*(?:booking|reservation)?\s*and\s+check\s+in|"
            r"forget\s+(?:this|the)?\s*(?:booking|reservation)?\s*and\s+check\s+in|"
            r"stop\s+(?:this|the)?\s*(?:booking|reservation)?\s*and\s+check\s+in|"
            r"switch\s+to\s+check\s+in"
            r")\b",
            text,
        )
    )


def _looks_like_check_in_request(transcript: str) -> bool:
    text = (transcript or "").strip().lower()
    if not text:
        return False
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
    text = (transcript or "").strip().lower()
    if not text:
        return False
    if looks_like_room_discovery_repairable(text):
        return True
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


def _looks_like_room_recommendation_request(transcript: str) -> bool:
    text = (transcript or "").strip().lower()
    if not text:
        return False

    if re.search(
        r"\b("
        r"which\s+room\s+(?:should|would)|"
        r"what\s+room\s+should|"
        r"recommend(?:\s+me)?\s+(?:a\s+)?(?:room|suite)|"
        r"suggest(?:\s+me)?\s+(?:a\s+)?(?:room|suite)|"
        r"best\s+(?:room|suite)\s+for|"
        r"(?:cheapest|budget|affordable|lowest\s+price)\s+(?:room|suite)|"
        r"compare\s+(?:rooms?|the\s+.+\s+and\s+.+)|"
        r"difference\s+between\s+.+\s+and\s+.+|"
        r"which\s+is\s+better|"
        r"which\s+(?:one|room|suite)\s+is\s+better|"
        r"which\s+(?:room|suite)\s+(?:is|would\s+be)\s+best"
        r")\b",
        text,
    ):
        return True

    has_guest_fit = bool(
        re.search(
            r"\b("
            r"family\s+of\s+(?:\d+|one|two|three|four|five|six|seven|eight)|"
            r"(?:\d+|one|two|three|four|five|six|seven|eight)\s+adults?"
            r"(?:\s+and\s+(?:\d+|one|two|three|four|five|six|seven|eight)\s+children?)?|"
            r"two\s+adults?\s+and\s+two\s+children|"
            r"two\s+adults?\s+and\s+one\s+child"
            r")\b",
            text,
        )
    )
    has_room_discovery_context = bool(
        re.search(
            r"\b("
            r"room|suite|rooms|suites|"
            r"fit|fits|suitable|best|recommend|suggest|choose|"
            r"look\s+at|look\s+for|compare|affordable|budget|cheapest"
            r")\b",
            text,
        )
    )
    return has_guest_fit and has_room_discovery_context


def _looks_like_room_comparison_request(transcript: str) -> bool:
    text = (transcript or "").strip().lower()
    if not text:
        return False
    return bool(
        re.search(
            r"\b("
            r"compare|comparison|"
            r"difference\s+between|"
            r"which\s+is\s+better|"
            r"which\s+(?:one|room|suite)?\s*is\s+better|"
            r"versus|vs\.?"
            r")\b",
            text,
        )
    )


def _looks_like_room_preview_detail_request(transcript: str) -> bool:
    text = (transcript or "").strip().lower()
    if not text:
        return False

    mentions_room_context = bool(
        re.search(r"\b(this|it|room|suite)\b", text)
        or re.search(r"\bdoes\s+this\s+room\b", text)
    )
    mentions_feature = bool(
        re.search(
            r"\b("
            r"balcony|terrace|view|city\s+view|sea\s+view|ocean\s+view|"
            r"bathroom|bath\s*tub|bathtub|shower|bedroom|bed|window|"
            r"living\s+room|living\s+area|lounge|workspace|desk|sofa|seating|"
            r"feature|features|amenity|amenities"
            r")\b",
            text,
        )
    )
    asks_about_feature = bool(
        re.search(
            r"\b("
            r"does|is|has|have|what|which|tell|describe|show|see|view|"
            r"can\s+i\s+see|can\s+you\s+show"
            r")\b",
            text,
        )
    )
    return mentions_feature and (mentions_room_context or asks_about_feature)


# ─────────────────────────────────────────────────────────────────────────────
# ROUTER
# ─────────────────────────────────────────────────────────────────────────────

ROUTER_SYSTEM_PROMPT = """
You are a highly critical intent classifier for a luxury hotel kiosk AI named "Siya".
The user's text may contain mixed intentions, conversational filler, or mid-sentence corrections (e.g., "Wait, no, I mean check in").
Your job is to read the ENTIRE message carefully before deciding the final intent.

- BOOK_ROOM: User wants to start a NEW reservation, explore rooms, see room options, take a virtual tour, view available rooms, or browse what's available. Any expression of interest in seeing, exploring, or choosing rooms counts as BOOK_ROOM.
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

## Screen Context Rules
A "Current UI screen" message is provided. Use it to disambiguate ambiguous intents:
- WELCOME / IDLE: Opening screen. Any mention of rooms, availability, booking, wanting to see/explore rooms, family-fit room advice, cheapest/affordable rooms, or room comparisons -> BOOK_ROOM. Greetings, amenity questions, hotel info -> GENERAL_QUERY.
- ROOM_SELECT: User is browsing the room catalog. Selecting or asking about a specific room -> BOOK_ROOM. Feature questions -> GENERAL_QUERY.
- ROOM_PREVIEW: User is viewing a SPECIFIC room's image carousel.
  * "show me bathroom", "I want to see the balcony", "show me the view", "does this room have a balcony", or ANY request to focus on a room feature/area -> GENERAL_QUERY (this is a visual focus request, NOT a new booking).
  * "book this room", "I'll take it", "I want this one" -> BOOK_ROOM.
  * If the user starts giving guest counts, dates, or a guest name while still in ROOM_PREVIEW, classify as the corresponding PROVIDE_* intent so the booking flow can begin naturally.
  * "show me another option", "different room", "I don't like this", "go back", "other rooms" -> MODIFY_BOOKING (user wants to browse different rooms).
- BOOKING_COLLECT: User is providing booking details (guests, dates, name).
  * Visual focus requests ("show me the balcony") -> GENERAL_QUERY.
  * Phrases like "check in tomorrow" inside a booking-detail sentence usually refer to stay dates, not kiosk CHECK_IN for an existing reservation.
  * Guest counts -> PROVIDE_GUESTS. Dates -> PROVIDE_DATES. Names -> PROVIDE_NAME.
- BOOKING_SUMMARY: Only CONFIRM_BOOKING or MODIFY_BOOKING are expected here.
  * "yes, that's correct", "proceed to payment", "go to payment" -> CONFIRM_BOOKING.
  * "change the guest name", "edit the dates", "modify the details" -> MODIFY_BOOKING.
CRITICAL: On ROOM_PREVIEW and BOOKING_COLLECT, phrases like "show me [room part]" are visual focus requests (GENERAL_QUERY), NOT booking requests. Do not classify them as BOOK_ROOM.

Respond ONLY with a JSON object:
{"intent": "<INTENT>", "confidence": <0.0-1.0>}
"""


def _router_result(
    state: KioskState,
    intent: str,
    confidence: float,
    *,
    intent_source: str,
    speech_override: Optional[str] = None,
    consecutive_failures: int = 0,
    last_failed_screen: Optional[str] = None,
) -> dict:
    log_decision_trace(
        "router",
        intent=intent,
        intent_source=intent_source,
        selected_room=state.selected_room or state.booking_slots.room_type,
        next_screen=state.current_ui_screen,
        transcript=state.latest_transcript,
    )
    return {
        "resolved_intent": intent,
        "confidence": confidence,
        "speech_override": speech_override,
        "consecutive_failures": consecutive_failures,
        "last_failed_screen": last_failed_screen,
    }


def _route_booking_summary_override(state: KioskState, transcript_text: str) -> Optional[dict]:
    if state.current_ui_screen != "BOOKING_SUMMARY":
        return None
    if _is_summary_modify_transcript(transcript_text):
        return _router_result(
            state,
            "MODIFY_BOOKING",
            0.96,
            intent_source="summary_guard",
        )
    if state.booking_slots.is_complete() and _is_summary_confirmation_transcript(transcript_text):
        return _router_result(
            state,
            "CONFIRM_BOOKING",
            0.97,
            intent_source="summary_guard",
        )
    return None


def _route_preview_context_override(state: KioskState, transcript_text: str) -> Optional[dict]:
    current_screen = state.current_ui_screen
    if current_screen == "ROOM_PREVIEW" and _looks_like_room_preview_detail_request(transcript_text):
        print(
            f"[Router] Preview detail guard on {current_screen}: "
            f"'{state.latest_transcript}' -> GENERAL_QUERY"
        )
        return _router_result(
            state,
            "GENERAL_QUERY",
            0.97,
            intent_source="preview_detail_guard",
        )

    if current_screen in ("ROOM_PREVIEW", "BOOKING_COLLECT"):
        visual_focus_text = transcript_text.strip().lower()
        if re.search(
            r"\b(?:show|see|view|display|open|focus|describe|tell)\b.*"
            r"\b(?:bath(?:room|tub)?|balcony|terrace|bedroom|bed|living|lounge|"
            r"kitchen|view|ocean|fireplace|shower|pool|sofa|seating|window|workspace|desk)\b",
            visual_focus_text,
        ):
            print(
                f"[Router] Visual focus guard on {current_screen}: "
                f"'{state.latest_transcript}' -> GENERAL_QUERY"
            )
            return _router_result(
                state,
                "GENERAL_QUERY",
                0.95,
                intent_source="visual_focus_guard",
            )
    return None


def _route_welcome_discovery_override(state: KioskState, transcript_text: str) -> Optional[dict]:
    current_screen = state.current_ui_screen

    # FIX LOGIC-01: Scoped _looks_like_room_browsing_request to the same allowed
    # screens as the other discovery guards. Previously it fired on ALL screens
    # including BOOKING_COLLECT, which could incorrectly override a guest saying
    # "show me the rooms again" mid-booking into a BOOK_ROOM intent before the
    # check-in guard could run.
    DISCOVERY_ALLOWED_SCREENS = {"WELCOME", "IDLE", "AI_CHAT", "MANUAL_MENU", "ROOM_SELECT"}

    if current_screen in DISCOVERY_ALLOWED_SCREENS and _looks_like_room_comparison_request(transcript_text):
        print(f"[Router] Deterministic room comparison match: '{state.latest_transcript}'")
        return _router_result(
            state,
            "BOOK_ROOM",
            0.95,
            intent_source="room_comparison_guard",
        )

    if current_screen in {"WELCOME", "IDLE", "AI_CHAT", "MANUAL_MENU"} and _looks_like_room_recommendation_request(transcript_text):
        print(f"[Router] Deterministic room recommendation match: '{state.latest_transcript}'")
        return _router_result(
            state,
            "BOOK_ROOM",
            0.95,
            intent_source="welcome_room_recommendation_guard",
        )

    if current_screen in DISCOVERY_ALLOWED_SCREENS and _looks_like_room_browsing_request(transcript_text):
        print(f"[Router] Deterministic room browsing match: '{state.latest_transcript}'")
        return _router_result(
            state,
            "BOOK_ROOM",
            0.95,
            intent_source="room_browsing_guard",
        )

    return None


def _route_check_in_override(state: KioskState, transcript_text: str) -> Optional[dict]:
    current_screen = state.current_ui_screen
    is_booking_context = current_screen in {"BOOKING_COLLECT", "BOOKING_SUMMARY"}
    if not _looks_like_check_in_request(transcript_text):
        return None
    if is_booking_context and not _looks_like_explicit_check_in_restart_request(transcript_text):
        print(
            f"[Router] Suppressing CHECK_IN takeover on {current_screen}: "
            f"'{state.latest_transcript}'"
        )
        return None
    return _router_result(
        state,
        "CHECK_IN",
        0.97,
        intent_source="check_in_guard",
    )


async def route_intent(state: KioskState) -> dict:
    """Node 1: Classify the user's intent."""
    print(f"[Router] Classifying: '{state.latest_transcript}'")
    semantic_hint: Optional[str] = None
    semantic_result = None
    transcript_text = state.latest_transcript or ""
    current_screen = state.current_ui_screen
    is_booking_context = current_screen in {"BOOKING_COLLECT", "BOOKING_SUMMARY"}

    for guard in (
        _route_booking_summary_override,
        _route_preview_context_override,
        _route_welcome_discovery_override,
        _route_check_in_override,
    ):
        override = guard(state, transcript_text)
        if override:
            return override

    try:
        from agent.semantic_classifier import classify_intent_semantically

        semantic_result = await classify_intent_semantically(
            transcript=transcript_text,
            current_screen=current_screen,
            session_id=state.session_id,
            language=state.language,
        )
        if semantic_result is not None:
            if getattr(semantic_result, "source", "") == "stt_normalizer":
                if state.last_failed_screen == current_screen:
                    consecutive_failures = (state.consecutive_failures or 0) + 1
                else:
                    consecutive_failures = 1
                last_failed_screen = current_screen
                _record_semantic_classification(state, semantic_result)
                if consecutive_failures >= 2:
                    print(f"[Router][L4] {consecutive_failures} consecutive filler turns -> escalating")
                    return _router_result(
                        state,
                        "IDLE",
                        1.0,
                        intent_source="stt_normalizer",
                        speech_override=(
                            "I'm sorry, I'm having trouble understanding. "
                            "A staff member can assist you right away - "
                            "please approach the front desk or press the call button on this screen."
                        ),
                        consecutive_failures=consecutive_failures,
                        last_failed_screen=last_failed_screen,
                    )
                return _router_result(
                    state,
                    "IDLE",
                    1.0,
                    intent_source="stt_normalizer",
                    speech_override=(
                        "I didn't quite catch that. "
                        "You can tap the screen buttons, or try saying it again in a different way."
                    ),
                    consecutive_failures=consecutive_failures,
                    last_failed_screen=last_failed_screen,
                )
            if semantic_result.is_out_of_domain:
                print(
                    f"[Router][L2] Out-of-domain (score={semantic_result.confidence}), escalating to LLM"
                )
            elif not semantic_result.should_escalate_to_llm:
                print(
                    f"[Router][L2] HIGH confidence: intent={semantic_result.intent} "
                    f"score={semantic_result.confidence} phrase='{semantic_result.matched_phrase}'"
                )
                _record_semantic_classification(state, semantic_result)
                return _router_result(
                    state,
                    semantic_result.intent,
                    semantic_result.confidence,
                    intent_source="semantic_classifier",
                )
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
        {"role": "system", "content": f"Current UI screen: {current_screen}"},
        {"role": "system", "content": f"Guest language preference: {state.language}"},
        {"role": "user", "content": transcript_text},
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

    final_intent_source = "llm"
    if intent == "GENERAL_QUERY" and confidence < 0.80:
        if _looks_like_room_browsing_request(transcript_text) or (
            current_screen in {"WELCOME", "IDLE", "AI_CHAT", "MANUAL_MENU"}
            and _looks_like_room_recommendation_request(transcript_text)
        ):
            print(f"[Router] Low-confidence fallback: GENERAL_QUERY({confidence}) -> BOOK_ROOM")
            intent = "BOOK_ROOM"
            confidence = 0.85
            final_intent_source = "llm_room_browsing_fallback"

    if intent == "CHECK_IN" and is_booking_context and not _looks_like_explicit_check_in_restart_request(transcript_text):
        replacement_intent = semantic_hint or "GENERAL_QUERY"
        print(
            f"[Router] Post-LLM CHECK_IN suppression on {current_screen}: "
            f"'{state.latest_transcript}' -> {replacement_intent}"
        )
        intent = replacement_intent
        confidence = max(confidence, 0.7 if replacement_intent != "GENERAL_QUERY" else 0.6)
        final_intent_source = "llm_check_in_suppression"

    is_failure = intent in {"IDLE", "GENERAL_QUERY"} and confidence < 0.60
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
        _record_semantic_classification(
            state,
            semantic_result,
            override_intent="IDLE" if semantic_result and semantic_result.intent != "IDLE" else None,
        )
        return _router_result(
            state,
            "IDLE",
            1.0,
            intent_source="failure_escalation",
            speech_override=(
                "I'm sorry, I'm having trouble understanding. "
                "A staff member can assist you right away - "
                "please approach the front desk or press the call button on this screen."
            ),
            consecutive_failures=consecutive_failures,
            last_failed_screen=last_failed_screen,
        )

    if is_failure and consecutive_failures == 1:
        print("[Router][L4] First failure -> retry guidance")
        _record_semantic_classification(
            state,
            semantic_result,
            override_intent="IDLE" if semantic_result and semantic_result.intent != "IDLE" else None,
        )
        return _router_result(
            state,
            "IDLE",
            1.0,
            intent_source="failure_retry",
            speech_override=(
                "I didn't quite catch that. "
                "You can tap the screen buttons, or try saying it again in a different way."
            ),
            consecutive_failures=consecutive_failures,
            last_failed_screen=last_failed_screen,
        )

    print(f"[Router] -> Intent: {intent} (confidence: {confidence})")
    _record_semantic_classification(
        state,
        semantic_result,
        override_intent=intent if semantic_result and intent != semantic_result.intent else None,
    )
    return _router_result(
        state,
        intent,
        confidence,
        intent_source=final_intent_source,
        consecutive_failures=consecutive_failures,
        last_failed_screen=last_failed_screen,
    )


# ─────────────────────────────────────────────────────────────────────────────
# GENERAL CHAT NODE
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# BOOKING NODE
# ─────────────────────────────────────────────────────────────────────────────

def build_booking_prompt(state: KioskState) -> str:
    slots = state.booking_slots
    missing = slots.missing_required_slots()
    filled = {k: v for k, v in slots.model_dump().items() if v is not None}
    # Pass the full room catalog so the LLM fallback sees every option.
    # Only name, price, currency, and max_adults are included per room to keep
    # token usage proportional — verbose fields (descriptions, images) are omitted.
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
    if _looks_like_room_comparison_request(transcript):
        return None
    candidate = _extract_room_candidate_from_transcript(transcript)
    return _find_room_from_inventory(room_inventory, candidate or transcript)


def _extract_guest_counts_deterministically(transcript: str) -> dict[str, int]:
    text = (transcript or "").strip().lower()
    if not text:
        return {}

    slots: dict[str, int] = {}
    child_match = re.search(r"\b(\d+|one|two|to|too|three|four|for|five|six)\s*(?:child|children|kid|kids)\b", text)
    if child_match:
        child_count = _parse_spoken_number(child_match.group(1))
        if child_count is not None:
            slots["children"] = child_count

    adult_match = re.search(r"\b(\d+|one|two|to|too|three|four|for|five|six)\s*adults?\b", text)
    if adult_match:
        adult_count = _parse_spoken_number(adult_match.group(1))
        if adult_count is not None and adult_count >= 1:
            slots["adults"] = adult_count
            return slots

    if re.search(r"\bjust me\b|\balone\b|\bsolo\b|\b1 person\b", text):
        slots["adults"] = 1
        return slots

    total_match = re.search(r"\b(\d+|one|two|to|too|three|four|for|five|six)\s*(?:people|guests?|persons?)\b", text)
    if not total_match:
        total_match = re.search(r"\bwe are\s+(\d+|one|two|to|too|three|four|for|five|six)\b", text)
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

    mid_sentence_match = re.search(
        r"(?:guest\s+name\s+is|name\s+is|the\s+name\s+is)\s+([A-Za-z][A-Za-z .'-]{1,60}?)(?:\s*(?:,|;|\.|$)|\s+(?=\d|check|adult|child|today|tomorrow|night|room))",
        text,
        flags=re.IGNORECASE,
    )
    if mid_sentence_match:
        cleaned = mid_sentence_match.group(1).strip(" .")
        if cleaned and len(cleaned.split()) <= 6:
            return cleaned.title()

    prefix_match = re.match(
        r"^(?:my name is|name is|guest name is|the name is|i am|i'm|this is)\s+(.+)$",
        text,
        flags=re.IGNORECASE,
    )
    if prefix_match:
        cleaned = prefix_match.group(1).strip(" .")
        cleaned = re.split(r"\s*(?:,|;|\.)\s*", cleaned, maxsplit=1)[0]
        cleaned = re.split(
            r"\s+(?=(?:\d+|one|two|three|four|five|six|today|tomorrow|day\s+after\s+tomorrow|next|check[\s-]?in|check[\s-]?out|adults?|children|kids|guests?|nights?))",
            cleaned,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip(" .")
    else:
        if re.search(
            r"\b(change|modify|edit|update|guest name|booking name|payment|check[\s-]?in|check[\s-]?out|adults?|children|kids|dates?|nights?)\b",
            text,
            flags=re.IGNORECASE,
        ):
            return None
        if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,60}", text):
            return None
        cleaned = text.strip(" .")

    # FIX BUG-05: Raised word-count cap from 4 to 6 to accommodate longer South
    # Asian and Spanish legal names (e.g. "Maria De La Cruz Santos" = 5 words).
    if not cleaned or len(cleaned.split()) > 6:
        return None
    return cleaned.title()


def _has_booking_detail_updates(extracted_slots: dict) -> bool:
    return any(
        extracted_slots.get(key) is not None
        for key in ("adults", "children", "check_in_date", "check_out_date", "guest_name")
    )


def _infer_booking_follow_up_slot(transcript: str, extracted_slots: dict) -> Optional[str]:
    text = (transcript or "").strip().lower()

    if extracted_slots.get("guest_name") or re.search(r"\b(name|guest name)\b", text):
        return "guest_name"
    if (
        extracted_slots.get("check_in_date")
        or extracted_slots.get("check_out_date")
        or re.search(r"\b(check[\s-]?in|check[\s-]?out|date|dates|stay|night|nights)\b", text)
    ):
        return "check_in_date"
    if (
        extracted_slots.get("adults") is not None
        or extracted_slots.get("children") is not None
        or re.search(r"\b(adults?|children|kids|guests?)\b", text)
    ):
        return "adults"
    return None


def _extract_slots_deterministically(state: KioskState) -> dict:
    text = (state.latest_transcript or "").strip()
    room_inventory = state.tenant_room_inventory or []
    slots: dict[str, object] = {}
    should_extract_booking_slots = state.current_ui_screen in {"BOOKING_COLLECT", "BOOKING_SUMMARY"}

    if state.resolved_intent == "BOOK_ROOM" or should_extract_booking_slots:
        matched_room = _transcript_explicitly_identifies_room(text, room_inventory)
        if matched_room:
            slots["room_type"] = matched_room.name
        elif (
            state.current_ui_screen == "ROOM_PREVIEW"
            and state.selected_room
            and _looks_like_explicit_preview_booking_request(text)
        ):
            slots["room_type"] = state.selected_room.name

    if state.resolved_intent == "PROVIDE_GUESTS" or should_extract_booking_slots:
        slots.update(_extract_guest_counts_deterministically(text))

    if state.resolved_intent == "PROVIDE_DATES" or should_extract_booking_slots:
        slots.update(_extract_dates_deterministically(text))

    if state.resolved_intent == "PROVIDE_NAME" or should_extract_booking_slots:
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


def _make_booking_response_precomputed(
    state: KioskState,
    speech: str,
    next_ui_screen: str,
    updated_slots: BookingSlots,
    resolved_selected_room: Optional[RoomInventoryItem],
    *,
    active_slot: Optional[str] = None,
) -> dict:
    """Variant of _make_booking_response for callers that have already run
    _prepare_booking_state_update(). Accepts the pre-computed slots and room
    directly so date normalisation is not repeated a second time.
    Use this whenever the caller has already called _prepare_booking_state_update()
    for validation purposes — avoids the double-compute that existed in
    _handle_booking_detail_transition and _handle_summary_modify_transition.
    """
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


def _booking_response(
    state: KioskState,
    response: dict,
    *,
    decision_source: str,
    extracted_slots: Optional[dict] = None,
) -> dict:
    log_decision_trace(
        "booking_logic",
        intent=state.resolved_intent,
        intent_source=decision_source,
        extracted_slots=extracted_slots,
        selected_room=response.get("selected_room") or state.selected_room or state.booking_slots.room_type,
        next_screen=response.get("next_ui_screen"),
        transcript=state.latest_transcript,
    )
    return response


def _build_preview_booking_gate_response(state: KioskState) -> dict:
    speech = (
        f"Whenever you're ready, say book this room and I'll continue the reservation for {state.selected_room.name}."
    )
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
        "next_ui_screen": "ROOM_PREVIEW",
    }


def _handle_room_request_transition(
    state: KioskState,
    extracted_slots: dict,
    room_inventory: list[RoomInventoryItem],
) -> Optional[dict]:
    if state.current_ui_screen in {"WELCOME", "IDLE", "AI_CHAT", "MANUAL_MENU", "ROOM_SELECT"} and _looks_like_room_comparison_request(state.latest_transcript):
        compared_rooms = _rooms_mentioned_in_transcript(state.latest_transcript, room_inventory)
        comparison_prompt = _build_room_comparison_prompt(compared_rooms or room_inventory[:2])
        return _make_booking_response(
            state,
            comparison_prompt,
            "ROOM_SELECT",
            active_slot="room_type",
            clear_room_selection=True,
        )

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
        if (
            state.current_ui_screen == "ROOM_PREVIEW"
            and _looks_like_explicit_preview_booking_request(state.latest_transcript)
        ):
            return _make_booking_response(
                state,
                _build_room_confirmation(room),
                "BOOKING_COLLECT",
                active_slot="adults",
                extracted_slots=extracted,
                selected_room=room,
            )
        return _make_booking_response(
            state,
            _build_room_preview_intro(room),
            "ROOM_PREVIEW",
            active_slot=None,
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

    return None


def _handle_booking_detail_transition(
    state: KioskState,
    extracted_slots: dict,
    room_inventory: list[RoomInventoryItem],
) -> Optional[dict]:
    if state.current_ui_screen not in {"BOOKING_COLLECT", "BOOKING_SUMMARY"}:
        return None
    if not _has_booking_detail_updates(extracted_slots):
        return None

    # Compute state once. Use _make_booking_response_precomputed for all return
    # paths so date normalisation is not repeated inside _make_booking_response.
    preview_slots, preview_room = _prepare_booking_state_update(
        state,
        extracted_slots=extracted_slots,
    )
    missing_required = preview_slots.missing_required_slots()
    selected_room_name = (
        preview_room.name
        if preview_room and preview_room.name
        else preview_slots.room_type
    )

    if state.current_ui_screen == "BOOKING_SUMMARY":
        if not missing_required:
            return _make_booking_response_precomputed(
                state,
                "I've updated those booking details. Please review them once more before payment, or tell me if anything else should change.",
                "BOOKING_COLLECT",
                preview_slots,
                preview_room,
                active_slot=None,
            )
        next_slot = _infer_booking_follow_up_slot(state.latest_transcript, extracted_slots) or missing_required[0]
        return _make_booking_response_precomputed(
            state,
            _fallback_booking_prompt(next_slot, selected_room_name, room_inventory),
            "BOOKING_COLLECT",
            preview_slots,
            preview_room,
            active_slot=next_slot,
        )

    if not missing_required:
        guest_name = preview_slots.guest_name
        speech = (
            f"Thank you, {guest_name}. Let me pull up your booking summary."
            if guest_name
            else "Perfect. Let me pull up your booking summary."
        )
        return _make_booking_response_precomputed(
            state,
            speech,
            "BOOKING_SUMMARY",
            preview_slots,
            preview_room,
            active_slot=None,
        )

    next_slot = missing_required[0]
    return _make_booking_response_precomputed(
        state,
        _fallback_booking_prompt(next_slot, selected_room_name, room_inventory),
        "BOOKING_COLLECT",
        preview_slots,
        preview_room,
        active_slot=next_slot,
    )


def _handle_summary_modify_transition(state: KioskState, extracted_slots: dict) -> dict:
    preview_slots, preview_room = _prepare_booking_state_update(
        state,
        extracted_slots=extracted_slots,
    )
    requested_slot = _infer_booking_follow_up_slot(state.latest_transcript, extracted_slots)
    missing_required = preview_slots.missing_required_slots()
    selected_room_name = (
        preview_room.name
        if preview_room and preview_room.name
        else preview_slots.room_type
    )
    if _has_booking_detail_updates(extracted_slots) and not missing_required:
        speech = (
            "I've updated those booking details. Please review them once more before payment, "
            "or tell me if anything else should change."
        )
        active_slot = None
    else:
        active_slot = requested_slot or (missing_required[0] if missing_required else "guest_name")
        speech = _fallback_booking_prompt(active_slot, selected_room_name, state.tenant_room_inventory)
    return _make_booking_response_precomputed(
        state,
        speech,
        "BOOKING_COLLECT",
        preview_slots,
        preview_room,
        active_slot=active_slot,
    )


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

    if (
        state.current_ui_screen == "ROOM_PREVIEW"
        and state.selected_room
        and intent in {"PROVIDE_GUESTS", "PROVIDE_DATES", "PROVIDE_NAME"}
        and not _looks_like_explicit_preview_booking_request(state.latest_transcript)
    ):
        return _build_preview_booking_gate_response(state)

    if intent == "BOOK_ROOM":
        return _handle_room_request_transition(state, extracted_slots, room_inventory)

    booking_detail_transition = _handle_booking_detail_transition(
        state,
        extracted_slots,
        room_inventory,
    )
    if booking_detail_transition:
        return booking_detail_transition

    if state.current_ui_screen == "ROOM_SELECT" and not state.booking_slots.room_type:
        if intent == "PROVIDE_GUESTS" and extracted_slots.get("adults") is not None:
            adults = int(extracted_slots["adults"])
            children = extracted_slots.get("children")
            guest_text = f"{adults} adult{'s' if adults != 1 else ''}"
            if isinstance(children, int) and children > 0:
                guest_text += f" and {children} child{'ren' if children != 1 else ''}"
            return _make_booking_response(
                state,
                f"Got it, {guest_text}. Which room would you like to explore?",
                "ROOM_SELECT",
                active_slot="room_type",
                extracted_slots=extracted_slots,
            )

        if intent == "PROVIDE_DATES" and (
            extracted_slots.get("check_in_date") or extracted_slots.get("check_out_date")
        ):
            preview_slots, _ = _prepare_booking_state_update(
                state,
                extracted_slots=extracted_slots,
            )
            check_in_text = _format_date_for_speech(preview_slots.check_in_date)
            check_out_text = _format_date_for_speech(preview_slots.check_out_date)
            if check_in_text and check_out_text:
                speech = (
                    f"Got it, check-in {check_in_text} and check-out {check_out_text}. "
                    "Which room would you like to explore?"
                )
            elif check_in_text:
                speech = f"Got it, check-in {check_in_text}. Which room would you like to explore?"
            else:
                speech = "Got it. Which room would you like to explore?"
            return _make_booking_response(
                state,
                speech,
                "ROOM_SELECT",
                active_slot="room_type",
                extracted_slots=extracted_slots,
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
        return _booking_response(
            state,
            {
                "speech_response": speech,
                "speech_override": None,
                "booking_slots": state.booking_slots,
                "active_slot": state.active_slot,
                "selected_room": state.selected_room,
                "history": updated_history,
                "next_ui_screen": state.current_ui_screen,
            },
            decision_source="speech_override",
        )

    # FIX PERF-03: Run _transcript_explicitly_identifies_room once here and reuse
    # the result. The original called it again inside booking_logic's validation
    # block, running the full inventory scan twice per LLM-fallback turn.
    extracted = _extract_slots_deterministically(state)
    room_inventory = state.tenant_room_inventory or []
    transcript_room_match = _transcript_explicitly_identifies_room(state.latest_transcript, room_inventory)

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
            return _booking_response(
                state,
                {
                    "speech_response": speech,
                    "booking_slots": state.booking_slots,
                    "active_slot": None,
                    "selected_room": state.selected_room,
                    "history": updated_history,
                    "next_ui_screen": "PAYMENT",
                },
                decision_source="summary_confirm_payment",
            )
        if missing_required:
            next_slot = missing_required[0]
            speech = _fallback_booking_prompt(next_slot, selected_room_name, state.tenant_room_inventory)
            updated_history = state.history + [
                ConversationTurn(role="user", content=state.latest_transcript),
                ConversationTurn(role="assistant", content=speech),
            ]
            return _booking_response(
                state,
                {
                    "speech_response": speech,
                    "booking_slots": state.booking_slots,
                    "active_slot": next_slot,
                    "selected_room": state.selected_room,
                    "history": updated_history,
                    "next_ui_screen": "BOOKING_COLLECT",
                },
                decision_source="summary_confirm_collect_missing",
            )

    if state.resolved_intent == "MODIFY_BOOKING":
        if _is_room_change_request(state.latest_transcript):
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
            return _booking_response(
                state,
                {
                    "speech_response": speech,
                    "booking_slots": updated_slots,
                    "active_slot": "room_type",
                    "selected_room": None,
                    "history": updated_history,
                    "next_ui_screen": "ROOM_SELECT",
                },
                decision_source="summary_modify_room_change",
            )

        if state.current_ui_screen == "BOOKING_SUMMARY":
            return _booking_response(
                state,
                _handle_summary_modify_transition(state, extracted),
                decision_source="summary_modify_collect",
                extracted_slots=extracted,
            )

    deterministic = _deterministic_booking_response(
        state,
        extracted,
        room_inventory,
    )
    if deterministic:
        print("[BookingLogic] Deterministic response (no LLM)")
        return _booking_response(
            state,
            deterministic,
            decision_source="deterministic",
            extracted_slots=extracted,
        )

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
        return _booking_response(
            state,
            {
                "speech_response": "I'm sorry, I didn't quite catch that. Could you please say it once more?",
                "next_ui_screen": fallback_screen,
            },
            decision_source="llm_parse_error",
        )

    extracted = result.get("extracted_slots", {})
    speech = result.get("speech", "Let me note that down.")
    selected_room = state.selected_room

    # VALIDATION LAYER: tenant-aware room check using DB-backed room inventory.
    # FIX PERF-03 (continued): Reuse transcript_room_match computed above instead
    # of calling _transcript_explicitly_identifies_room again here.
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

    return _booking_response(
        state,
        {
            "speech_response": speech,
            "booking_slots": updated_slots,
            "active_slot": None if next_screen == "ROOM_PREVIEW" else next_slot,
            "selected_room": selected_room,
            "history": updated_history,
            "next_ui_screen": next_screen,
        },
        decision_source="llm_booking_fallback",
        extracted_slots=extracted,
    )


def _determine_next_screen(slots: BookingSlots, is_complete: bool, stay_in_room_preview: bool) -> str:
    """Map missing slots to the correct UI screen.

    Flow:  ROOM_SELECT  →  ROOM_PREVIEW  →  BOOKING_COLLECT  →  BOOKING_SUMMARY
    """
    if is_complete:
        return "BOOKING_SUMMARY"

    if slots.room_type is None:
        return "ROOM_SELECT"

    if stay_in_room_preview:
        return "ROOM_PREVIEW"

    return "BOOKING_COLLECT"
