from datetime import date, datetime
from typing import Optional


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
