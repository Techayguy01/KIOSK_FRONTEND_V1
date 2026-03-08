
import json
import os
from dotenv import load_dotenv
from agent.nodes import route_intent
from agent.state import KioskState

load_dotenv()

def test_intent():
    log_file = "intent_verification_log.txt"
    def log(msg):
        print(msg)
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(msg + "\n")

    log("--- Intent Verification Test ---")
    
    # Test case: Mid-sentence correction
    test_transcript = "Mujhe second date aur check out sorry check in"
    log(f"Testing Transcript: '{test_transcript}'")
    
    state = KioskState(
        session_id="test-session-123",
        latest_transcript=test_transcript,
        current_ui_screen="WELCOME",
        language="hi"
    )
    
    try:
        res = route_intent(state)
        log(f"Resolved Intent: {res.get('resolved_intent')}")
        log(f"Confidence: {res.get('confidence')}")
        
        if res.get('resolved_intent') == 'CHECK_IN':
            log("✅ SUCCESS: Correctly identified CHECK_IN after correction.")
        else:
            log(f"❌ FAILURE: Got {res.get('resolved_intent')} instead of CHECK_IN.")
            
    except Exception as e:
        log(f"❌ ERROR: {e}")

if __name__ == "__main__":
    test_intent()
