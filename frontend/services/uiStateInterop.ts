import {
  BACKEND_CHAT_ACCEPTED_STATES,
  BACKEND_STATE_NORMALIZATION_FALLBACK,
  UIState,
} from "@contracts/backend.contract";

const ACCEPTED_STATE_SET = new Set<string>(BACKEND_CHAT_ACCEPTED_STATES);

const STATE_ALIASES: Record<string, UIState> = {
  "AI-CHAT": "AI_CHAT",
  AICHAT: "AI_CHAT",
  "MANUAL-MENU": "MANUAL_MENU",
  MANUALMENU: "MANUAL_MENU",
  "SCAN-ID": "SCAN_ID",
  "ID-VERIFY": "ID_VERIFY",
  IDVERIFY: "ID_VERIFY",
  "CHECK-IN-SUMMARY": "CHECK_IN_SUMMARY",
  CHECKINSUMMARY: "CHECK_IN_SUMMARY",
  ROOMSELECT: "ROOM_SELECT",
  ROOMPREVIEW: "ROOM_PREVIEW",
  BOOKINGCOLLECT: "BOOKING_COLLECT",
  BOOKINGSUMMARY: "BOOKING_SUMMARY",
  "KEY-DISPENSING": "KEY_DISPENSING",
};

const FRONTEND_TO_BACKEND_STATE_MAP: Record<string, UIState> = {
  ROOM_PREVIEW: "ROOM_SELECT",
};

export function isUiState(value: unknown): value is UIState {
  return typeof value === "string" && ACCEPTED_STATE_SET.has(value);
}

function canonicalizeStateToken(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "_");
}

/**
 * Normalize frontend state before sending to backend chat.
 * Unknown values are coerced to a safe fallback instead of leaking invalid tokens.
 */
export function normalizeStateForBackendChat(rawState: string | null | undefined): UIState {
  if (!rawState) return BACKEND_STATE_NORMALIZATION_FALLBACK;
  if (isUiState(rawState)) return rawState;

  const canonical = canonicalizeStateToken(rawState);
  const frontendMapped = FRONTEND_TO_BACKEND_STATE_MAP[canonical];
  if (frontendMapped) return frontendMapped;
  const mapped = STATE_ALIASES[canonical] || STATE_ALIASES[canonical.replace(/_/g, "")] || canonical;
  if (mapped === "ROOM_PREVIEW") return "ROOM_SELECT";
  if (isUiState(mapped)) return mapped;

  return BACKEND_STATE_NORMALIZATION_FALLBACK;
}

/**
 * Normalize `nextUiScreen` from backend response.
 * Returns null when no valid state can be resolved.
 */
export function normalizeBackendStateFromResponse(rawState: unknown): UIState | null {
  if (rawState === "ROOM_PREVIEW") return "ROOM_PREVIEW";
  if (isUiState(rawState)) return rawState;
  if (typeof rawState !== "string") return null;

  const canonical = canonicalizeStateToken(rawState);
  if (canonical === "ROOM_PREVIEW" || canonical === "ROOMPREVIEW") {
    return "ROOM_PREVIEW";
  }

  const normalized = normalizeStateForBackendChat(rawState);
  if (normalized === BACKEND_STATE_NORMALIZATION_FALLBACK) {
    if (!isUiState(canonical)) {
      return null;
    }
  }

  return normalized;
}
