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
}

export interface ChatResponseDTO {
  speech: string;
  intent: string;
  confidence: number;
}

export interface BookingChatResponseDTO extends ChatResponseDTO {
  extractedSlots?: Record<string, unknown>;
  accumulatedSlots?: Record<string, unknown>;
  missingSlots?: string[];
  nextSlotToAsk?: string | null;
  isComplete?: boolean;
  persistedBookingId?: string | null;
}
