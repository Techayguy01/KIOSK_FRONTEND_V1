export type VoiceEvent =
    | { type: "VOICE_SESSION_STARTED" }
    | { type: "VOICE_TRANSCRIPT_PARTIAL"; transcript: string }
    | { type: "VOICE_TRANSCRIPT_READY"; transcript: string }
    | { type: "VOICE_SESSION_ENDED" }
    | { type: "VOICE_SESSION_ABORTED" }  // Phase 10: Watchdog/silence timeout
    | { type: "VOICE_SESSION_ERROR" };   // Phase 10: STT/TTS failure
