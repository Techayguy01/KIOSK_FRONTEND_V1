# English Prompt Variation Report

- Generated at: 2026-03-20T13:43:07
- Base URL: `http://127.0.0.1:8000`
- Tenant tested: `Nagpur Premium Hotel` (`nagpur-premium-hotel-3b832f1b`)
- Tenant ID: `f4992258-e692-4306-bf62-3142858f85a6`
- Room inventory used: `Ocean One View, Luxurious Suite, Budget Deluxe Room, Grand Luxury Suite`

## Test Basis

- Live `/api/chat` requests against the running backend on `localhost:8000`.
- Real kiosk-style payloads with `tenantId`, `tenantSlug`, `x-tenant-slug`, and the live room catalog from `/api/rooms`.
- One fresh baseline run from the existing English harness plus a deeper tenant-aware variation matrix using different English phrasings and two full booking journeys.
- Payment-path validation was done with a real tenant context so booking persistence and room allocation were exercised, not mocked.
- Fresh far-future dates were used for payment scenarios in this rerun to avoid false warnings from previously allocated test bookings on reused dates.

## Summary

- Tenant-aware variation matrix: `28` total, `28` pass, `0` warn, `0` fail.
- Existing baseline harness rerun: `17` total, `15` pass, `2` warn, `0` fail.
- Combined live evidence: `45` total, `43` pass, `2` warn, `0` fail.

## Key Findings

- No major tenant-aware behavior regressions were observed in this run.

## Category Summary

| Category | Total | Pass | Warn | Fail |
| --- | --- | --- | --- | --- |
| Booking collection | 1 | 1 | 0 | 0 |
| Booking collection edit | 1 | 1 | 0 | 0 |
| Check-in | 1 | 1 | 0 | 0 |
| Comparison | 1 | 1 | 0 | 0 |
| Flow::budget_happy_path | 5 | 5 | 0 | 0 |
| Flow::summary_edit_path | 7 | 7 | 0 | 0 |
| Hotel FAQ | 1 | 1 | 0 | 0 |
| Preview booking | 1 | 1 | 0 | 0 |
| Preview detail | 1 | 1 | 0 | 0 |
| Preview navigation | 1 | 1 | 0 | 0 |
| Pricing | 1 | 1 | 0 | 0 |
| Recommendation | 1 | 1 | 0 | 0 |
| Room discovery | 2 | 2 | 0 | 0 |
| Selection | 1 | 1 | 0 | 0 |
| Summary confirm | 1 | 1 | 0 | 0 |
| Summary edit | 1 | 1 | 0 | 0 |
| Summary room change | 1 | 1 | 0 | 0 |

## Scenario Results

| Verdict | Mode | Category | State | Prompt | Route | Intent | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PASS | single_turn | Check-in | WELCOME | I already have a reservation and need to check in. | SCAN_ID | CHECK_IN | screen=SCAN_ID intent=CHECK_IN |
| PASS | single_turn | Room discovery | WELCOME | Can you show me the room options? I need something low-cost for two adults. | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Room discovery | WELCOME | We are four adults. Which room should we consider? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Comparison | WELCOME | Can you compare the Budget Deluxe Room and the Grand Luxury Suite? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Hotel FAQ | WELCOME | What time is breakfast and is Wi-Fi free? | WELCOME | GENERAL_QUERY | screen=WELCOME intent=GENERAL_QUERY |
| PASS | single_turn | Pricing | ROOM_SELECT | Which is your cheapest room? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Recommendation | ROOM_SELECT | Which room fits two adults and one child best? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Selection | ROOM_SELECT | Show me the Budget Deluxe Room. | ROOM_PREVIEW | BOOK_ROOM | screen=ROOM_PREVIEW intent=BOOK_ROOM |
| PASS | single_turn | Preview detail | ROOM_PREVIEW | Does this room have a balcony or a work desk? | ROOM_PREVIEW | GENERAL_QUERY | screen=ROOM_PREVIEW intent=GENERAL_QUERY |
| PASS | single_turn | Preview navigation | ROOM_PREVIEW | Please show me another room instead. | ROOM_SELECT | MODIFY_BOOKING | screen=ROOM_SELECT intent=MODIFY_BOOKING |
| PASS | single_turn | Preview booking | ROOM_PREVIEW | I want to book this room. | BOOKING_COLLECT | BOOK_ROOM | screen=BOOKING_COLLECT intent=BOOK_ROOM |
| PASS | single_turn | Booking collection | BOOKING_COLLECT | My name is Emily Stone. Two adults and one child. We want to check in tomorrow for two nig... | BOOKING_SUMMARY | PROVIDE_NAME | screen=BOOKING_SUMMARY intent=PROVIDE_NAME |
| PASS | single_turn | Booking collection edit | BOOKING_COLLECT | Change the stay to next Friday for three nights. | BOOKING_SUMMARY | PROVIDE_DATES | screen=BOOKING_SUMMARY intent=PROVIDE_DATES |
| PASS | single_turn | Summary edit | BOOKING_SUMMARY | I need to change the guest name before paying. | BOOKING_COLLECT | MODIFY_BOOKING | screen=BOOKING_COLLECT intent=MODIFY_BOOKING |
| PASS | single_turn | Summary room change | BOOKING_SUMMARY | Actually I want to change the room before paying. | ROOM_SELECT | MODIFY_BOOKING | screen=ROOM_SELECT intent=MODIFY_BOOKING |
| PASS | single_turn | Summary confirm | BOOKING_SUMMARY | Everything looks correct. Continue to payment. | PAYMENT | CONFIRM_BOOKING | screen=PAYMENT intent=CONFIRM_BOOKING |
| PASS | multi_turn_flow | Flow::budget_happy_path | WELCOME | Show me available rooms for two adults and one child on a budget. | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow::budget_happy_path | ROOM_SELECT | Please show me the Budget Deluxe Room. | ROOM_PREVIEW | BOOK_ROOM | screen=ROOM_PREVIEW intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow::budget_happy_path | ROOM_PREVIEW | This works for me. I want to book it. | BOOKING_COLLECT | BOOK_ROOM | screen=BOOKING_COLLECT intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow::budget_happy_path | BOOKING_COLLECT | My name is Sarah Bennett. Two adults and one child. Checking in on June 20 2031 for two ni... | BOOKING_SUMMARY | PROVIDE_NAME | screen=BOOKING_SUMMARY intent=PROVIDE_NAME |
| PASS | multi_turn_flow | Flow::budget_happy_path | BOOKING_SUMMARY | Yes, proceed to payment. | PAYMENT | CONFIRM_BOOKING | screen=PAYMENT intent=CONFIRM_BOOKING |
| PASS | multi_turn_flow | Flow::summary_edit_path | WELCOME | I need a room for four adults. | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow::summary_edit_path | ROOM_SELECT | Please show me the Grand Luxury Suite. | ROOM_PREVIEW | BOOK_ROOM | screen=ROOM_PREVIEW intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow::summary_edit_path | ROOM_PREVIEW | I want to book this room. | BOOKING_COLLECT | BOOK_ROOM | screen=BOOKING_COLLECT intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow::summary_edit_path | BOOKING_COLLECT | My name is Daniel Reed. Four adults. Checking in on June 24 2031 for one night. | BOOKING_SUMMARY | PROVIDE_NAME | screen=BOOKING_SUMMARY intent=PROVIDE_NAME |
| PASS | multi_turn_flow | Flow::summary_edit_path | BOOKING_SUMMARY | Actually change the guest name to Priya Reed before paying. | BOOKING_COLLECT | MODIFY_BOOKING | screen=BOOKING_COLLECT intent=MODIFY_BOOKING |
| PASS | multi_turn_flow | Flow::summary_edit_path | BOOKING_COLLECT | The name should be Priya Reed. | BOOKING_SUMMARY | PROVIDE_NAME | screen=BOOKING_SUMMARY intent=PROVIDE_NAME |
| PASS | multi_turn_flow | Flow::summary_edit_path | BOOKING_SUMMARY | Looks good now. Continue to payment. | PAYMENT | CONFIRM_BOOKING | screen=PAYMENT intent=CONFIRM_BOOKING |

## Detailed Responses

### welcome_existing_checkin

- Verdict: PASS
- Mode: single_turn
- Category: Check-in
- Input state: `WELCOME`
- Prompt: "I already have a reservation and need to check in."
- Route: `SCAN_ID`
- Intent: `CHECK_IN`
- Confidence: `0.97`
- Speech: "Sure. Let's begin check in. Please scan your ID to continue."
- Note: screen=SCAN_ID intent=CHECK_IN
- Error: `None`

### welcome_budget_rooms

- Verdict: PASS
- Mode: single_turn
- Category: Room discovery
- Input state: `WELCOME`
- Prompt: "Can you show me the room options? I need something low-cost for two adults."
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### welcome_family_recommendation

- Verdict: PASS
- Mode: single_turn
- Category: Room discovery
- Input state: `WELCOME`
- Prompt: "We are four adults. Which room should we consider?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### welcome_room_comparison

- Verdict: PASS
- Mode: single_turn
- Category: Comparison
- Input state: `WELCOME`
- Prompt: "Can you compare the Budget Deluxe Room and the Grand Luxury Suite?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### welcome_hotel_faq

- Verdict: PASS
- Mode: single_turn
- Category: Hotel FAQ
- Input state: `WELCOME`
- Prompt: "What time is breakfast and is Wi-Fi free?"
- Route: `WELCOME`
- Intent: `GENERAL_QUERY`
- Confidence: `1.0`
- Speech: "I'm sorry, I don't have that hotel detail right now, but I'm happy to help with your booking or another question."
- Note: screen=WELCOME intent=GENERAL_QUERY
- Error: `None`

### room_select_cheapest

- Verdict: PASS
- Mode: single_turn
- Category: Pricing
- Input state: `ROOM_SELECT`
- Prompt: "Which is your cheapest room?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.961`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### room_select_best_fit

- Verdict: PASS
- Mode: single_turn
- Category: Recommendation
- Input state: `ROOM_SELECT`
- Prompt: "Which room fits two adults and one child best?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.902`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### room_select_named_selection

- Verdict: PASS
- Mode: single_turn
- Category: Selection
- Input state: `ROOM_SELECT`
- Prompt: "Show me the Budget Deluxe Room."
- Route: `ROOM_PREVIEW`
- Intent: `BOOK_ROOM`
- Confidence: `0.9`
- Speech: "Here is the Budget Deluxe Room, available at INR 999 per night for up to 2 adults. Take a look and let me know if you'd like to book it or see another option."
- Note: screen=ROOM_PREVIEW intent=BOOK_ROOM
- Error: `None`

### room_preview_amenities

- Verdict: PASS
- Mode: single_turn
- Category: Preview detail
- Input state: `ROOM_PREVIEW`
- Prompt: "Does this room have a balcony or a work desk?"
- Route: `ROOM_PREVIEW`
- Intent: `GENERAL_QUERY`
- Confidence: `0.97`
- Speech: "Absolutely. Let me show you the amenities interior in Budget Deluxe Room on screen. Bedroom / Main Room. If you'd like, I can continue with your booking whenever you're ready."
- Note: screen=ROOM_PREVIEW intent=GENERAL_QUERY
- Error: `None`

### room_preview_other_option

- Verdict: PASS
- Mode: single_turn
- Category: Preview navigation
- Input state: `ROOM_PREVIEW`
- Prompt: "Please show me another room instead."
- Route: `ROOM_SELECT`
- Intent: `MODIFY_BOOKING`
- Confidence: `0.852`
- Speech: "Of course. Let's take another look at the rooms and find a comfortable option for you."
- Note: screen=ROOM_SELECT intent=MODIFY_BOOKING
- Error: `None`

### room_preview_book_this

- Verdict: PASS
- Mode: single_turn
- Category: Preview booking
- Input state: `ROOM_PREVIEW`
- Prompt: "I want to book this room."
- Route: `BOOKING_COLLECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.931`
- Speech: "Great choice. Budget Deluxe Room is available at INR 999 per night for up to 2 adults. How many adults will be staying?"
- Note: screen=BOOKING_COLLECT intent=BOOK_ROOM
- Error: `None`

### booking_collect_compound

- Verdict: PASS
- Mode: single_turn
- Category: Booking collection
- Input state: `BOOKING_COLLECT`
- Prompt: "My name is Emily Stone. Two adults and one child. We want to check in tomorrow for two nights."
- Route: `BOOKING_SUMMARY`
- Intent: `PROVIDE_NAME`
- Confidence: `1.0`
- Speech: "Thank you, Emily Stone. Let me pull up your booking summary."
- Note: screen=BOOKING_SUMMARY intent=PROVIDE_NAME
- Error: `None`

### booking_collect_change_dates

- Verdict: PASS
- Mode: single_turn
- Category: Booking collection edit
- Input state: `BOOKING_COLLECT`
- Prompt: "Change the stay to next Friday for three nights."
- Route: `BOOKING_SUMMARY`
- Intent: `PROVIDE_DATES`
- Confidence: `0.482`
- Speech: "You've chosen to stay in a Budget Deluxe Room. It's priced at 999 INR per night and can accommodate up to 2 adults. Your new stay dates are next Friday for three nights. Is this correct?"
- Note: screen=BOOKING_SUMMARY intent=PROVIDE_DATES
- Error: `None`

### booking_summary_edit_name

- Verdict: PASS
- Mode: single_turn
- Category: Summary edit
- Input state: `BOOKING_SUMMARY`
- Prompt: "I need to change the guest name before paying."
- Route: `BOOKING_COLLECT`
- Intent: `MODIFY_BOOKING`
- Confidence: `0.96`
- Speech: "May I have the name for this booking?"
- Note: screen=BOOKING_COLLECT intent=MODIFY_BOOKING
- Error: `None`

### booking_summary_change_room

- Verdict: PASS
- Mode: single_turn
- Category: Summary room change
- Input state: `BOOKING_SUMMARY`
- Prompt: "Actually I want to change the room before paying."
- Route: `ROOM_SELECT`
- Intent: `MODIFY_BOOKING`
- Confidence: `0.96`
- Speech: "Of course. Let's take another look at the rooms and find a comfortable option for you."
- Note: screen=ROOM_SELECT intent=MODIFY_BOOKING
- Error: `None`

### booking_summary_confirm

- Verdict: PASS
- Mode: single_turn
- Category: Summary confirm
- Input state: `BOOKING_SUMMARY`
- Prompt: "Everything looks correct. Continue to payment."
- Route: `PAYMENT`
- Intent: `CONFIRM_BOOKING`
- Confidence: `0.97`
- Speech: "Perfect. Your booking details are confirmed. Taking you to payment now."
- Note: screen=PAYMENT intent=CONFIRM_BOOKING
- Error: `None`

### budget_flow_step_1

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::budget_happy_path
- Input state: `WELCOME`
- Prompt: "Show me available rooms for two adults and one child on a budget."
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### budget_flow_step_2

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::budget_happy_path
- Input state: `ROOM_SELECT`
- Prompt: "Please show me the Budget Deluxe Room."
- Route: `ROOM_PREVIEW`
- Intent: `BOOK_ROOM`
- Confidence: `0.9`
- Speech: "Here is the Budget Deluxe Room, available at INR 999 per night for up to 2 adults. Take a look and let me know if you'd like to book it or see another option."
- Note: screen=ROOM_PREVIEW intent=BOOK_ROOM
- Error: `None`

### budget_flow_step_3

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::budget_happy_path
- Input state: `ROOM_PREVIEW`
- Prompt: "This works for me. I want to book it."
- Route: `BOOKING_COLLECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.509`
- Speech: "Great choice. Budget Deluxe Room is available at INR 999 per night for up to 2 adults. How many adults will be staying?"
- Note: screen=BOOKING_COLLECT intent=BOOK_ROOM
- Error: `None`

### budget_flow_step_4

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::budget_happy_path
- Input state: `BOOKING_COLLECT`
- Prompt: "My name is Sarah Bennett. Two adults and one child. Checking in on June 20 2031 for two nights."
- Route: `BOOKING_SUMMARY`
- Intent: `PROVIDE_NAME`
- Confidence: `1.0`
- Speech: "Thank you, Sarah Bennett. Let me pull up your booking summary."
- Note: screen=BOOKING_SUMMARY intent=PROVIDE_NAME
- Error: `None`

### budget_flow_step_5

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::budget_happy_path
- Input state: `BOOKING_SUMMARY`
- Prompt: "Yes, proceed to payment."
- Route: `PAYMENT`
- Intent: `CONFIRM_BOOKING`
- Confidence: `0.97`
- Speech: "Perfect. Your booking details are confirmed. Taking you to payment now."
- Note: screen=PAYMENT intent=CONFIRM_BOOKING
- Error: `None`

### summary_edit_flow_step_1

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::summary_edit_path
- Input state: `WELCOME`
- Prompt: "I need a room for four adults."
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### summary_edit_flow_step_2

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::summary_edit_path
- Input state: `ROOM_SELECT`
- Prompt: "Please show me the Grand Luxury Suite."
- Route: `ROOM_PREVIEW`
- Intent: `BOOK_ROOM`
- Confidence: `0.512`
- Speech: "Here is the Grand Luxury Suite, available at INR 10000 per night for up to 4 adults. Take a look and let me know if you'd like to book it or see another option."
- Note: screen=ROOM_PREVIEW intent=BOOK_ROOM
- Error: `None`

### summary_edit_flow_step_3

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::summary_edit_path
- Input state: `ROOM_PREVIEW`
- Prompt: "I want to book this room."
- Route: `BOOKING_COLLECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.931`
- Speech: "Great choice. Grand Luxury Suite is available at INR 10000 per night for up to 4 adults. How many adults will be staying?"
- Note: screen=BOOKING_COLLECT intent=BOOK_ROOM
- Error: `None`

### summary_edit_flow_step_4

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::summary_edit_path
- Input state: `BOOKING_COLLECT`
- Prompt: "My name is Daniel Reed. Four adults. Checking in on June 24 2031 for one night."
- Route: `BOOKING_SUMMARY`
- Intent: `PROVIDE_NAME`
- Confidence: `1.0`
- Speech: "Thank you, Daniel Reed. Let me pull up your booking summary."
- Note: screen=BOOKING_SUMMARY intent=PROVIDE_NAME
- Error: `None`

### summary_edit_flow_step_5

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::summary_edit_path
- Input state: `BOOKING_SUMMARY`
- Prompt: "Actually change the guest name to Priya Reed before paying."
- Route: `BOOKING_COLLECT`
- Intent: `MODIFY_BOOKING`
- Confidence: `0.96`
- Speech: "May I have the name for this booking?"
- Note: screen=BOOKING_COLLECT intent=MODIFY_BOOKING
- Error: `None`

### summary_edit_flow_step_6

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::summary_edit_path
- Input state: `BOOKING_COLLECT`
- Prompt: "The name should be Priya Reed."
- Route: `BOOKING_SUMMARY`
- Intent: `PROVIDE_NAME`
- Confidence: `0.459`
- Speech: "I've updated the guest name to Priya Reed. You've already chosen the Grand Luxury Suite for 4 adults, checking in on June 24th, 2031, and checking out on June 25th, 2031. Is this booking correct?"
- Note: screen=BOOKING_SUMMARY intent=PROVIDE_NAME
- Error: `None`

### summary_edit_flow_step_7

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::summary_edit_path
- Input state: `BOOKING_SUMMARY`
- Prompt: "Looks good now. Continue to payment."
- Route: `PAYMENT`
- Intent: `CONFIRM_BOOKING`
- Confidence: `0.97`
- Speech: "Perfect. Your booking details are confirmed. Taking you to payment now."
- Note: screen=PAYMENT intent=CONFIRM_BOOKING
- Error: `None`

## Interpretation

- The routing and booking-state fixes are holding up well under live tenant-aware testing: preview-first selection, booking-slot collection, summary edits, and payment progression all worked in this sweep.
- The earlier WELCOME-stage room-comparison issue is now fixed in the live backend run; comparison wording stayed in browse context instead of jumping into a single-room preview.
- The two payment warnings in the baseline harness should not be treated as product regressions by themselves because that harness omits a real tenant UUID/slug and therefore cannot exercise booking persistence the same way the kiosk frontend does.
- Hotel FAQ coverage still depends on tenant data. The polite fallback is stable, but the tenant tested here does not appear to have breakfast/Wi-Fi answers available through the FAQ layer.