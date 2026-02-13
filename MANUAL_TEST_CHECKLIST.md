# Voice-First Booking — Manual Test Checklist

## Prerequisites
- [ ] Backend running: `cd backend && npm run dev`
- [ ] Frontend running: `cd frontend && npm run dev`
- [ ] Microphone connected and working
- [ ] Browser at http://localhost:3000

## Test A: Happy Path (Voice Only)
1. [ ] Touch screen to wake from IDLE → WELCOME appears
2. [ ] Say "I want to book a room" → navigates to ROOM_SELECT
3. [ ] Say "Tell me about the deluxe suite" → system describes it
4. [ ] Say "I'll take that one" → navigates to BOOKING_COLLECT
5. [ ] Verify: Chat conversation visible on left, booking card on right
6. [ ] System asks "How many guests?" → Say "Two adults"
7. [ ] Verify: Adults slot fills to "2" on booking card
8. [ ] System asks for dates → Say "Tomorrow to the 15th"
9. [ ] Verify: Check-in and check-out slots fill
10. [ ] System asks for name → Say "John Smith"
11. [ ] Verify: All slots filled, progress bar at 100%
12. [ ] System reads summary → Say "Yes, confirm"
13. [ ] Navigates to BOOKING_SUMMARY page
14. [ ] Verify: All details correct on summary card
15. [ ] Say "Confirm" or tap "Confirm & Pay" → navigates to PAYMENT

## Test B: Compound Statement
1. [ ] Say "Book the standard room for 2 adults, 3 nights starting tomorrow, name is Jane"
2. [ ] Verify: Multiple slots fill simultaneously
3. [ ] Verify: System asks only for remaining slots (if any)

## Test C: Correction
1. [ ] During booking, say "Two adults"
2. [ ] Then say "Actually, make that three adults"
3. [ ] Verify: Adults slot updates from 2 → 3
4. [ ] Verify: Slot briefly highlights (amber) to show change
5. [ ] Verify: Other slots remain unchanged

## Test D: Context Question
1. [ ] During booking (mid-slot-fill), ask "What time is breakfast?"
2. [ ] Verify: System answers the question
3. [ ] Verify: System returns to asking for next slot
4. [ ] Verify: Previously filled slots are NOT lost

## Test E: Cancel and Restart
1. [ ] Start a booking, fill some slots
2. [ ] Say "Cancel" or "Start over"
3. [ ] Verify: Returns to ROOM_SELECT (or WELCOME)
4. [ ] Verify: Previous booking data is cleared

## Test F: Go Back
1. [ ] From BOOKING_COLLECT, say "Go back"
2. [ ] Verify: Returns to ROOM_SELECT
3. [ ] From BOOKING_SUMMARY, tap "Modify"
4. [ ] Verify: Returns to BOOKING_COLLECT with slots preserved

## Test G: Silence Handling
1. [ ] Enter BOOKING_COLLECT and stay silent
2. [ ] After ~5 seconds: System gives gentle nudge
3. [ ] After ~15 seconds: System suggests touch screen
4. [ ] After ~45 seconds: Returns to IDLE

## Test H: Low Confidence
1. [ ] Mumble or speak unclearly
2. [ ] Verify: System asks to repeat (not crash)
3. [ ] Speak clearly on second attempt
4. [ ] Verify: System recovers and continues

## Test I: Privacy
1. [ ] Complete a booking (or partially fill one)
2. [ ] Return to WELCOME/IDLE
3. [ ] Start new interaction
4. [ ] Verify: NO data from previous session persists
5. [ ] Ask "What's my name?" → System should NOT know

## Test J: Touch Fallback
1. [ ] Verify "Cancel Booking" button works on BookingCollectPage
2. [ ] Verify "Modify" and "Confirm & Pay" buttons work on BookingSummaryPage
3. [ ] All voice-triggered actions should also have touch equivalents

---

## Test Results

**Date:** _______________  
**Tester:** _______________  
**Pass Rate:** _____ / 10 tests passed

**Notes:**
