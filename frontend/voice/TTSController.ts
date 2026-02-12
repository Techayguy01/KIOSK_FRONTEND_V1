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
    private currentAudio: HTMLAudioElement | null = null;
    private currentRequestId = 0;
    private pendingQueue: TTSQueueItem[] = [];
    private isCancelling: boolean = false;
    private readonly TTS_API_URL = import.meta.env.VITE_TTS_API_URL || "http://localhost:3002/api/tts";

    constructor() {
        console.log("[TTSController] Initialized (Phase 9.4 - Audio Authority)");
        this.initVoice();
    }

    /**
     * Select a stable English voice.
     */
    private initVoice(): void {
        const synth = window.speechSynthesis;

        const loadVoices = () => {
            const voices = synth.getVoices();

            // Prefer high-quality voices
            this.selectedVoice = voices.find(v =>
                v.lang.startsWith('en') &&
                (v.name.includes('Google') || v.name.includes('Microsoft') || v.name.includes('Samantha'))
            ) || voices.find(v => v.lang.startsWith('en')) || voices[0];

            if (this.selectedVoice) {
                console.log(`[TTSController] Voice: ${this.selectedVoice.name}`);
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

        const requestId = ++this.currentRequestId;

        // Cancel any existing speech immediately
        this.hardStop();

        const playedByBackend = await this.tryPlayWithBackend(text, requestId);
        if (playedByBackend) return;

        return new Promise((resolve, reject) => {
            const synth = window.speechSynthesis;

            const utterance = new SpeechSynthesisUtterance(text.trim());

            if (this.selectedVoice) {
                utterance.voice = this.selectedVoice;
            }

            utterance.rate = 1.0;
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

    private async tryPlayWithBackend(text: string, requestId: number): Promise<boolean> {
        try {
            const response = await fetch(this.TTS_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
            });

            if (!response.ok) {
                console.warn(`[TTSController] Backend TTS HTTP ${response.status}, using browser fallback`);
                return false;
            }
            const data = await response.json() as { ok?: boolean; audioUrl?: string; reason?: string };

            if (!data?.ok || !data.audioUrl || requestId !== this.currentRequestId) {
                console.warn(`[TTSController] Backend TTS unavailable (${data?.reason || "unknown_reason"}), using browser fallback`);
                return false;
            }

            console.log("[TTSController] Using backend VibeVoice audio");
            await this.playAudio(data.audioUrl, text, requestId);
            return true;
        } catch {
            console.warn("[TTSController] Backend TTS request failed, using browser fallback");
            return false;
        }
    }

    private resolveAudioUrl(audioUrl: string): string {
        if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
        try {
            const apiBase = new URL(this.TTS_API_URL);
            return new URL(audioUrl, apiBase.origin).toString();
        } catch {
            return audioUrl;
        }
    }

    private async playAudio(audioUrl: string, text: string, requestId: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const resolvedAudioUrl = this.resolveAudioUrl(audioUrl);
            const audio = new Audio(resolvedAudioUrl);
            this.currentAudio = audio;
            this.state = "SPEAKING";
            this.isCancelling = false;
            this.emit({ type: "TTS_STARTED", text });

            const clear = () => {
                audio.onended = null;
                audio.onerror = null;
                audio.onplaying = null;
                if (this.currentAudio === audio) this.currentAudio = null;
            };

            audio.onended = () => {
                clear();
                if (requestId !== this.currentRequestId) {
                    resolve();
                    return;
                }
                this.state = "IDLE";
                if (!this.isCancelling) {
                    this.emit({ type: "TTS_ENDED" });
                }
                resolve();
            };

            audio.onerror = () => {
                clear();
                this.state = "IDLE";
                reject(new Error("backend_audio_playback_failed"));
            };

            audio.play().catch((error) => {
                clear();
                this.state = "IDLE";
                reject(error);
            });
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
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio = null;
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
