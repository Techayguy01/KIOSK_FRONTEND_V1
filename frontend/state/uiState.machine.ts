import { UIState } from '@contracts/backend.contract';

type TransitionMap = Record<string, UIState>;
type StateConfig = Record<UIState, { on: TransitionMap; canGoBack: boolean }>;

// DEFINITION OF TRUTH
const MACHINE_CONFIG: StateConfig = {
  IDLE: {
    on: { PROXIMITY_DETECTED: 'WELCOME', TOUCH_SELECTED: 'WELCOME' },
    canGoBack: false
  },
  WELCOME: {
    on: {
      CHECK_IN_SELECTED: 'SCAN_ID',
      BOOK_ROOM_SELECTED: 'ROOM_SELECT',
      HELP_SELECTED: 'HELP',
      TOUCH_SELECTED: 'MANUAL_MENU',
      EXPLAIN_CAPABILITIES: 'WELCOME',
      GENERAL_QUERY: 'WELCOME'
    },
    canGoBack: true
  },
  AI_CHAT: {
    on: {
      CHECK_IN_SELECTED: 'SCAN_ID',
      BOOK_ROOM_SELECTED: 'ROOM_SELECT',
      HELP_SELECTED: 'HELP'
    },
    canGoBack: true
  },
  MANUAL_MENU: {
    on: {
      CHECK_IN_SELECTED: 'SCAN_ID',
      BOOK_ROOM_SELECTED: 'ROOM_SELECT',
      HELP_SELECTED: 'HELP'
    },
    canGoBack: true
  },
  SCAN_ID: {
    on: {
      OCR_SUCCESS: 'ID_VERIFY',
      OCR_DEMO_SUCCESS: 'ID_VERIFY',
      SCAN_COMPLETED: 'ID_VERIFY',
      RESCAN: 'SCAN_ID',
      BACK_REQUESTED: 'WELCOME',
      CANCEL_REQUESTED: 'WELCOME'
    },
    canGoBack: true
  },
  ID_VERIFY: {
    on: {
      CONFIRM_ID: 'CHECK_IN_SUMMARY',
      RESCAN: 'SCAN_ID',
      BACK_REQUESTED: 'SCAN_ID',
      CANCEL_REQUESTED: 'WELCOME',
      RESET: 'IDLE'
    },
    canGoBack: true
  },
  CHECK_IN_SUMMARY: {
    on: {
      CONFIRM_CHECKIN: 'KEY_DISPENSING',
      RESCAN: 'SCAN_ID',
      BACK_REQUESTED: 'ID_VERIFY',
      CANCEL_REQUESTED: 'WELCOME',
      RESET: 'IDLE'
    },
    canGoBack: true
  },
  ROOM_SELECT: {
    on: {
      ROOM_SELECTED: 'ROOM_PREVIEW',
      HELP_SELECTED: 'HELP',
      BACK_REQUESTED: 'MANUAL_MENU',
      CANCEL_REQUESTED: 'WELCOME'
    },
    canGoBack: true
  },
  ROOM_PREVIEW: {
    on: {
      ROOM_SELECTED: 'ROOM_PREVIEW',
      ASK_ROOM_DETAIL: 'ROOM_PREVIEW',
      ASK_PRICE: 'ROOM_PREVIEW',
      COMPARE_ROOMS: 'ROOM_PREVIEW',
      GENERAL_QUERY: 'ROOM_PREVIEW',
      HELP_SELECTED: 'HELP',
      MODIFY_BOOKING: 'ROOM_PREVIEW',
      SELECT_ROOM: 'ROOM_PREVIEW',
      PROVIDE_GUESTS: 'BOOKING_COLLECT',
      PROVIDE_DATES: 'BOOKING_COLLECT',
      PROVIDE_NAME: 'BOOKING_COLLECT',
      CONFIRM_BOOKING: 'BOOKING_COLLECT',
      BOOK_ROOM_SELECTED: 'BOOKING_COLLECT',
      CANCEL_BOOKING: 'ROOM_SELECT',
      BACK_REQUESTED: 'ROOM_SELECT'
    },
    canGoBack: true
  },
  BOOKING_COLLECT: {
    on: {
      PROVIDE_GUESTS: 'BOOKING_COLLECT',
      PROVIDE_DATES: 'BOOKING_COLLECT',
      PROVIDE_NAME: 'BOOKING_COLLECT',
      SELECT_ROOM: 'BOOKING_COLLECT',
      ASK_ROOM_DETAIL: 'BOOKING_COLLECT',
      ASK_PRICE: 'BOOKING_COLLECT',
      GENERAL_QUERY: 'BOOKING_COLLECT',
      MODIFY_BOOKING: 'BOOKING_COLLECT',
      CONFIRM_BOOKING: 'BOOKING_SUMMARY',
      CANCEL_BOOKING: 'ROOM_SELECT',
      BACK_REQUESTED: 'ROOM_SELECT',
      HELP_SELECTED: 'HELP',
      RESET: 'IDLE'
    },
    canGoBack: true
  },
  BOOKING_SUMMARY: {
    on: {
      CONFIRM_PAYMENT: 'PAYMENT',
      MODIFY_BOOKING: 'BOOKING_COLLECT',
      HELP_SELECTED: 'HELP',
      BACK_REQUESTED: 'BOOKING_COLLECT',
      CANCEL_BOOKING: 'WELCOME',
      RESET: 'IDLE'
    },
    canGoBack: true
  },
  HELP: {
    on: {
      BACK_REQUESTED: 'WELCOME',
      CANCEL_REQUESTED: 'WELCOME',
      RESET: 'IDLE'
    },
    canGoBack: true
  },
  PAYMENT: {
    on: { CONFIRM_PAYMENT: 'KEY_DISPENSING' },
    canGoBack: true
  },
  KEY_DISPENSING: {
    on: { DISPENSE_COMPLETE: 'COMPLETE' },
    canGoBack: false // Hardware lock
  },
  COMPLETE: {
    on: { RESET: 'IDLE', PROXIMITY_DETECTED: 'WELCOME' },
    canGoBack: false
  },
  ERROR: {
    on: { RESET: 'IDLE', BACK_REQUESTED: 'WELCOME' },
    canGoBack: true
  }
};

export const StateMachine = {
  /**
   * pure function to determine next state
   */
  transition: (currentState: UIState, event: string): UIState => {
    const rules = MACHINE_CONFIG[currentState];
    if (!rules || !rules.on[event]) {
      // console.warn(`[StateMachine] No transition for ${currentState} -> ${event}`);
      return currentState; // Stay put if invalid
    }
    return rules.on[event];
  },

  /**
   * pure function to determine metadata
   */
  getMetadata: (state: UIState) => {
    const config = MACHINE_CONFIG[state];
    return {
      canGoBack: config ? config.canGoBack : false
    };
  },

  /**
   * helper to find "previous" logical state for Back button
   * Uses explicit journey-aware mappings instead of a single mixed linear flow.
   */
  getPreviousState: (current: UIState): UIState => {
    const previousStateMap: Partial<Record<UIState, UIState>> = {
      WELCOME: 'IDLE',
      AI_CHAT: 'WELCOME',
      MANUAL_MENU: 'WELCOME',
      SCAN_ID: 'MANUAL_MENU',
      ID_VERIFY: 'SCAN_ID',
      CHECK_IN_SUMMARY: 'ID_VERIFY',
      ROOM_SELECT: 'MANUAL_MENU',
      ROOM_PREVIEW: 'ROOM_SELECT',
      BOOKING_COLLECT: 'ROOM_PREVIEW',
      BOOKING_SUMMARY: 'BOOKING_COLLECT',
      HELP: 'WELCOME',
      PAYMENT: 'BOOKING_SUMMARY',
      KEY_DISPENSING: 'PAYMENT',
      COMPLETE: 'WELCOME',
      ERROR: 'WELCOME'
    };

    return previousStateMap[current] || 'IDLE';
  }
};
