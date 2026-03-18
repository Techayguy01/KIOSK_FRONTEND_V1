"""
Tests for date parsing and normalization in agent/nodes.py.
"""

from datetime import date

import pytest

from agent.nodes import (
    _anchor_yearless_date,
    _extract_requested_nights,
    _has_explicit_year,
    _normalize_booking_dates,
    _parse_iso_date,
    _replace_year_safely,
)
from agent.state import BookingSlots, RoomInventoryItem


class TestParseIsoDate:
    def test_valid_date(self):
        assert _parse_iso_date("2026-03-18") == date(2026, 3, 18)

    def test_invalid_date(self):
        assert _parse_iso_date("not-a-date") is None

    def test_none(self):
        assert _parse_iso_date(None) is None

    def test_empty(self):
        assert _parse_iso_date("") is None


class TestHasExplicitYear:
    def test_with_year(self):
        assert _has_explicit_year("March 18 2026") is True

    def test_without_year(self):
        assert _has_explicit_year("March 18") is False

    def test_empty(self):
        assert _has_explicit_year("") is False


class TestExtractRequestedNights:
    @pytest.mark.parametrize(
        ("transcript", "expected"),
        [
            ("for 3 nights", 3),
            ("2 nights", 2),
            ("for two nights", 2),
            ("one night", 1),
            ("for twelve nights", 12),
            ("hello", None),
            ("", None),
        ],
    )
    def test_extraction(self, transcript, expected):
        assert _extract_requested_nights(transcript) == expected


class TestAnchorYearlessDate:
    def test_past_date_anchored_forward(self):
        today = date(2026, 3, 18)
        result = _anchor_yearless_date("2025-03-20", "March 20", today)
        parsed = _parse_iso_date(result)
        assert parsed is not None
        assert parsed >= today

    def test_future_date_stays(self):
        today = date(2026, 3, 18)
        result = _anchor_yearless_date("2026-04-01", "April 1", today)
        assert result == "2026-04-01"

    def test_explicit_year_preserved(self):
        today = date(2026, 3, 18)
        result = _anchor_yearless_date("2025-03-20", "March 20 2025", today)
        assert result == "2025-03-20"


class TestReplaceYearSafely:
    def test_normal_date(self):
        result = _replace_year_safely(date(2025, 6, 15), 2026)
        assert result == date(2026, 6, 15)

    def test_leap_day_to_non_leap_year(self):
        result = _replace_year_safely(date(2024, 2, 29), 2025)
        assert result == date(2025, 2, 28)

    def test_leap_day_to_leap_year(self):
        result = _replace_year_safely(date(2024, 2, 29), 2028)
        assert result == date(2028, 2, 29)


class TestExtractNightsEdgeCases:
    @pytest.mark.parametrize(
        ("transcript", "expected"),
        [
            ("for 1 night", 1),
            ("for 10 nights", 10),
            ("for 99 nights", 99),
            ("3 night stay", 3),
            ("stay for five nights", 5),
            ("seven night package", 7),
            ("thirteen nights", None),
            ("zero nights", None),
            ("for -3 nights", 3),
            ("nights", None),
            ("I need 2 nights", 2),
        ],
    )
    def test_edge_cases(self, transcript, expected):
        assert _extract_requested_nights(transcript) == expected


class TestAnchorYearlessEdgeCases:
    def test_none_input(self):
        result = _anchor_yearless_date(None, "some transcript", date(2026, 3, 18))
        assert result is None

    def test_empty_string(self):
        result = _anchor_yearless_date("", "some transcript", date(2026, 3, 18))
        assert result == ""

    def test_today_is_valid(self):
        today = date(2026, 3, 18)
        result = _anchor_yearless_date("2026-03-18", "March 18", today)
        parsed = _parse_iso_date(result)
        assert parsed is not None
        assert parsed >= today


class TestNormalizeBookingDates:
    def _make_room(self, price: float = 200.0) -> RoomInventoryItem:
        return RoomInventoryItem(id="r1", name="Test Room", price=price, currency="INR")

    def test_nights_derive_checkout(self):
        slots = BookingSlots(
            check_in_date="2026-04-01",
            nights=3,
        )
        result = _normalize_booking_dates(slots, "for 3 nights", self._make_room())
        assert result.check_out_date == "2026-04-04"

    def test_checkout_before_checkin_corrected(self):
        slots = BookingSlots(
            check_in_date="2026-04-05",
            check_out_date="2026-04-03",
        )
        result = _normalize_booking_dates(slots, "April 3 to April 5", None)
        parsed_in = _parse_iso_date(result.check_in_date)
        parsed_out = _parse_iso_date(result.check_out_date)
        assert parsed_out > parsed_in

    def test_nights_calculated_from_date_pair(self):
        slots = BookingSlots(
            check_in_date="2026-04-01",
            check_out_date="2026-04-04",
        )
        result = _normalize_booking_dates(slots, "April 1 to April 4", None)
        assert result.nights == 3

    def test_total_price_calculated(self):
        room = self._make_room(price=500.0)
        slots = BookingSlots(
            check_in_date="2026-04-01",
            check_out_date="2026-04-04",
        )
        result = _normalize_booking_dates(slots, "April 1 to April 4", room)
        assert result.nights == 3
        assert result.total_price == 1500.0

    def test_requested_nights_overrides_existing(self):
        slots = BookingSlots(
            check_in_date="2026-04-01",
            check_out_date="2026-04-10",
            nights=9,
        )
        result = _normalize_booking_dates(slots, "actually for 3 nights", self._make_room())
        assert result.nights == 3
        assert result.check_out_date == "2026-04-04"
