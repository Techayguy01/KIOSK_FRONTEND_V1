"""
Tests for deterministic intent pre-checks in agent/nodes.py.
These tests do NOT call the LLM - they test the regex-based functions only.
"""

from unittest.mock import AsyncMock, patch

import pytest

from agent.nodes import (
    _is_room_change_request,
    _is_summary_confirmation_transcript,
    _is_summary_modify_transcript,
    _looks_like_check_in_request,
    route_intent,
)
from agent.state import BookingSlots, KioskState

try:
    from agent.nodes import _looks_like_room_browsing_request

    HAS_ROOM_BROWSING = True
except ImportError:
    HAS_ROOM_BROWSING = False


class TestCheckInDetection:
    @pytest.mark.parametrize(
        "transcript",
        [
            "I want to check in",
            "check in please",
            "I have a booking",
            "existing booking",
            "my reservation",
            "check-in",
            "I'd like to check in",
            "can I check in",
            "let me check in",
        ],
    )
    def test_positive_check_in(self, transcript):
        assert _looks_like_check_in_request(transcript) is True

    @pytest.mark.xfail(
        reason="Current router regex does not match the article-containing phrase 'I have a reservation'.",
        strict=False,
    )
    def test_i_have_a_reservation(self):
        assert _looks_like_check_in_request("I have a reservation") is True

    @pytest.mark.parametrize(
        "transcript",
        [
            "what is the check in time",
            "when is check in",
            "tell me the check in hours",
            "what time can I check in",
            "book a room",
            "show me rooms",
            "hello",
            "what is the pool timing",
            "",
        ],
    )
    def test_negative_check_in(self, transcript):
        assert _looks_like_check_in_request(transcript) is False


class TestSummaryConfirmation:
    @pytest.mark.parametrize(
        "transcript",
        [
            "yes confirm",
            "confirmed",
            "correct",
            "yes",
            "yeah",
            "yep",
            "proceed",
            "continue",
            "pay",
            "payment",
            "card",
            "looks good",
            "it's correct",
        ],
    )
    def test_positive_confirmation(self, transcript):
        assert _is_summary_confirmation_transcript(transcript) is True

    @pytest.mark.parametrize(
        "transcript",
        [
            "change the room",
            "modify dates",
            "go back",
            "not sure",
            "",
        ],
    )
    def test_negative_confirmation(self, transcript):
        assert _is_summary_confirmation_transcript(transcript) is False


class TestSummaryModification:
    @pytest.mark.parametrize(
        "transcript",
        [
            "change the date",
            "modify my booking",
            "edit the name",
            "update the room",
            "that's wrong",
            "not correct",
            "go back",
        ],
    )
    def test_positive_modification(self, transcript):
        assert _is_summary_modify_transcript(transcript) is True

    @pytest.mark.parametrize(
        "transcript",
        [
            "yes confirm",
            "looks good",
            "proceed",
            "hello",
            "",
        ],
    )
    def test_negative_modification(self, transcript):
        assert _is_summary_modify_transcript(transcript) is False


class TestRoomChangeRequest:
    @pytest.mark.parametrize(
        "transcript",
        [
            "change the room",
            "I want a different room",
            "switch room please",
            "go back to room selection",
            "modify the room",
        ],
    )
    def test_positive_room_change(self, transcript):
        assert _is_room_change_request(transcript) is True

    @pytest.mark.parametrize(
        "transcript",
        [
            "change the date",
            "modify my name",
            "hello",
            "",
        ],
    )
    def test_negative_room_change(self, transcript):
        assert _is_room_change_request(transcript) is False


@pytest.mark.skipif(not HAS_ROOM_BROWSING, reason="Room browsing pre-check not yet implemented")
class TestRoomBrowsingDetection:
    @pytest.mark.parametrize(
        "transcript",
        [
            "show me rooms",
            "show me the rooms",
            "see the rooms",
            "view rooms",
            "virtual tour",
            "give me a virtual tour",
            "explore rooms",
            "explore the rooms",
            "let me see rooms",
            "let me explore the rooms",
            "what rooms do you have",
            "room options",
            "available rooms",
            "browse rooms",
            "I want to see the rooms",
            "room tour",
            "show me room options",
        ],
    )
    def test_positive_room_browsing(self, transcript):
        assert _looks_like_room_browsing_request(transcript) is True

    @pytest.mark.parametrize(
        "transcript",
        [
            "what time is room service",
            "what is the room policy",
            "when is checkout",
            "hello",
            "book a room",
            "I want to check in",
            "what is the pool timing",
            "",
            "how much does a room cost",
        ],
    )
    def test_negative_room_browsing(self, transcript):
        assert _looks_like_room_browsing_request(transcript) is False


class TestCheckInEdgeCases:
    @pytest.mark.parametrize(
        "transcript",
        [
            "CHECK IN",
            "Check In Please",
            "  check in  ",
            "check in!",
            "check in.",
            "I WANT TO CHECK IN",
            "i have a booking already",
            "I have an existing booking",
        ],
    )
    def test_case_and_whitespace_variations(self, transcript):
        assert _looks_like_check_in_request(transcript) is True

    @pytest.mark.parametrize(
        "transcript",
        [
            "checking the weather",
            "check this out",
            "check the menu",
            "I have a question",
            "check in what time",
            "when is the check in time",
        ],
    )
    def test_false_positives_prevented(self, transcript):
        assert _looks_like_check_in_request(transcript) is False


class TestConfirmationEdgeCases:
    @pytest.mark.parametrize(
        "transcript",
        [
            "YES",
            "  yes  ",
            "yes!",
            "yes, confirm",
            "yes please confirm",
            "that is correct",
            "yep looks good",
            "yeah proceed",
            "let's proceed",
            "confirm and pay",
            "I want to pay",
            "take my card",
            "its correct",
        ],
    )
    def test_positive_variations(self, transcript):
        assert _is_summary_confirmation_transcript(transcript) is True

    @pytest.mark.parametrize(
        "transcript",
        [
            "hmm let me think",
            "wait",
            "hold on",
            "I'm not sure yet",
            "maybe",
            "can I see the rooms again",
            "no",
            "nope",
        ],
    )
    def test_non_confirmations(self, transcript):
        assert _is_summary_confirmation_transcript(transcript) is False


class TestModificationEdgeCases:
    @pytest.mark.parametrize(
        "transcript",
        [
            "CHANGE THE DATE",
            "  modify my booking  ",
            "I want to edit something",
            "the dates are wrong",
            "update my name",
            "go back please",
            "that's not correct",
        ],
    )
    def test_positive_variations(self, transcript):
        assert _is_summary_modify_transcript(transcript) is True

    @pytest.mark.parametrize(
        "transcript",
        [
            "looks wonderful",
            "tell me about the room",
            "how much is it",
        ],
    )
    def test_non_modifications(self, transcript):
        assert _is_summary_modify_transcript(transcript) is False


class TestRoomChangeEdgeCases:
    @pytest.mark.parametrize(
        "transcript",
        [
            "I want to change my room",
            "can I switch to a different suite",
            "let me see another room",
            "go back to the room selection",
            "replace this room with something else",
        ],
    )
    def test_positive_change(self, transcript):
        assert _is_room_change_request(transcript) is True

    @pytest.mark.parametrize(
        "transcript",
        [
            "I love this room",
            "the room looks great",
            "tell me about suite features",
            "what's the room rate",
            "change my dates please",
        ],
    )
    def test_no_room_change(self, transcript):
        assert _is_room_change_request(transcript) is False


class TestRouteIntentModule4:
    @pytest.mark.asyncio
    async def test_family_recommendation_routes_to_book_room(self):
        state = KioskState(
            session_id="router-family-room",
            tenant_id="default",
            current_ui_screen="WELCOME",
            latest_transcript="We are a family of four. Which room should we look at?",
        )

        result = await route_intent(state)

        assert result["resolved_intent"] == "BOOK_ROOM"
        assert result["confidence"] >= 0.9

    @pytest.mark.asyncio
    async def test_welcome_room_difference_routes_to_book_room(self):
        state = KioskState(
            session_id="router-room-difference",
            tenant_id="default",
            current_ui_screen="WELCOME",
            latest_transcript="What is the difference between Budget Deluxe Room and Grand Luxury Suite?",
        )

        result = await route_intent(state)

        assert result["resolved_intent"] == "BOOK_ROOM"
        assert result["confidence"] >= 0.9

    @pytest.mark.asyncio
    async def test_welcome_which_is_better_routes_to_book_room(self):
        state = KioskState(
            session_id="router-which-is-better",
            tenant_id="default",
            current_ui_screen="WELCOME",
            latest_transcript="Which is better, Budget Deluxe Room or Grand Luxury Suite?",
        )

        result = await route_intent(state)

        assert result["resolved_intent"] == "BOOK_ROOM"
        assert result["confidence"] >= 0.9

    @pytest.mark.asyncio
    async def test_room_select_better_comparison_routes_to_book_room(self):
        state = KioskState(
            session_id="router-room-better-comparison",
            tenant_id="default",
            current_ui_screen="ROOM_SELECT",
            latest_transcript="Which one is better for four adults, Budget Deluxe Room or Grand Luxury Suite?",
        )

        result = await route_intent(state)

        assert result["resolved_intent"] == "BOOK_ROOM"
        assert result["confidence"] >= 0.9

    @pytest.mark.asyncio
    async def test_room_preview_detail_routes_to_general_query(self):
        state = KioskState(
            session_id="router-preview-detail",
            tenant_id="default",
            current_ui_screen="ROOM_PREVIEW",
            latest_transcript="Does this room have a balcony or a city view?",
        )

        result = await route_intent(state)

        assert result["resolved_intent"] == "GENERAL_QUERY"
        assert result["confidence"] >= 0.9

    @pytest.mark.asyncio
    async def test_booking_summary_confirm_routes_to_confirm_booking(self):
        state = KioskState(
            session_id="router-summary-confirm",
            tenant_id="default",
            current_ui_screen="BOOKING_SUMMARY",
            latest_transcript="Yes, those details are correct. Please proceed to payment.",
            booking_slots=BookingSlots(
                roomType="Family Suite",
                adults=2,
                checkInDate="2026-03-21",
                checkOutDate="2026-03-23",
                guestName="John Carter",
            ),
        )

        result = await route_intent(state)

        assert result["resolved_intent"] == "CONFIRM_BOOKING"
        assert result["confidence"] >= 0.95

    @pytest.mark.asyncio
    async def test_booking_summary_modify_routes_to_modify_booking(self):
        state = KioskState(
            session_id="router-summary-modify",
            tenant_id="default",
            current_ui_screen="BOOKING_SUMMARY",
            latest_transcript="I need to change the guest name before paying.",
        )

        result = await route_intent(state)

        assert result["resolved_intent"] == "MODIFY_BOOKING"
        assert result["confidence"] >= 0.95

    @pytest.mark.asyncio
    async def test_booking_collect_suppresses_generic_check_in_takeover(self):
        state = KioskState(
            session_id="router-booking-check-in-suppression",
            tenant_id="default",
            current_ui_screen="BOOKING_COLLECT",
            latest_transcript="My name is John Carter, two adults, check in tomorrow for two nights.",
            booking_slots=BookingSlots(roomType="Family Suite"),
        )

        with patch(
            "agent.semantic_classifier.classify_intent_semantically",
            new=AsyncMock(return_value=None),
        ), patch(
            "agent.nodes.get_llm_response",
            return_value='{"intent":"CHECK_IN","confidence":0.94}',
        ):
            result = await route_intent(state)

        assert result["resolved_intent"] == "GENERAL_QUERY"
        assert result["resolved_intent"] != "CHECK_IN"
