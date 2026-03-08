/**
 * TTS Controller (Phase 9.4)
 * 
 * Audio Authority Model - strict priority control for TTS.
 * 
 * Rules:
 * - Single active audio source (no overlapping)
 * - Cancelable mid-utterance (instant barge-in)
 * - Promise-safe (no race conditions)
 * - STT always has higher priority than TTS
 * 
 * Audio Authority Table:
 * | Event               | Action                    |
 * |---------------------|---------------------------|
 * | User starts speaking| Immediately stop TTS      |
 * | TTS playing         | STT still listens         |
 * | New Agent state     | Cancel any existing TTS   |
 * | ERROR / CANCEL      | Hard stop all audio       |
 */

import { TtsEvent, TtsState } from "./tts.types";
import { PremiumAudioPlayer } from "./premiumPlayer";

const TTS_LANG_PRIORITY = (
    import.meta.env.VITE_TTS_LANG_PRIORITY || "hi-IN,hi,en-IN,en-US,en"
)
    .split(",")
    .map((lang: string) => lang.trim().toLowerCase())
    .filter(Boolean);

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
    private isCancelling: boolean = false;

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

            // 1. Try to find an Indian Female voice first (Microsoft Neerja, Google's Indian female, etc.)
            let selected = voices.find(v =>
                (v.lang === 'en-IN' || v.lang === 'hi-IN') &&
                (v.name.includes('Female') || v.name.includes('Neerja') || v.name.includes('Aditi'))
            );

            // 2. If not found, fall back to any standard female English voice
            if (!selected) {
                selected = voices.find(v => v.name.includes('Female') || v.name.includes('Samantha'));
            }

            // 3. Fallback to quality hints (Google, Microsoft, etc.)
            if (!selected) {
                selected = voices.find(v => {
                    const lowerName = v.name.toLowerCase();
                    return VOICE_QUALITY_HINTS.some((hint) => lowerName.includes(hint));
                });
            }

            this.selectedVoice = selected || voices[0];

            if (this.selectedVoice) {
                console.log(`[TTSController] Selected Fallback Voice: ${this.selectedVoice.name} (${this.selectedVoice.lang})`);
            }
        };

        if (synth.getVoices().length > 0) {
            loadVoices();
        } else {
            synth.onvoiceschanged = loadVoices;
        }
    }

    /**
     * Speak text with audio authority.
     * Cancels any existing speech first. Promise-safe.
     */
    public async speak(text: string, language?: string): Promise<void> {
        if (!text || !text.trim()) return;

        // Cancel any existing speech immediately
        this.hardStop();

        // Detect language — use passed language, then selected voice, then default
        const currentLang = language || this.selectedVoice?.lang.split("-")[0] || "en";

        // Try Premium AI Voice — the ONLY voice source.
        // If it fails, we stay silent. The text is already visible in the CaptionsOverlay.
        try {
            this.state = "SPEAKING";
            this.emit({ type: "TTS_STARTED", text });

            await PremiumAudioPlayer.play(text, currentLang);

            this.state = "IDLE";
            this.emit({ type: "TTS_ENDED" });
        } catch (err) {
            console.warn("[TTSController] Premium voice failed. Text shown on screen instead:", err);
            this.state = "IDLE";
            // Emit TTS_ENDED so the system doesn't get stuck waiting for speech to finish.
            this.emit({ type: "TTS_ENDED" });
        }
    }

    /**
     * Instant barge-in: Stop TTS immediately (<50ms target).
     * Called when user starts speaking.
     */
    public bargeIn(): void {
        if (this.isSpeaking()) {
            console.log("[TTSController] BARGE-IN: Stopping TTS instantly");
            this.hardStop();
            this.emit({ type: "TTS_CANCELLED" });
        }
    }

    /**
     * Hard stop all audio. Used for:
     * - Barge-in
     * - State change
     * - Error
     * - Session timeout
     * - App unmount
     */
    public hardStop(): void {
        const synth = window.speechSynthesis;

        this.isCancelling = true;

        // Cancel immediately
        if (synth.speaking || synth.pending) {
            synth.cancel();
        }

        // Stop Premium Player
        PremiumAudioPlayer.stop();

        // Clear queue
        this.pendingQueue.forEach(item => item.resolve());
        this.pendingQueue = [];

        this.state = "IDLE";
        this.currentUtterance = null;
    }

    /**
     * Check if currently speaking.
     */
    public isSpeaking(): boolean {
        // Check both native synth and our premium player
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
     * Destroy this instance — clear all listeners and stop audio.
     * Called during HMR to prevent ghost instances.
     */
    public destroy(): void {
        this.hardStop();
        this.listeners = [];
        console.log("[TTSController] Destroyed (HMR cleanup)");
    }
}

export const TTSController = new TTSControllerService();

// Vite HMR: Clean up old instance before replacement
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        TTSController.destroy();
    });
}
