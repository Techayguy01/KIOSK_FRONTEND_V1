export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export interface TenantConfigDTO {
  timezone: string;
  supportPhone: string;
  checkInTime: string;
}

export interface TenantDTO {
  id: string;
  name: string;
  slug: string;
  plan: string;
  hotelConfig?: TenantConfigDTO | null;
}

export interface TenantResponseDTO {
  tenant: TenantDTO | null;
  requestId?: string;
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

export interface RoomsResponseDTO {
  rooms: RoomDTO[];
  requestId?: string;
}

export interface ChatRequestDTO {
  transcript?: string;
  currentState?: string;
  sessionId?: string;
  activeSlot?: BookingSlotName | null;
  expectedType?: BookingSlotExpectedType | null;
  lastSystemPrompt?: string;
  filledSlots?: Record<string, unknown>;
  conversationHistory?: ChatTurnDTO[];
}

export interface ChatResponseDTO {
  speech: string;
  intent: string;
  confidence: number;
}

export interface BookingChatResponseDTO extends ChatResponseDTO {
  extractedSlots?: Record<string, unknown>;
  extractedValue?: string | number | null;
  accumulatedSlots?: Record<string, unknown>;
  missingSlots?: string[];
  nextSlotToAsk?: string | null;
  isComplete?: boolean;
  persistedBookingId?: string | null;
}

export type BookingSlotName =
  | "roomType"
  | "adults"
  | "children"
  | "checkInDate"
  | "checkOutDate"
  | "guestName";

export type BookingSlotExpectedType = "number" | "date" | "string";

export interface ChatTurnDTO {
  role: "user" | "assistant";
  content: string;
}

// --- Kiosk Runtime Contracts ---

export interface KioskDeviceDTO {
  id: string;
  tenantId: string;
  deviceCode: string;
  name?: string;
  location?: string;
  status: 'online' | 'offline' | 'maintenance';
  lastHeartbeat?: string;
}

export interface KioskSessionDTO {
  id: string;
  tenantId: string;
  deviceId?: string;
  sessionToken: string;
  language: string;
  startedAt: string;
  endedAt?: string;
  finalState?: 'COMPLETE' | 'IDLE' | 'ERROR';
}

export interface CreateKioskSessionRequest {
  deviceId?: string;
  language?: string;
}

export interface UpdateKioskSessionRequest {
  finalState: 'COMPLETE' | 'IDLE' | 'ERROR';
}
