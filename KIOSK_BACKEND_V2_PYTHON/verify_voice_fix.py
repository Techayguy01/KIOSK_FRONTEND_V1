
import os
import sys
from dotenv import load_dotenv

# Add current dir to path for imports
sys.path.append(os.path.abspath(os.getcwd()))

from core.voice import VoiceProvider

load_dotenv()

def test_extraction():
    log_file = "verify_log.txt"
    def log(msg):
        print(msg)
        with open(log_file, "a") as f:
            f.write(msg + "\n")
            
    log("[Test] Verifying robust audio extraction...")
    try:
        # We test with a short string to avoid high credit usage
        audio_bytes = VoiceProvider.generate_speech("Success.", language="en")
        
        log(f"[Test] Result size: {len(audio_bytes)} bytes")
        
        if len(audio_bytes) > 1000:
            log("[Test] ✅ SUCCESS: Audio data looks valid (large enough).")
            with open("final_extraction_test.wav", "wb") as f:
                f.write(audio_bytes)
        else:
            log(f"[Test] ❌ FAILURE: Result still too small ({len(audio_bytes)} bytes)")
                
    except Exception as e:
        log(f"[Test] ❌ ERROR: {e}")

if __name__ == "__main__":
    test_extraction()
