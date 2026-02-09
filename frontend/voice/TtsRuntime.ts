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
     * Select a stable English voice.
     * Called on init and after voices load.
     */
    private initVoice(): void {
        const synth = window.speechSynthesis;

        const loadVoices = () => {
            const voices = synth.getVoices();

            // Prefer Google or Microsoft English voices for quality
            this.selectedVoice = voices.find(v =>
                v.lang.startsWith('en') &&
                (v.name.includes('Google') || v.name.includes('Microsoft'))
            ) || voices.find(v => v.lang.startsWith('en')) || voices[0];

            if (this.selectedVoice) {
                console.log(`[TtsRuntime] Selected voice: ${this.selectedVoice.name}`);
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
