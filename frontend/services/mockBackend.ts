import { UIState, ChatMessage } from '../contracts/backend.contract';
import { UIEventType } from '../contracts/events.contract';
import { sessionMock } from '../mocks/session.mock';
import { roomsMock } from '../mocks/rooms.mock';
import { voiceMock } from '../mocks/voice.mock';
import { StateMachine } from '../state/uiState.machine';

// --- THE MOCK BACKEND AUTHORITY ---
// This class simulates the remote Antigravity Agent / Backend Server.
// It runs outside the React lifecycle.
// It is the ONLY source of truth for "What happens next".

type BackendListener = (state: UIState, data: any) => void;

class MockBackendService {
  // The Server's State
  private _state: UIState = 'IDLE';
  private _data: any = {};
  private _messages: ChatMessage[] = []; // Conversation History
  private _listeners: BackendListener[] = [];

  // Track history for simple "Back" logic in this mock
  // In a real app, this might be a complex state machine history
  private _previousState: UIState | null = null;

  constructor() {
    this._data = {};
  }

  public subscribe(listener: BackendListener): () => void {
    this._listeners.push(listener);
    this.broadcastToListener(listener);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  }

  public async sendIntent(type: UIEventType, payload?: any): Promise<void> {
    console.log(`[BACKEND SERVER] Processing Intent: ${type}`, payload);

    // Simulate Network Latency (Waiting State)
    if (type !== 'VOICE_INPUT_START' && type !== 'VOICE_INPUT_END') {
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    this.processIntent(type, payload);
  }

  private processIntent(type: UIEventType, payload: any) {
    // 0. GOD MODE BYPASS 🛡️ (Restored for Director)
    // The State Machine doesn't know about "FORCE_STATE", so we handle it here.
    if (type === 'FORCE_STATE' as any) {
      console.log(`[BACKEND] ⚡ FORCE OVERRIDE: ${payload.targetState}`);

      // Inject required data to prevent crashes
      const nextData = { ...this._data };
      if (payload.targetState === 'ROOM_SELECT') {
        nextData.rooms = require('../mocks/rooms.mock').roomsMock.available_rooms;
      }
      if (payload.targetState === 'PAYMENT') {
        // Fake a room selection if one doesn't exist
        if (!nextData.selectedRoom) {
          const rooms = require('../mocks/rooms.mock').roomsMock.available_rooms;
          nextData.selectedRoom = rooms[0];
          nextData.bill = { nights: 2, total: "450.00", currencySymbol: "$" };
        }
      }

      // Metadata Override (Allow Back)
      nextData.metadata = { ...nextData.metadata, canGoBack: true };

      this.updateState(payload.targetState, nextData);
      return; // Skip the State Machine
    }

    console.log(`[BACKEND] Processing: ${type} (Current: ${this._state})`);

    // 1. CALCULATE NEXT STATE (Using the Brain 🧠)
    const nextState = StateMachine.transition(this._state, type);

    // 2. HANDLE DATA UPDATES (Side Effects)
    const nextData = { ...this._data };

    // Load Rooms
    if (nextState === 'ROOM_SELECT' && this._state !== 'ROOM_SELECT') {
      nextData.rooms = roomsMock.available_rooms;
    }

    // Handle Selection Logic
    if (type === 'ROOM_SELECTED' && payload.room) {
      const room = payload.room;
      const nights = sessionMock.reservation.nights;
      const subtotal = room.price * nights;
      const taxes = 45.00;
      const total = subtotal + taxes;

      nextData.selectedRoom = room;
      nextData.bill = {
        nights,
        subtotal: subtotal.toFixed(2),
        taxes: taxes.toFixed(2),
        total: total.toFixed(2),
        currencySymbol: room.currency === 'USD' ? '$' : room.currency
      };
    }

    // Scan Completion Logic
    if (type === 'SCAN_COMPLETED') {
      nextData.rooms = roomsMock.available_rooms;
      nextData.user = sessionMock.user;
    }

    // Reset Logic
    if (type === 'RESET') {
      this._messages = [];
      // nextData is already cloned, but we might want to clear it?
      // The original code did nextData = {}
      // Let's rely on state. Next time we enter a state, we load data.
      // But let's look at the original RESET:
      // nextData = {};
    }

    if (type === 'START_SESSION') {
      this._messages = [{
        id: 'msg_init',
        role: 'assistant',
        text: "Hi, I'm Siya AI. How can I help you today?",
        timestamp: Date.now()
      }];
      nextData.listening = false;
    }

    // Help Message
    if (type === 'HELP_SELECTED') {
      console.log("[BACKEND] Staff notified.");
      this.addMessage('assistant', "I've notified a staff member to assist you.");
    }

    // 3. INJECT METADATA (Automated!)
    // No more manual "canGoBack" checks.
    const metadata = StateMachine.getMetadata(nextState);
    nextData.metadata = {
      ...nextData.metadata,
      ...metadata
    };

    // Update Progress (Keep this helper or move to Machine? Keep helper for now)
    nextData.progress = this.calculateProgress(nextState);

    // 4. COMMIT
    this.updateState(nextState, nextData);

    // 5. AUTO-FORWARDING (Hardware Sim)
    if (type === 'CONFIRM_PAYMENT') {
      this.simulateHardwareDispense();
    }
  }

  private async handleVoiceInteraction() {
    this.updateState(this._state, { ...this._data, listening: false });
    await new Promise(resolve => setTimeout(resolve, 600));
    this.addMessage('user', "I'd like to check in, please.");
    this.updateState(this._state, { ...this._data });
    await new Promise(resolve => setTimeout(resolve, 1000));
    this.addMessage('assistant', "I hear you. To proceed, please use the Manual Mode buttons for this test.");
    this.updateState(this._state, { ...this._data });
  }

  private addMessage(role: 'assistant' | 'user', text: string) {
    this._messages.push({
      id: `msg_${Date.now()}`,
      role,
      text,
      timestamp: Date.now()
    });
  }

  private calculateProgress(state: UIState) {
    const steps = ['ID Scan', 'Room', 'Payment', 'Key'];
    switch (state) {
      case 'SCAN_ID': return { currentStep: 1, totalSteps: 4, steps };
      case 'ROOM_SELECT': return { currentStep: 2, totalSteps: 4, steps };
      case 'PAYMENT': return { currentStep: 3, totalSteps: 4, steps };
      case 'COMPLETE': return { currentStep: 4, totalSteps: 4, steps };
      default: return null;
    }
  }



  private simulateHardwareDispense() {
    setTimeout(() => {
      const completedData = {
        ...this._data,
        progress: { currentStep: 4, totalSteps: 4, steps: ['ID Scan', 'Room', 'Payment', 'Key'] },
        metadata: { canGoBack: false }
      };
      this.updateState('COMPLETE', completedData);
    }, 2500);
  }

  private updateState(newState: UIState, newData: any) {
    this._state = newState;
    this._data = newData;
    this._listeners.forEach(l => this.broadcastToListener(l));
  }

  private broadcastToListener(listener: BackendListener) {
    listener(this._state, { ...this._data, messages: this._messages });
  }
}

export const BackendService = new MockBackendService();