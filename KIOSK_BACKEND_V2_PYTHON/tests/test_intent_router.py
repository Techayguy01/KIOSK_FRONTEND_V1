"""
Tests for deterministic intent pre-checks in agent/nodes.py.
These tests do NOT call the LLM - they test the regex-based functions only.
"""

import pytest

from agent.nodes import (
    _is_room_change_request,
    _is_summary_confirmation_transcript,
    _is_summary_modify_transcript,
    _looks_like_check_in_request,
)

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
