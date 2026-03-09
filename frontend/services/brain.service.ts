/**
 * Brain Service — Voice-to-Agent Bridge
 * 
 * Connects voice transcripts to the backend LLM and dispatches
 * the returned intents to the Agent FSM.
 * 
 * RULE: This is a TRANSLATOR, not a CONTROLLER.
 * It sends transcripts, receives intents, and forwards them.
 * It NEVER decides flow or navigation.
 */

import { AgentAdapter } from "../agent/adapter";
import { buildTenantApiUrl, getTenantHeaders, getTenantSlug } from "./tenantContext";
import type { BookingChatResponseDTO, ChatRequestDTO, ChatResponseDTO } from "@contracts/api.contract";
import { normalizeBackendStateFromResponse, normalizeStateForBackendChat } from "./uiStateInterop";

// States that use the booking endpoint
const BOOKING_STATES = ["BOOKING_COLLECT", "BOOKING_SUMMARY", "ROOM_SELECT"];

export type BrainResponse = ChatResponseDTO & Partial<BookingChatResponseDTO>;
type BrainTurn = { role: "user" | "assistant"; text: string };

export interface SendToBrainOptions {
    slotContext?: {
        activeSlot: string | null;
        expectedType: "number" | "date" | "string" | null;
        promptAsked: string;
    };
    filledSlots?: Record<string, unknown>;
    conversationHistory?: BrainTurn[];
}

// Subscribers who want to know about brain responses (e.g., TTS, UI)
type BrainResponseListener = (response: BrainResponse) => void;
const listeners: BrainResponseListener[] = [];

/** Subscribe to brain responses (for TTS playback, UI updates, etc.) */
export function onBrainResponse(listener: BrainResponseListener): () => void {
    listeners.push(listener);
    return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
    };
}

/** Notify all listeners */
function notifyListeners(response: BrainResponse): void {
    listeners.forEach(listener => {
        try {
            listener(response);
        } catch (e) {
            console.error("[BrainService] Listener error:", e);
        }
    });
}

/** Generate a simple session ID (persists per page load) */
let sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function resetSession(): void {
    sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log("[BrainService] Session reset:", sessionId);
}

/**
 * Send a transcript to the backend brain and dispatch the result.
 * 
 * @param transcript - The user's speech text
 * @param currentState - Current Agent FSM state
 * @returns The brain's response (also dispatched to Agent and listeners)
 */
export async function sendToBrain(
    transcript: string,
    currentState: string,
    options?: SendToBrainOptions
): Promise<BrainResponse | null> {
    if (!transcript || transcript.trim().length === 0) {
        console.log("[BrainService] Empty transcript, skipping");
        return null;
    }

    // V2 Python backend: unified /api/chat handles all states
    const url = buildTenantApiUrl("chat");

    const backendCurrentState = normalizeStateForBackendChat(currentState);
    console.log(`[BrainService] Sending to V2 Brain: "${transcript}" (State: ${backendCurrentState})`);

    // V2 Python backend payload — note snake_case fields to match FastAPI ChatRequest
    const payload: any = {
        transcript,
        session_id: sessionId,
        // Normalize before crossing the API boundary.
        current_ui_screen: backendCurrentState, // V2 uses current_ui_screen, not currentState
        tenant_id: "default",
        tenant_slug: getTenantSlug(),
    };

    // Pass along extra context if available (V2 can use this for memory)
    if (options?.filledSlots && Object.keys(options.filledSlots).length > 0) {
        payload.filled_slots = options.filledSlots;
    }

    console.log("[BrainService] Outgoing payload:", payload);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getTenantHeaders() },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Brain returned ${response.status}`);
        }

        const data: BrainResponse = await response.json();
        const normalizedNextUiScreen = normalizeBackendStateFromResponse(data.nextUiScreen);
        if (data.nextUiScreen && !normalizedNextUiScreen) {
            console.warn(`[BrainService] Ignoring unknown backend nextUiScreen: ${data.nextUiScreen}`);
        }
        if (normalizedNextUiScreen) {
            data.nextUiScreen = normalizedNextUiScreen;
        }
        console.log("[BrainService] Brain response:", data);

        // 1. Notify listeners (TTS will speak, UI will show response)
        notifyListeners(data);

        // 2. Confidence-based intent dispatch
        if (data.confidence >= 0.85) {
            // HIGH confidence: Execute immediately
            console.log(`[BrainService] HIGH confidence (${data.confidence}) — Dispatching: ${data.intent}`);
            AgentAdapter.dispatch(data.intent as any, {
                speech: data.speech,
                selectedRoom: data.selectedRoom,
                slots: data.accumulatedSlots,
                missingSlots: data.missingSlots,
                nextSlotToAsk: data.nextSlotToAsk,
                nextUiScreen: data.nextUiScreen,
                isComplete: data.isComplete,
                backendDecision: true,
            });
        } else if (data.confidence >= 0.50) {
            // MEDIUM confidence: Dispatch but the LLM should have asked a clarifying question
            // The speech response likely contains "Did you mean...?" — let it play
            console.log(`[BrainService] MEDIUM confidence (${data.confidence}) — Dispatching with clarification: ${data.intent}`);
            AgentAdapter.dispatch(data.intent as any, {
                speech: data.speech,
                selectedRoom: data.selectedRoom,
                slots: data.accumulatedSlots,
                missingSlots: data.missingSlots,
                nextSlotToAsk: data.nextSlotToAsk,
                nextUiScreen: data.nextUiScreen,
                isComplete: data.isComplete,
                needsClarification: true,
                backendDecision: true,
            });
        } else {
            // LOW confidence: Do NOT dispatch intent, only speak the response
            // The LLM should say "I didn't catch that, could you repeat?"
            console.log(`[BrainService] LOW confidence (${data.confidence}) — NOT dispatching, speech only`);
            // Don't dispatch to agent — just let listeners handle the speech
        }

        return data;

    } catch (error) {
        console.error("[BrainService] Failed to reach brain:", error);

        // Notify listeners of failure (UI can show error, TTS can apologize)
        const fallback: BrainResponse = {
            speech: "I'm having trouble connecting. Please try again or use the touch screen.",
            intent: "UNKNOWN",
            confidence: 0.0,
        };
        notifyListeners(fallback);

        return fallback;
    }
}
