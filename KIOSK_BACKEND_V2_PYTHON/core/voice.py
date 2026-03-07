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

def normalize_language_code(lang: str) -> str:
    """Helper to ensure language code is formatted correctly."""
    if not lang:
        return "en-IN"
    lang = lang.lower().strip()
    if lang.startswith("hi"):
        return "hi-IN"
    return "en-IN"

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
            
        lang_code = "hi-IN" if language.startswith("hi") else "en-IN"
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
        Converts text to speech using Sarvam TTS.
        Returns the raw audio bytes (WAV format).
        """
        if not sarvam_client:
            raise ValueError("[Voice] SarvamAI client not initialized")
            
        lang_code = "hi-IN" if language.startswith("hi") else "en-IN"

        try:
            response = sarvam_client.text_to_speech.convert(
                text=text,
                target_language_code=lang_code,
                model="bulbul:v2",
                speaker="anushka", # From the test script that worked
            )
            
            # The client returns an iterator of chunks. Need to convert correctly.
            audio_bytes = b"".join(_chunk_to_bytes(chunk) for chunk in response)
            return audio_bytes
            
        except Exception as e:
            print(f"[Voice] Sarvam TTS failed: {e}")
            raise e
