
import asyncio
from agent.nodes import booking_logic
from agent.state import KioskState, BookingSlots

async def test_fuzzy_validation():
    print("--- Fuzzy Room Validation Test ---")
    
    # Test case: Misheard room type "Supriya" -> "Superior Room"
    test_transcript = "I want a Supriya room"
    print(f"Testing Transcript: '{test_transcript}'")
    
    state = KioskState(
        session_id="test-session-fuzzy",
        latest_transcript=test_transcript,
        current_ui_screen="ROOM_SELECT",
        language="en",
        booking_slots=BookingSlots()
    )
    
    # Note: booking_logic needs to be called in an async context now
    res = await booking_logic(state)
    
    final_slots = res.get('booking_slots').model_dump()
    print(f"Resolved Room: {final_slots.get('room_type')}")
    print(f"Speech: {res.get('speech_response')}")
    
    if final_slots.get('room_type') == "Superior Room":
        print("✅ SUCCESS: 'Supriya' fuzzy matched to 'Superior Room'.")
    else:
        print(f"❌ FAILURE: Got {final_slots.get('room_type')} instead of Superior Room.")

    # Test case: Unrecognized room type "Sandwich" -> Prompt for clarification
    test_transcript = "I want a sandwich room"
    print(f"\nTesting Transcript: '{test_transcript}'")
    
    state.latest_transcript = test_transcript
    res = await booking_logic(state)
    
    final_slots = res.get('booking_slots').model_dump()
    print(f"Resolved Room: {final_slots.get('room_type')}")
    print(f"Speech: {res.get('speech_response')}")
    
    if final_slots.get('room_type') is None and "prefer" in res.get('speech_response'):
        print("✅ SUCCESS: Rejected unknown room and prompted for options.")
    else:
        print("❌ FAILURE: Did not rejected/prompt correctly.")

if __name__ == "__main__":
    asyncio.run(test_fuzzy_validation())
