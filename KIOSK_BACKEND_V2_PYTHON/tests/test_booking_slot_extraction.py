from datetime import date, timedelta

from agent.nodes import (
    _extract_dates_deterministically,
    _extract_guest_counts_deterministically,
    _extract_guest_name_deterministically,
)


def test_stt_style_compound_booking_turn_extracts_all_slots():
    transcript = "to adults one child check and it is today check out it is tomorrow and guest name is tanay"

    guests = _extract_guest_counts_deterministically(transcript)
    dates = _extract_dates_deterministically(transcript)
    guest_name = _extract_guest_name_deterministically(transcript)

    assert guests == {"children": 1, "adults": 2}
    assert dates == {
        "check_in_date": date.today().isoformat(),
        "check_out_date": (date.today() + timedelta(days=1)).isoformat(),
    }
    assert guest_name == "Tanay"
