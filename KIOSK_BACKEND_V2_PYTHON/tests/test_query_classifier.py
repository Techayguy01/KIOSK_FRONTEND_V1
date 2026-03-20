import pytest

from services.query_classifier import classify_query_type


@pytest.mark.parametrize(
    ("transcript", "screen", "expected"),
    [
        ("What time is breakfast and do you offer free Wi-Fi?", "WELCOME", "FAQ_INFO"),
        ("I already have a reservation and I want to check in.", "WELCOME", "CHECK_IN"),
        ("We are a family of four. Which room should we look at?", "WELCOME", "ROOM_DISCOVERY"),
        ("What hotel rooms are available in this hotel", "WELCOME", "ROOM_DISCOVERY"),
        (
            "Which one is better for four adults, Budget Deluxe Room or Grand Luxury Suite?",
            "ROOM_SELECT",
            "ROOM_COMPARISON",
        ),
        ("Does this room have a balcony or a city view?", "ROOM_PREVIEW", "ROOM_PREVIEW_QUERY"),
        ("Yes, those details are correct. Please proceed to payment.", "BOOKING_SUMMARY", "BOOKING_FLOW"),
    ],
)
def test_classify_query_type(transcript, screen, expected):
    assert classify_query_type(transcript, screen) == expected
