import type { UIState } from "./backend.contract";

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

export interface OcrRequestDTO {
  imageDataUrl: string;
  language?: string;
  cropBox?: NormalizedCropBoxDTO;
}

export interface NormalizedCropBoxDTO {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrFieldsDTO {
  fullName?: string;
  documentNumber?: string;
  dateOfBirth?: string;
  yearOfBirth?: string;
  documentType?: string;
}

export interface OcrResultDTO {
  text: string;
  confidence: number;
  fields: OcrFieldsDTO;
}

export interface MatchedBookingDTO {
  id: string;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  status: string;
  roomTypeId: string;
  roomName?: string | null;
}

export interface OcrResponseDTO {
  ocr: OcrResultDTO;
  matchedBooking?: MatchedBookingDTO | null;
  multiplePossibleMatches?: boolean;
  weakExtraction?: boolean;
  extractionMessage?: string;
  requestId?: string;
}

export interface ChatRequestDTO {
  transcript?: string;
  currentState?: UIState;
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
  nextUiScreen?: UIState;
  sessionId?: string;
  language?: string;
}

export interface SelectedRoomHintDTO {
  id: string;
  name: string;
  displayName?: string | null;
  code?: string | null;
  price?: number | null;
  currency?: string | null;
}

export interface BookingChatResponseDTO extends ChatResponseDTO {
  extractedSlots?: Record<string, unknown>;
  extractedValue?: string | number | null;
  accumulatedSlots?: Record<string, unknown>;
  missingSlots?: string[];
  nextSlotToAsk?: string | null;
  selectedRoom?: SelectedRoomHintDTO | null;
  isComplete?: boolean;
  persistedBookingId?: string | null;
  error?: string;
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
