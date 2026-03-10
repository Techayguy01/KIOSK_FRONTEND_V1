/**
 * Premium Audio Player (Phase 2 - Sarvam AI)
 * 
 * Fetches and plays high-quality audio streams from the Python backend.
 * Uses HTMLAudioElement for simple playback with event support.
 */

import { buildTenantApiUrl, getTenantHeaders } from "../services/tenantContext";

class PremiumAudioPlayerService {
    private currentAudio: HTMLAudioElement | null = null;
    private onEndCallback: (() => void) | null = null;
    private activeReject: ((error: Error) => void) | null = null;
    private activeController: AbortController | null = null;
    private activeTimeout: ReturnType<typeof setTimeout> | null = null;
    private stopRequested = false;

    /**
     * Fetch and play TTS audio from the backend.
     */
    public async play(
        text: string,
        language: string,
        hooks?: { onStart?: () => void; onEnd?: () => void }
    ): Promise<void> {
        this.stop();

        // Timeout: short kiosk prompts should fail fast and fall back instead of creating long silence.
        const PREMIUM_TTS_TIMEOUT_MS = 4500;
        const controller = new AbortController();
        this.activeController = controller;
        this.stopRequested = false;
        this.activeTimeout = setTimeout(() => controller.abort(), PREMIUM_TTS_TIMEOUT_MS);

        try {
            const url = buildTenantApiUrl("voice/tts");
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getTenantHeaders(),
                },
                body: JSON.stringify({ text, language }),
                signal: controller.signal,
            });

            this.clearPendingRequest();

            if (!response.ok) {
                throw new Error(`TTS API failed: ${response.status}`);
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            return new Promise((resolve, reject) => {
                const audio = new Audio(audioUrl);
                this.currentAudio = audio;
                this.activeReject = reject;

                audio.onplay = () => {
                    console.log(`[PremiumPlayer] Playing AI Audio (${language}): "${text.substring(0, 30)}..."`);
                    hooks?.onStart?.();
                };

                audio.onended = () => {
                    this.activeReject = null;
                    this.cleanup();
                    hooks?.onEnd?.();
                    if (this.onEndCallback) this.onEndCallback();
                    resolve();
                };

                audio.onerror = () => {
                    this.activeReject = null;
                    this.cleanup();
                    reject(new Error("Audio playback failed"));
                };

                audio.play().catch((error) => {
                    this.activeReject = null;
                    this.cleanup();
                    reject(error instanceof Error ? error : new Error("Audio playback failed"));
                });
            });
        } catch (error) {
            const stopped = this.stopRequested;
            this.clearPendingRequest();
            const isTimeout = error instanceof DOMException && error.name === 'AbortError';
            if (stopped) {
                throw new Error("playback_stopped");
            }
            console.error(`[PremiumPlayer] ${isTimeout ? 'Timeout' : 'Error'}:`, error);
            throw error;
        }
    }

    /**
     * Stop the current audio playback instantly.
     */
    public stop(): void {
        this.stopRequested = true;
        if (this.activeController) {
            this.activeController.abort();
        }
        this.clearPendingRequest();

        if (this.currentAudio) {
            this.currentAudio.pause();
            this.cleanup();
        }

        if (this.activeReject) {
            const reject = this.activeReject;
            this.activeReject = null;
            reject(new Error("playback_stopped"));
        }
    }

    /**
     * Set a callback for when speech ends.
     */
    public onEnded(callback: () => void): void {
        this.onEndCallback = callback;
    }

    private cleanup(): void {
        if (this.currentAudio) {
            URL.revokeObjectURL(this.currentAudio.src);
            this.currentAudio = null;
        }
    }

    private clearPendingRequest(): void {
        if (this.activeTimeout) {
            clearTimeout(this.activeTimeout);
            this.activeTimeout = null;
        }
        this.activeController = null;
    }
}

export const PremiumAudioPlayer = new PremiumAudioPlayerService();
