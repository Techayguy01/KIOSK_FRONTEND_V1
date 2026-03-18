"""
Tests for room name matching and fuzzy resolution in agent/nodes.py.
"""

import pytest

from agent.nodes import (
    _extract_room_candidate_from_transcript,
    _find_room_from_inventory,
    _normalize_text,
    find_best_room_match,
)
from agent.state import RoomInventoryItem


def _make_room(name: str, code: str = "", room_id: str = "test-id") -> RoomInventoryItem:
    return RoomInventoryItem(id=room_id, name=name, code=code, price=100.0, currency="INR")


MOCK_INVENTORY = [
    _make_room("Deluxe Ocean View", "DOV", "r1"),
    _make_room("Executive Suite", "ES", "r2"),
    _make_room("Standard Queen", "SQ", "r3"),
]


class TestNormalizeText:
    def test_sweet_to_suite(self):
        assert "suite" in _normalize_text("Executive Sweet")

    def test_luxary_to_luxury(self):
        assert "luxury" in _normalize_text("Luxary Room")

    def test_lowercases(self):
        assert _normalize_text("HELLO") == "hello"

    def test_strips(self):
        assert _normalize_text("  room  ") == "room"


class TestFuzzyRoomMatch:
    def test_exact_match(self):
        result = find_best_room_match(
            "Deluxe Ocean View",
            ["Deluxe Ocean View", "Executive Suite"],
        )
        assert result == "Deluxe Ocean View"

    def test_case_insensitive(self):
        result = find_best_room_match(
            "deluxe ocean view",
            ["Deluxe Ocean View", "Executive Suite"],
        )
        assert result == "Deluxe Ocean View"

    def test_close_match(self):
        result = find_best_room_match(
            "Deluxe Ocen View",
            ["Deluxe Ocean View", "Executive Suite"],
        )
        assert result == "Deluxe Ocean View"

    def test_no_match(self):
        result = find_best_room_match(
            "Presidential Penthouse",
            ["Deluxe Ocean View", "Executive Suite"],
        )
        assert result is None


class TestExtractRoomCandidate:
    @pytest.mark.parametrize(
        ("transcript", "expected_substring"),
        [
            ("I want to book Deluxe Ocean View", "deluxe ocean view"),
            ("book Executive Suite", "executive suite"),
            ("please select Standard Queen", "standard queen"),
            ("I would like to book the Executive Suite", "executive suite"),
        ],
    )
    def test_extraction(self, transcript, expected_substring):
        result = _extract_room_candidate_from_transcript(transcript)
        assert expected_substring in result.lower()


class TestFindRoomFromInventory:
    def test_exact_name(self):
        result = _find_room_from_inventory(MOCK_INVENTORY, "Deluxe Ocean View")
        assert result is not None
        assert result.name == "Deluxe Ocean View"

    def test_by_code(self):
        result = _find_room_from_inventory(MOCK_INVENTORY, "DOV")
        assert result is not None
        assert result.name == "Deluxe Ocean View"

    def test_fuzzy_name(self):
        result = _find_room_from_inventory(MOCK_INVENTORY, "Deluxe Ocen View")
        assert result is not None
        assert result.name == "Deluxe Ocean View"

    def test_generic_word_rejected(self):
        result = _find_room_from_inventory(MOCK_INVENTORY, "room")
        assert result is None

    def test_empty_input(self):
        result = _find_room_from_inventory(MOCK_INVENTORY, "")
        assert result is None

    def test_no_inventory(self):
        result = _find_room_from_inventory([], "Deluxe Ocean View")
        assert result is None


class TestSTTMisspellings:
    """Tests for speech-to-text errors that commonly occur in voice input."""

    @pytest.mark.parametrize(
        ("misspelled", "expected_name"),
        [
            ("Delux Ocean View", "Deluxe Ocean View"),
            ("Deluxe Ocen View", "Deluxe Ocean View"),
            ("Executive Sweet", "Executive Suite"),
            ("Executiv Suite", "Executive Suite"),
            ("Standerd Queen", "Standard Queen"),
            ("Standard Qeen", "Standard Queen"),
        ],
    )
    def test_fuzzy_misspellings(self, misspelled, expected_name):
        result = _find_room_from_inventory(MOCK_INVENTORY, misspelled)
        assert result is not None
        assert result.name == expected_name


class TestPartialRoomNames:
    """Tests for partial or abbreviated room names."""

    @pytest.mark.parametrize("partial", ["suite", "room", "rooms"])
    def test_generic_words_rejected(self, partial):
        result = _find_room_from_inventory(MOCK_INVENTORY, partial)
        assert result is None

    def test_code_case_insensitive(self):
        result = _find_room_from_inventory(MOCK_INVENTORY, "dov")
        assert result is not None
        assert result.name == "Deluxe Ocean View"

    def test_code_uppercase(self):
        result = _find_room_from_inventory(MOCK_INVENTORY, "ES")
        assert result is not None
        assert result.name == "Executive Suite"

    def test_code_mixed_case(self):
        result = _find_room_from_inventory(MOCK_INVENTORY, "Sq")
        assert result is not None
        assert result.name == "Standard Queen"


class TestExtractRoomCandidateEdgeCases:
    @pytest.mark.parametrize(
        ("transcript", "should_contain"),
        [
            ("choose the Executive Suite please", "executive suite"),
            ("take the Standard Queen", "standard queen"),
            ("prefer Deluxe Ocean View", "deluxe ocean view"),
            ("can i have Executive Suite", "executive suite"),
            ("I need a Standard Queen room", "standard queen"),
            ("give me the Deluxe Ocean View", "deluxe ocean view"),
        ],
    )
    def test_various_prefixes(self, transcript, should_contain):
        result = _extract_room_candidate_from_transcript(transcript)
        assert should_contain in result.lower()


class TestFuzzyRoomMatchEdgeCases:
    def test_empty_candidates(self):
        result = find_best_room_match("anything", [])
        assert result is None

    def test_empty_extracted(self):
        result = find_best_room_match("", ["Deluxe Ocean View"])
        assert result is None

    def test_none_extracted(self):
        result = find_best_room_match(None, ["Deluxe Ocean View"])
        assert result is None
