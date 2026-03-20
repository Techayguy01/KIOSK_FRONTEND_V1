# Module 02: Routing and Classifier Alignment

## Date/Time Completed
- 2026-03-20 Asia/Calcutta

## Goal of Module 2
- Make the router screen-aware before it applies broad transactional regexes.
- Stop booking-session turns from being hijacked by `CHECK_IN`.
- Improve deterministic handling for family room recommendations and room-preview detail questions.
- Align the semantic-classifier configuration with the intended router behavior so fallback layers stop fighting each other.

## Exact 5 Changes Made
1. Added booking-context-aware `CHECK_IN` restart suppression in [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py), including a dedicated helper for explicit “switch to check-in instead” wording.
2. Added deterministic room-recommendation routing in [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py) for family-fit, room-choice, budget, and comparison prompts so they resolve to `BOOK_ROOM` from welcome-like screens.
3. Added deterministic room-preview detail routing in [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py) so questions about the currently viewed room’s balcony, view, bathroom, or features stay preview-safe instead of being treated as fresh room exploration.
4. Expanded valid intent coverage and intent examples in [`agent/intent_config.py`](c:\Users\\tanb2\\Desktop\\KIOSK_FRONTEND_V1\\KIOSK_BACKEND_V2_PYTHON\\agent\\intent_config.py) for family recommendations, explicit preview booking language, payment-confirm wording, summary edit wording, and combined booking-detail turns.
5. Added this module report file at [`docs/implementation_reports/module_02_routing_and_classifier.md`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\docs\implementation_reports\module_02_routing_and_classifier.md).

## Affected Files
- [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py)
- [`agent/intent_config.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\intent_config.py)
- [`docs/implementation_reports/module_02_routing_and_classifier.md`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\docs\implementation_reports\module_02_routing_and_classifier.md)

## Behavioral Impact
- A prompt like “We are a family of four. Which room should we look at?” now resolves deterministically to `BOOK_ROOM` instead of falling through as a vague general query.
- A prompt like “Does this room have a balcony or a city view?” on `ROOM_PREVIEW` is now treated as a preview-safe detail request instead of a fresh room-shopping turn.
- Booking-session turns that contain stay-date phrasing like “check in tomorrow” are less likely to be misread as kiosk `CHECK_IN` for an existing reservation.
- The semantic classifier now has better valid-screen coverage for `ROOM_PREVIEW` and `BOOKING_COLLECT`, which reduces disagreement between deterministic routing and embedding-based fallback.

## Expected User-Facing Effect
- Guests asking for a room recommendation at the welcome screen should be guided into room discovery more reliably.
- Guests exploring a specific room should get room-detail behavior instead of being bounced back into generic browsing.
- Guests already entering booking details should feel less like the kiosk “forgets” the booking and suddenly switches context.
- Summary confirmation and edit wording now has stronger classifier support, which sets up cleaner downstream behavior in the next module.

## Regression Risks Introduced
- Some recommendation and comparison prompts may now classify more aggressively as `BOOK_ROOM`, even when a guest intended a broad informational question about rooms.
- Preview-detail prompts are still routed as `GENERAL_QUERY`, so downstream booking logic must preserve preview context correctly in Module 3 for the full UX to improve.
- Combined booking-detail turns are better represented in the classifier config, but full multi-slot extraction still depends on Module 3.

## Tests Run After the Module
- `C:\Users\tanb2\anaconda3\envs\myenv\python.exe -m py_compile agent/nodes.py agent/intent_config.py`
- `C:\Users\tanb2\anaconda3\envs\myenv\python.exe -m pytest tests/test_intent_router.py -q -p no:cacheprovider`
- Inline router validation using `route_intent()` for:
  - welcome family recommendation prompt
  - room-preview detail question
  - booking-collect compound detail turn with an LLM `CHECK_IN` response mocked in

## Result Summary
- Compile check passed.
- Existing intent-router test suite passed: `138 passed`, `1 xfailed`.
- Direct router validation passed for all three target Module 2 behaviors:
  - family recommendation -> `BOOK_ROOM`
  - preview detail question -> `GENERAL_QUERY`
  - booking-collect compound turn no longer hijacked by `CHECK_IN`
- The live backend smoke script could not be used in this module because the local backend server was not running at validation time.

## Notes for Module 3
- Module 3 should focus on booking orchestration and next-screen transitions in [`agent/nodes.py`](c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1\KIOSK_BACKEND_V2_PYTHON\agent\nodes.py), especially:
  - keeping preview detail requests anchored in `ROOM_PREVIEW`
  - preventing named room selection from skipping preview
  - advancing `BOOKING_SUMMARY` confirmation to `PAYMENT`
  - preserving booking context when edits happen from summary
