Back & Cancel UI Policy

Frontend Authority Rules (Kiosk System)

Purpose

This document defines how Back and Cancel controls must be implemented in the frontend while preserving Agent authority.

The frontend is a Dumb Renderer + Intent Emitter.
Navigation decisions are never made in UI code.

Core Principles (Non-Negotiable)
1. Agent is the Sole Authority

The frontend does not decide where Back or Cancel goes.

The frontend only emits intents.

The Agent decides whether an intent causes a transition or a No-Op.

2. Back and Cancel are Intents, NOT Navigation
Action	Intent Emitted
Back	BACK_REQUESTED
Cancel	CANCEL_REQUESTED

The frontend must not:

compute a “previous page”

store navigation history

use router history (push, pop, etc.)

3. Rendering a Button ≠ Permission to Navigate

Rendering a Back or Cancel button:

does not guarantee a transition

only guarantees an intent emission

If the Agent rejects the intent:

UI stays exactly where it is

no retries

no fallback logic

This is expected behavior.

When to Show Back / Cancel Buttons
Allowed Rule

A page may render Back/Cancel if it is meaningful to the user.

Forbidden Rule

A page must never hide or show buttons based on assumed navigation logic.

✅ Allowed:

<Button onClick={() => emit("BACK_REQUESTED")}>Back</Button>


❌ Forbidden:

if (state === "SCAN_ID") goBack()

Page-Level Responsibilities

Each page owns its own controls.

SCAN_ID Page

Show Back → emits BACK_REQUESTED

Show Cancel → emits CANCEL_REQUESTED

No auto-advance

No retry logic

ROOM_SELECT Page

Show Back → emits BACK_REQUESTED

Show Cancel → emits CANCEL_REQUESTED

“Confirm” button may exist, but if intent is missing → expect No-Op

PAYMENT Page (Future)

Show Cancel (mandatory)

Back optional (Agent decides)

Never allow voice input

KEY_DISPENSING Page

No Back

No Cancel

No buttons unless Agent explicitly supports it

ERROR Page

Single action:

“Tap to Restart” → emits TOUCH_SELECTED

No voice

No multiple choices

Visual Consistency Rules

Back button position should be consistent across pages

Cancel button must be visually stronger than Back

Button presence is UX, not logic

What the Frontend Must NEVER Do

🚫 Never change state directly
🚫 Never infer previous screen
🚫 Never auto-advance
🚫 Never “fix” stuck states
🚫 Never emit multiple intents for one action
🚫 Never bypass the AgentAdapter

If something feels stuck → that is a design signal, not a bug.

Debugging Guidance for Frontend

If a button “does nothing”:

Check which intent is emitted

Check current Agent state

Check TRANSITION_TABLE

If No-Op → behavior is correct

Frontend must not patch around it.

Mental Model to Remember

Frontend asks. Agent decides. UI obeys.

Why This Policy Exists

Prevents logic duplication

Enables voice & touch parity

Makes kiosk behavior predictable

Protects against unsafe navigation

Scales to hardware + backend integration