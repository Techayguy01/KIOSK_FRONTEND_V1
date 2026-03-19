import React, { useEffect, useMemo, useRef, useState } from "react";
import { Hand, Loader2, Mic, MicOff, PauseCircle, Volume2 } from "lucide-react";
import { UiState } from "../agent";
import { getCurrentTenantLanguage } from "../services/tenantContext";
import { VoiceRuntime, VoiceMode } from "../voice/VoiceRuntime";
import { VoiceSessionErrorReason } from "../voice/voice.types";
import { TTSController } from "../voice/TTSController";

type VoiceStatusKind = "listening" | "speaking" | "processing" | "paused" | "ready" | "reconnecting" | "unavailable";
type InteractionMode = "manual" | "voice";
const RECOVERY_BADGE_MS = 3000;

type VoiceStatusIndicatorProps = {
    currentState: UiState;
    voiceEnabled: boolean;
    interactionMode: InteractionMode;
    pendingVoiceConfirm: boolean;
    voiceLocked?: boolean;
    onRequestVoiceMode?: () => void;
    onConfirmVoiceMode?: () => void;
    onCancelVoiceMode?: () => void;
    onRequestManualMode?: () => void;
};

const VOICE_RELEVANT_STATES = new Set<UiState>([
    "WELCOME",
    "AI_CHAT",
    "MANUAL_MENU",
    "ROOM_SELECT",
    "ROOM_PREVIEW",
    "BOOKING_COLLECT",
    "BOOKING_SUMMARY",
    "PAYMENT",
]);

export const VoiceStatusIndicator: React.FC<VoiceStatusIndicatorProps> = ({
    currentState,
    voiceEnabled,
    interactionMode,
    pendingVoiceConfirm,
    voiceLocked,
    onRequestVoiceMode,
    onConfirmVoiceMode,
    onCancelVoiceMode,
    onRequestManualMode,
}) => {
    const [mode, setMode] = useState<VoiceMode>(VoiceRuntime.getMode());
    const [isProcessing, setIsProcessing] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isRecovering, setIsRecovering] = useState(false);
    const [unavailableReason, setUnavailableReason] = useState<VoiceSessionErrorReason | null>(null);
    const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const clearRecoveryTimer = () => {
        if (!recoveryTimerRef.current) return;
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
    };

    const showRecoveryWindow = () => {
        clearRecoveryTimer();
        setIsRecovering(true);
        recoveryTimerRef.current = setTimeout(() => {
            setIsRecovering(false);
            recoveryTimerRef.current = null;
        }, RECOVERY_BADGE_MS);
    };

    const clearRecoveryWindow = () => {
        clearRecoveryTimer();
        setIsRecovering(false);
    };

    useEffect(() => {
        const unsubVoice = VoiceRuntime.subscribe((event) => {
            switch (event.type) {
                case "VOICE_TRANSCRIPT_READY":
                    startProcessingWindow();
                    break;
                case "VOICE_SESSION_STARTED":
                    clearProcessingTimer();
                    clearRecoveryWindow();
                    setIsProcessing(false);
                    setIsPaused(false);
                    setUnavailableReason(null);
                    break;
                case "VOICE_SESSION_ENDED":
                    clearProcessingTimer();
                    clearRecoveryWindow();
                    setIsProcessing(false);
                    setIsPaused(event.reason === "pause");
                    if (event.reason === "permission_denied") {
                        setUnavailableReason("stt_permission_denied");
                    }
                    break;
                case "VOICE_SESSION_ABORTED":
                    clearProcessingTimer();
                    clearRecoveryWindow();
                    setIsProcessing(false);
                    setIsPaused(false);
                    break;
                case "VOICE_SESSION_ERROR":
                    clearProcessingTimer();
                    setIsProcessing(false);
                    if (event.reason === "stt_recoverable" && !event.fatal) {
                        showRecoveryWindow();
                        break;
                    }
                    clearRecoveryWindow();
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
                clearRecoveryWindow();
                setIsProcessing(false);
                setIsPaused(false);
            }
        });

        const unsubTTS = TTSController.subscribe((event) => {
            if (event.type === "TTS_STARTED") {
                clearProcessingTimer();
                clearRecoveryWindow();
                setIsProcessing(false);
                setIsPaused(false);
            }
        });

        return () => {
            unsubVoice();
            unsubMode();
            unsubTTS();
            clearProcessingTimer();
            clearRecoveryTimer();
        };
    }, []);

    if (!VOICE_RELEVANT_STATES.has(currentState)) {
        return null;
    }

    const status = useMemo((): { kind: VoiceStatusKind; label: string } => {
        if (interactionMode === "manual") {
            if (pendingVoiceConfirm) {
                return { kind: "ready", label: "Confirm voice switch" };
            }
            return { kind: "paused", label: "Manual mode active" };
        }

        if (!voiceEnabled) {
            return { kind: "unavailable", label: "Voice unavailable" };
        }
        if (unavailableReason) {
            return { kind: "unavailable", label: "Voice unavailable" };
        }
        if (voiceLocked) {
            return { kind: "paused", label: "Voice locked" };
        }
        if (isRecovering) {
            return { kind: "reconnecting", label: "Reconnecting..." };
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
    }, [interactionMode, isPaused, isProcessing, isRecovering, mode, pendingVoiceConfirm, unavailableReason, voiceEnabled, voiceLocked]);

    const badgeClassByKind: Record<VoiceStatusKind, string> = {
        listening: "border-emerald-400/60 bg-emerald-500/15 text-emerald-100",
        speaking: "border-cyan-400/60 bg-cyan-500/15 text-cyan-100",
        processing: "border-amber-400/60 bg-amber-500/15 text-amber-100",
        paused: "border-slate-400/60 bg-slate-500/15 text-slate-100",
        ready: "border-blue-400/60 bg-blue-500/15 text-blue-100",
        reconnecting: "border-sky-300/70 bg-sky-400/15 text-sky-50",
        unavailable: "border-rose-400/60 bg-rose-500/15 text-rose-100",
    };

    const icon = (() => {
        switch (status.kind) {
            case "speaking":
                return <Volume2 size={14} />;
            case "processing":
                return <Loader2 size={14} className="animate-spin" />;
            case "reconnecting":
                return <Loader2 size={14} className="animate-spin" />;
            case "paused":
                return <PauseCircle size={14} />;
            case "unavailable":
                return <MicOff size={14} />;
            default:
                return <Mic size={14} />;
        }
    })();

    const canTapToToggle = interactionMode === "manual" ? true : voiceEnabled;

    const handleClick = () => {
        if (interactionMode === "manual") {
            if (!pendingVoiceConfirm) {
                onRequestVoiceMode?.();
            }
            return;
        }

        if (!canTapToToggle || voiceLocked) return;
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
        <div className="fixed left-4 bottom-4 z-40 flex max-w-[280px] flex-col gap-2 pointer-events-auto">
            <button
                type="button"
                onClick={handleClick}
                disabled={!canTapToToggle}
                className={`flex w-[188px] items-center justify-center rounded-full border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-md transition-colors ${badgeClassByKind[status.kind]} ${status.kind === "reconnecting" ? "animate-pulse" : ""} ${canTapToToggle ? "hover:brightness-110" : "cursor-not-allowed opacity-85"}`}
                aria-live="polite"
                aria-label={`Voice status: ${status.label}`}
                title={`Voice status: ${status.label}`}
            >
                <span className="inline-flex items-center gap-2">
                    {icon}
                    {status.label}
                </span>
            </button>

            {interactionMode === "manual" && pendingVoiceConfirm && (
                <div className="rounded-2xl border border-cyan-400/40 bg-slate-950/90 p-3 text-xs text-slate-100 shadow-lg backdrop-blur-md">
                    <p className="mb-2 leading-relaxed">
                        Switch to voice mode now?
                    </p>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onConfirmVoiceMode}
                            className="flex-1 rounded-lg border border-cyan-300/60 bg-cyan-400/20 px-2 py-1.5 text-cyan-100 transition hover:bg-cyan-400/30"
                        >
                            Enable voice
                        </button>
                        <button
                            type="button"
                            onClick={onCancelVoiceMode}
                            className="flex-1 rounded-lg border border-slate-500/70 bg-slate-700/40 px-2 py-1.5 text-slate-100 transition hover:bg-slate-600/40"
                        >
                            Keep manual
                        </button>
                    </div>
                </div>
            )}

            {interactionMode === "voice" && (
                <button
                    type="button"
                    onClick={onRequestManualMode}
                    className="inline-flex w-[188px] items-center justify-center gap-2 rounded-full border border-amber-300/60 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-100 shadow-lg backdrop-blur-md transition hover:brightness-110"
                    aria-label="Switch to manual mode"
                    title="Switch to manual mode"
                >
                    <Hand size={14} />
                    Manual Mode
                </button>
            )}
        </div>
    );
};
