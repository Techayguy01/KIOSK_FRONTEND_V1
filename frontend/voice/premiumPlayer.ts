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

    /**
     * Fetch and play TTS audio from the backend.
     */
    public async play(
        text: string,
        language: string,
        hooks?: { onStart?: () => void; onEnd?: () => void }
    ): Promise<void> {
        this.stop();

        // Timeout: Don't let the user wait in silence forever.
        // 12s allows Sarvam to synthesize longer sentences without aborting.
        const PREMIUM_TTS_TIMEOUT_MS = 12000;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PREMIUM_TTS_TIMEOUT_MS);

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

            clearTimeout(timeout);

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
            clearTimeout(timeout);
            const isTimeout = error instanceof DOMException && error.name === 'AbortError';
            console.error(`[PremiumPlayer] ${isTimeout ? 'Timeout' : 'Error'}:`, error);
            throw error;
        }
    }

    /**
     * Stop the current audio playback instantly.
     */
    public stop(): void {
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
}

export const PremiumAudioPlayer = new PremiumAudioPlayerService();
