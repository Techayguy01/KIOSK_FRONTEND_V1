# Kiosk AI Platform - Standard Operating Procedures (SOP)

**Document Version:** 1.0  
**Platform:** Kiosk AI Platform (Nexus / Siya Assistant)  
**Prepared From:** Source code plus latest screenshots in `Kiosk Images/`  
**Last Updated:** April 15, 2026  
**Classification:** Internal Operations

---

## Table of Contents

### Part A - Overview
- [A1. Platform Identity](#a1-platform-identity)
- [A2. Screenshot Inventory](#a2-screenshot-inventory)
- [A3. Role and Interaction Modes](#a3-role-and-interaction-modes)

### Part B - Core Guest Journey SOPs
- [SOP-K-01: Start Session from Idle Attract Screen](#sop-k-01-start-session-from-idle-attract-screen)
- [SOP-K-02: Operate Voice Welcome Mode](#sop-k-02-operate-voice-welcome-mode)
- [SOP-K-03: Operate Manual Menu Mode](#sop-k-03-operate-manual-menu-mode)
- [SOP-K-04: Browse and Select Rooms](#sop-k-04-browse-and-select-rooms)
- [SOP-K-05: Use Room Preview and Voice Prompts](#sop-k-05-use-room-preview-and-voice-prompts)
- [SOP-K-06: Collect Booking Details](#sop-k-06-collect-booking-details)
- [SOP-K-07: Confirm Booking Summary](#sop-k-07-confirm-booking-summary)
- [SOP-K-08: Complete Payment Simulation](#sop-k-08-complete-payment-simulation)
- [SOP-K-09: Monitor Key Dispensing State](#sop-k-09-monitor-key-dispensing-state)
- [SOP-K-10: Complete and Reset Session](#sop-k-10-complete-and-reset-session)

### Part C - Check-In Flow SOPs (OCR Path)
- [SOP-K-11: Run ID Scan and OCR Match](#sop-k-11-run-id-scan-and-ocr-match)
- [SOP-K-12: Confirm Check-In Against Matched Booking](#sop-k-12-confirm-check-in-against-matched-booking)

### Part D - Appendix
- [Appendix A: API Dependency Map for Each Step](#appendix-a-api-dependency-map-for-each-step)
- [Appendix B: Inferred Gaps and Missing Screenshots](#appendix-b-inferred-gaps-and-missing-screenshots)

---

## Part A - Overview

### A1. Platform Identity

| Field | Value |
|---|---|
| Product Name | Nexus Kiosk Interface |
| Assistant Name | Siya |
| Primary Purpose | Self-service hotel check-in and room booking |
| Interaction Modes | Voice-first mode and touch/manual mode |
| Frontend Runtime | React + Vite app at `/:tenantSlug/*` |
| Backend Runtime | FastAPI + LangGraph (`/api/*`) |
| Data Store | Neon PostgreSQL |

### A2. Screenshot Inventory

| # | File | Mapped SOP |
|---|---|---|
| 1 | `Screenshot 2026-04-15 152358.png` | SOP-K-01 |
| 2 | `Screenshot 2026-04-15 152406.png` | SOP-K-02 |
| 3 | `Screenshot 2026-04-15 152413.png` | SOP-K-03 |
| 4 | `Screenshot 2026-04-15 155456.png` | SOP-K-04 |
| 5 | `Screenshot 2026-04-15 155504.png` | SOP-K-05 |
| 6 | `Screenshot 2026-04-15 155612.png` | SOP-K-06 |
| 7 | `Screenshot 2026-04-15 155618.png` | SOP-K-07 |
| 8 | `Screenshot 2026-04-15 155628.png` | SOP-K-08 |
| 9 | `Screenshot 2026-04-15 155634.png` | SOP-K-09 |
| 10 | `Screenshot 2026-04-15 155638.png` | SOP-K-10 |

### A3. Role and Interaction Modes

| Actor | Capabilities |
|---|---|
| Guest | Voice booking, manual booking, payment simulation, session restart |
| Frontdesk Operator | Can intervene via manual mode and hidden language panel |
| System Operator | Monitors backend APIs, OCR quality, and check-in persistence |

---

## Part B - Core Guest Journey SOPs

### SOP-K-01: Start Session from Idle Attract Screen

| Field | Value |
|---|---|
| SOP ID | SOP-K-01 |
| Trigger | Idle screen displayed and guest touches screen |
| Primary UI State | `IDLE` |

#### Screenshot
![Idle Attract Screen](../Kiosk%20Images/Screenshot%202026-04-15%20152358.png)

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | Ensure kiosk shows the branded idle attract screen with "TOUCH ANYWHERE TO START". | System is in passive waiting mode. |
| 2 | Guest taps anywhere on screen. | Intent `PROXIMITY_DETECTED` is emitted. |
| 3 | Verify navigation to welcome flow. | UI transitions from `IDLE` to `WELCOME`. |

---

### SOP-K-02: Operate Voice Welcome Mode

| Field | Value |
|---|---|
| SOP ID | SOP-K-02 |
| Trigger | Voice-mode welcome appears |
| Primary UI States | `WELCOME`, `AI_CHAT` |

#### Screenshot
![Voice Welcome Mode](../Kiosk%20Images/Screenshot%202026-04-15%20152406.png)

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | On welcome voice UI, verify orb animation and microphone CTA. | Voice mode ready indicator is visible. |
| 2 | Guest taps mic button or starts speaking. | Voice session starts through `VoiceRuntime`. |
| 3 | Speak intent such as "check in" or "book a room". | Transcript goes to backend via `brain.service` and `/api/chat`. |
| 4 | Observe assistant speech and route transition. | State moves according to backend response (`SCAN_ID` or `ROOM_SELECT`). |

---

### SOP-K-03: Operate Manual Menu Mode

| Field | Value |
|---|---|
| SOP ID | SOP-K-03 |
| Trigger | User taps "Use Touch" or manual mode |
| Primary UI State | `MANUAL_MENU` |

#### Screenshot
![Manual Menu Mode](../Kiosk%20Images/Screenshot%202026-04-15%20152413.png)

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | From welcome, switch to touch/manual mode. | Three action cards render: Check In, Book Room, Help. |
| 2 | Tap **Check In**. | Emits `CHECK_IN_SELECTED`; route goes to scan/check-in path. |
| 3 | Tap **Book Room**. | Emits `BOOK_ROOM_SELECTED`; route goes to room flow. |
| 4 | Optionally tap "Switch to Voice Mode". | Voice mode request flow is initiated. |

---

### SOP-K-04: Browse and Select Rooms

| Field | Value |
|---|---|
| SOP ID | SOP-K-04 |
| Trigger | Room catalog is loaded |
| Primary UI State | `ROOM_SELECT` |

#### Screenshot
![Room Catalog](../Kiosk%20Images/Screenshot%202026-04-15%20155456.png)

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | Confirm room cards are visible with images, amenities, capacities, and pricing. | `/api/rooms` data rendered successfully. |
| 2 | Swipe/browse room options and compare if needed. | Room cards and compare controls remain responsive. |
| 3 | Tap **Choose Room** on desired card. | Emits `ROOM_SELECTED` with selected room payload. |
| 4 | Verify transition. | State advances to `ROOM_PREVIEW`. |

---

### SOP-K-05: Use Room Preview and Voice Prompts

| Field | Value |
|---|---|
| SOP ID | SOP-K-05 |
| Trigger | Selected room opens in preview |
| Primary UI State | `ROOM_PREVIEW` |

#### Screenshot
![Room Preview](../Kiosk%20Images/Screenshot%202026-04-15%20155504.png)

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | Verify selected room story carousel and room details panel. | Preview context displays visuals and key room stats. |
| 2 | Use prompt chips (price, amenities, more photos). | Emits `GENERAL_QUERY` intents with room-focused transcript. |
| 3 | Tap **Continue with this room** or equivalent confirm action. | Emits `CONFIRM_BOOKING` and progresses booking collection. |
| 4 | If room is unsuitable, choose "Show other rooms". | Returns to room browsing path. |

---

### SOP-K-06: Collect Booking Details

| Field | Value |
|---|---|
| SOP ID | SOP-K-06 |
| Trigger | Booking form/progress rail appears |
| Primary UI State | `BOOKING_COLLECT` |

#### Screenshot
![Booking Collect](../Kiosk%20Images/Screenshot%202026-04-15%20155612.png)

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | Verify booking progress rail includes room, guests, dates, guest name, nights, and total. | Current slot completion status is visible. |
| 2 | Provide details by voice or manual edit mode. | Slot fields update as backend returns `accumulatedSlots`. |
| 3 | Use **Edit details** for corrections if needed. | Constraint validation runs before progression. |
| 4 | Click **Continue to review** once complete. | Emits `CONFIRM_BOOKING`; transitions to summary. |

---

### SOP-K-07: Confirm Booking Summary

| Field | Value |
|---|---|
| SOP ID | SOP-K-07 |
| Trigger | Booking summary card is shown |
| Primary UI State | `BOOKING_SUMMARY` |

#### Screenshot
![Booking Summary](../Kiosk%20Images/Screenshot%202026-04-15%20155618.png)

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | Verify room, guests, dates, duration, guest name, and total amount. | All required booking slots are finalized. |
| 2 | If edits are needed, select **Modify**. | Emits `MODIFY_BOOKING`; returns to collection flow. |
| 3 | Select **Confirm & Pay**. | Emits `CONFIRM_PAYMENT`; backend route proceeds to payment. |

---

### SOP-K-08: Complete Payment Simulation

| Field | Value |
|---|---|
| SOP ID | SOP-K-08 |
| Trigger | Payment terminal simulation screen appears |
| Primary UI State | `PAYMENT` |

#### Screenshot
![Payment Simulation](../Kiosk%20Images/Screenshot%202026-04-15%20155628.png)

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | Review reservation summary card (room and final total). | Guest confirms bill before payment action. |
| 2 | Tap **Simulate Card Insert**. | Emits `CONFIRM_PAYMENT`. |
| 3 | Observe processing completion. | Transition begins towards key dispensing. |

---

### SOP-K-09: Monitor Key Dispensing State

| Field | Value |
|---|---|
| SOP ID | SOP-K-09 |
| Trigger | Dispensing indicator appears |
| Primary UI State | `KEY_DISPENSING` |

#### Screenshot
![Key Dispensing](../Kiosk%20Images/Screenshot%202026-04-15%20155634.png)

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | Verify loading indicator with "Dispensing Key Card...". | Guest is informed key operation is in progress. |
| 2 | Do not interrupt unless timeout/error appears. | System should auto-progress to completion state. |

---

### SOP-K-10: Complete and Reset Session

| Field | Value |
|---|---|
| SOP ID | SOP-K-10 |
| Trigger | Completion screen appears |
| Primary UI State | `COMPLETE` |

#### Screenshot
![Completion Screen](../Kiosk%20Images/Screenshot%202026-04-15%20155638.png)

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | Verify success message, assigned room context, and booking reference. | Guest receives booking completion confirmation. |
| 2 | Tap **Start New Session** after guest leaves. | Emits `RESET`; flow returns to initial state. |
| 3 | Confirm privacy reset behavior. | Previous transcript/session context is cleared. |

---

## Part C - Check-In Flow SOPs (OCR Path)

### SOP-K-11: Run ID Scan and OCR Match

| Field | Value |
|---|---|
| SOP ID | SOP-K-11 |
| Trigger | Check-in flow enters scan step |
| Primary UI State | `SCAN_ID` |

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | Start from manual/voice check-in path. | UI enters identity scan page. |
| 2 | Capture ID using webcam scanner. | Frontend posts image data to `/api/ocr`. |
| 3 | Review extraction confidence and matching status. | OCR returns fields and optional matched booking payload. |
| 4 | On weak/partial extraction, rescan. | User remains in scan/verify path until acceptable result. |

---

### SOP-K-12: Confirm Check-In Against Matched Booking

| Field | Value |
|---|---|
| SOP ID | SOP-K-12 |
| Trigger | OCR has produced booking candidate |
| Primary UI States | `ID_VERIFY`, `CHECK_IN_SUMMARY` |

#### Procedure

| Step | Action | Expected Result |
|---|---|---|
| 1 | Verify extracted identity fields against booking details. | Operator/guest confirms name and booking alignment. |
| 2 | Click **Confirm Identity** then **Confirm Check-In**. | Frontend calls `/api/checkin/confirm`. |
| 3 | Validate success response (`CHECKED_IN`). | Booking row updated with `checked_in_at` and `checkin_status`. |
| 4 | If mismatch/error, use rescan/back options. | User can retry without corrupting booking state. |

---

## Part D - Appendix

### Appendix A: API Dependency Map for Each Step

| Journey Step | API(s) |
|---|---|
| Tenant bootstrap | `GET /api/tenant`, `GET /api/faqs` |
| Room browse | `GET /api/rooms` |
| Voice/manual intenting | `POST /api/chat` |
| OCR identity | `POST /api/ocr` |
| Check-in persist | `POST /api/checkin/confirm` |
| STT | `POST /api/voice/stt` |
| TTS | `POST /api/voice/tts` |
| Session cleanup | `DELETE /api/chat/{session_id}` |

### Appendix B: Inferred Gaps and Missing Screenshots

The following flows are implemented in code but not represented in the provided screenshot set:

| Gap | File/State |
|---|---|
| ID scan UI screenshot | `ScanIdPage.tsx` / `SCAN_ID` |
| ID verification screenshot | `IdVerifyPage.tsx` / `ID_VERIFY` |
| Check-in summary screenshot | `CheckInSummaryPage.tsx` / `CHECK_IN_SUMMARY` |
| Explicit error state screenshot | `ERROR` runtime route |

---

*End of Kiosk AI Platform SOP Document*  
*Generated using source-driven workflow mapping and 10 screenshots from `Kiosk Images`.*
