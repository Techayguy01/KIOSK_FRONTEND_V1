/**
 * Speech Output Controller (Phase 9.1)
 * 
 * Glue layer between Agent state and TTS Runtime.
 * 
 * RULES:
 * - Speak ONLY when Agent explicitly provides text
 * - Cancel speech on state change, CANCEL, or BACK
 * - Does NOT generate text
 */

import { TtsRuntime } from "./TtsRuntime";
import { TtsEvent } from "./tts.types";

class SpeechOutputControllerService {
    private listeners: ((event: TtsEvent) => void)[] = [];

    constructor() {
        console.log("[SpeechOutput] Controller initialized (Phase 9.1)");

        // Forward TTS events
        TtsRuntime.subscribe((event) => {
            this.listeners.forEach(cb => cb(event));
        });
    }

    /**
     * Speak text from Agent.
     * This is the ONLY entry point for speech.
     */
    public speakFromAgent(text: string): void {
        if (!text || !text.trim()) {
            console.warn("[SpeechOutput] Empty text from Agent, ignoring");
            return;
        }

        console.log(`[SpeechOutput] Agent requested speech: "${text.substring(0, 50)}..."`);

        // Fire and forget - TtsRuntime handles the rest
        TtsRuntime.speak(text).catch(err => {
            console.error("[SpeechOutput] Speech failed:", err);
        });
    }

    /**
     * Stop any active speech.
     * Called on state change, CANCEL, or BACK.
     */
    public stopSpeech(): void {
        if (TtsRuntime.isSpeaking()) {
            console.log("[SpeechOutput] Stopping speech (state change or user action)");
            TtsRuntime.stop();
        }
    }

    /**
     * Check if currently speaking.
     */
    public isSpeaking(): boolean {
        return TtsRuntime.isSpeaking();
    }

    /**
     * Subscribe to speech events.
     */
    public subscribe(cb: (event: TtsEvent) => void): () => void {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter(l => l !== cb);
        };
    }
}

export const SpeechOutputController = new SpeechOutputControllerService();
