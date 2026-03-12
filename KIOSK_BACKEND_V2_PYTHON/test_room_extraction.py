import json
import unittest
from unittest.mock import patch

from agent.nodes import _transcript_explicitly_identifies_room, booking_logic
from agent.state import BookingSlots, KioskState, RoomInventoryItem


ROOMS = [
    RoomInventoryItem(id="1", name="Superior Room", code="SUPERIOR"),
    RoomInventoryItem(id="2", name="Grand Presidential Suite", code="TAJ_PRESIDENTIAL"),
    RoomInventoryItem(id="3", name="Luxury Suite", code="LUX_SUITE"),
]


class RoomExtractionTests(unittest.TestCase):
    def test_extracts_room_from_natural_sentence(self) -> None:
        match = _transcript_explicitly_identifies_room("I want to book superior room", ROOMS)
        self.assertIsNotNone(match)
        self.assertEqual(match.name, "Superior Room")

    def test_extracts_room_from_suite_phrase_with_stt_variant(self) -> None:
        match = _transcript_explicitly_identifies_room("I want to book luxury sweet", ROOMS)
        self.assertIsNotNone(match)
        self.assertEqual(match.name, "Luxury Suite")

    def test_extracts_room_from_presidential_sentence(self) -> None:
        match = _transcript_explicitly_identifies_room("book grand presidential suite", ROOMS)
        self.assertIsNotNone(match)
        self.assertEqual(match.name, "Grand Presidential Suite")

    def test_ignores_non_selection_question(self) -> None:
        match = _transcript_explicitly_identifies_room("show me room prices", ROOMS)
        self.assertIsNone(match)

    def test_ambiguous_suite_phrase_is_not_auto_selected(self) -> None:
        ambiguous_rooms = [
            RoomInventoryItem(id="1", name="Grand Presidential Suite", code="TAJ_PRESIDENTIAL"),
            RoomInventoryItem(id="2", name="Luxury Suite", code="LUX_SUITE"),
        ]
        match = _transcript_explicitly_identifies_room("book suite", ambiguous_rooms)
        self.assertIsNone(match)


class BookingLogicRoomSelectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_initial_booking_turn_accepts_valid_room_phrase(self) -> None:
        state = KioskState(
            session_id="room-select-regression",
            latest_transcript="I want to book superior room",
            current_ui_screen="WELCOME",
            language="en",
            booking_slots=BookingSlots(),
            tenantRoomInventory=ROOMS,
        )

        llm_payload = {
            "extracted_slots": {},
            "speech": "",
            "is_complete": False,
            "next_slot_to_ask": "room_type",
        }

        with patch("agent.nodes.get_llm_response", return_value=json.dumps(llm_payload)):
            result = await booking_logic(state)

        self.assertEqual(result["next_ui_screen"], "BOOKING_COLLECT")
        self.assertEqual(result["selected_room"].name, "Superior Room")
        self.assertEqual(result["booking_slots"].room_type, "Superior Room")


if __name__ == "__main__":
    unittest.main()
