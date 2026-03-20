from datetime import date, datetime
from typing import Optional


CONTRACT_TO_BACKEND_SLOT_MAP = {
    "roomType": "room_type",
    "adults": "adults",
    "children": "children",
    "checkInDate": "check_in_date",
    "checkOutDate": "check_out_date",
    "guestName": "guest_name",
    "nights": "nights",
    "totalPrice": "total_price",
}


def parse_iso_date(raw_value: Optional[str]) -> Optional[date]:
    if not raw_value:
        return None
    try:
        return datetime.strptime(str(raw_value), "%Y-%m-%d").date()
    except Exception:
        return None


def resolve_room_capacity_limit(selected_room_payload: Optional[dict], key: str) -> Optional[int]:
    if not selected_room_payload:
        return None
    raw_value = selected_room_payload.get(key)
    if raw_value is None:
        return None
    try:
        parsed = int(raw_value)
        return parsed if parsed >= 0 else None
    except Exception:
        return None


def _normalize_room_lookup_value(raw_value: Optional[object]) -> str:
    if raw_value is None:
        return ""
    return " ".join(str(raw_value).strip().lower().split())


def resolve_effective_room_payload(
    selected_room_payload: Optional[dict],
    slots_dict: Optional[dict],
    room_inventory: Optional[list[dict]],
) -> Optional[dict]:
    payload = dict(selected_room_payload or {})
    if not room_inventory:
        return payload or None

    normalized_payload_name = _normalize_room_lookup_value(payload.get("name"))
    normalized_payload_code = _normalize_room_lookup_value(payload.get("code"))
    normalized_room_hint = _normalize_room_lookup_value(
        (slots_dict or {}).get("room_type") or (slots_dict or {}).get("roomType")
    )
    selected_room_id = str(payload.get("id") or "").strip()

    canonical_room: Optional[dict] = None
    for room in room_inventory:
        room_id = str(room.get("id") or "").strip()
        room_name = _normalize_room_lookup_value(room.get("name"))
        room_code = _normalize_room_lookup_value(room.get("code"))
        if selected_room_id and room_id == selected_room_id:
            canonical_room = dict(room)
            break
        if normalized_payload_name and normalized_payload_name in {room_name, room_code}:
            canonical_room = dict(room)
            break
        if normalized_payload_code and normalized_payload_code in {room_name, room_code}:
            canonical_room = dict(room)
            break
        if normalized_room_hint and normalized_room_hint in {room_name, room_code}:
            canonical_room = dict(room)
            break

    if not canonical_room:
        return payload or None

    merged_room = dict(canonical_room)
    merged_room.update({key: value for key, value in payload.items() if value is not None})
    for authoritative_key in (
        "id",
        "name",
        "code",
        "price",
        "currency",
        "maxAdults",
        "maxChildren",
        "maxTotalGuests",
    ):
        if canonical_room.get(authoritative_key) is not None:
            merged_room[authoritative_key] = canonical_room.get(authoritative_key)
    return merged_room


def bookings_overlap(
    existing_check_in: date,
    existing_check_out: date,
    requested_check_in: date,
    requested_check_out: date,
) -> bool:
    return requested_check_in < existing_check_out and requested_check_out > existing_check_in


def validate_booking_constraints(
    slots_dict: dict,
    selected_room_payload: Optional[dict],
) -> tuple[Optional[str], Optional[str], str]:
    today = date.today()
    check_in = parse_iso_date(slots_dict.get("check_in_date"))
    check_out = parse_iso_date(slots_dict.get("check_out_date"))

    if check_in and check_in < today:
        return (
            "Check-in date cannot be in the past. Please choose today or a future date.",
            "checkInDate",
            "BOOKING_COLLECT",
        )

    if check_in and check_out and check_out <= check_in:
        return (
            "Check-out date must be after check-in date. Please update the dates.",
            "checkOutDate",
            "BOOKING_COLLECT",
        )

    adults = slots_dict.get("adults")
    children = slots_dict.get("children")
    max_adults = resolve_room_capacity_limit(selected_room_payload, "maxAdults")
    max_children = resolve_room_capacity_limit(selected_room_payload, "maxChildren")
    max_total_guests = resolve_room_capacity_limit(selected_room_payload, "maxTotalGuests")

    try:
        adult_count = int(adults) if adults is not None else None
    except Exception:
        adult_count = None

    try:
        child_count = int(children) if children is not None else 0
    except Exception:
        child_count = 0

    # Minimum guest validation: a booking must have at least 1 adult
    if adult_count is not None and adult_count < 1:
        return (
            "A booking requires at least 1 adult. How many adults will be staying?",
            "adults",
            "BOOKING_COLLECT",
        )

    if child_count < 0:
        return (
            "The number of children cannot be negative. How many children will be staying?",
            "children",
            "BOOKING_COLLECT",
        )

    if max_adults is not None and adult_count is not None and adult_count > max_adults:
        return (
            f"This room allows up to {max_adults} adult{'s' if max_adults != 1 else ''}. "
            "Please reduce the adult count or choose another room.",
            "adults",
            "BOOKING_COLLECT",
        )

    if max_children is not None and child_count > max_children:
        return (
            f"This room allows up to {max_children} child{'ren' if max_children != 1 else ''}. "
            "Please reduce the child count or choose another room.",
            "children",
            "BOOKING_COLLECT",
        )

    if (
        max_total_guests is not None
        and adult_count is not None
        and adult_count + child_count > max_total_guests
    ):
        return (
            f"This room allows up to {max_total_guests} guest{'s' if max_total_guests != 1 else ''} in total. "
            "Please adjust the guest count or choose another room.",
            "adults",
            "BOOKING_COLLECT",
        )

    return None, None, "BOOKING_SUMMARY"


def sanitize_booking_constraints(
    slots_dict: dict,
    previous_slots_dict: Optional[dict],
    selected_room_payload: Optional[dict],
) -> tuple[dict, Optional[str], Optional[str], str]:
    sanitized_slots = dict(slots_dict or {})
    previous_values = dict(previous_slots_dict or {})
    first_error: Optional[str] = None
    first_slot: Optional[str] = None
    first_screen = "BOOKING_SUMMARY"
    seen_slots: set[str] = set()

    while True:
        error, slot, screen = validate_booking_constraints(sanitized_slots, selected_room_payload)
        if not error:
            return sanitized_slots, first_error, first_slot, first_screen

        if first_error is None:
            first_error = error
            first_slot = slot
            first_screen = screen

        backend_slot = CONTRACT_TO_BACKEND_SLOT_MAP.get(slot or "", slot or "")
        if not backend_slot or backend_slot in seen_slots:
            return sanitized_slots, first_error, first_slot, first_screen

        seen_slots.add(backend_slot)
        previous_value = previous_values.get(backend_slot)
        current_value = sanitized_slots.get(backend_slot)
        sanitized_slots[backend_slot] = None if previous_value == current_value else previous_value
