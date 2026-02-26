/**
 * TTS Runtime (Phase 9.1)
 * 
 * Singleton Text-to-Speech engine using Web Speech API.
 * 
 * RULE: TTS does NOT decide what to say.
 *       It only speaks text explicitly provided by the Agent layer.
 * 
 * Features:
 * - One utterance at a time
 * - Cancel existing speech before starting new one
 * - Emit lifecycle events
 */

import { TtsEvent, TtsState } from "./tts.types";

const TTS_LANG_PRIORITY = (
    import.meta.env.VITE_TTS_LANG_PRIORITY || "hi-IN,hi,en-IN,en-US,en"
)
    .split(",")
    .map((lang: string) => lang.trim().toLowerCase())
    .filter(Boolean);

const VOICE_QUALITY_HINTS = ["google", "microsoft", "samantha", "hindi", "india"];

class TtsRuntimeService {
    private listeners: ((event: TtsEvent) => void)[] = [];
    private state: TtsState = "IDLE";
    private currentUtterance: SpeechSynthesisUtterance | null = null;
    private selectedVoice: SpeechSynthesisVoice | null = null;

    constructor() {
        console.log("[TtsRuntime] Initialized (Phase 9.1 - Web Speech API)");
        this.initVoice();
    }

    /**
     * Select a stable Indian-local voice first.
     * Called on init and after voices load.
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
                console.log(`[TtsRuntime] Selected voice: ${this.selectedVoice.name} (${this.selectedVoice.lang})`);
            }
        };

        // Voices may already be loaded or need to wait
        if (synth.getVoices().length > 0) {
            loadVoices();
        } else {
            synth.onvoiceschanged = loadVoices;
        }
    }

    /**
     * Speak text. Cancels any existing speech first.
     */
    public async speak(text: string): Promise<void> {
        if (!text || !text.trim()) {
            console.warn("[TtsRuntime] Empty text, ignoring.");
            return;
        }

        // Cancel existing speech
        this.stop();

        return new Promise((resolve, reject) => {
            const synth = window.speechSynthesis;

            // Create utterance
            const utterance = new SpeechSynthesisUtterance(text.trim());

            if (this.selectedVoice) {
                utterance.voice = this.selectedVoice;
            }
            utterance.lang = this.selectedVoice?.lang || TTS_LANG_PRIORITY[0] || "hi-IN";

            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            // Event handlers
            utterance.onstart = () => {
                this.state = "SPEAKING";
                console.log(`[TtsRuntime] Speaking: "${text.substring(0, 50)}..."`);
                this.emit({ type: "TTS_STARTED", text });
            };

            utterance.onend = () => {
                this.state = "IDLE";
                this.currentUtterance = null;
                console.log("[TtsRuntime] Speech ended");
                this.emit({ type: "TTS_ENDED" });
                resolve();
            };

            utterance.onerror = (event) => {
                // Ignore 'interrupted' errors (expected when cancelled)
                if (event.error === 'interrupted' || event.error === 'canceled') {
                    this.state = "IDLE";
                    this.currentUtterance = null;
                    resolve();
                    return;
                }

                this.state = "IDLE";
                this.currentUtterance = null;
                console.error(`[TtsRuntime] Error: ${event.error}`);
                this.emit({ type: "TTS_ERROR", error: event.error });
                reject(new Error(event.error));
            };

            this.currentUtterance = utterance;
            synth.speak(utterance);
        });
    }

    /**
     * Stop current speech immediately.
     */
    public stop(): void {
        const synth = window.speechSynthesis;

        if (synth.speaking || synth.pending) {
            console.log("[TtsRuntime] Cancelling speech");
            synth.cancel();

            if (this.state === "SPEAKING") {
                this.emit({ type: "TTS_CANCELLED" });
            }

            this.state = "IDLE";
            this.currentUtterance = null;
        }
    }

    /**
     * Check if currently speaking.
     */
    public isSpeaking(): boolean {
        return this.state === "SPEAKING";
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
        console.log(`[TtsRuntime] Emitting: ${event.type}`);
        this.listeners.forEach(cb => cb(event));
    }
}

export const TtsRuntime = new TtsRuntimeService();
