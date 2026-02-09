/**
 * TTS Type Definitions (Phase 9.1)
 * 
 * Strict types for Text-to-Speech events.
 * TTS is OUTPUT ONLY - it does NOT decide what to say.
 */

export type TtsEvent =
    | { type: "TTS_STARTED"; text: string }
    | { type: "TTS_ENDED" }
    | { type: "TTS_CANCELLED" }
    | { type: "TTS_ERROR"; error: string };

export type TtsState = "IDLE" | "SPEAKING";
