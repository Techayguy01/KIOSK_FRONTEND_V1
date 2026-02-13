import { useEffect, useRef, useCallback } from "react";

/**
 * useVoiceTimeout
 * 
 * Monitors silence during booking and provides gentle prompts.
 * 
 * Behavior:
 * - 5 seconds silence → soft nudge (via brain response)
 * - 15 seconds silence → offer touch screen alternative
 * - 45 seconds silence → return to IDLE (privacy)
 */

interface VoiceTimeoutOptions {
    enabled: boolean;
    currentState: string;
    onSoftNudge: () => void;
    onTouchFallback: () => void;
    onPrivacyTimeout: () => void;
}

export function useVoiceTimeout(options: VoiceTimeoutOptions) {
    const { enabled, currentState, onSoftNudge, onTouchFallback, onPrivacyTimeout } = options;
    const lastActivityRef = useRef<number>(Date.now());
    const nudgedRef = useRef(false);
    const fallbackRef = useRef(false);

    // Reset on any new brain response or state change
    const resetTimer = useCallback(() => {
        lastActivityRef.current = Date.now();
        nudgedRef.current = false;
        fallbackRef.current = false;
    }, []);

    useEffect(() => {
        if (!enabled) return;

        const interval = setInterval(() => {
            const elapsed = Date.now() - lastActivityRef.current;

            if (elapsed > 45000) {
                // 45s: Privacy timeout
                onPrivacyTimeout();
                clearInterval(interval);
            } else if (elapsed > 15000 && !fallbackRef.current) {
                // 15s: Touch screen suggestion
                fallbackRef.current = true;
                onTouchFallback();
            } else if (elapsed > 5000 && !nudgedRef.current) {
                // 5s: Gentle nudge
                nudgedRef.current = true;
                onSoftNudge();
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [enabled, currentState, onSoftNudge, onTouchFallback, onPrivacyTimeout]);

    return { resetTimer };
}
