/**
 * TTS Type Definitions (Phase 9.1)
 * 
 * Strict types for Text-to-Speech events.
 * TTS is OUTPUT ONLY - it does NOT decide what to say.
 */

export type TtsEvent =
    | { type: "TTS_STARTED"; text: string }
    | { type: "TTS_ENDED"; text?: string }
    | { type: "TTS_CANCELLED"; reason?: "barge_in" | "hard_stop" | "state_change" }
    | { type: "TTS_ERROR"; error: string; text?: string; fallbackToText?: boolean };

export type TtsState = "IDLE" | "SPEAKING";
