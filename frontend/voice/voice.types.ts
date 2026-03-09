export type VoiceSessionEndReason =
    | "user"
    | "pause"
    | "timeout_no_speech"
    | "timeout_no_result"
    | "session_timeout"
    | "permission_denied"
    | "hard_stop";

export type VoiceSessionErrorReason =
    | "stt_permission_denied"
    | "stt_recoverable"
    | "stt_fatal"
    | "tts_failure"
    | "unknown";

export type VoiceEvent =
    | { type: "VOICE_SESSION_STARTED" }
    | { type: "VOICE_TRANSCRIPT_PARTIAL"; transcript: string }
    | { type: "VOICE_TRANSCRIPT_READY"; transcript: string }
    | { type: "VOICE_SESSION_ENDED"; reason?: VoiceSessionEndReason; hadTranscript?: boolean }
    | { type: "VOICE_SESSION_ABORTED" }  // Phase 10: Watchdog/silence timeout
    | { type: "VOICE_SESSION_ERROR"; reason?: VoiceSessionErrorReason; fatal?: boolean; recoverable?: boolean; detail?: string };   // Phase 10: STT/TTS failure
