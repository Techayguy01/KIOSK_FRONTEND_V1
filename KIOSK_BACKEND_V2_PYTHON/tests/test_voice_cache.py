from core.voice import _build_tts_cache_key, _normalize_tenant_scope


def test_tts_cache_key_is_tenant_scoped():
    key_a = _build_tts_cache_key("Hello world", "en", "tenant-a")
    key_b = _build_tts_cache_key("Hello world", "en", "tenant-b")
    assert key_a != key_b


def test_tts_cache_key_is_stable_for_same_tenant():
    key_a = _build_tts_cache_key("Hello world", "en", "tenant-a")
    key_b = _build_tts_cache_key("Hello world", "en", "tenant-a")
    assert key_a == key_b


def test_blank_tenant_scope_defaults_to_global():
    assert _normalize_tenant_scope(None) == "global"
    assert _normalize_tenant_scope("") == "global"
    assert _build_tts_cache_key("Hello world", "en", None) == _build_tts_cache_key("Hello world", "en", "")
