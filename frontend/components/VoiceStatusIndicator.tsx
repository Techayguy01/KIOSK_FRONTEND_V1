import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PauseCircle, Volume2 } from "lucide-react";
import { UiState } from "../agent";
import { getCurrentTenantLanguage } from "../services/tenantContext";
import { VoiceRuntime, VoiceMode } from "../voice/VoiceRuntime";
import { VoiceSessionErrorReason } from "../voice/voice.types";
import { TTSController } from "../voice/TTSController";

type VoiceStatusKind = "listening" | "speaking" | "processing" | "paused" | "ready" | "unavailable";

type VoiceStatusIndicatorProps = {
    currentState: UiState;
    voiceEnabled: boolean;
};

const VOICE_RELEVANT_STATES = new Set<UiState>([
    "WELCOME",
    "AI_CHAT",
    "MANUAL_MENU",
    "ROOM_SELECT",
    "BOOKING_COLLECT",
    "BOOKING_SUMMARY",
    "PAYMENT",
]);

export const VoiceStatusIndicator: React.FC<VoiceStatusIndicatorProps> = ({ currentState, voiceEnabled }) => {
    const [mode, setMode] = useState<VoiceMode>(VoiceRuntime.getMode());
    const [isProcessing, setIsProcessing] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [unavailableReason, setUnavailableReason] = useState<VoiceSessionErrorReason | null>(null);
    const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearProcessingTimer = () => {
        if (!processingTimerRef.current) return;
        clearTimeout(processingTimerRef.current);
        processingTimerRef.current = null;
    };

    const startProcessingWindow = () => {
        clearProcessingTimer();
        setIsProcessing(true);
        // Keep this short so stale "processing" state does not linger.
        processingTimerRef.current = setTimeout(() => {
            setIsProcessing(false);
            processingTimerRef.current = null;
        }, 5000);
    };

    useEffect(() => {
        const unsubVoice = VoiceRuntime.subscribe((event) => {
            switch (event.type) {
                case "VOICE_TRANSCRIPT_READY":
                    startProcessingWindow();
                    break;
                case "VOICE_SESSION_STARTED":
                    clearProcessingTimer();
                    setIsProcessing(false);
                    setIsPaused(false);
                    setUnavailableReason(null);
                    break;
                case "VOICE_SESSION_ENDED":
                    clearProcessingTimer();
                    setIsProcessing(false);
                    setIsPaused(event.reason === "pause");
                    if (event.reason === "permission_denied") {
                        setUnavailableReason("stt_permission_denied");
                    }
                    break;
                case "VOICE_SESSION_ABORTED":
                    clearProcessingTimer();
                    setIsProcessing(false);
                    setIsPaused(false);
                    break;
                case "VOICE_SESSION_ERROR":
                    clearProcessingTimer();
                    setIsProcessing(false);
                    if (
                        event.reason === "stt_permission_denied" ||
                        event.reason === "stt_fatal" ||
                        event.fatal
                    ) {
                        setUnavailableReason(event.reason || "stt_fatal");
                    }
                    break;
                default:
                    break;
            }
        });

        const unsubMode = VoiceRuntime.onModeChange((nextMode) => {
            setMode(nextMode);
            if (nextMode === "listening" || nextMode === "speaking") {
                clearProcessingTimer();
                setIsProcessing(false);
                setIsPaused(false);
            }
        });

        const unsubTTS = TTSController.subscribe((event) => {
            if (event.type === "TTS_STARTED") {
                clearProcessingTimer();
                setIsProcessing(false);
                setIsPaused(false);
            }
        });

        return () => {
            unsubVoice();
            unsubMode();
            unsubTTS();
            clearProcessingTimer();
        };
    }, []);

    if (!VOICE_RELEVANT_STATES.has(currentState)) {
        return null;
    }

    const status = useMemo((): { kind: VoiceStatusKind; label: string } => {
        if (!voiceEnabled) {
            return { kind: "unavailable", label: "Voice unavailable" };
        }
        if (unavailableReason) {
            return { kind: "unavailable", label: "Voice unavailable" };
        }
        if (mode === "speaking") {
            return { kind: "speaking", label: "Speaking" };
        }
        if (isProcessing) {
            return { kind: "processing", label: "Processing" };
        }
        if (isPaused) {
            return { kind: "paused", label: "Paused" };
        }
        if (mode === "listening") {
            return { kind: "listening", label: "Listening" };
        }
        return { kind: "ready", label: "Tap mic to speak" };
    }, [isPaused, isProcessing, mode, unavailableReason, voiceEnabled]);

    const badgeClassByKind: Record<VoiceStatusKind, string> = {
        listening: "border-emerald-400/60 bg-emerald-500/15 text-emerald-100",
        speaking: "border-cyan-400/60 bg-cyan-500/15 text-cyan-100",
        processing: "border-amber-400/60 bg-amber-500/15 text-amber-100",
        paused: "border-slate-400/60 bg-slate-500/15 text-slate-100",
        ready: "border-blue-400/60 bg-blue-500/15 text-blue-100",
        unavailable: "border-rose-400/60 bg-rose-500/15 text-rose-100",
    };

    const icon = (() => {
        switch (status.kind) {
            case "speaking":
                return <Volume2 size={14} />;
            case "processing":
                return <Loader2 size={14} className="animate-spin" />;
            case "paused":
                return <PauseCircle size={14} />;
            case "unavailable":
                return <MicOff size={14} />;
            default:
                return <Mic size={14} />;
        }
    })();

    const canTapToToggle = voiceEnabled;
    const handleClick = () => {
        if (!canTapToToggle) return;
        if (mode === "listening") {
            VoiceRuntime.endSession();
            return;
        }
        if (mode === "idle") {
            setUnavailableReason(null);
            void VoiceRuntime.startSession(getCurrentTenantLanguage());
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={!canTapToToggle}
            className={`fixed left-4 bottom-4 z-40 flex w-[168px] items-center justify-center pointer-events-auto rounded-full border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-md transition-colors ${badgeClassByKind[status.kind]} ${canTapToToggle ? "hover:brightness-110" : "cursor-not-allowed opacity-85"}`}
            aria-live="polite"
            aria-label={`Voice status: ${status.label}`}
            title={`Voice status: ${status.label}`}
        >
            <span className="inline-flex items-center gap-2">
                {icon}
                {status.label}
            </span>
        </button>
    );
};
