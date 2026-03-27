"""
core/voice.py

Handles STT and TTS integrations with Sarvam AI, including fallback mechanisms.
For English, STT/TTS is handled on the browser.
For Indian languages (default: Hindi), this module calls Sarvam AI.
"""

import hashlib
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Optional
from time import perf_counter
from dotenv import load_dotenv

load_dotenv()

# Avoid initializing provider SDK clients at import-time. Import-time network/SSL
# setup can block the whole API boot. We lazily create clients only when STT/TTS
# is invoked.
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "").strip() or os.getenv("YOUR_SARVAM_API_KEY", "").strip()

SarvamAI = None
AsyncSarvamAI = None
sarvam_client = None
sarvam_async_client = None


def _get_sarvam_client():
    global SarvamAI, sarvam_client
    if sarvam_client is not None:
        return sarvam_client
    if not SARVAM_API_KEY:
        return None
    try:
        if SarvamAI is None:
            from sarvamai import SarvamAI as _SarvamAI  # type: ignore
            SarvamAI = _SarvamAI
        sarvam_client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
        return sarvam_client
    except Exception as e:
        print(f"[Voice] Failed to init Sarvam client (lazy): {e}")
        sarvam_client = None
        return None


def _get_sarvam_async_client():
    global AsyncSarvamAI, sarvam_async_client
    if sarvam_async_client is not None:
        return sarvam_async_client
    if not SARVAM_API_KEY:
        return None
    try:
        if AsyncSarvamAI is None:
            from sarvamai import AsyncSarvamAI as _AsyncSarvamAI  # type: ignore
            AsyncSarvamAI = _AsyncSarvamAI
        sarvam_async_client = AsyncSarvamAI(api_subscription_key=SARVAM_API_KEY)
        return sarvam_async_client
    except Exception as e:
        print(f"[Voice] Failed to init AsyncSarvamAI client (lazy): {e}")
        sarvam_async_client = None
        return None

LANGUAGE_ALIASES = {
    "english": "en",
    "en": "en",
    "en-in": "en",
    "hindi": "hi",
    "hi": "hi",
    "hi-in": "hi",
    "marathi": "mr",
    "mr": "mr",
    "mr-in": "mr",
}

SARVAM_LANGUAGE_CODES = {
    "en": "en-IN",
    "hi": "hi-IN",
    "mr": "mr-IN",
}

TTS_CACHE_TTL_SECONDS = max(0, int(os.getenv("TTS_CACHE_TTL_SECONDS", "3600") or "3600"))
TTS_CACHE_MAX_SIZE = max(1, int(os.getenv("TTS_CACHE_MAX_SIZE", "200") or "200"))


def normalize_language_code(lang: str) -> str:
    """Normalize DB/UI/provider language values to canonical internal codes."""
    normalized = str(lang or "").strip().lower()
    return LANGUAGE_ALIASES.get(normalized, "en")


def normalize_language_list(languages: list[str] | None) -> list[str]:
    normalized = [normalize_language_code(language) for language in (languages or [])]
    deduped: list[str] = []
    for language in normalized:
        if language not in deduped:
            deduped.append(language)
    return deduped


def resolve_sarvam_language_code(lang: str) -> str:
    return SARVAM_LANGUAGE_CODES.get(normalize_language_code(lang), "en-IN")

def _chunk_to_bytes(chunk) -> bytes:
    """Helper to convert the generator yield into raw bytes safely."""
    if chunk is None:
        return b""
    if isinstance(chunk, (bytes, bytearray)):
        return bytes(chunk)
    if isinstance(chunk, str):
        return chunk.encode("latin-1", errors="ignore")
    if isinstance(chunk, (tuple, list)):
        return b"".join(_chunk_to_bytes(part) for part in chunk)
    return b""


@dataclass
class TTSAudioResult:
    audio_bytes: bytes
    cache_status: str


@dataclass
class _TTSCacheEntry:
    audio_bytes: bytes
    expires_at: float


_tts_cache: "OrderedDict[str, _TTSCacheEntry]" = OrderedDict()
_tts_cache_lock = threading.Lock()
_tts_inflight: dict[str, threading.Event] = {}


def _build_tts_cache_key(text: str, language: str) -> str:
    normalized_text = str(text or "").strip()
    normalized_language = normalize_language_code(language)
    digest = hashlib.sha256(f"{normalized_text}|{normalized_language}".encode("utf-8")).hexdigest()
    return digest


def _get_cached_tts_audio(cache_key: str) -> bytes | None:
    if TTS_CACHE_TTL_SECONDS <= 0:
        return None

    now = perf_counter()
    with _tts_cache_lock:
        cached_entry = _tts_cache.get(cache_key)
        if not cached_entry:
            return None
        if cached_entry.expires_at <= now:
            _tts_cache.pop(cache_key, None)
            return None
        _tts_cache.move_to_end(cache_key)
        return cached_entry.audio_bytes


def _store_cached_tts_audio(cache_key: str, audio_bytes: bytes) -> None:
    if TTS_CACHE_TTL_SECONDS <= 0 or not audio_bytes:
        return

    expires_at = perf_counter() + TTS_CACHE_TTL_SECONDS
    with _tts_cache_lock:
        _tts_cache[cache_key] = _TTSCacheEntry(audio_bytes=audio_bytes, expires_at=expires_at)
        _tts_cache.move_to_end(cache_key)
        while len(_tts_cache) > TTS_CACHE_MAX_SIZE:
            _tts_cache.popitem(last=False)


def _purge_expired_tts_cache_entries() -> None:
    if TTS_CACHE_TTL_SECONDS <= 0:
        return

    now = perf_counter()
    with _tts_cache_lock:
        expired_keys = [key for key, entry in _tts_cache.items() if entry.expires_at <= now]
        for key in expired_keys:
            _tts_cache.pop(key, None)


def _run_sarvam_tts_request(text: str, language: str, request_id: Optional[str] = None) -> bytes:
    import urllib.request
    import json
    import base64

    if not SARVAM_API_KEY:
        raise ValueError("[Voice] SARVAM_API_KEY not found in environment")

    lang_code = resolve_sarvam_language_code(language)
    url = "https://api.sarvam.ai/text-to-speech"

    payload = {
        "text": text,
        "target_language_code": lang_code,
        "speaker": "ritu",
        "model": "bulbul:v3"
    }

    headers = {
        "api-subscription-key": SARVAM_API_KEY,
        "Content-Type": "application/json"
    }

    started_at = perf_counter()
    request_label = request_id or "none"
    print(
        "[Voice] Requesting Premium (v3) TTS "
        f"id={request_label} "
        f"lang={lang_code} "
        f"chars={len(text.strip())}"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=15) as response:
        if response.status != 200:
            raise Exception(f"Sarvam API error: {response.status}")

        raw_resp = response.read().decode("utf-8")
        resp_json = json.loads(raw_resp)

        if "audios" in resp_json and len(resp_json["audios"]) > 0:
            b64_str = resp_json["audios"][0]
            audio_bytes = base64.b64decode(b64_str)
            print(
                "[Voice] Premium TTS success "
                f"id={request_label} "
                f"bytes={len(audio_bytes)} "
                f"durationMs={round((perf_counter() - started_at) * 1000, 1)}"
            )
            return audio_bytes

        audio_bytes = raw_resp.encode("latin-1")
        print(
            "[Voice] Premium TTS legacy response "
            f"id={request_label} "
            f"bytes={len(audio_bytes)} "
            f"durationMs={round((perf_counter() - started_at) * 1000, 1)}"
        )
        return audio_bytes

class VoiceProvider:
    """Handles audio processing. Extensible for circuit breakers later."""

    @staticmethod
    async def transcribe_audio(audio_base64: str, language: str = "hi") -> str:
        """
        Transcribes base64 WAV audio to text using Sarvam's streaming WebSocket.
        We stream the audio in one go, flush it, and wait for the result.
        Returns the transcribed text string.
        """
        client = _get_sarvam_async_client()
        if not client:
            raise ValueError("[Voice] AsyncSarvamAI client not initialized")
            
        lang_code = resolve_sarvam_language_code(language)
        transcript = ""
        
        try:
            async with client.speech_to_text_streaming.connect(
                model="saaras:v3",
                mode="codemix",          # Perfect for Hindi + English mix
                language_code=lang_code,
                high_vad_sensitivity=True,
                flush_signal=True        # Demand immediate execution
            ) as ws:
                
                # Send the complete audio payload
                await ws.transcribe(
                    audio=audio_base64,
                    sample_rate=16000,
                    encoding="audio/wav"
                )
                
                # Force immediate processing
                await ws.flush()

                # Read until we get the transcript or reach timeout
                async for message in ws:
                    msg_type = message.get("type", "")
                    if msg_type == "transcript":
                        transcript = message.get("text", "")
                        break
                        
        except Exception as e:
            print(f"[Voice] Sarvam STT failed: {e}")
            raise e

        return transcript.strip()

    @staticmethod
    def generate_speech(text: str, language: str = "hi", request_id: Optional[str] = None) -> TTSAudioResult:
        """
        Converts text to speech using Sarvam TTS (Direct REST API).
        Returns the raw audio bytes (WAV format).
        Uses Bulbul v3 for superior accent handling.
        """
        normalized_text = str(text or "").strip()
        normalized_language = normalize_language_code(language)
        if not normalized_text:
            raise ValueError("[Voice] No text provided for TTS generation")

        _purge_expired_tts_cache_entries()
        cache_key = _build_tts_cache_key(normalized_text, normalized_language)
        cached_audio = _get_cached_tts_audio(cache_key)
        if cached_audio is not None:
            print(
                "[Voice] Cache HIT "
                f"id={request_id or 'none'} "
                f"lang={resolve_sarvam_language_code(normalized_language)} "
                f"bytes={len(cached_audio)}"
            )
            return TTSAudioResult(audio_bytes=cached_audio, cache_status="hit")

        wait_event: threading.Event | None = None
        should_generate = False
        with _tts_cache_lock:
            inflight_event = _tts_inflight.get(cache_key)
            if inflight_event is None:
                inflight_event = threading.Event()
                _tts_inflight[cache_key] = inflight_event
                should_generate = True
            else:
                wait_event = inflight_event

        if not should_generate and wait_event is not None:
            print(
                "[Voice] Cache WAIT "
                f"id={request_id or 'none'} "
                f"waitingFor={cache_key[:12]}"
            )
            wait_event.wait(timeout=20)
            cached_after_wait = _get_cached_tts_audio(cache_key)
            if cached_after_wait is not None:
                print(
                    "[Voice] Cache HIT_AFTER_WAIT "
                    f"id={request_id or 'none'} "
                    f"bytes={len(cached_after_wait)}"
                )
                return TTSAudioResult(audio_bytes=cached_after_wait, cache_status="hit")

        print(
            "[Voice] Cache MISS "
            f"id={request_id or 'none'} "
            f"lang={resolve_sarvam_language_code(normalized_language)} "
            f"chars={len(normalized_text)}"
        )

        try:
            audio_bytes = _run_sarvam_tts_request(
                text=normalized_text,
                language=normalized_language,
                request_id=request_id,
            )
            _store_cached_tts_audio(cache_key, audio_bytes)
            return TTSAudioResult(audio_bytes=audio_bytes, cache_status="miss")
        except Exception as e:
            print(
                "[Voice] Direct Sarvam TTS failed "
                f"id={request_id or 'none'} "
                f"error={e}"
            )
            raise e
        finally:
            with _tts_cache_lock:
                inflight_event = _tts_inflight.pop(cache_key, None)
                if inflight_event is not None:
                    inflight_event.set()
