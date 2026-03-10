"""
core/voice.py

Handles STT and TTS integrations with Sarvam AI, including fallback mechanisms.
For English, STT/TTS is handled on the browser.
For Indian languages (default: Hindi), this module calls Sarvam AI.
"""

import os
import base64
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

# We will initialize Sarvam globally
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "").strip() or os.getenv("YOUR_SARVAM_API_KEY", "").strip()

try:
    from sarvamai import SarvamAI, AsyncSarvamAI
    sarvam_client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
    sarvam_async_client = AsyncSarvamAI(api_subscription_key=SARVAM_API_KEY)
except Exception as e:
    print(f"[Voice] Failed to init Sarvam client: {e}")
    sarvam_client = None
    sarvam_async_client = None

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

class VoiceProvider:
    """Handles audio processing. Extensible for circuit breakers later."""

    @staticmethod
    async def transcribe_audio(audio_base64: str, language: str = "hi") -> str:
        """
        Transcribes base64 WAV audio to text using Sarvam's streaming WebSocket.
        We stream the audio in one go, flush it, and wait for the result.
        Returns the transcribed text string.
        """
        if not sarvam_async_client:
            raise ValueError("[Voice] AsyncSarvamAI client not initialized")
            
        lang_code = resolve_sarvam_language_code(language)
        transcript = ""
        
        try:
            async with sarvam_async_client.speech_to_text_streaming.connect(
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
    def generate_speech(text: str, language: str = "hi") -> bytes:
        """
        Converts text to speech using Sarvam TTS (Direct REST API).
        Returns the raw audio bytes (WAV format).
        Uses Bulbul v3 for superior accent handling.
        """
        import urllib.request
        import json
        import base64

        if not SARVAM_API_KEY:
            raise ValueError("[Voice] SARVAM_API_KEY not found in environment")
            
        lang_code = resolve_sarvam_language_code(language)
        url = "https://api.sarvam.ai/text-to-speech"
        
        # Phase 2 Upgrade: Use Bulbul v3 as suggested
        payload = {
            "text": text,
            "target_language_code": lang_code,
            "speaker": "ritu", # Premium v3 female voice
            "model": "bulbul:v3"
        }
        
        headers = {
            "api-subscription-key": SARVAM_API_KEY,
            "Content-Type": "application/json"
        }

        try:
            print(f"[Voice] Requesting Premium (v3) TTS for: \"{text[:30]}...\"")
            req = urllib.request.Request(
                url, 
                data=json.dumps(payload).encode("utf-8"), 
                headers=headers, 
                method="POST"
            )
            
            with urllib.request.urlopen(req, timeout=15) as response:
                if response.status != 200:
                    raise Exception(f"Sarvam API error: {response.status}")
                
                # Direct REST returns JSON { "audios": ["base64...", ...] }
                raw_resp = response.read().decode("utf-8")
                resp_json = json.loads(raw_resp)
                
                if "audios" in resp_json and len(resp_json["audios"]) > 0:
                    # Sarvam v3 returns a list of base64 strings
                    b64_str = resp_json["audios"][0]
                    return base64.b64decode(b64_str)
                
                # Fallback in case of raw stream (legacy)
                return raw_resp.encode("latin-1")
                
        except Exception as e:
            print(f"[Voice] Direct Sarvam TTS failed: {e}")
            raise e
