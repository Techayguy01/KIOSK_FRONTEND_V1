import pytest

from services.transcript_understanding import (
    looks_like_room_discovery_repairable,
    repair_transcript_for_routing,
)


@pytest.mark.parametrize(
    ("transcript", "expected"),
    [
        (
            "i want room for what hotel rooms are available",
            "what rooms are available in this hotel",
        ),
        (
            "what hotel rooms are available in this",
            "what rooms are available in this hotel",
        ),
        (
            "what hotel rooms are available in this hotel",
            "what rooms are available in this hotel",
        ),
        (
            "what rooms are available in this hotel",
            "what rooms are available in this hotel",
        ),
    ],
)
def test_repair_transcript_for_routing_handles_voice_room_discovery_noise(transcript, expected):
    assert repair_transcript_for_routing(transcript) == expected


@pytest.mark.parametrize(
    "transcript",
    [
        "i want room for what hotel rooms are available",
        "what hotel rooms are available in this",
        "what hotel rooms are available in this hotel",
    ],
)
def test_looks_like_room_discovery_repairable_for_logged_voice_failures(transcript):
    assert looks_like_room_discovery_repairable(transcript) is True


def test_looks_like_room_discovery_repairable_does_not_mark_general_faq_as_room_browse():
    assert looks_like_room_discovery_repairable("what time is breakfast in this hotel") is False
