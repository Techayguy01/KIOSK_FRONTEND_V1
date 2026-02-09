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
      HELP_SELECTED: 'WELCOME', // Stay on page, show notification
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
      HELP_SELECTED: 'IDLE' // or HELP state if exists
    },
    canGoBack: true
  },
  MANUAL_MENU: {
    on: {
      CHECK_IN_SELECTED: 'SCAN_ID',
      BOOK_ROOM_SELECTED: 'ROOM_SELECT',
      HELP_SELECTED: 'IDLE'
    },
    canGoBack: true
  },
  SCAN_ID: {
    on: { SCAN_COMPLETED: 'ROOM_SELECT' },
    canGoBack: true
  },
  ROOM_SELECT: {
    on: { ROOM_SELECTED: 'PAYMENT' },
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
   * (Simple stack logic for linear flows)
   */
  getPreviousState: (current: UIState): UIState => {
    // Phase 11.7: Simple Linear Flow for Demo
    const flow: UIState[] = ['IDLE', 'WELCOME', 'SCAN_ID', 'ROOM_SELECT', 'PAYMENT'];
    const idx = flow.indexOf(current);
    if (idx > 0) return flow[idx - 1];

    // Fallback for non-linear states
    if (current === 'MANUAL_MENU') return 'WELCOME';
    if (current === 'AI_CHAT') return 'WELCOME';
    if (current === 'ERROR') return 'WELCOME';

    return 'IDLE';
  }
};