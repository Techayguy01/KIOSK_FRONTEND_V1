# Module 01: API Gateway and Context Preservation

## Date/Time Completed
- 2026-03-20 Asia/Calcutta

## Goal of Module 1
- Stop valid room-discovery prompts from being swallowed by the FAQ fallback path before the agent runs.
- Remove duplicate summary-confirm behavior from the API layer so summary confirmation has a single downstream owner.
- Preserve active booking context when the frontend sends a regressed screen like `WELCOME` or `IDLE`.

## Exact 5 Changes Made
1. Removed the API-layer summary-confirm short-circuit from [`api/chat.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\api\chat.py), including the now-redundant `_is_summary_confirmation_transcript` import.
2. Added a regex-based room-recommendation FAQ bypass helper in [`api/chat.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\api\chat.py) for family-fit, recommendation, budget, and comparison prompts.
3. Tightened `_should_attempt_faq()` in [`api/chat.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\api\chat.py) so transactional room-discovery prompts no longer fall into FAQ fallback.
4. Strengthened booking-context preservation in [`api/chat.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\api\chat.py) and added targeted API regression tests in [`tests/test_api_chat.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\tests\test_api_chat.py).
5. Added this module report file at [`docs/implementation_reports/module_01_api_gateway_and_context.md`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\docs\implementation_reports\module_01_api_gateway_and_context.md).

## Affected Files
- [`api/chat.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\api\chat.py)
- [`tests/test_api_chat.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\tests\test_api_chat.py)
- [`docs/implementation_reports/module_01_api_gateway_and_context.md`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\docs\implementation_reports\module_01_api_gateway_and_context.md)

## Behavioral Impact
- Family or recommendation-style room prompts at `WELCOME` now continue into the agent path instead of returning the generic FAQ fallback response.
- Summary-confirm prompts on `BOOKING_SUMMARY` are no longer resolved directly inside the API layer, which removes duplicate progression logic at the entry point.
- If the frontend regresses an active booking session to `WELCOME` or `IDLE`, the backend now preserves `ROOM_PREVIEW`, `BOOKING_COLLECT`, or `BOOKING_SUMMARY` instead of collapsing the flow.
- `filledSlots` merges are less destructive when a room is already selected and the new payload does not explicitly change the room.

## Expected User-Facing Effect
- A guest saying “We are a family of four. Which room should we look at?” is less likely to get the unhelpful “I don't have that hotel detail right now” response.
- A guest who is already in the booking flow is less likely to be thrown back to the welcome experience just because the frontend sent the wrong current screen.
- Booking-summary confirmations now consistently reach the agent path, which sets up cleaner payment progression in the next module.

## Regression Risks Introduced
- The new FAQ bypass patterns are English-focused and may still miss other paraphrases until Module 2 expands routing examples.
- The stronger context preservation may keep a user in booking context longer than before if the frontend sends an incorrect `WELCOME` screen for a genuinely reset session.
- Summary confirmation still depends on downstream booking logic, so this module removes duplication but does not by itself solve all summary/payment failures.

## Tests Run After the Module
- `C:\Users\tanb2\anaconda3\envs\myenv\python.exe -m py_compile api/chat.py tests/test_api_chat.py`
- `C:\Users\tanb2\anaconda3\envs\myenv\python.exe -m pytest tests/test_api_chat.py -q -p no:cacheprovider -k "family_room_recommendation_bypasses_faq_fallback or summary_confirm_runs_through_agent_not_api_short_circuit or preserves_booking_screen_when_request_regresses_to_welcome"`

## Result Summary
- Python compile check passed.
- Targeted Module 1 API tests passed: `3 passed`, `14 deselected`.
- Known warnings remain from unrelated Pydantic/FastAPI deprecations and are not caused by this module.

## Notes for Module 2
- Module 2 should focus on routing precedence inside [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py), especially screen-aware suppression of check-in takeover during booking.
- The live booking issues around `ROOM_PREVIEW`, combined slot filling, and `BOOKING_SUMMARY -> PAYMENT` still need downstream agent-layer fixes.
