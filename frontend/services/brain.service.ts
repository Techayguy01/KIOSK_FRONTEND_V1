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
import { buildTenantApiUrl, getTenantHeaders } from "./tenantContext";
import type { BookingChatResponseDTO, ChatResponseDTO } from "@contracts/api.contract";

// States that use the booking endpoint
const BOOKING_STATES = ["BOOKING_COLLECT", "BOOKING_SUMMARY", "ROOM_SELECT"];

export type BrainResponse = ChatResponseDTO & Partial<BookingChatResponseDTO>;

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
    currentState: string
): Promise<BrainResponse | null> {
    if (!transcript || transcript.trim().length === 0) {
        console.log("[BrainService] Empty transcript, skipping");
        return null;
    }

    // Decide which endpoint based on current state
    const isBookingMode = BOOKING_STATES.includes(currentState);
    const url = isBookingMode ? buildTenantApiUrl("chat/booking") : buildTenantApiUrl("chat");

    console.log(`[BrainService] Sending to ${isBookingMode ? "Booking" : "General"} Brain: "${transcript}" (State: ${currentState})`);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getTenantHeaders() },
            body: JSON.stringify({
                transcript,
                currentState,
                sessionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`Brain returned ${response.status}`);
        }

        const data: BrainResponse = await response.json();
        console.log("[BrainService] Brain response:", data);

        // 1. Notify listeners (TTS will speak, UI will show response)
        notifyListeners(data);

        // 2. Confidence-based intent dispatch
        if (data.confidence >= 0.85) {
            // HIGH confidence: Execute immediately
            console.log(`[BrainService] HIGH confidence (${data.confidence}) — Dispatching: ${data.intent}`);
            AgentAdapter.dispatch(data.intent as any, {
                speech: data.speech,
                slots: data.accumulatedSlots,
                isComplete: data.isComplete,
            });
        } else if (data.confidence >= 0.50) {
            // MEDIUM confidence: Dispatch but the LLM should have asked a clarifying question
            // The speech response likely contains "Did you mean...?" — let it play
            console.log(`[BrainService] MEDIUM confidence (${data.confidence}) — Dispatching with clarification: ${data.intent}`);
            AgentAdapter.dispatch(data.intent as any, {
                speech: data.speech,
                slots: data.accumulatedSlots,
                isComplete: data.isComplete,
                needsClarification: true,
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
