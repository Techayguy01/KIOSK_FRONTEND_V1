// contracts/events.contract.ts

export type UIEventType = 
  | 'START_SESSION'
  | 'CHECK_IN_SELECTED'
  | 'BOOK_ROOM_SELECTED'
  | 'HELP_SELECTED'
  | 'SCAN_COMPLETED'
  | 'ROOM_SELECTED'
  | 'CONFIRM_PAYMENT'
  | 'DISPENSE_COMPLETE'
  | 'RESET'
  | 'VOICE_INPUT_START'
  | 'VOICE_INPUT_END'
  | 'ERROR'
  | 'ERROR_DISMISSED'
  | 'BACK_REQUESTED';

export interface UIEvent {
  type: UIEventType;
  payload?: any;
}

export type UIEventHandler = (event: UIEvent) => void;