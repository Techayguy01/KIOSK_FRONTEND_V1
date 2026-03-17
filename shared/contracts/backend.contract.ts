// contracts/backend.contract.ts

export type UIState =
  | 'IDLE'
  | 'WELCOME'
  | 'AI_CHAT'
  | 'MANUAL_MENU'
  | 'SCAN_ID'
  | 'ID_VERIFY'
  | 'CHECK_IN_SUMMARY'
  | 'ROOM_SELECT'
  | 'ROOM_PREVIEW'
  | 'BOOKING_COLLECT'
  | 'BOOKING_SUMMARY'
  | 'PAYMENT'
  | 'KEY_DISPENSING'
  | 'COMPLETE'
  | 'ERROR';

/**
 * States that the backend chat endpoint currently accepts from the frontend.
 * Keep this aligned with Python `agent/state.py::UIScreen`.
 */
export const BACKEND_CHAT_ACCEPTED_STATES: readonly UIState[] = [
  'IDLE',
  'WELCOME',
  'AI_CHAT',
  'MANUAL_MENU',
  'SCAN_ID',
  'ID_VERIFY',
  'CHECK_IN_SUMMARY',
  'ROOM_SELECT',
  'BOOKING_COLLECT',
  'BOOKING_SUMMARY',
  'PAYMENT',
  'KEY_DISPENSING',
  'COMPLETE',
  'ERROR',
] as const;

/**
 * Frontend presentation surfaces that are chat-compatible but not backend-owned
 * booking progression states.
 */
export const FRONTEND_PRESENTATION_STATES: readonly UIState[] = [
  'AI_CHAT',
  'MANUAL_MENU',
  'ROOM_PREVIEW',
] as const;

/** Safe fallback when an unknown state arrives at a chat boundary. */
export const BACKEND_STATE_NORMALIZATION_FALLBACK: UIState = 'WELCOME';

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  timestamp: number;
}

export interface BackendResponse {
  ui_state: UIState;
  messages?: ChatMessage[]; // Chat history for Voice/AI mode
  text_response?: string;   // Legacy/Simple response
  audio_url?: string;
  metadata?: Record<string, any>;
}
