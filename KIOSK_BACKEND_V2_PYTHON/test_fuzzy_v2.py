
import asyncio
import os
import json
from agent.nodes import booking_logic
from agent.state import KioskState, BookingSlots

async def test_fuzzy_validation():
    log_path = "test_fuzzy_log.txt"
    def log(msg):
        print(msg)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(msg + "\n")

    if os.path.exists(log_path):
        os.remove(log_path)

    log("--- Fuzzy Room Validation Test ---")
    
    try:
        # Test case: Misheard room type "Supriya" -> "Superior Room"
        test_transcript = "I want a Supriya room"
        log(f"Testing Transcript: '{test_transcript}'")
        
        state = KioskState(
            session_id="test-session-fuzzy",
            latest_transcript=test_transcript,
            current_ui_screen="ROOM_SELECT",
            language="en",
            booking_slots=BookingSlots()
        )
        
        res = await booking_logic(state)
        
        final_slots = res.get('booking_slots').model_dump()
        log(f"Resolved Room: {final_slots.get('room_type')}")
        log(f"Speech: {res.get('speech_response')}")
        
        if final_slots.get('room_type') == "Superior Room":
            log("✅ SUCCESS: 'Supriya' fuzzy matched to 'Superior Room'.")
        else:
            log(f"❌ FAILURE: Got {final_slots.get('room_type')} instead of Superior Room.")

    except Exception as e:
        log(f"❌ ERROR: {e}")
        import traceback
        log(traceback.format_exc())

if __name__ == "__main__":
    asyncio.run(test_fuzzy_validation())
