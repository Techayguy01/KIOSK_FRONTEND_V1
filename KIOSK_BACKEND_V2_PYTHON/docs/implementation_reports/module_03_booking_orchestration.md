# Module 03: Booking Orchestration and Screen Transitions

## Date/Time Completed
- 2026-03-20 Asia/Calcutta

## Goal of Module 3
- Make booking progression stateful and conservative so the kiosk stops skipping room preview, stops losing booking context, and handles booking-summary confirmations and edits reliably.
- Allow combined booking-detail turns to fill multiple slots in one pass instead of depending on a single dominant intent.
- Make `ROOM_PREVIEW`, `BOOKING_COLLECT`, and `BOOKING_SUMMARY` behave like distinct stages with predictable transition rules.

## Exact 5 Changes Made
1. Added booking-screen multi-slot extraction in [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py) so `BOOKING_COLLECT` and `BOOKING_SUMMARY` now extract room, guest counts, dates, and guest name from the same utterance instead of only trusting the dominant intent.
2. Tightened deterministic guest-name parsing in [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py) so compound prompts like “My name is John Carter, two adults, tomorrow for two nights” keep the actual name while avoiding false positives from edit requests.
3. Enforced preview-first room selection in [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py) so choosing a valid room now opens `ROOM_PREVIEW`, and only explicit preview-booking phrases like “I will take this room” move the guest into `BOOKING_COLLECT`.
4. Made summary-stage transitions authoritative in [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py): complete confirmation now goes to `PAYMENT`, explicit room change still goes to `ROOM_SELECT`, and non-room edits stay inside `BOOKING_COLLECT` instead of falling backward into room shopping.
5. Added this module report file at [`docs/implementation_reports/module_03_booking_orchestration.md`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\docs\implementation_reports\module_03_booking_orchestration.md).

## Affected Files
- [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py)
- [`docs/implementation_reports/module_03_booking_orchestration.md`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\docs\implementation_reports\module_03_booking_orchestration.md)

## Behavioral Impact
- A named room selection from `ROOM_SELECT` now keeps the guest in a preview-first journey instead of jumping straight to conversational slot collection.
- `ROOM_PREVIEW` now behaves like a real commitment boundary: browsing the room stays in preview, while explicit “book this room” phrasing starts the reservation flow.
- Compound booking-detail turns now update multiple fields together, so the backend can move directly from `BOOKING_COLLECT` to `BOOKING_SUMMARY` when the guest provides enough information in one sentence.
- `BOOKING_SUMMARY` is now conservative and state-aware: payment confirmations complete the flow, non-room edits stay inside booking collection, and summary edits no longer drift into generic browsing paths.

## Expected User-Facing Effect
- A guest who says “Show me the Family Suite” should now see that room first instead of being asked for adult counts too early.
- A guest who says “I will take this room” from preview should smoothly enter the booking form instead of being kept in browsing mode.
- A guest who gives several booking details in one sentence should feel like the kiosk understood the whole request instead of forcing a slow one-slot-at-a-time recovery.
- A guest reviewing the booking summary should be able to confirm payment or edit details without the kiosk suddenly forgetting the booking and dumping them back into room selection.

## Regression Risks Introduced
- The stricter preview-first rule is intentionally less eager, so some users who start giving dates or guest counts while still browsing a room will now be prompted to explicitly confirm that they want to book that room first.
- Guest-name extraction is safer for mixed booking prompts now, but it is still English-oriented and may need more patterns later for unusual naming phrasing.
- Summary edits now stay in `BOOKING_COLLECT` more often, which is correct for stability, but the frontend should be checked in Module 4 to ensure it handles that return path cleanly.

## Tests Run After the Module
- `C:\Users\tanb2\anaconda3\envs\myenv\python.exe -m py_compile KIOSK_BACKEND_V2_PYTHON/agent/nodes.py`
- Inline validation using `booking_logic()` and `_extract_slots_deterministically()` for:
  - compound slot filling from `BOOKING_COLLECT`
  - named room selection from `ROOM_SELECT`
  - explicit preview confirmation from `ROOM_PREVIEW`
  - `BOOKING_SUMMARY -> PAYMENT` confirmation
  - `BOOKING_SUMMARY -> BOOKING_COLLECT` non-room edit handling
  - preview-screen slot-like utterances staying non-mutating until explicit booking confirmation

## Result Summary
- Compile check passed.
- Deterministic validation passed for all target Module 3 behaviors:
  - compound booking detail turn -> `BOOKING_SUMMARY`
  - named room selection -> `ROOM_PREVIEW`
  - explicit preview confirmation -> `BOOKING_COLLECT`
  - complete summary confirmation -> `PAYMENT`
  - summary guest-name edit -> `BOOKING_COLLECT`
  - preview detail-entry without explicit booking stays in `ROOM_PREVIEW` and no longer mutates booking slots
- No live server validation was used for this module because the local backend runtime was not part of the module acceptance gate.

## Notes for Module 4
- Module 4 should turn these deterministic improvements into regression coverage in [`tests/test_api_chat.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\tests\test_api_chat.py), [`tests/test_intent_router.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\tests\test_intent_router.py), and the live smoke harness.
- The best next verification step is a stateful end-to-end booking journey that asserts the preview-first behavior and the summary-to-payment path through the real `/api/chat` contract.
