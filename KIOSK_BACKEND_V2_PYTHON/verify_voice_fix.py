
import os
import sys
from dotenv import load_dotenv

# Add parent dir to path for imports
sys.path.append(os.path.abspath(os.path.join(os.getcwd(), "..")))

from core.voice import VoiceProvider

load_dotenv()

def test_extraction():
    print("[Test] Verifying robust audio extraction...")
    try:
        # We test with a short string to avoid high credit usage
        audio_bytes = VoiceProvider.generate_speech("Success.", language="en")
        
        print(f"[Test] Result size: {len(audio_bytes)} bytes")
        
        if len(audio_bytes) > 1000:
            print("[Test] ✅ SUCCESS: Audio data looks valid (large enough).")
            with open("final_extraction_test.wav", "wb") as f:
                f.write(audio_bytes)
        else:
            print(f"[Test] ❌ FAILURE: Result still too small ({len(audio_bytes)} bytes)")
            if len(audio_bytes) > 0:
                print(f"[Test] Content sample: {audio_bytes[:50]!r}")
                
    except Exception as e:
        print(f"[Test] ❌ ERROR: {e}")

if __name__ == "__main__":
    test_extraction()
