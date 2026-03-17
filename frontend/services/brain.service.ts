/**
 * Brain Service - Voice-to-Agent Bridge
 *
 * Connects voice transcripts to the backend LLM and dispatches
 * the returned intents to the Agent FSM.
 *
 * RULE: This is a TRANSLATOR, not a CONTROLLER.
 * It sends transcripts, receives intents, and forwards them.
 * It NEVER decides flow or navigation.
 */

import { AgentAdapter } from "../agent/adapter";
import { buildTenantApiUrl, getCurrentTenantLanguage, getTenantHeaders, getTenantSlug } from "./tenantContext";
import type { BookingChatResponseDTO, ChatRequestDTO, ChatResponseDTO } from "@contracts/api.contract";
import { normalizeBackendStateFromResponse, normalizeStateForBackendChat } from "./uiStateInterop";
import { buildCacheKey, getCachedFaqAnswer, putCachedFaqAnswer } from "./faqCache.service";

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
    roomCatalog?: unknown[];
}

// Subscribers who want to know about brain responses (e.g., TTS, UI)
type BrainResponseListener = (response: BrainResponse) => void;
const listeners: BrainResponseListener[] = [];

const FAQ_CACHE_BLOCKED_STATES = new Set([
    "SCAN_ID",
    "ID_VERIFY",
    "CHECK_IN_SUMMARY",
    "ROOM_SELECT",
    "ROOM_PREVIEW",
    "BOOKING_COLLECT",
    "BOOKING_SUMMARY",
    "PAYMENT",
    "KEY_DISPENSING",
    "COMPLETE",
]);

const TRANSACTIONAL_CHECK_IN_PATTERN = /\b(i want to check[\s-]?in|check me in|start check[\s-]?in|begin check[\s-]?in)\b/i;
const TRANSACTIONAL_BOOKING_PATTERN = /\b(confirm booking|cancel booking|modify booking|book a room|make a booking|start booking|reserve a room)\b/i;
const FAQ_INFO_PATTERN = /\b(what|when|where|which|how|time|timing|hours?|breakfast|wifi|parking|pool|check[\s-]?(in|out)|check and|second time)\b/i;

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

function shouldUseFaqCache(transcript: string, currentState: string): boolean {
    const cleaned = (transcript || "").trim();
    if (!cleaned) return false;
    if (FAQ_CACHE_BLOCKED_STATES.has(currentState)) return false;
    if (TRANSACTIONAL_CHECK_IN_PATTERN.test(cleaned)) return false;
    if (TRANSACTIONAL_BOOKING_PATTERN.test(cleaned)) return false;
    if (!FAQ_INFO_PATTERN.test(cleaned)) return false;
    return true;
}

function dispatchFromConfidence(data: BrainResponse): void {
    if (data.confidence >= 0.85) {
        console.log(`[BrainService] HIGH confidence (${data.confidence}) - Dispatching: ${data.intent}`);
        AgentAdapter.dispatch(data.intent as any, {
            speech: data.speech,
            selectedRoom: data.selectedRoom,
            slots: data.accumulatedSlots,
            missingSlots: data.missingSlots,
            nextSlotToAsk: data.nextSlotToAsk,
            nextUiScreen: data.nextUiScreen,
            isComplete: data.isComplete,
            visualFocus: data.visualFocus,
            backendDecision: true,
        });
    } else if (data.confidence >= 0.50) {
        console.log(`[BrainService] MEDIUM confidence (${data.confidence}) - Dispatching with clarification: ${data.intent}`);
        AgentAdapter.dispatch(data.intent as any, {
            speech: data.speech,
            selectedRoom: data.selectedRoom,
            slots: data.accumulatedSlots,
            missingSlots: data.missingSlots,
            nextSlotToAsk: data.nextSlotToAsk,
            nextUiScreen: data.nextUiScreen,
            isComplete: data.isComplete,
            needsClarification: true,
            visualFocus: data.visualFocus,
            backendDecision: true,
        });
    } else {
        console.log(`[BrainService] LOW confidence (${data.confidence}) - NOT dispatching, speech only`);
    }
}

export function resetSession(): void {
    AgentAdapter.clearSession("brain_service_reset");
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
    const tenantSlug = getTenantSlug();
    const activeLanguage = getCurrentTenantLanguage();
    const lookupKey = `${tenantSlug || "default"}::${activeLanguage}::${transcript}`;
    const sessionId = AgentAdapter.getCurrentSessionId();

    console.log(`[BrainService] Sending to V2 Brain: "${transcript}" (State: ${backendCurrentState})`);
    console.log(`[BrainService][FAQCache] eligibility=${shouldUseFaqCache(transcript, currentState)} key=${lookupKey}`);

    if (shouldUseFaqCache(transcript, currentState)) {
        const cachedFaq = await getCachedFaqAnswer(tenantSlug, transcript, activeLanguage);
        if (cachedFaq) {
            const cachedResponse: BrainResponse = {
                speech: cachedFaq.answer,
                intent: "GENERAL_QUERY",
                confidence: Math.max(cachedFaq.confidence, 0.92),
                nextUiScreen: backendCurrentState as any,
                answerSource: "FAQ_CACHE",
                faqId: cachedFaq.faqId ?? null,
                sessionId,
                language: activeLanguage,
            };
            console.log(`[BrainService][FAQCache] HIT key=${cachedFaq.cacheKey} faqId=${cachedResponse.faqId || "none"}`);
            notifyListeners(cachedResponse);
            dispatchFromConfidence(cachedResponse);
            return cachedResponse;
        }

        // Exact cache MISS -> Send to backend for semantic matching
        console.log(`[BrainService][FAQCache] MISS key=${lookupKey} -> Searching backend semantic engine`);
    }

    // V2 Python backend payload - note snake_case fields to match FastAPI ChatRequest
    const payload: any = {
        transcript,
        session_id: sessionId,
        // Normalize before crossing the API boundary.
        current_ui_screen: backendCurrentState,
        tenant_id: "default",
        tenant_slug: tenantSlug,
        language: activeLanguage,
    };

    // Pass along extra context if available (V2 can use this for memory)
    if (options?.filledSlots && Object.keys(options.filledSlots).length > 0) {
        payload.filled_slots = options.filledSlots;
    }
    if (Array.isArray(options?.roomCatalog) && options!.roomCatalog.length > 0) {
        payload.room_catalog = options!.roomCatalog;
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
        console.log("[BrainService] /api/chat response:", data);
        console.log(`[BrainService] answerSource=${data.answerSource || "missing"}`);
        const normalizedNextUiScreen = normalizeBackendStateFromResponse(data.nextUiScreen);
        if (data.nextUiScreen && !normalizedNextUiScreen) {
            console.warn(`[BrainService] Ignoring unknown backend nextUiScreen: ${data.nextUiScreen}`);
        }
        if (normalizedNextUiScreen) {
            data.nextUiScreen = normalizedNextUiScreen;
        }

        if (data.answerSource === "FAQ_DB") {
            console.log(`[BrainService][FAQCache] WRITE_PATH faqId=${data.faqId || "none"} lang=${activeLanguage}`);
            await putCachedFaqAnswer({
                tenantSlug,
                langCode: activeLanguage,
                transcript,
                answer: data.speech,
                faqId: data.faqId ?? null,
                confidence: data.confidence,
            });
            console.log(`[BrainService][FAQCache] STORED faqId=${data.faqId || "none"} lang=${activeLanguage}`);
        }

        console.log("[BrainService] Brain response:", data);

        // 1. Notify listeners (TTS will speak, UI will show response)
        notifyListeners(data);

        // 2. Confidence-based intent dispatch
        dispatchFromConfidence(data);

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
