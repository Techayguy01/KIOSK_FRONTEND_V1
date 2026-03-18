"""
Tests for booking constraint validation in services/booking_guards.py.
"""

from datetime import date, timedelta
from unittest.mock import patch

from services.booking_guards import (
    bookings_overlap,
    parse_iso_date,
    resolve_effective_room_payload,
    resolve_room_capacity_limit,
    sanitize_booking_constraints,
    validate_booking_constraints,
)


class TestParseIsoDate:
    def test_valid(self):
        assert parse_iso_date("2026-03-18") == date(2026, 3, 18)

    def test_invalid(self):
        assert parse_iso_date("bad") is None

    def test_none(self):
        assert parse_iso_date(None) is None


class TestValidateBookingConstraints:
    @patch("services.booking_guards.date")
    def test_past_checkin_rejected(self, mock_date):
        mock_date.today.return_value = date(2026, 3, 18)
        mock_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)

        error, slot, screen = validate_booking_constraints(
            {"check_in_date": "2026-03-10", "check_out_date": "2026-03-12"},
            None,
        )

        assert error is not None
        assert "past" in error.lower()
        assert slot == "checkInDate"
        assert screen == "BOOKING_COLLECT"

    @patch("services.booking_guards.date")
    def test_checkout_before_checkin_rejected(self, mock_date):
        mock_date.today.return_value = date(2026, 3, 18)
        mock_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)

        error, slot, screen = validate_booking_constraints(
            {"check_in_date": "2026-03-20", "check_out_date": "2026-03-19"},
            None,
        )

        assert error is not None
        assert slot == "checkOutDate"
        assert screen == "BOOKING_COLLECT"

    def test_adults_exceed_capacity(self):
        error, slot, screen = validate_booking_constraints(
            {"adults": 5},
            {"maxAdults": 2},
        )

        assert error is not None
        assert slot == "adults"
        assert screen == "BOOKING_COLLECT"

    def test_valid_booking_passes(self):
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        next_week = (date.today() + timedelta(days=7)).isoformat()

        error, slot, screen = validate_booking_constraints(
            {
                "check_in_date": tomorrow,
                "check_out_date": next_week,
                "adults": 2,
            },
            {"maxAdults": 4},
        )

        assert error is None
        assert slot is None
        assert screen == "BOOKING_SUMMARY"


class TestChildrenCapacity:
    def test_children_exceed_max(self):
        error, slot, screen = validate_booking_constraints(
            {"children": 4},
            {"maxChildren": 2},
        )
        assert error is not None
        assert slot == "children"

    def test_children_within_limit(self):
        error, slot, screen = validate_booking_constraints(
            {"children": 1},
            {"maxChildren": 3},
        )
        assert error is None


class TestTotalGuestCapacity:
    def test_total_exceeds_max(self):
        error, slot, screen = validate_booking_constraints(
            {"adults": 3, "children": 2},
            {"maxTotalGuests": 4},
        )
        assert error is not None
        assert "total" in error.lower()

    def test_total_within_limit(self):
        error, slot, screen = validate_booking_constraints(
            {"adults": 2, "children": 1},
            {"maxTotalGuests": 4},
        )
        assert error is None

    def test_adults_only_against_total(self):
        error, slot, screen = validate_booking_constraints(
            {"adults": 5},
            {"maxTotalGuests": 4},
        )
        assert error is not None


class TestSameDayCheckout:
    @patch("services.booking_guards.date")
    def test_same_day_rejected(self, mock_date):
        mock_date.today.return_value = date(2026, 3, 18)
        mock_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)
        error, slot, screen = validate_booking_constraints(
            {"check_in_date": "2026-03-20", "check_out_date": "2026-03-20"},
            None,
        )
        assert error is not None
        assert slot == "checkOutDate"


class TestResolveRoomCapacityLimit:
    def test_valid_integer(self):
        assert resolve_room_capacity_limit({"maxAdults": 4}, "maxAdults") == 4

    def test_string_integer(self):
        assert resolve_room_capacity_limit({"maxAdults": "3"}, "maxAdults") == 3

    def test_none_value(self):
        assert resolve_room_capacity_limit({"maxAdults": None}, "maxAdults") is None

    def test_missing_key(self):
        assert resolve_room_capacity_limit({}, "maxAdults") is None

    def test_negative_rejected(self):
        assert resolve_room_capacity_limit({"maxAdults": -1}, "maxAdults") is None

    def test_no_payload(self):
        assert resolve_room_capacity_limit(None, "maxAdults") is None


class TestResolveEffectiveRoomPayload:
    def test_uses_canonical_inventory_match(self):
        result = resolve_effective_room_payload(
            {"name": "Executive Suite"},
            {"room_type": "Executive Suite"},
            [{"id": "r1", "name": "Executive Suite", "code": "ES", "maxAdults": 3}],
        )
        assert result is not None
        assert result["id"] == "r1"
        assert result["name"] == "Executive Suite"

    def test_falls_back_to_payload_when_no_inventory(self):
        result = resolve_effective_room_payload(
            {"id": "r1", "name": "Executive Suite"},
            {"room_type": "Executive Suite"},
            [],
        )
        assert result == {"id": "r1", "name": "Executive Suite"}


class TestSanitizeBookingConstraints:
    def test_resets_invalid_slot_to_previous_value(self):
        sanitized, error, slot, screen = sanitize_booking_constraints(
            {"check_in_date": "2026-03-10", "check_out_date": "2026-03-12"},
            {"check_in_date": None, "check_out_date": None},
            None,
        )
        assert error is not None
        assert slot == "checkInDate"
        assert sanitized["check_in_date"] is None


class TestBookingsOverlap:
    def test_overlapping(self):
        assert bookings_overlap(
            date(2026, 4, 1), date(2026, 4, 5),
            date(2026, 4, 3), date(2026, 4, 7),
        ) is True

    def test_not_overlapping(self):
        assert bookings_overlap(
            date(2026, 4, 1), date(2026, 4, 3),
            date(2026, 4, 5), date(2026, 4, 7),
        ) is False

    def test_adjacent_not_overlapping(self):
        assert bookings_overlap(
            date(2026, 4, 1), date(2026, 4, 3),
            date(2026, 4, 3), date(2026, 4, 5),
        ) is False

    def test_contained_overlap(self):
        assert bookings_overlap(
            date(2026, 4, 1), date(2026, 4, 10),
            date(2026, 4, 3), date(2026, 4, 5),
        ) is True
