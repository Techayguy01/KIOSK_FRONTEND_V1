"""
Integration tests for the full LangGraph agent pipeline.
LLM calls are mocked so the graph can be exercised without external APIs.
"""

import json
from unittest.mock import patch

import pytest

from agent.nodes import booking_logic, route_intent
from agent.graph import kiosk_agent
from agent.state import BookingSlots, KioskState, RoomInventoryItem


def _make_state(transcript: str, screen: str = "WELCOME", **kwargs) -> KioskState:
    rooms = kwargs.pop(
        "rooms",
        [
            RoomInventoryItem(id="r1", name="Deluxe Ocean View", code="DOV", price=250),
            RoomInventoryItem(id="r2", name="Executive Suite", code="ES", price=450),
        ],
    )
    return KioskState(
        session_id="test-session",
        tenant_id="test-tenant",
        latest_transcript=transcript,
        current_ui_screen=screen,
        tenantRoomInventory=rooms,
        **kwargs,
    )


def _mock_router_response(intent: str, confidence: float = 0.9) -> str:
    return json.dumps({"intent": intent, "confidence": confidence})


def _mock_booking_response(speech: str, room_type=None, next_slot="room_type") -> str:
    return json.dumps(
        {
            "extracted_slots": {"room_type": room_type},
            "speech": speech,
            "is_complete": False,
            "next_slot_to_ask": next_slot,
        }
    )


async def _route_then_book(state: KioskState) -> dict:
    routed = await route_intent(state)
    merged_state = state.model_copy(update=routed)
    result = await booking_logic(merged_state)
    return {**routed, **result}


class TestBookingPipeline:
    @pytest.mark.asyncio
    async def test_book_room_goes_to_room_select(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [_mock_router_response("BOOK_ROOM", 0.95)]

            result = await _route_then_book(_make_state("book a room"))

        assert result["resolved_intent"] == "BOOK_ROOM"
        assert result["next_ui_screen"] == "ROOM_SELECT"
        assert "room options" in result["speech_response"].lower()

    @pytest.mark.asyncio
    async def test_general_query_stays_on_welcome(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [
                _mock_router_response("GENERAL_QUERY", 0.9),
                "Hello! Welcome to our hotel. How can I help you?",
            ]

            result = await kiosk_agent.ainvoke(_make_state("hello"))

        assert result["resolved_intent"] == "GENERAL_QUERY"
        assert result["next_ui_screen"] == "WELCOME"
        assert result["speech_response"] == "Hello! Welcome to our hotel. How can I help you?"

    @pytest.mark.asyncio
    async def test_check_in_goes_to_scan_id_without_llm(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            result = await kiosk_agent.ainvoke(_make_state("I want to check in"))

        mock_llm.assert_not_called()
        assert result["resolved_intent"] == "CHECK_IN"
        assert result["next_ui_screen"] == "SCAN_ID"


class TestRoomSelectionPipeline:
    @pytest.mark.asyncio
    async def test_selecting_valid_room_goes_to_booking_collect(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [_mock_router_response("BOOK_ROOM", 0.9)]

            result = await _route_then_book(
                _make_state("book Deluxe Ocean View", screen="ROOM_SELECT")
            )

        assert result["resolved_intent"] == "BOOK_ROOM"
        assert result["next_ui_screen"] == "BOOKING_COLLECT"
        assert result["active_slot"] == "adults"
        assert result["booking_slots"].room_type == "Deluxe Ocean View"
        assert "how many adults" in result["speech_response"].lower()


class TestFullBookingFlow:
    @pytest.mark.asyncio
    async def test_book_room_initial_lands_on_room_select(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [_mock_router_response("BOOK_ROOM", 0.95)]
            result = await _route_then_book(_make_state("I'd like to book a room"))
        assert result["next_ui_screen"] == "ROOM_SELECT"
        assert "which one interests you" in result["speech_response"].lower()

    @pytest.mark.asyncio
    async def test_select_room_from_room_select_screen(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [_mock_router_response("BOOK_ROOM", 0.9)]
            result = await _route_then_book(
                _make_state("Executive Suite", screen="ROOM_SELECT")
            )
        assert result["next_ui_screen"] == "BOOKING_COLLECT"
        assert result["active_slot"] == "adults"
        assert result["booking_slots"].room_type == "Executive Suite"

    @pytest.mark.asyncio
    async def test_provide_guests_from_booking_collect(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [_mock_router_response("PROVIDE_GUESTS", 0.9)]
            state = _make_state(
                "2 adults",
                screen="BOOKING_COLLECT",
                booking_slots=BookingSlots(room_type="Executive Suite"),
            )
            state.selected_room = RoomInventoryItem(
                id="r2", name="Executive Suite", code="ES", price=450
            )
            result = await _route_then_book(state)
        assert result["next_ui_screen"] == "BOOKING_COLLECT"
        assert result["booking_slots"].adults == 2
        assert result["active_slot"] == "check_in_date"
        assert "when would you like to check in" in result["speech_response"].lower()

    @pytest.mark.asyncio
    async def test_provide_dates_from_booking_collect(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [_mock_router_response("PROVIDE_DATES", 0.9)]
            state = _make_state(
                "April 1 to April 4",
                screen="BOOKING_COLLECT",
                booking_slots=BookingSlots(room_type="Executive Suite", adults=2),
            )
            state.selected_room = RoomInventoryItem(
                id="r2", name="Executive Suite", code="ES", price=450
            )
            result = await _route_then_book(state)
        assert result["booking_slots"].check_in_date == "2026-04-01"
        assert result["booking_slots"].check_out_date == "2026-04-04"
        assert result["active_slot"] == "guest_name"
        assert "name for this booking" in result["speech_response"].lower()

    @pytest.mark.asyncio
    async def test_complete_booking_goes_to_summary(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [_mock_router_response("PROVIDE_NAME", 0.9)]
            state = _make_state(
                "John Smith",
                screen="BOOKING_COLLECT",
                booking_slots=BookingSlots(
                    room_type="Executive Suite",
                    adults=2,
                    check_in_date="2026-04-01",
                    check_out_date="2026-04-04",
                ),
            )
            state.selected_room = RoomInventoryItem(
                id="r2", name="Executive Suite", code="ES", price=450
            )
            result = await _route_then_book(state)
        assert result["next_ui_screen"] == "BOOKING_SUMMARY"
        assert result["booking_slots"].guest_name == "John Smith"
        assert "booking summary" in result["speech_response"].lower()

    @pytest.mark.asyncio
    async def test_book_this_room_from_preview_skips_booking_llm(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [_mock_router_response("BOOK_ROOM", 0.95)]
            state = _make_state(
                "book this room",
                screen="ROOM_PREVIEW",
                booking_slots=BookingSlots(room_type="Executive Suite"),
            )
            state.selected_room = RoomInventoryItem(
                id="r2", name="Executive Suite", code="ES", price=450
            )
            result = await _route_then_book(state)

        assert result["next_ui_screen"] == "BOOKING_COLLECT"
        assert result["active_slot"] == "adults"
        assert result["booking_slots"].room_type == "Executive Suite"


class TestBookingSummaryActions:
    def _summary_state(self):
        state = _make_state(
            "",
            screen="BOOKING_SUMMARY",
            booking_slots=BookingSlots(
                room_type="Executive Suite",
                adults=2,
                check_in_date="2026-04-01",
                check_out_date="2026-04-04",
                guest_name="John Smith",
            ),
        )
        state.selected_room = RoomInventoryItem(
            id="r2", name="Executive Suite", code="ES", price=450
        )
        return state

    @pytest.mark.asyncio
    async def test_confirm_goes_to_payment(self):
        state = self._summary_state()
        state.latest_transcript = "yes confirm"
        with patch("agent.nodes.get_llm_response") as mock_llm:
            result = await kiosk_agent.ainvoke(state)
        mock_llm.assert_not_called()
        assert result["next_ui_screen"] == "PAYMENT"

    @pytest.mark.asyncio
    async def test_modify_stays_in_booking(self):
        state = self._summary_state()
        state.latest_transcript = "change the dates"
        with patch("agent.nodes.get_llm_response") as mock_llm:
            mock_llm.side_effect = [
                json.dumps(
                    {
                        "extracted_slots": {},
                        "speech": "Sure, what dates would you prefer?",
                        "is_complete": False,
                        "next_slot_to_ask": "check_in_date",
                    }
                ),
            ]
            result = await kiosk_agent.ainvoke(state)
        assert result["next_ui_screen"] in {"BOOKING_COLLECT", "BOOKING_SUMMARY"}

    @pytest.mark.asyncio
    async def test_room_change_goes_to_room_select(self):
        state = self._summary_state()
        state.latest_transcript = "change the room"
        with patch("agent.nodes.get_llm_response") as mock_llm:
            result = await kiosk_agent.ainvoke(state)
        mock_llm.assert_not_called()
        assert result["next_ui_screen"] == "ROOM_SELECT"
        assert result["booking_slots"].room_type is None


class TestDeterministicRouting:
    @pytest.mark.asyncio
    async def test_check_in_skips_llm(self):
        with patch("agent.nodes.get_llm_response") as mock_llm:
            result = await kiosk_agent.ainvoke(_make_state("check in please"))
        mock_llm.assert_not_called()
        assert result["resolved_intent"] == "CHECK_IN"

    @pytest.mark.asyncio
    async def test_confirm_on_summary_skips_router_llm(self):
        state = _make_state(
            "yes confirm",
            screen="BOOKING_SUMMARY",
            booking_slots=BookingSlots(
                room_type="Executive Suite",
                adults=2,
                check_in_date="2026-04-01",
                check_out_date="2026-04-04",
                guest_name="John Smith",
            ),
        )
        state.selected_room = RoomInventoryItem(
            id="r2", name="Executive Suite", code="ES", price=450
        )
        with patch("agent.nodes.get_llm_response") as mock_llm:
            result = await kiosk_agent.ainvoke(state)
        mock_llm.assert_not_called()
        assert result["resolved_intent"] == "CONFIRM_BOOKING"
        assert result["next_ui_screen"] == "PAYMENT"
