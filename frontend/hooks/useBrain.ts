import { useState, useEffect, useCallback } from "react";
import { sendToBrain, onBrainResponse, resetSession, BrainResponse } from "../services/brain.service";
import { useUIState } from "../state/uiContext";
import { AgentAdapter } from "../agent/adapter";

/**
 * useBrain Hook
 * 
 * Provides components with:
 * - lastResponse: The most recent brain response
 * - bookingSlots: Accumulated booking data
 * - isProcessing: Whether a request is in flight
 * - sendTranscript: Function to send a transcript to the brain
 * - resetBrainSession: Function to wipe session
 */
export function useBrain() {
    const { state } = useUIState();
    const [lastResponse, setLastResponse] = useState<BrainResponse | null>(null);
    const [bookingSlots, setBookingSlots] = useState<Record<string, any>>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [conversationHistory, setConversationHistory] = useState<
        { role: "user" | "assistant"; text: string }[]
    >([]);

    // Subscribe to brain responses
    useEffect(() => {
        const unsubscribe = onBrainResponse((response) => {
            setLastResponse(response);
            setIsProcessing(false);

            // Update accumulated slots
            if (response.accumulatedSlots) {
                setBookingSlots(response.accumulatedSlots);
            }

            // Update conversation history
            if (response.speech) {
                setConversationHistory(prev => [
                    ...prev,
                    { role: "assistant", text: response.speech }
                ]);
            }
        });

        return unsubscribe;
    }, []);

    // Reset on WELCOME/IDLE
    useEffect(() => {
        if (state === "WELCOME" || state === "IDLE") {
            setBookingSlots({});
            setConversationHistory([]);
            setLastResponse(null);
            resetSession();
        }
    }, [state]);

    const sendTranscript = useCallback(async (transcript: string) => {
        setIsProcessing(true);
        const nextHistory = [...conversationHistory, { role: "user" as const, text: transcript }];

        // Add user message to history
        setConversationHistory(nextHistory);

        await sendToBrain(transcript, state, {
            slotContext: AgentAdapter.getSlotContext(),
            filledSlots: bookingSlots,
            conversationHistory: nextHistory,
        });
    }, [state, bookingSlots, conversationHistory]);

    return {
        lastResponse,
        bookingSlots,
        isProcessing,
        conversationHistory,
        sendTranscript,
        resetBrainSession: resetSession,
    };
}
