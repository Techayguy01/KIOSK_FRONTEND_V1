# Extended English Prompt Variation Report

- Generated at: 2026-03-20T14:06:09
- Base URL: `http://127.0.0.1:8000`
- Tenant tested: `Nagpur Premium Hotel` (`nagpur-premium-hotel-3b832f1b`)
- Tenant ID: `f4992258-e692-4306-bf62-3142858f85a6`
- Room inventory used: `Ocean One View, Luxurious Suite, Budget Deluxe Room, Grand Luxury Suite`

## Summary

- Total scenarios: 28
- Pass: 18
- Warn: 2
- Fail: 8

## Key Findings

- Comparison prompts are improved but not fully stable across paraphrases. Some variants still miss the deterministic room-comparison path.
- At least one prompt path still falls through to an LLM fallback that requires an unavailable OpenAI API key, producing a hard server failure instead of a graceful response.
- At least one multi-turn booking flow showed instability and should be reviewed in the detailed table.

## Category Summary

| Category | Total | Pass | Warn | Fail |
| --- | --- | --- | --- | --- |
| Booking collection | 1 | 0 | 0 | 1 |
| Booking collection edit | 1 | 1 | 0 | 0 |
| Check-in | 1 | 1 | 0 | 0 |
| Comparison | 7 | 2 | 2 | 3 |
| Flow::budget_booking_flow | 2 | 1 | 0 | 1 |
| Flow::summary_edit_flow | 4 | 3 | 0 | 1 |
| Hotel FAQ | 1 | 1 | 0 | 0 |
| Preview booking | 1 | 1 | 0 | 0 |
| Preview detail | 1 | 0 | 0 | 1 |
| Preview navigation | 1 | 1 | 0 | 0 |
| Pricing | 1 | 1 | 0 | 0 |
| Recommendation | 1 | 1 | 0 | 0 |
| Room discovery | 2 | 2 | 0 | 0 |
| Selection | 1 | 0 | 0 | 1 |
| Summary confirm | 1 | 1 | 0 | 0 |
| Summary edit | 2 | 2 | 0 | 0 |

## Scenario Results

| Verdict | Mode | Category | State | Prompt | Route | Intent | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PASS | single_turn | Check-in | WELCOME | I already have a reservation and need to check in. | SCAN_ID | CHECK_IN | screen=SCAN_ID intent=CHECK_IN |
| PASS | single_turn | Room discovery | WELCOME | Show me affordable rooms for two adults. | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Room discovery | WELCOME | We are 4 adults. Which room should we look at? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Comparison | WELCOME | Can you compare the Budget Deluxe Room and the Grand Luxury Suite? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| FAIL | single_turn | Comparison | WELCOME | Compare Budget Deluxe Room versus Grand Luxury Suite. | - | - | http=500 |
| WARN | single_turn | Comparison | WELCOME | What is the difference between Budget Deluxe Room and Grand Luxury Suite? | WELCOME | GENERAL_QUERY | expected_screens=['ROOM_SELECT'] expected_intents=['BOOK_ROOM', 'COMPARE_ROOMS', 'GENERAL_QUERY'] ac... |
| WARN | single_turn | Comparison | WELCOME | Which is better, Budget Deluxe Room or Grand Luxury Suite? | WELCOME | GENERAL_QUERY | expected_screens=['ROOM_SELECT'] expected_intents=['BOOK_ROOM', 'COMPARE_ROOMS', 'GENERAL_QUERY'] ac... |
| PASS | single_turn | Hotel FAQ | WELCOME | What time is breakfast and do you offer free Wi-Fi? | WELCOME | GENERAL_QUERY | screen=WELCOME intent=GENERAL_QUERY |
| PASS | single_turn | Pricing | ROOM_SELECT | What is your cheapest room tonight? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | single_turn | Recommendation | ROOM_SELECT | Which room is best for four adults? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| FAIL | single_turn | Comparison | ROOM_SELECT | Can you compare the Budget Deluxe Room and the Grand Luxury Suite for me? | - | - | http=500 |
| PASS | single_turn | Comparison | ROOM_SELECT | What is the difference between Budget Deluxe Room and Grand Luxury Suite? | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| FAIL | single_turn | Comparison | ROOM_SELECT | Which one is better for four adults, Budget Deluxe Room or Grand Luxury Suite? | - | - | http=500 |
| FAIL | single_turn | Selection | ROOM_SELECT | Please show me the Budget Deluxe Room. | - | - | http=500 |
| FAIL | single_turn | Preview detail | ROOM_PREVIEW | Does this room have a balcony or a work desk? | - | - | http=500 |
| PASS | single_turn | Preview navigation | ROOM_PREVIEW | Show me another room instead. | ROOM_SELECT | MODIFY_BOOKING | screen=ROOM_SELECT intent=MODIFY_BOOKING |
| PASS | single_turn | Preview booking | ROOM_PREVIEW | I want to book this room. | BOOKING_COLLECT | BOOK_ROOM | screen=BOOKING_COLLECT intent=BOOK_ROOM |
| FAIL | single_turn | Booking collection | BOOKING_COLLECT | My name is Emily Stone. There will be 2 adults and 1 child. We want to check in on June 17 2035... | - | - | http=500 |
| PASS | single_turn | Booking collection edit | BOOKING_COLLECT | Actually change the stay to July 2 2035 for 3 nights. | BOOKING_SUMMARY | PROVIDE_DATES | screen=BOOKING_SUMMARY intent=PROVIDE_DATES |
| PASS | single_turn | Summary confirm | BOOKING_SUMMARY | Everything looks correct. Continue to payment. | PAYMENT | CONFIRM_BOOKING | screen=PAYMENT intent=CONFIRM_BOOKING |
| PASS | single_turn | Summary edit | BOOKING_SUMMARY | I need to change the guest name before paying. | BOOKING_COLLECT | MODIFY_BOOKING | screen=BOOKING_COLLECT intent=MODIFY_BOOKING |
| PASS | single_turn | Summary edit | BOOKING_SUMMARY | Actually change the room before I pay. | ROOM_SELECT | MODIFY_BOOKING | screen=ROOM_SELECT intent=MODIFY_BOOKING |
| PASS | multi_turn_flow | Flow::budget_booking_flow | WELCOME | Show me budget-friendly rooms for two adults. | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| FAIL | multi_turn_flow | Flow::budget_booking_flow | ROOM_SELECT | Please show me the Budget Deluxe Room. | - | - | http=500 |
| PASS | multi_turn_flow | Flow::summary_edit_flow | WELCOME | I need a room for 4 adults. | ROOM_SELECT | BOOK_ROOM | screen=ROOM_SELECT intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow::summary_edit_flow | ROOM_SELECT | Please show me the Grand Luxury Suite. | ROOM_PREVIEW | BOOK_ROOM | screen=ROOM_PREVIEW intent=BOOK_ROOM |
| PASS | multi_turn_flow | Flow::summary_edit_flow | ROOM_PREVIEW | I want to book this room. | BOOKING_COLLECT | BOOK_ROOM | screen=BOOKING_COLLECT intent=BOOK_ROOM |
| FAIL | multi_turn_flow | Flow::summary_edit_flow | BOOKING_COLLECT | My name is Daniel Reed. 4 adults. Checking in on September 15 2035 for 1 night. | - | - | http=500 |

## Detailed Responses

### welcome_checkin_direct

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

### welcome_rooms_budget

- Verdict: PASS
- Mode: single_turn
- Category: Room discovery
- Input state: `WELCOME`
- Prompt: "Show me affordable rooms for two adults."
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### welcome_family_fit

- Verdict: PASS
- Mode: single_turn
- Category: Room discovery
- Input state: `WELCOME`
- Prompt: "We are 4 adults. Which room should we look at?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### welcome_compare_explicit

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

### welcome_compare_versus

- Verdict: FAIL
- Mode: single_turn
- Category: Comparison
- Input state: `WELCOME`
- Prompt: "Compare Budget Deluxe Room versus Grand Luxury Suite."
- Route: `-`
- Intent: `-`
- Confidence: `None`
- Speech: "{"detail":"[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable"}"
- Note: http=500
- Error: `[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable`

### welcome_compare_difference

- Verdict: WARN
- Mode: single_turn
- Category: Comparison
- Input state: `WELCOME`
- Prompt: "What is the difference between Budget Deluxe Room and Grand Luxury Suite?"
- Route: `WELCOME`
- Intent: `GENERAL_QUERY`
- Confidence: `1.0`
- Speech: "I'm sorry, I don't have that hotel detail right now, but I'm happy to help with your booking or another question."
- Note: expected_screens=['ROOM_SELECT'] expected_intents=['BOOK_ROOM', 'COMPARE_ROOMS', 'GENERAL_QUERY'] actual_screen=WELCOME actual_intent=GENERAL_QUERY
- Error: `None`

### welcome_compare_better

- Verdict: WARN
- Mode: single_turn
- Category: Comparison
- Input state: `WELCOME`
- Prompt: "Which is better, Budget Deluxe Room or Grand Luxury Suite?"
- Route: `WELCOME`
- Intent: `GENERAL_QUERY`
- Confidence: `1.0`
- Speech: "I'm sorry, I don't have that hotel detail right now, but I'm happy to help with your booking or another question."
- Note: expected_screens=['ROOM_SELECT'] expected_intents=['BOOK_ROOM', 'COMPARE_ROOMS', 'GENERAL_QUERY'] actual_screen=WELCOME actual_intent=GENERAL_QUERY
- Error: `None`

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
- Error: `None`

### room_select_cheapest

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
- Error: `None`

### room_select_best_for_family

- Verdict: PASS
- Mode: single_turn
- Category: Recommendation
- Input state: `ROOM_SELECT`
- Prompt: "Which room is best for four adults?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.866`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### room_select_compare_plain

- Verdict: FAIL
- Mode: single_turn
- Category: Comparison
- Input state: `ROOM_SELECT`
- Prompt: "Can you compare the Budget Deluxe Room and the Grand Luxury Suite for me?"
- Route: `-`
- Intent: `-`
- Confidence: `None`
- Speech: "{"detail":"[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable"}"
- Note: http=500
- Error: `[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable`

### room_select_compare_difference

- Verdict: PASS
- Mode: single_turn
- Category: Comparison
- Input state: `ROOM_SELECT`
- Prompt: "What is the difference between Budget Deluxe Room and Grand Luxury Suite?"
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.596`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### room_select_compare_better_for_group

- Verdict: FAIL
- Mode: single_turn
- Category: Comparison
- Input state: `ROOM_SELECT`
- Prompt: "Which one is better for four adults, Budget Deluxe Room or Grand Luxury Suite?"
- Route: `-`
- Intent: `-`
- Confidence: `None`
- Speech: "{"detail":"[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable"}"
- Note: http=500
- Error: `[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable`

### room_select_named_selection

- Verdict: FAIL
- Mode: single_turn
- Category: Selection
- Input state: `ROOM_SELECT`
- Prompt: "Please show me the Budget Deluxe Room."
- Route: `-`
- Intent: `-`
- Confidence: `None`
- Speech: "{"detail":"[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable"}"
- Note: http=500
- Error: `[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable`

### room_preview_feature_question

- Verdict: FAIL
- Mode: single_turn
- Category: Preview detail
- Input state: `ROOM_PREVIEW`
- Prompt: "Does this room have a balcony or a work desk?"
- Route: `-`
- Intent: `-`
- Confidence: `None`
- Speech: "{"detail":"[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable"}"
- Note: http=500
- Error: `[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable`

### room_preview_switch_option

- Verdict: PASS
- Mode: single_turn
- Category: Preview navigation
- Input state: `ROOM_PREVIEW`
- Prompt: "Show me another room instead."
- Route: `ROOM_SELECT`
- Intent: `MODIFY_BOOKING`
- Confidence: `0.852`
- Speech: "Of course. Let's take another look at the rooms and find a comfortable option for you."
- Note: screen=ROOM_SELECT intent=MODIFY_BOOKING
- Error: `None`

### room_preview_book

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

- Verdict: FAIL
- Mode: single_turn
- Category: Booking collection
- Input state: `BOOKING_COLLECT`
- Prompt: "My name is Emily Stone. There will be 2 adults and 1 child. We want to check in on June 17 2035 for 2 nights."
- Route: `-`
- Intent: `-`
- Confidence: `None`
- Speech: "{"detail":"[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable"}"
- Note: http=500
- Error: `[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable`

### booking_collect_change_dates

- Verdict: PASS
- Mode: single_turn
- Category: Booking collection edit
- Input state: `BOOKING_COLLECT`
- Prompt: "Actually change the stay to July 2 2035 for 3 nights."
- Route: `BOOKING_SUMMARY`
- Intent: `PROVIDE_DATES`
- Confidence: `0.465`
- Speech: "Thank you, Emily Stone. Let me pull up your booking summary."
- Note: screen=BOOKING_SUMMARY intent=PROVIDE_DATES
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
- Category: Summary edit
- Input state: `BOOKING_SUMMARY`
- Prompt: "Actually change the room before I pay."
- Route: `ROOM_SELECT`
- Intent: `MODIFY_BOOKING`
- Confidence: `0.96`
- Speech: "Of course. Let's take another look at the rooms and find a comfortable option for you."
- Note: screen=ROOM_SELECT intent=MODIFY_BOOKING
- Error: `None`

### budget_flow_step_1

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::budget_booking_flow
- Input state: `WELCOME`
- Prompt: "Show me budget-friendly rooms for two adults."
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### budget_flow_step_2

- Verdict: FAIL
- Mode: multi_turn_flow
- Category: Flow::budget_booking_flow
- Input state: `ROOM_SELECT`
- Prompt: "Please show me the Budget Deluxe Room."
- Route: `-`
- Intent: `-`
- Confidence: `None`
- Speech: "{"detail":"[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable"}"
- Note: http=500
- Error: `[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable`

### summary_edit_flow_step_1

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::summary_edit_flow
- Input state: `WELCOME`
- Prompt: "I need a room for 4 adults."
- Route: `ROOM_SELECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.95`
- Speech: "We have 4 room options: the Ocean One View at INR 4000 for up to 2 guests, the Luxurious Suite at INR 5000 for up to 4 guests, and the Budget Deluxe Room at INR 999 for up to 2 guests. Which one interests you?"
- Note: screen=ROOM_SELECT intent=BOOK_ROOM
- Error: `None`

### summary_edit_flow_step_2

- Verdict: PASS
- Mode: multi_turn_flow
- Category: Flow::summary_edit_flow
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
- Category: Flow::summary_edit_flow
- Input state: `ROOM_PREVIEW`
- Prompt: "I want to book this room."
- Route: `BOOKING_COLLECT`
- Intent: `BOOK_ROOM`
- Confidence: `0.931`
- Speech: "Great choice. Grand Luxury Suite is available at INR 10000 per night for up to 4 adults. How many adults will be staying?"
- Note: screen=BOOKING_COLLECT intent=BOOK_ROOM
- Error: `None`

### summary_edit_flow_step_4

- Verdict: FAIL
- Mode: multi_turn_flow
- Category: Flow::summary_edit_flow
- Input state: `BOOKING_COLLECT`
- Prompt: "My name is Daniel Reed. 4 adults. Checking in on September 15 2035 for 1 night."
- Route: `-`
- Intent: `-`
- Confidence: `None`
- Speech: "{"detail":"[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable"}"
- Note: http=500
- Error: `[LLM] All models failed. Last error: litellm.AuthenticationError: AuthenticationError: OpenAIException - The api_key client option must be set either by passing api_key to the client or by setting the OPENAI_API_KEY environment variable`

## Interpretation

- `ROOM_SELECT` for a comparison prompt is usually the correct browse-context behavior. It keeps the guest in catalog browsing rather than prematurely committing them to one room preview.
- The main remaining comparison problem is phrasing coverage. The backend is strong on direct ?compare X and Y? wording, but weaker on variants like ?versus,? ?difference between,? and ?which is better.?
- There is also an environment-level reliability issue: when a comparison variant misses the deterministic path, the fallback stack can hit an unavailable OpenAI configuration and return a `500` instead of degrading gracefully.