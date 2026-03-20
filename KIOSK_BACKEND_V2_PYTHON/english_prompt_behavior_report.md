# English Prompt Behavior Report

- Generated at: 2026-03-20T10:54:57
- Base URL: `http://localhost:8000`
- Health payload: `{"status": "ok", "version": "2.0.0", "model": "LangGraph + LiteLLM"}`

## Summary

- Total scenarios: 17
- Pass: 9
- Warn: 8
- Fail: 0

## Key Findings

- Room-preview detail questions are not consistently staying in ROOM_PREVIEW, which can break the sense of a focused room tour.
- Combined booking-detail turns are not reliably treated as slot-filling inputs, which risks pushing customers back into room discovery.
- Summary confirmation is not reliably advancing to PAYMENT, so the final conversion step is still unstable.
- Selecting a named room from ROOM_SELECT can jump straight into BOOKING_COLLECT, skipping the preview experience.

## Scenario Results

| Verdict | Mode | Category | State | Prompt | Route | Intent | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PASS | single_turn | Check-in | WELCOME | Hi, I already have a reservation and I want to check in. | SCAN_ID | CHECK_IN | screen=SCAN_ID intent=CHECK_IN |
| PASS | single_turn | Room discovery | WELCOME | Can you show me your available rooms? I need something affordable for two adults. | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Hotel FAQ | WELCOME | What time is breakfast and do you offer free Wi-Fi? | WELCOME | GENERAL_QUERY | screen=WELCOME intent=GENERAL_QUERY |
| WARN | single_turn | Room discovery | WELCOME | We are a family of four. Which room should we look at? | WELCOME | GENERAL_QUERY | expected_screens=['ROOM_SELECT'] expected_intents=['BOOK_ROOM', 'BOOK_ROOM_SELECTED', 'GEN... |
| PASS | single_turn | Pricing | ROOM_SELECT | What is your cheapest room tonight? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Comparison | ROOM_SELECT | Can you compare the Deluxe King and the Family Suite for me? | ROOM_SELECT | GENERAL_QUERY | screen=ROOM_SELECT intent=GENERAL_QUERY |
| WARN | single_turn | Room preview | ROOM_PREVIEW | Does this room have a balcony or a city view? | ROOM_SELECT | GENERAL_QUERY | expected_screens=['ROOM_PREVIEW', 'BOOKING_COLLECT'] expected_intents=['ASK_ROOM_DETAIL', ... |
| PASS | single_turn | Room preview | ROOM_PREVIEW | Show me a different room option instead. | ROOM_SELECT | MODIFY_BOOKING | screen=ROOM_SELECT intent=MODIFY_BOOKING |
| WARN | single_turn | Booking collection | BOOKING_COLLECT | My name is John Carter. There will be two adults and one child. We want to check in tomorr... | ROOM_SELECT | CHECK_IN | expected_screens=['BOOKING_COLLECT', 'BOOKING_SUMMARY'] expected_intents=['PROVIDE_NAME', ... |
| WARN | single_turn | Booking collection | BOOKING_COLLECT | Actually change the stay to next Friday for three nights. | ROOM_SELECT | PROVIDE_DATES | expected_screens=['BOOKING_COLLECT', 'BOOKING_SUMMARY'] expected_intents=['MODIFY_BOOKING'... |
| WARN | single_turn | Booking summary | BOOKING_SUMMARY | Yes, those details are correct. Please proceed to payment. | BOOKING_COLLECT | CONFIRM_BOOKING | expected_screens=['PAYMENT', 'BOOKING_SUMMARY'] expected_intents=['CONFIRM_BOOKING', 'CONF... |
| WARN | single_turn | Booking summary | BOOKING_SUMMARY | I need to change the guest name before paying. | ROOM_SELECT | MODIFY_BOOKING | expected_screens=['BOOKING_COLLECT', 'BOOKING_SUMMARY'] expected_intents=['MODIFY_BOOKING'... |
| PASS | multi_turn_flow | Flow booking journey | WELCOME | I would like to book a room for my family. | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| WARN | multi_turn_flow | Flow booking journey | ROOM_SELECT | Please show me the Family Suite. | BOOKING_COLLECT | BOOK_ROOM | expected_screens=['ROOM_PREVIEW', 'ROOM_SELECT'] expected_intents=['ROOM_SELECTED', 'BOOK_... |
| PASS | multi_turn_flow | Flow booking journey | BOOKING_COLLECT | This looks good. I want to book this room. | BOOKING_COLLECT | BOOK_ROOM | screen=BOOKING_COLLECT intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow booking journey | BOOKING_COLLECT | The booking is for John Carter, two adults and two children, checking in tomorrow for two ... | BOOKING_SUMMARY | PROVIDE_NAME | screen=BOOKING_SUMMARY intent=PROVIDE_NAME |
| WARN | multi_turn_flow | Flow booking journey | BOOKING_SUMMARY | Yes, everything is correct. Proceed to payment. | BOOKING_COLLECT | CONFIRM_BOOKING | expected_screens=['PAYMENT', 'BOOKING_SUMMARY'] expected_intents=['CONFIRM_BOOKING', 'CONF... |

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
- Speech: "We have 3 room options: the Deluxe King at INR 6499 for up to 2 guests, the Family Suite at INR 8999 for up to 4 guests, and the Premium Twin at INR 7299 for up to 2 guests. Which one interests you?"
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

- Verdict: WARN
- Mode: single_turn
- Category: Room discovery
- Input state: `WELCOME`
- Prompt: "We are a family of four. Which room should we look at?"
- Route: `WELCOME`
- Intent: `GENERAL_QUERY`
- Confidence: `1.0`
- Speech: "I'm sorry, I don't have that hotel detail right now, but I'm happy to help with your booking or another question."
- Note: expected_screens=['ROOM_SELECT'] expected_intents=['BOOK_ROOM', 'BOOK_ROOM_SELECTED', 'GENERAL_QUERY'] actual_screen=WELCOME actual_intent=GENERAL_QUERY

### room_select_cheapest_room

- Verdict: PASS
- Mode: single_turn
- Category: Pricing
- Input state: `ROOM_SELECT`
- Prompt: "What is your cheapest room tonight?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.9`
- Speech: "We have 3 room options: the Deluxe King at INR 6499 for up to 2 guests, the Family Suite at INR 8999 for up to 4 guests, and the Premium Twin at INR 7299 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM

### room_select_compare_rooms

- Verdict: PASS
- Mode: single_turn
- Category: Comparison
- Input state: `ROOM_SELECT`
- Prompt: "Can you compare the Deluxe King and the Family Suite for me?"
- Route: `ROOM_SELECT`
- Intent: `GENERAL_QUERY`
- Confidence: `0.9`
- Speech: "The Deluxe King is a room for up to 2 adults, priced at 6499 INR, while the Family Suite can accommodate up to 4 adults and costs 8999 INR. We have 3 room options available. Which one of these suits your needs or would you like to know more about another room?"
- Note: screen=ROOM_SELECT intent=GENERAL_QUERY

### room_preview_amenity_question

- Verdict: WARN
- Mode: single_turn
- Category: Room preview
- Input state: `ROOM_PREVIEW`
- Prompt: "Does this room have a balcony or a city view?"
- Route: `ROOM_SELECT`
- Intent: `GENERAL_QUERY`
- Confidence: `1.0`
- Speech: "We have 3 room options available. Our Deluxe King and Premium Twin rooms are priced at 6499 and 7299 INR respectively, and can accommodate up to 2 adults. Would you like to know more about one of these rooms or see all options?"
- Note: expected_screens=['ROOM_PREVIEW', 'BOOKING_COLLECT'] expected_intents=['ASK_ROOM_DETAIL', 'GENERAL_QUERY', 'ROOM_SELECTED'] actual_screen=ROOM_SELECT actual_intent=GENERAL_QUERY

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

- Verdict: WARN
- Mode: single_turn
- Category: Booking collection
- Input state: `BOOKING_COLLECT`
- Prompt: "My name is John Carter. There will be two adults and one child. We want to check in tomorrow for two nights."
- Route: `ROOM_SELECT`
- Intent: `CHECK_IN`
- Confidence: `0.97`
- Speech: "Hello John Carter, I have you checking in tomorrow for two nights with two adults and one child. We have three room options available, including the Deluxe King for 6499 INR per night for up to two adults. Which room type would you prefer?"
- Note: expected_screens=['BOOKING_COLLECT', 'BOOKING_SUMMARY'] expected_intents=['PROVIDE_NAME', 'PROVIDE_DATES', 'PROVIDE_GUESTS', 'CONFIRM_BOOKING'] actual_screen=ROOM_SELECT actual_intent=CHECK_IN

### booking_collect_change_dates

- Verdict: WARN
- Mode: single_turn
- Category: Booking collection
- Input state: `BOOKING_COLLECT`
- Prompt: "Actually change the stay to next Friday for three nights."
- Route: `ROOM_SELECT`
- Intent: `PROVIDE_DATES`
- Confidence: `0.482`
- Speech: "You'd like to stay from next Friday for three nights. We have 3 room options available, including the Deluxe King for 6499 INR per night for up to 2 adults. Which room type would you prefer?"
- Note: expected_screens=['BOOKING_COLLECT', 'BOOKING_SUMMARY'] expected_intents=['MODIFY_BOOKING', 'PROVIDE_DATES'] actual_screen=ROOM_SELECT actual_intent=PROVIDE_DATES

### booking_summary_confirm_payment

- Verdict: WARN
- Mode: single_turn
- Category: Booking summary
- Input state: `BOOKING_SUMMARY`
- Prompt: "Yes, those details are correct. Please proceed to payment."
- Route: `BOOKING_COLLECT`
- Intent: `CONFIRM_BOOKING`
- Confidence: `0.9`
- Speech: "Certainly. We currently have 3 room options available, each with different amenities and room details. Deluxe King is available for INR 6499 and is suited for up to 2 adults. Family Suite is available for INR 8999 and is suited for up to 4 adults. I also have 1 more option available if you'd like to..."
- Note: expected_screens=['PAYMENT', 'BOOKING_SUMMARY'] expected_intents=['CONFIRM_BOOKING', 'CONFIRM_PAYMENT'] actual_screen=BOOKING_COLLECT actual_intent=CONFIRM_BOOKING

### booking_summary_modify_request

- Verdict: WARN
- Mode: single_turn
- Category: Booking summary
- Input state: `BOOKING_SUMMARY`
- Prompt: "I need to change the guest name before paying."
- Route: `ROOM_SELECT`
- Intent: `MODIFY_BOOKING`
- Confidence: `0.96`
- Speech: "You haven't chosen a room yet. We have 3 room options available. The Deluxe King is 6499 INR and can accommodate 2 adults. Which room would you like to book?"
- Note: expected_screens=['BOOKING_COLLECT', 'BOOKING_SUMMARY'] expected_intents=['MODIFY_BOOKING'] actual_screen=ROOM_SELECT actual_intent=MODIFY_BOOKING

### flow_step_1_browse_rooms

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow booking journey
- Input state: `WELCOME`
- Prompt: "I would like to book a room for my family."
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.855`
- Speech: "We have 3 room options: the Deluxe King at INR 6499 for up to 2 guests, the Family Suite at INR 8999 for up to 4 guests, and the Premium Twin at INR 7299 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM

### flow_step_2_select_family_suite

- Verdict: WARN
- Mode: multi_turn_flow
- Category: Flow booking journey
- Input state: `ROOM_SELECT`
- Prompt: "Please show me the Family Suite."
- Route: `BOOKING_COLLECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.485`
- Speech: "Great choice. Family Suite is available at INR 8999 per night for up to 4 adults. How many adults will be staying?"
- Note: expected_screens=['ROOM_PREVIEW', 'ROOM_SELECT'] expected_intents=['ROOM_SELECTED', 'BOOK_ROOM', 'SELECT_ROOM'] actual_screen=BOOKING_COLLECT actual_intent=BOOK_ROOM

### flow_step_3_start_booking

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow booking journey
- Input state: `BOOKING_COLLECT`
- Prompt: "This looks good. I want to book this room."
- Route: `BOOKING_COLLECT`
- Intent: `BOOK_ROOM`
- Confidence: `1.0`
- Speech: "Great choice. Family Suite is available at INR 8999 per night for up to 4 adults. How many adults will be staying?"
- Note: screen=BOOKING_COLLECT intent=BOOK_ROOM

### flow_step_4_fill_details

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow booking journey
- Input state: `BOOKING_COLLECT`
- Prompt: "The booking is for John Carter, two adults and two children, checking in tomorrow for two nights."
- Route: `BOOKING_SUMMARY`
- Intent: `PROVIDE_NAME`
- Confidence: `0.8`
- Speech: "Thank you, The Booking Is For John Carter, Two Adults And Two Children, Checking In Tomorrow For Two Nights. Let me pull up your booking summary."
- Note: screen=BOOKING_SUMMARY intent=PROVIDE_NAME

### flow_step_5_confirm_summary

- Verdict: WARN
- Mode: multi_turn_flow
- Category: Flow booking journey
- Input state: `BOOKING_SUMMARY`
- Prompt: "Yes, everything is correct. Proceed to payment."
- Route: `BOOKING_COLLECT`
- Intent: `CONFIRM_BOOKING`
- Confidence: `0.9`
- Speech: "Certainly. Family Suite is a lovely choice. How many adults will be staying?"
- Note: expected_screens=['PAYMENT', 'BOOKING_SUMMARY'] expected_intents=['CONFIRM_BOOKING', 'CONFIRM_PAYMENT'] actual_screen=BOOKING_COLLECT actual_intent=CONFIRM_BOOKING
