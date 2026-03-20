# English Prompt Recheck Report

- Generated at: 2026-03-20T15:06:00
- Base URL: `http://127.0.0.1:8000`
- Tenant tested: `Nagpur Premium Hotel` (`nagpur-premium-hotel-3b832f1b`)

## Scope

- Targeted live recheck of the prompts that failed or behaved inconsistently in the previous extended sweep.
- Focused on comparison phrasing, room selection, preview detail, booking collection, and summary confirmation.

## Environment Note

- `.env` currently exposes `GROQ_API_KEY` and `DATABASE_URL`.
- `.env` still does not expose `OPENAI_API_KEY`.
- After the Groq key renewal, the previously observed `500` failures did not reproduce in this recheck.

## Results

| Prompt Area | Prompt | State | Status | Outcome |
| --- | --- | --- | --- | --- |
| Comparison | `Compare Budget Deluxe Room versus Grand Luxury Suite.` | `WELCOME` | `PASS` | Routed to `ROOM_SELECT` |
| Comparison | `What is the difference between Budget Deluxe Room and Grand Luxury Suite?` | `WELCOME` | `PASS` | Routed to `ROOM_SELECT` with no selected room |
| Comparison | `Which is better, Budget Deluxe Room or Grand Luxury Suite?` | `WELCOME` | `PASS` | Routed to `ROOM_SELECT` with no selected room |
| Comparison | `Can you compare the Budget Deluxe Room and the Grand Luxury Suite for me?` | `ROOM_SELECT` | `PASS` | Routed to `ROOM_SELECT` |
| Comparison | `Which one is better for four adults, Budget Deluxe Room or Grand Luxury Suite?` | `ROOM_SELECT` | `PASS` | Routed to `ROOM_SELECT` with no selected room |
| Selection | `Please show me the Budget Deluxe Room.` | `ROOM_SELECT` | `PASS` | Routed to `ROOM_PREVIEW` with the correct selected room |
| Preview detail | `Does this room have a balcony or a work desk?` | `ROOM_PREVIEW` | `PASS` | Stayed in `ROOM_PREVIEW` |
| Booking collect | compound guest/date turn | `BOOKING_COLLECT` | `PASS` | Routed to `BOOKING_SUMMARY` |
| Booking collect | summary-edit flow detail turn | `BOOKING_COLLECT` | `PASS` | Routed to `BOOKING_SUMMARY` |
| Summary confirm | `Everything looks correct. Continue to payment.` | `BOOKING_SUMMARY` | `PASS` | Routed to `PAYMENT` |

## Conclusions

- The renewed Groq key materially improved runtime stability. The prior fallback-related `500` failures did not occur in this recheck.
- `ROOM_SELECT` remains the correct target for direct comparison prompts, and the tested English comparison variants now consistently stay in browse/compare context instead of falling back or over-selecting a room.
- The previously failing comparison phrasings are fixed in this recheck:
  - `difference between ...` from `WELCOME`
  - `which is better ...` from `WELCOME`
  - `which one is better for four adults ...` from `ROOM_SELECT`
- Core booking flow also remained healthy in this spot check:
  - room selection works
  - preview detail stays anchored
  - booking detail collection reaches summary
  - summary confirmation reaches payment
