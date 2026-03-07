"""
Quick test to verify the Sarvam AI API key works.
Tests both TTS (text-to-speech) and basic SDK connectivity.
"""

import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("SARVAM_API_KEY", "").strip() or os.getenv("YOUR_SARVAM_API_KEY", "").strip()
print(f"[Test] Sarvam API Key found: {'Yes' if api_key else 'No'} (length: {len(api_key)})")

if not api_key:
    print("[Test] ERROR: No SARVAM_API_KEY in .env")
    raise SystemExit(1)

try:
    from sarvamai import SarvamAI
except Exception as exc:
    print(f"[Test] ERROR: sarvamai SDK not available: {exc}")
    raise SystemExit(1)

client = SarvamAI(api_subscription_key=api_key)


def chunk_to_bytes(chunk):
    if chunk is None:
        return b""
    if isinstance(chunk, (bytes, bytearray)):
        return bytes(chunk)
    if isinstance(chunk, str):
        return chunk.encode("latin-1", errors="ignore")
    if isinstance(chunk, (tuple, list)):
        for part in chunk:
            nested = chunk_to_bytes(part)
            if nested:
                return nested
    return b""


# Test 1: English TTS
print("\n[Test 1] Testing Sarvam TTS (Text to Audio)...")
try:
    response = client.text_to_speech.convert(
        text="Welcome to our hotel. How can I help you today?",
        target_language_code="en-IN",
        model="bulbul:v2",
        speaker="anushka",
    )

    audio_path = "test_tts_output.wav"
    with open(audio_path, "wb") as file_handle:
        for chunk in response:
            file_handle.write(chunk_to_bytes(chunk))

    file_size = os.path.getsize(audio_path)
    print(f"[Test 1] SUCCESS: Audio saved: {audio_path} ({file_size} bytes)")
except Exception as exc:
    print(f"[Test 1] ERROR: {exc}")

# Test 2: Hindi TTS
print("\n[Test 2] Testing Sarvam TTS Hindi (Text to Audio)...")
try:
    response = client.text_to_speech.convert(
        text="Aapka hamare hotel mein swagat hai. Main aapki kaise madad kar sakti hoon?",
        target_language_code="hi-IN",
        model="bulbul:v2",
        speaker="anushka",
    )

    audio_path_hi = "test_tts_hindi_output.wav"
    with open(audio_path_hi, "wb") as file_handle:
        for chunk in response:
            file_handle.write(chunk_to_bytes(chunk))

    file_size = os.path.getsize(audio_path_hi)
    print(f"[Test 2] SUCCESS: Audio saved: {audio_path_hi} ({file_size} bytes)")
except Exception as exc:
    print(f"[Test 2] ERROR: {exc}")

print("\n[Test] All tests complete.")

