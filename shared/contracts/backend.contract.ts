// contracts/backend.contract.ts

export type UIState =
  | 'IDLE'
  | 'WELCOME'
  | 'AI_CHAT'
  | 'MANUAL_MENU'
  | 'SCAN_ID'
  | 'ROOM_SELECT'
  | 'BOOKING_COLLECT'
  | 'BOOKING_SUMMARY'
  | 'PAYMENT'
  | 'KEY_DISPENSING'
  | 'COMPLETE'
  | 'ERROR';

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