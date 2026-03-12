import unittest
from datetime import date

from services.booking_guards import (
    bookings_overlap,
    resolve_effective_room_payload,
    sanitize_booking_constraints,
    validate_booking_constraints,
)


class BookingConstraintTests(unittest.TestCase):
    def test_guest_limit_rejected_when_adults_exceed_room_capacity(self) -> None:
        message, slot, screen = validate_booking_constraints(
            slots_dict={
                "adults": 20,
                "children": 0,
                "check_in_date": "2030-01-10",
                "check_out_date": "2030-01-12",
            },
            selected_room_payload={
                "maxAdults": 3,
                "maxChildren": 1,
                "maxTotalGuests": 3,
            },
        )

        self.assertIsNotNone(message)
        self.assertIn("up to 3 adults", str(message).lower())
        self.assertEqual(slot, "adults")
        self.assertEqual(screen, "BOOKING_COLLECT")

    def test_effective_room_payload_uses_catalog_capacity_when_selected_room_is_partial(self) -> None:
        resolved_room = resolve_effective_room_payload(
            selected_room_payload={
                "id": "room-1",
                "name": "Superior Room",
            },
            slots_dict={"room_type": "Superior Room"},
            room_inventory=[
                {
                    "id": "room-1",
                    "name": "Superior Room",
                    "code": "SUP",
                    "price": 10000,
                    "currency": "INR",
                    "maxAdults": 4,
                    "maxChildren": 2,
                    "maxTotalGuests": 6,
                }
            ],
        )

        self.assertIsNotNone(resolved_room)
        self.assertEqual(resolved_room["maxAdults"], 4)
        self.assertEqual(resolved_room["maxChildren"], 2)
        self.assertEqual(resolved_room["maxTotalGuests"], 6)

    def test_sanitize_booking_constraints_rolls_back_invalid_guest_counts(self) -> None:
        sanitized_slots, message, slot, screen = sanitize_booking_constraints(
            slots_dict={
                "room_type": "Superior Room",
                "adults": 24,
                "children": 35,
                "check_in_date": "2030-01-10",
                "check_out_date": "2030-01-12",
                "guest_name": "Ram",
            },
            previous_slots_dict={
                "room_type": "Superior Room",
                "adults": 2,
                "children": 1,
                "check_in_date": None,
                "check_out_date": None,
                "guest_name": None,
            },
            selected_room_payload={
                "name": "Superior Room",
                "maxAdults": 4,
                "maxChildren": 2,
                "maxTotalGuests": 6,
            },
        )

        self.assertIsNotNone(message)
        self.assertEqual(slot, "adults")
        self.assertEqual(screen, "BOOKING_COLLECT")
        self.assertEqual(sanitized_slots["adults"], 2)
        self.assertEqual(sanitized_slots["children"], 1)


class BookingConflictTests(unittest.TestCase):
    def test_overlap_detected_for_same_time_window(self) -> None:
        self.assertTrue(
            bookings_overlap(
                existing_check_in=date(2030, 1, 10),
                existing_check_out=date(2030, 1, 12),
                requested_check_in=date(2030, 1, 11),
                requested_check_out=date(2030, 1, 13),
            )
        )

    def test_back_to_back_stays_do_not_overlap(self) -> None:
        self.assertFalse(
            bookings_overlap(
                existing_check_in=date(2030, 1, 10),
                existing_check_out=date(2030, 1, 12),
                requested_check_in=date(2030, 1, 12),
                requested_check_out=date(2030, 1, 14),
            )
        )


if __name__ == "__main__":
    unittest.main()
