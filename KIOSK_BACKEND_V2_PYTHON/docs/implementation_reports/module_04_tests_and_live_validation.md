# Module 04: Tests and Live Validation Alignment

## Date/Time Completed
- 2026-03-20 Asia/Calcutta

## Goal of Module 4
- Convert the routing and booking-flow fixes from Modules 1 to 3 into explicit regression coverage.
- Add shared booking fixtures so API tests can simulate realistic kiosk state without duplicating payload setup.
- Update the live English smoke harness so its expectations match the corrected preview-first and summary-to-payment behavior.

## Exact 5 Changes Made
1. Added shared booking fixtures in [`tests/conftest.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\tests\conftest.py) for room catalog payloads, `Family Suite` inventory objects, booking-summary slot payloads, and reusable stateful request builders for booking journeys.
2. Expanded deterministic router coverage in [`tests/test_intent_router.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\tests\test_intent_router.py) for family room recommendations, room-preview detail prompts, summary confirm wording, summary modify wording, and booking-screen suppression of accidental `CHECK_IN` takeover.
3. Added focused `/api/chat` regressions in [`tests/test_api_chat.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\tests\test_api_chat.py) for preview detail retention, compound booking-detail collection, summary-to-payment, summary edit return-to-collect, and a full family-booking journey through `PAYMENT`.
4. Updated the live English probe in [`test_live_intent_routing.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\test_live_intent_routing.py) to carry single-turn `filledSlots` context, assert stricter preview-first and payment expectations, and generate findings that call out the exact booking-flow regressions we care about now.
5. Added this module report file at [`docs/implementation_reports/module_04_tests_and_live_validation.md`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\docs\implementation_reports\module_04_tests_and_live_validation.md).

## Affected Files
- [`tests/conftest.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\tests\conftest.py)
- [`tests/test_intent_router.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\tests\test_intent_router.py)
- [`tests/test_api_chat.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\tests\test_api_chat.py)
- [`test_live_intent_routing.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\test_live_intent_routing.py)
- [`docs/implementation_reports/module_04_tests_and_live_validation.md`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\docs\implementation_reports\module_04_tests_and_live_validation.md)

## Behavioral Impact
- The backend now has direct regression coverage for the booking flows that were previously only being observed manually in live probing.
- Preview-specific room questions, compound slot-filling turns, summary confirmation, and summary edits are now guarded by tests that will fail if those behaviors regress.
- The live English smoke script now evaluates the kiosk against the corrected product behavior instead of accepting older fallback outcomes like summary confirmation staying on `BOOKING_SUMMARY`.

## Expected User-Facing Effect
- If a future change accidentally makes the kiosk skip room preview again, break summary payment progression, or throw booking edits out of context, the test suite should catch it before that behavior reaches users.
- The live behavior report should now be more trustworthy because the smoke harness is checking the same outcomes we actually want the kiosk to deliver.
- Engineers working on the backend can reproduce booking regressions faster because the tests now carry realistic room catalog and slot context instead of relying on hand-built ad hoc payloads.

## Regression Risks Introduced
- The new API journey test uses mocked classifier output for a few routing turns, so it validates backend orchestration strongly but is not a substitute for a fully live backend-plus-model run.
- The payment-path tests intentionally bypass database persistence with a pre-seeded persisted booking id, because the local test environment does not provide a real tenant UUID and room allocation path.
- The live smoke harness is stricter now, so some scenarios that previously showed as acceptable warnings may now surface as real regressions if the backend drifts.

## Tests Run After the Module
- `C:\Users\tanb2\anaconda3\envs\myenv\python.exe -m py_compile KIOSK_BACKEND_V2_PYTHON/tests/conftest.py KIOSK_BACKEND_V2_PYTHON/tests/test_api_chat.py KIOSK_BACKEND_V2_PYTHON/tests/test_intent_router.py KIOSK_BACKEND_V2_PYTHON/test_live_intent_routing.py`
- `C:\Users\tanb2\anaconda3\envs\myenv\python.exe -m pytest tests/test_intent_router.py -q -p no:cacheprovider`
- `C:\Users\tanb2\anaconda3\envs\myenv\python.exe -m pytest KIOSK_BACKEND_V2_PYTHON/tests/test_api_chat.py -q -p no:cacheprovider -k "preview_detail_question_stays_in_room_preview_context or booking_collect_compound_turn_moves_to_booking_summary or booking_summary_confirm_routes_to_payment or booking_summary_modify_routes_to_booking_collect or family_booking_journey_reaches_payment"`

## Result Summary
- Compile check passed for all Module 4 files.
- Router regression suite passed: `143 passed`, `1 xfailed`.
- New Module 4 API regressions passed: `5 passed`, `17 deselected`.
- The live smoke script was updated and compile-checked, but it was not executed as a module acceptance step because the local backend runtime was not part of this test run.

## Notes for the Next Module
- The next cleanup pass should focus on developer ergonomics and observability rather than new behavior: structured decision tracing, response-state invariants, and smaller helper boundaries around routing and booking transitions.
- Once the live backend server is running again, the updated [`test_live_intent_routing.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\test_live_intent_routing.py) should be run to regenerate [english_prompt_behavior_report.md](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\english_prompt_behavior_report.md) against the stricter expectations.
