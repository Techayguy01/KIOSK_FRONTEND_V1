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

            const byQuality = voices.filter((voice) => {
                const lowerName = voice.name.toLowerCase();
                return VOICE_QUALITY_HINTS.some((hint) => lowerName.includes(hint));
            });
            const candidatePool = byQuality.length > 0 ? byQuality : voices;

            const exactLangMatch = TTS_LANG_PRIORITY
                .map((lang) => candidatePool.find((voice) => voice.lang.toLowerCase() === lang))
                .find(Boolean);

            const prefixLangMatch = TTS_LANG_PRIORITY
                .map((lang) => {
                    const prefix = lang.split("-")[0];
                    return candidatePool.find((voice) => voice.lang.toLowerCase().startsWith(prefix));
                })
                .find(Boolean);

            this.selectedVoice = exactLangMatch || prefixLangMatch || candidatePool[0] || voices[0];

            if (this.selectedVoice) {
                console.log(`[TTSController] Voice: ${this.selectedVoice.name} (${this.selectedVoice.lang})`);
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
    public async speak(text: string): Promise<void> {
        if (!text || !text.trim()) return;

        // Cancel any existing speech immediately
        this.hardStop();

        return new Promise((resolve, reject) => {
            const synth = window.speechSynthesis;
            if (synth.paused) {
                synth.resume();
            }

            const utterance = new SpeechSynthesisUtterance(text.trim());

            if (this.selectedVoice) {
                utterance.voice = this.selectedVoice;
            }

            utterance.lang = this.selectedVoice?.lang || TTS_LANG_PRIORITY[0] || "hi-IN";
            utterance.rate = 0.95;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            utterance.onstart = () => {
                this.state = "SPEAKING";
                this.isCancelling = false;
                console.log(`[TTSController] Speaking: "${text.substring(0, 40)}..."`);
                this.emit({ type: "TTS_STARTED", text });
            };

            utterance.onend = () => {
                this.state = "IDLE";
                this.currentUtterance = null;

                if (!this.isCancelling) {
                    console.log("[TTSController] Speech ended");
                    this.emit({ type: "TTS_ENDED" });
                }

                resolve();
            };

            utterance.onerror = (event) => {
                // Ignore 'interrupted' and 'canceled' - expected during barge-in
                if (event.error === 'interrupted' || event.error === 'canceled') {
                    this.state = "IDLE";
                    this.currentUtterance = null;
                    resolve();
                    return;
                }

                this.state = "IDLE";
                this.currentUtterance = null;
                console.error(`[TTSController] Error: ${event.error}`);
                this.emit({ type: "TTS_ERROR", error: event.error });
                reject(new Error(event.error));
            };

            this.currentUtterance = utterance;
            synth.speak(utterance);
        });
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
}

export const TTSController = new TTSControllerService();
