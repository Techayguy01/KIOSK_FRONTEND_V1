import type { UIState } from "./backend.contract";
import type { KioskUiAction } from "./intents";

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
  supportPhone?: string | null;
  support_phone?: string | null;
  checkInTime: string;
  checkOutTime?: string;
  defaultLang?: string;
  availableLang?: string[];
  welcomeMessage?: string | null;
  supportEmail?: string | null;
  support_email?: string | null;
  address?: string | null;
  extra?: Record<string, any>;
  logoUrl?: string | null;
}

export interface TenantDTO {
  id: string;
  name: string;
  slug: string;
  plan: string;
  support_phone?: string | null;
  support_email?: string | null;
  address?: string | null;
  extra?: Record<string, any>;
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
  imageUrls?: string[];
  images?: RoomImageDTO[];
  features: string[];
  code?: string;
  maxAdults?: number | null;
  maxChildren?: number | null;
  maxTotalGuests?: number | null;
}

export interface RoomImageDTO {
  id?: string;
  url: string;
  tags?: string[];
  caption?: string | null;
  category?: string | null;
  displayOrder?: number | null;
  isPrimary?: boolean | null;
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
  assignedRoomNumber?: string | null;
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
  isGalleryFullscreen?: boolean;
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
  uiAction?: KioskUiAction | null;
  visualFocus?: VisualFocusDTO | null;
  answerSource?: "FAQ_DB" | "FAQ_CACHE" | "LLM" | "LOCAL_SIMILARITY" | "FAQ_FALLBACK";
  faqId?: string | null;
  normalizedQuery?: string;
  sessionId?: string;
  language?: string;
}

export interface VisualFocusDTO {
  imageId?: string | null;
  topic?: string | null;
  category?: string | null;
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
  assignedRoomId?: string | null;
  assignedRoomNumber?: string | null;
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
