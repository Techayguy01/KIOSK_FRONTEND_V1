# Shared Code Documentation

## 1. Folder Structure

```text
KIOSK_FRONTEND_V1/shared/
`-- contracts/
    |-- api.contract.ts        # API DTOs for tenant, room, and chat endpoints
    |-- backend.contract.ts    # UI state and backend response contract
    |-- booking.contract.ts    # Booking model (single source of truth)
    |-- events.contract.ts     # Frontend UI event contract
    `-- intents.ts             # Cross-layer intent union
```

---

## 2. Code Files

### a) `shared/contracts/backend.contract.ts`

```typescript
export type UIState =
  | "IDLE"
  | "WELCOME"
  | "AI_CHAT"
  | "MANUAL_MENU"
  | "SCAN_ID"
  | "ROOM_SELECT"
  | "BOOKING_COLLECT"
  | "BOOKING_SUMMARY"
  | "PAYMENT"
  | "KEY_DISPENSING"
  | "COMPLETE"
  | "ERROR";

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  timestamp: number;
}

export interface BackendResponse {
  ui_state: UIState;
  messages?: ChatMessage[];
  text_response?: string;
  audio_url?: string;
  metadata?: Record<string, any>;
}
```

### b) `shared/contracts/api.contract.ts`

```typescript
export interface TenantDTO {
  id: string;
  name: string;
  slug: string;
  plan: string;
  hotelConfig?: {
    timezone: string;
    supportPhone: string;
    checkInTime: string;
  } | null;
}

export interface RoomDTO {
  id: string;
  name: string;
  price: number;
  currency: string;
  image: string;
  features: string[];
  code?: string;
}

export interface ChatRequestDTO {
  transcript?: string;
  currentState?: string;
  sessionId?: string;
}

export interface ChatResponseDTO {
  speech: string;
  intent: string;
  confidence: number;
}
```

### c) `shared/contracts/booking.contract.ts`

```typescript
export type RoomType = "STANDARD" | "DELUXE" | "PRESIDENTIAL";

export interface BookingSlots {
  roomType: RoomType | null;
  adults: number | null;
  children: number | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  guestName: string | null;
  nights: number | null;
  totalPrice: number | null;
}

export function createEmptyBooking(): BookingSlots;
export function getMissingSlots(slots: BookingSlots): string[];
export function isBookingComplete(slots: BookingSlots): boolean;
```

### d) `shared/contracts/events.contract.ts`

```typescript
export type UIEventType =
  | "START_SESSION"
  | "CHECK_IN_SELECTED"
  | "BOOK_ROOM_SELECTED"
  | "HELP_SELECTED"
  | "SCAN_COMPLETED"
  | "ROOM_SELECTED"
  | "CONFIRM_PAYMENT"
  | "DISPENSE_COMPLETE"
  | "RESET"
  | "VOICE_INPUT_START"
  | "VOICE_INPUT_END"
  | "ERROR"
  | "ERROR_DISMISSED"
  | "BACK_REQUESTED";

export interface UIEvent {
  type: UIEventType;
  payload?: any;
}
```

### e) `shared/contracts/intents.ts`

```typescript
export type Intent =
  | "PROXIMITY_DETECTED"
  | "VOICE_STARTED"
  | "VOICE_TRANSCRIPT_RECEIVED"
  | "VOICE_SILENCE"
  | "TOUCH_SELECTED"
  | "CHECK_IN_SELECTED"
  | "BOOK_ROOM_SELECTED"
  | "HELP_SELECTED"
  | "SCAN_COMPLETED"
  | "ROOM_SELECTED"
  | "CONFIRM_PAYMENT"
  | "DISPENSE_COMPLETE"
  | "RESET"
  | "BACK_REQUESTED"
  | "CANCEL_REQUESTED"
  | "EXPLAIN_CAPABILITIES"
  | "GENERAL_QUERY"
  | "SELECT_ROOM"
  | "PROVIDE_GUESTS"
  | "PROVIDE_DATES"
  | "PROVIDE_NAME"
  | "CONFIRM_BOOKING"
  | "MODIFY_BOOKING"
  | "CANCEL_BOOKING"
  | "ASK_ROOM_DETAIL"
  | "COMPARE_ROOMS"
  | "ASK_PRICE";
```

---

## 3. Contract Definitions Overview

### Backend Contract (`backend.contract.ts`)

`UIState` controls what the frontend renders. Current states:

| State | Description |
|---|---|
| `IDLE` | Attract/waiting state |
| `WELCOME` | Greeting / entry state |
| `AI_CHAT` | Conversational assistant active |
| `MANUAL_MENU` | Manual touch flow menu |
| `SCAN_ID` | Identity scan step |
| `ROOM_SELECT` | Room selection view |
| `BOOKING_COLLECT` | Slot-filling data collection step |
| `BOOKING_SUMMARY` | Review/confirm booking summary |
| `PAYMENT` | Payment processing step |
| `KEY_DISPENSING` | Keycard dispensing |
| `COMPLETE` | Flow completed |
| `ERROR` | Error handling state |

### API Contract (`api.contract.ts`)

Shared DTO layer used by API boundaries:

- Tenant: `TenantDTO`, `TenantConfigDTO`, `TenantResponseDTO`
- Rooms: `RoomDTO`, `RoomsResponseDTO`
- Chat: `ChatRequestDTO`, `ChatResponseDTO`, `BookingChatResponseDTO`
- Errors: `ApiErrorBody`

### Booking Contract (`booking.contract.ts`)

This file is the **Single Source of Truth** for booking data across frontend and backend.

- Core data model: `BookingSlots`
- Allowed room types: `RoomType`
- Shared slot utilities: `createEmptyBooking`, `getMissingSlots`, `isBookingComplete`
- Booking-specific intent set: `BookingIntent`
- Booking response shape: `BookingResponse`

### Intent Contract (`intents.ts`)

`Intent` currently includes **27 values** in source. Categories:

- System: `PROXIMITY_DETECTED`, `RESET`
- Voice: `VOICE_STARTED`, `VOICE_TRANSCRIPT_RECEIVED`, `VOICE_SILENCE`
- Core actions: `TOUCH_SELECTED`, `CHECK_IN_SELECTED`, `BOOK_ROOM_SELECTED`, `HELP_SELECTED`, `SCAN_COMPLETED`, `ROOM_SELECTED`, `CONFIRM_PAYMENT`, `DISPENSE_COMPLETE`
- Navigation: `BACK_REQUESTED`, `CANCEL_REQUESTED`
- AI/general: `EXPLAIN_CAPABILITIES`, `GENERAL_QUERY`
- Booking: `SELECT_ROOM`, `PROVIDE_GUESTS`, `PROVIDE_DATES`, `PROVIDE_NAME`, `CONFIRM_BOOKING`, `MODIFY_BOOKING`, `CANCEL_BOOKING`, `ASK_ROOM_DETAIL`, `COMPARE_ROOMS`, `ASK_PRICE`

---

## 4. Import Patterns

```typescript
// Frontend
import { UIState, BackendResponse } from "@/shared/contracts/backend.contract";
import { UIEvent, UIEventType } from "@/shared/contracts/events.contract";
import { Intent } from "@/shared/contracts/intents";
import { TenantDTO, RoomDTO, ChatRequestDTO, ChatResponseDTO } from "@/shared/contracts/api.contract";
import { BookingSlots, BookingResponse, createEmptyBooking } from "@/shared/contracts/booking.contract";

// Backend
import { UIState, BackendResponse } from "../shared/contracts/backend.contract";
import { UIEvent, UIEventType } from "../shared/contracts/events.contract";
import { Intent } from "../shared/contracts/intents";
import { TenantDTO, RoomDTO, ChatRequestDTO, ChatResponseDTO } from "../shared/contracts/api.contract";
import { BookingSlots, BookingResponse, createEmptyBooking } from "../shared/contracts/booking.contract";
```

---

## 5. Architecture Principles

- Frontend renders from `ui_state` and emits events/intents.
- Backend owns flow decisions and returns state transitions.
- `shared/contracts/*` is the strict integration boundary.
- Contract changes must be coordinated across both sides.

---

**End of Shared Documentation**

