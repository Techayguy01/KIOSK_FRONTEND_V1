import { UIState, ChatMessage } from '../contracts/backend.contract';
import { UIEventType } from '../contracts/events.contract';
import { sessionMock } from '../mocks/session.mock';
import { roomsMock } from '../mocks/rooms.mock';
import { voiceMock } from '../mocks/voice.mock';

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
    let nextState = this._state;
    let nextData = { ...this._data };

    switch (type) {
      case 'START_SESSION':
        nextState = 'WELCOME';
        this._messages = [{
          id: 'msg_init',
          role: 'assistant',
          text: "Hi, I'm Siya AI. How can I help you today?",
          timestamp: Date.now()
        }];
        nextData.listening = false;
        break;

      case 'VOICE_INPUT_START':
        nextData.listening = true;
        break;

      case 'VOICE_INPUT_END':
        nextData.listening = false;
        this.handleVoiceInteraction(); 
        break;

      case 'CHECK_IN_SELECTED':
        nextState = 'SCAN_ID';
        break;

      case 'BOOK_ROOM_SELECTED':
        nextState = 'ROOM_SELECT';
        nextData.rooms = roomsMock.available_rooms;
        break;

      case 'SCAN_COMPLETED':
        nextState = 'ROOM_SELECT';
        nextData.rooms = roomsMock.available_rooms;
        nextData.user = sessionMock.user;
        break;

      case 'ROOM_SELECTED':
        const room = payload.room;
        const nights = sessionMock.reservation.nights;
        const subtotal = room.price * nights;
        const taxes = 45.00;
        const total = subtotal + taxes;

        nextState = 'PAYMENT';
        nextData.selectedRoom = room;
        nextData.bill = {
          nights,
          subtotal: subtotal.toFixed(2),
          taxes: taxes.toFixed(2),
          total: total.toFixed(2),
          currencySymbol: room.currency === 'USD' ? '$' : room.currency
        };
        break;

      case 'CONFIRM_PAYMENT':
        nextState = 'KEY_DISPENSING';
        this.simulateHardwareDispense();
        break;

      case 'BACK_REQUESTED':
        // Backend Logic: Determine previous state based on current state
        if (this._state === 'WELCOME') nextState = 'IDLE';
        else if (this._state === 'SCAN_ID') nextState = 'WELCOME';
        else if (this._state === 'ROOM_SELECT') nextState = 'WELCOME'; // Simplified for mock
        else if (this._state === 'PAYMENT') nextState = 'ROOM_SELECT';
        break;

      case 'RESET':
        nextState = 'IDLE';
        nextData = {};
        this._messages = [];
        break;

      case 'HELP_SELECTED':
        console.log("[BACKEND] Staff notified.");
        this.addMessage('assistant', "I've notified a staff member to assist you.");
        break;
    }

    // Update Progress & Metadata
    nextData.progress = this.calculateProgress(nextState);
    
    // BACKEND AUTHORITY: Determine if Back is allowed
    // We inject this into the metadata
    nextData.metadata = {
      ...nextData.metadata,
      canGoBack: this.calculateCanGoBack(nextState)
    };

    this.updateState(nextState, nextData);
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

  private calculateCanGoBack(state: UIState): boolean {
    switch (state) {
      case 'IDLE': return false;
      case 'WELCOME': return true; // Can go back to Idle (Cancel)
      case 'SCAN_ID': return true;
      case 'ROOM_SELECT': return true;
      case 'PAYMENT': return true;
      case 'KEY_DISPENSING': return false; // Hardware lock
      case 'COMPLETE': return false;
      case 'ERROR': return true;
      default: return false;
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