/**
 * TTS Controller (Phase 9.4)
 *
 * Audio authority model for speech output.
 *
 * Rules:
 * - Single active audio source (no overlap)
 * - Cancelable mid-utterance (barge-in)
 * - Promise-safe lifecycle events
 * - STT always has higher priority than TTS
 */

import { TtsEvent, TtsState } from "./tts.types";
import { PremiumAudioPlayer } from "./premiumPlayer";

const VOICE_QUALITY_HINTS = ["google", "microsoft", "samantha", "hindi", "india"];

type TTSQueueItem = {
    text: string;
    resolve: () => void;
    reject: (error: Error) => void;
};

class TTSControllerService {
    private listeners: ((event: TtsEvent) => void)[] = [];
    private state: TtsState = "IDLE";
    private currentUtterance: SpeechSynthesisUtterance | null = null;
    private selectedVoice: SpeechSynthesisVoice | null = null;
    private pendingQueue: TTSQueueItem[] = [];
    private isCancelling = false;
    private activeText: string | null = null;

    constructor() {
        console.log("[TTSController] Initialized (Phase 9.4 - Audio Authority)");
        this.initVoice();
    }

    /**
     * Select a stable Indian-local voice first, then fallback.
     */
    private initVoice(): void {
        const synth = window.speechSynthesis;

        const loadVoices = () => {
            const voices = synth.getVoices();

            if (voices.length === 0) {
                return;
            }

            let selected = voices.find(v =>
                (v.lang === "en-IN" || v.lang === "hi-IN") &&
                (v.name.includes("Female") || v.name.includes("Neerja") || v.name.includes("Aditi"))
            );

            if (!selected) {
                selected = voices.find(v => v.name.includes("Female") || v.name.includes("Samantha"));
            }

            if (!selected) {
                selected = voices.find(v => {
                    const lowerName = v.name.toLowerCase();
                    return VOICE_QUALITY_HINTS.some((hint) => lowerName.includes(hint));
                });
            }

            this.selectedVoice = selected || voices[0];

            if (this.selectedVoice) {
                console.log(`[TTSController] Selected fallback voice: ${this.selectedVoice.name} (${this.selectedVoice.lang})`);
            }
        };

        if (synth.getVoices().length > 0) {
            loadVoices();
        } else {
            synth.onvoiceschanged = loadVoices;
        }
    }

    /**
     * Speak text with strict lifecycle semantics.
     */
    public async speak(text: string, language?: string): Promise<void> {
        if (!text || !text.trim()) return;

        // Cancel any existing speech immediately
        this.hardStop("state_change");

        const currentLang = language || this.selectedVoice?.lang.split("-")[0] || "en";
        const normalizedText = text.trim();
        this.isCancelling = false;
        this.activeText = normalizedText;

        try {
            this.state = "SPEAKING";
            await PremiumAudioPlayer.play(normalizedText, currentLang, {
                onStart: () => {
                    this.emit({ type: "TTS_STARTED", text: normalizedText });
                },
                onEnd: () => {
                    this.emit({ type: "TTS_ENDED", text: normalizedText });
                },
            });

            this.state = "IDLE";
            this.activeText = null;
        } catch (err) {
            const isStopped = err instanceof Error && err.message === "playback_stopped";
            if (this.isCancelling || isStopped) {
                this.state = "IDLE";
                this.activeText = null;
                return;
            }

            console.warn("[TTSController] Premium voice failed. Text shown on screen instead:", err);
            this.state = "IDLE";
            this.emit({
                type: "TTS_ERROR",
                error: err instanceof Error ? err.message : "premium_tts_failed",
                text: this.activeText || normalizedText,
                fallbackToText: true,
            });
            this.activeText = null;
        }
    }

    /**
     * Instant barge-in: stop TTS immediately.
     */
    public bargeIn(): void {
        if (this.isSpeaking()) {
            console.log("[TTSController] BARGE-IN: Stopping TTS instantly");
            this.hardStop("barge_in");
        }
    }

    /**
     * Hard stop all speech output.
     */
    public hardStop(reason: "barge_in" | "hard_stop" | "state_change" = "hard_stop"): void {
        const synth = window.speechSynthesis;
        const wasSpeaking = this.state === "SPEAKING" || synth.speaking || synth.pending;

        this.isCancelling = true;

        if (synth.speaking || synth.pending) {
            synth.cancel();
        }

        PremiumAudioPlayer.stop();

        this.pendingQueue.forEach(item => item.resolve());
        this.pendingQueue = [];

        this.state = "IDLE";
        this.currentUtterance = null;
        this.activeText = null;

        if (wasSpeaking) {
            this.emit({ type: "TTS_CANCELLED", reason });
        }
    }

    /**
     * Check if currently speaking.
     */
    public isSpeaking(): boolean {
        return this.state === "SPEAKING" || window.speechSynthesis.speaking;
    }

    /**
     * Get current state.
     */
    public getState(): TtsState {
        return this.state;
    }

    /**
     * Subscribe to TTS events.
     */
    public subscribe(cb: (event: TtsEvent) => void): () => void {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter(l => l !== cb);
        };
    }

    private emit(event: TtsEvent): void {
        this.listeners.forEach(cb => cb(event));
    }

    /**
     * Destroy this instance and stop audio.
     */
    public destroy(): void {
        this.hardStop();
        this.listeners = [];
        console.log("[TTSController] Destroyed (HMR cleanup)");
    }
}

export const TTSController = new TTSControllerService();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        TTSController.destroy();
    });
}
