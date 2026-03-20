# English Prompt Behavior Report

- Generated at: 2026-03-20T14:31:54
- Base URL: `http://localhost:8000`
- Health payload: `{"status": "ok", "version": "2.0.0", "model": "LangGraph + LiteLLM"}`
- Tenant tested: `Nagpur Premium Hotel` (`nagpur-premium-hotel-3b832f1b`)
- Tenant ID: `f4992258-e692-4306-bf62-3142858f85a6`
- Live room inventory: `Ocean One View, Luxurious Suite, Budget Deluxe Room, Grand Luxury Suite`

## Summary

- Total scenarios: 17
- Pass: 17
- Warn: 0
- Fail: 0

## Key Findings

- No major behavior regressions were observed in this run.

## Scenario Results

| Verdict | Mode | Category | State | Prompt | Route | Intent | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PASS | single_turn | Check-in | WELCOME | Hi, I already have a reservation and I want to check in. | SCAN_ID | CHECK_IN | screen=SCAN_ID intent=CHECK_IN |
| PASS | single_turn | Room discovery | WELCOME | Can you show me your available rooms? I need something affordable for two adults. | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Hotel FAQ | WELCOME | What time is breakfast and do you offer free Wi-Fi? | WELCOME | GENERAL_QUERY | screen=WELCOME intent=GENERAL_QUERY |
| PASS | single_turn | Room discovery | WELCOME | We are a family of four. Which room should we look at? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Pricing | ROOM_SELECT | What is your cheapest room tonight? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Comparison | ROOM_SELECT | Can you compare the Budget Deluxe Room and the Grand Luxury Suite for me? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Room preview | ROOM_PREVIEW | Does this room have a balcony or a city view? | ROOM_PREVIEW | GENERAL_QUERY | screen=ROOM_PREVIEW intent=GENERAL_QUERY |
| PASS | single_turn | Room preview | ROOM_PREVIEW | Show me a different room option instead. | ROOM_SELECT | MODIFY_BOOKING | screen=ROOM_SELECT intent=MODIFY_BOOKING |
| PASS | single_turn | Booking collection | BOOKING_COLLECT | My name is John Carter. There will be 2 adults and 1 child. We want to check in on May 9 2... | BOOKING_SUMMARY | PROVIDE_NAME | screen=BOOKING_SUMMARY intent=PROVIDE_NAME |
| PASS | single_turn | Booking collection | BOOKING_COLLECT | Actually change the stay to May 24 2032 for 3 nights. | BOOKING_SUMMARY | MODIFY_BOOKING | screen=BOOKING_SUMMARY intent=MODIFY_BOOKING |
| PASS | single_turn | Booking summary | BOOKING_SUMMARY | Yes, those details are correct. Please proceed to payment. | PAYMENT | CONFIRM_BOOKING | screen=PAYMENT intent=CONFIRM_BOOKING |
| PASS | single_turn | Booking summary | BOOKING_SUMMARY | I need to change the guest name before paying. | BOOKING_COLLECT | MODIFY_BOOKING | screen=BOOKING_COLLECT intent=MODIFY_BOOKING |
| PASS | multi_turn_flow | Flow booking journey | WELCOME | We are 4 adults. Which room should we look at? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow booking journey | ROOM_SELECT | Please show me the Grand Luxury Suite. | ROOM_PREVIEW | BOOK_ROOM | screen=ROOM_PREVIEW intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow booking journey | ROOM_PREVIEW | This looks good. I want to book this room. | BOOKING_COLLECT | BOOK_ROOM | screen=BOOKING_COLLECT intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow booking journey | BOOKING_COLLECT | My name is John Carter. There will be 4 adults. We want to check in on July 8 2032 for 2 n... | BOOKING_SUMMARY | PROVIDE_NAME | screen=BOOKING_SUMMARY intent=PROVIDE_NAME |
| PASS | multi_turn_flow | Flow booking journey | BOOKING_SUMMARY | Yes, everything is correct. Proceed to payment. | PAYMENT | CONFIRM_BOOKING | screen=PAYMENT intent=CONFIRM_BOOKING |

## Detailed Responses

### welcome_checkin_existing_reservation

- Verdict: PASS
- Mode: single_turn
- Category: Check-in
- Input state: `WELCOME`
- Prompt: "Hi, I already have a reservation and I want to check in."
- Route: `SCAN_ID`
- Intent: `CHECK_IN`
- Confidence: `0.97`
- Speech: "Sure. Let's begin check in. Please scan your ID to continue."
- Note: screen=SCAN_ID intent=CHECK_IN

### welcome_rooms_budget

- Verdict: PASS
- Mode: single_turn
- Category: Room discovery
- Input state: `WELCOME`
- Prompt: "Can you show me your available rooms? I need something affordable for two adults."
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM

### welcome_hotel_faq

- Verdict: PASS
- Mode: single_turn
- Category: Hotel FAQ
- Input state: `WELCOME`
- Prompt: "What time is breakfast and do you offer free Wi-Fi?"
- Route: `WELCOME`
- Intent: `GENERAL_QUERY`
- Confidence: `1.0`
- Speech: "I'm sorry, I don't have that hotel detail right now, but I'm happy to help with your booking or another question."
- Note: screen=WELCOME intent=GENERAL_QUERY

### welcome_family_room_request

- Verdict: PASS
- Mode: single_turn
- Category: Room discovery
- Input state: `WELCOME`
- Prompt: "We are a family of four. Which room should we look at?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM

### room_select_cheapest_room

- Verdict: PASS
- Mode: single_turn
- Category: Pricing
- Input state: `ROOM_SELECT`
- Prompt: "What is your cheapest room tonight?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.896`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM

### room_select_compare_rooms

- Verdict: PASS
- Mode: single_turn
- Category: Comparison
- Input state: `ROOM_SELECT`
- Prompt: "Can you compare the Budget Deluxe Room and the Grand Luxury Suite for me?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "Budget Deluxe Room is available for INR 999 and suits up to 2 adults. Grand Luxury Suite is available for INR 10000 and suits up to 4 adults. Which one would you like to explore in more detail?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM

### room_preview_amenity_question

- Verdict: PASS
- Mode: single_turn
- Category: Room preview
- Input state: `ROOM_PREVIEW`
- Prompt: "Does this room have a balcony or a city view?"
- Route: `ROOM_PREVIEW`
- Intent: `GENERAL_QUERY`
- Confidence: `0.97`
- Speech: "Absolutely. Let me show you the balcony view in Grand Luxury Suite on screen. Private balcony with comfortable seating and panoramic city and hillside views, perfect for a relaxing stay.. If you'd like, I can continue with your booking whenever you're ready."
- Note: screen=ROOM_PREVIEW intent=GENERAL_QUERY

### room_preview_change_room

- Verdict: PASS
- Mode: single_turn
- Category: Room preview
- Input state: `ROOM_PREVIEW`
- Prompt: "Show me a different room option instead."
- Route: `ROOM_SELECT`
- Intent: `MODIFY_BOOKING`
- Confidence: `0.9`
- Speech: "Of course. Let's take another look at the rooms and find a comfortable option for you."
- Note: screen=ROOM_SELECT intent=MODIFY_BOOKING

### booking_collect_full_details

- Verdict: PASS
- Mode: single_turn
- Category: Booking collection
- Input state: `BOOKING_COLLECT`
- Prompt: "My name is John Carter. There will be 2 adults and 1 child. We want to check in on May 9 2032 for 2 nights."
- Route: `BOOKING_SUMMARY`
- Intent: `PROVIDE_NAME`
- Confidence: `1.0`
- Speech: "Thank you, John Carter. Let me pull up your booking summary."
- Note: screen=BOOKING_SUMMARY intent=PROVIDE_NAME

### booking_collect_change_dates

- Verdict: PASS
- Mode: single_turn
- Category: Booking collection
- Input state: `BOOKING_COLLECT`
- Prompt: "Actually change the stay to May 24 2032 for 3 nights."
- Route: `BOOKING_SUMMARY`
- Intent: `MODIFY_BOOKING`
- Confidence: `0.9`
- Speech: "Thank you, John Carter. Let me pull up your booking summary."
- Note: screen=BOOKING_SUMMARY intent=MODIFY_BOOKING

### booking_summary_confirm_payment

- Verdict: PASS
- Mode: single_turn
- Category: Booking summary
- Input state: `BOOKING_SUMMARY`
- Prompt: "Yes, those details are correct. Please proceed to payment."
- Route: `PAYMENT`
- Intent: `CONFIRM_BOOKING`
- Confidence: `0.97`
- Speech: "Perfect. Your booking details are confirmed. Taking you to payment now."
- Note: screen=PAYMENT intent=CONFIRM_BOOKING

### booking_summary_modify_request

- Verdict: PASS
- Mode: single_turn
- Category: Booking summary
- Input state: `BOOKING_SUMMARY`
- Prompt: "I need to change the guest name before paying."
- Route: `BOOKING_COLLECT`
- Intent: `MODIFY_BOOKING`
- Confidence: `0.96`
- Speech: "May I have the name for this booking?"
- Note: screen=BOOKING_COLLECT intent=MODIFY_BOOKING

### flow_step_1_browse_rooms

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow booking journey
- Input state: `WELCOME`
- Prompt: "We are 4 adults. Which room should we look at?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM

### flow_step_2_select_family_suite

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow booking journey
- Input state: `ROOM_SELECT`
- Prompt: "Please show me the Grand Luxury Suite."
- Route: `ROOM_PREVIEW`
- Intent: `BOOK_ROOM`
- Confidence: `0.512`
- Speech: "Here is the Grand Luxury Suite, available at INR 10000 per night for up to 4 adults. Take a look and let me know if you'd like to book it or see another option."
- Note: screen=ROOM_PREVIEW intent=BOOK_ROOM

### flow_step_3_start_booking

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow booking journey
- Input state: `ROOM_PREVIEW`
- Prompt: "This looks good. I want to book this room."
- Route: `BOOKING_COLLECT`
- Intent: `BOOK_ROOM`
- Confidence: `1.0`
- Speech: "Great choice. Grand Luxury Suite is available at INR 10000 per night for up to 4 adults. How many adults will be staying?"
- Note: screen=BOOKING_COLLECT intent=BOOK_ROOM

### flow_step_4_fill_details

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow booking journey
- Input state: `BOOKING_COLLECT`
- Prompt: "My name is John Carter. There will be 4 adults. We want to check in on July 8 2032 for 2 nights."
- Route: `BOOKING_SUMMARY`
- Intent: `PROVIDE_NAME`
- Confidence: `1.0`
- Speech: "Thank you, John Carter. Let me pull up your booking summary."
- Note: screen=BOOKING_SUMMARY intent=PROVIDE_NAME

### flow_step_5_confirm_summary

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow booking journey
- Input state: `BOOKING_SUMMARY`
- Prompt: "Yes, everything is correct. Proceed to payment."
- Route: `PAYMENT`
- Intent: `CONFIRM_BOOKING`
- Confidence: `0.97`
- Speech: "Perfect. Your booking details are confirmed. Taking you to payment now."
- Note: screen=PAYMENT intent=CONFIRM_BOOKING
