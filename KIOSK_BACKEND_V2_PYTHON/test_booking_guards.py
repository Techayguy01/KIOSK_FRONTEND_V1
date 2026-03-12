import unittest
from datetime import date

from services.booking_guards import bookings_overlap, validate_booking_constraints


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
