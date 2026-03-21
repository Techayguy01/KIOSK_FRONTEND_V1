from agent.stt_normalizer import is_filler_only, normalize_for_routing


def test_normalize_virtual_true_to_virtual_tour():
    normalized, is_filler = normalize_for_routing("virtual true of rooms")
    assert is_filler is False
    assert normalized == "virtual tour of rooms"


def test_normalize_check_een():
    normalized, is_filler = normalize_for_routing("check een please")
    assert is_filler is False
    assert normalized == "check in please"


def test_filler_only_short_circuits():
    normalized, is_filler = normalize_for_routing("umm")
    assert is_filler is True
    assert normalized == "umm"
    assert is_filler_only("hmm") is True
