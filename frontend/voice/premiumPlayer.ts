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

    /**
     * Fetch and play TTS audio from the backend.
     */
    public async play(text: string, language: string): Promise<void> {
        this.stop();

        try {
            const url = buildTenantApiUrl("voice/tts");
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...getTenantHeaders(),
                },
                body: JSON.stringify({ text, language }),
            });

            if (!response.ok) {
                throw new Error(`TTS API failed: ${response.status}`);
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            return new Promise((resolve, reject) => {
                const audio = new Audio(audioUrl);
                this.currentAudio = audio;

                audio.onplay = () => {
                    console.log(`[PremiumPlayer] Playing AI Audio (${language}): "${text.substring(0, 30)}..."`);
                };

                audio.onended = () => {
                    this.cleanup();
                    if (this.onEndCallback) this.onEndCallback();
                    resolve();
                };

                audio.onerror = (e) => {
                    this.cleanup();
                    reject(new Error("Audio playback failed"));
                };

                audio.play().catch(reject);
            });
        } catch (error) {
            console.error("[PremiumPlayer] Error:", error);
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
