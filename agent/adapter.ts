import { Intent } from "../contracts/intents";
import { processIntent, UiState } from "./index";

/**
 * AgentAdapter (Singleton)
 * 
 * The SOLE bridge between the Frontend (React) and the Agent Brain (processIntent).
 * - Maintains the current authoritative state.
 * - Dispatches intents to the pure Agent function.
 * - Notifies subscribers (UI) of state changes.
 */
class AgentAdapterService {
    private state: UiState = "IDLE";
    private listeners: ((state: UiState) => void)[] = [];

    constructor() {
        console.log("[AgentAdapter] Initialized. Current State:", this.state);
    }

    /**
     * Returns the current state synchronously.
     */
    public getState(): UiState {
        return this.state;
    }

    /**
     * Subscribe to state changes.
     * Returns an unsubscribe function.
     */
    public subscribe(listener: (state: UiState) => void): () => void {
        this.listeners.push(listener);
        // Emit current state immediately to new subscriber
        listener(this.state);

        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * Dispatch an Intent to the Agent Brain.
     * This is the ONLY way to change state.
     */
    public dispatch(intent: Intent, payload?: any) {
        console.log(`[AgentAdapter] Dispatching Intent: ${intent}`, payload ? payload : "");

        // 1. Ask Brain for next state
        const response = processIntent(intent, this.state, (msg) => console.log(msg));

        // 2. Check if state actually changed
        if (response.ui_state !== this.state) {
            const previousState = this.state;
            this.state = response.ui_state;

            console.log(`[AgentAdapter] State Transition: ${previousState} -> ${this.state}`);

            // 3. Notify Listeners
            this.notifyListeners();
        } else {
            console.log(`[AgentAdapter] No Transition (Stuck): ${this.state}`);
        }
    }

    private notifyListeners() {
        this.listeners.forEach(listener => listener(this.state));
    }

    // debug / testing utility to force reset if needed (though restart semantics usually handle this)
    public _reset() {
        this.state = "IDLE";
        this.notifyListeners();
    }
}

export const AgentAdapter = new AgentAdapterService();
