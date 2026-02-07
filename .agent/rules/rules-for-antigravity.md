---
trigger: always_on
---


These rules apply to **anyone using Antigravity to modify or generate FRONTEND code**.
The goal is to ensure the frontend stays **merge-safe, backend-ready, and non-authoritative**.

Your job is to make the UI better — **not smarter**.

---

## 1. Frontend Is a Renderer, Not a Brain
You may:
- improve layout
- improve visuals
- improve animations
- improve accessibility
- improve responsiveness

You may NOT:
- decide flow
- infer intent
- auto-navigate
- simulate backend intelligence

> If the UI “figures something out”, it’s wrong.

---

## 2. Never Change Flow Logic
Do NOT:
- add timers that move screens
- chain screens together
- assume success or failure
- skip steps

All screen changes must happen **only** when `ui_state` changes.

---

## 3. `ui_state` Is Read-Only
- You can **read** `ui_state`
- You can **render** based on it
- You must NEVER mutate, derive, or replace it

❌ `if (state === SCAN_ID && success)`  
✅ `switch (ui_state) { … }`

---

## 4. Emit Intents, Never Outcomes
Frontend can emit:
- `CHECK_IN_SELECTED`
- `VOICE_INPUT_STARTED`
- `BACK_REQUESTED`

Frontend must NOT emit:
- `ID_VERIFIED`
- `PAYMENT_SUCCESS`
- `ROOM_ASSIGNED`

Those are backend conclusions.

---

## 5. Pages Must Be Dumb
A page:
- must not know what comes next
- must not know where it came from
- must not count steps
- must not handle retries

Pages only:
- render UI
- forward user actions

---

## 6. No Hidden Side Effects
Forbidden in frontend:
- `setTimeout` advancing flow
- `useEffect` that changes screens
- “demo flows”
- silent redirects

Animations are fine.  
State changes are not.

---

## 7. Voice UI Has No Meaning
Frontend voice features may:
- show transcript
- show “listening”
- animate orb
- play audio

Frontend voice features must NOT:
- parse speech
- detect intent
- trigger navigation

Speech is **just data**.

---

## 8. Manual Touch Is Explicit
Manual mode:
- must be user-triggered
- must be clearly labeled
- must not auto-enable

Touch ≠ permission to shortcut flow.

---

## 9. Back Button Is Not Navigation
Frontend:
- shows Back button
- emits `BACK_REQUESTED`

Frontend must NOT:
- track history
- decide destination
- assume previous page

---

## 10. No Business Data in UI
Do NOT:
- calculate prices
- apply discounts
- validate payments
- infer availability

If it smells like business logic → stop.

---

## 11. Respect Folder Ownership
You may safely change:
/pages
/components
/styles


You must NOT modify:
/state
/services
/api
/contracts


Those belong to backend integration.

---

## 12. Mock Data Must Be Swappable
- All data must come from `/mocks`
- No hardcoded values inside components
- UI must survive mock removal

If real data replaces mocks and UI breaks → fail.

---

## 13. Merge-Safety Rule (Critical)
Every frontend change must pass this question:

> “Can backend be plugged in later **without touching this file**?”

If the answer is no → reject the change.

---

## 14. If Unsure, Freeze
If you’re not sure whether something is frontend or backend:
- do nothing
- ask
- leave a placeholder

Guessing is worse than waiting.

---

## 15. Final Test
Delete backend logic entirely.

Expected result:
- UI renders
- buttons work
- chat shows
- **flow does NOT complete**s

If flow still completes → frontend crossed the line.

---

## Golden Rule

**Frontend makes things beautiful.  
Backend makes things correct.**

If you remember only one thing:
> **Never help the backend by being clever.**