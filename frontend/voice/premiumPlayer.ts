/**
 * Premium Audio Player (Phase 2 - Sarvam AI)
 * 
 * Fetches and plays high-quality audio streams from the Python backend.
 * Uses HTMLAudioElement for simple playback with event support.
 */

import { buildTenantApiUrl, getTenantHeaders } from "../services/tenantContext";

class PremiumAudioPlayerService {
    private currentAudio: HTMLAudioElement | null = null;
    private activeReject: ((error: Error) => void) | null = null;
    private activeController: AbortController | null = null;
    private activeTimeout: ReturnType<typeof setTimeout> | null = null;
    private activeAbortReasons = new Map<number, "timeout" | "superseded" | "stop">();
    private requestSequence = 0;

    // Pre-fetch cache: store audio object URLs keyed by "language::text"
    private prefetchCache = new Map<string, string>();
    private prefetchInflight = new Map<string, Promise<void>>();

    private getCacheKey(text: string, language: string): string {
        return `${language}::${text.trim()}`;
    }

    public hasPrefetched(text: string, language: string): boolean {
        if (!text?.trim()) return false;
        return this.prefetchCache.has(this.getCacheKey(text, language));
    }

    private isPrefetchedObjectUrl(url: string): boolean {
        for (const cachedUrl of this.prefetchCache.values()) {
            if (cachedUrl === url) {
                return true;
            }
        }
        return false;
    }

    /**
     * Pre-fetch TTS audio in the background. The audio blob is cached as an
     * object URL so that a subsequent play() call for the same text skips the
     * network round-trip entirely.
     */
    public async prefetch(text: string, language: string): Promise<void> {
        if (!text?.trim()) return;
        const key = this.getCacheKey(text, language);
        if (this.prefetchCache.has(key)) return;
        if (this.prefetchInflight.has(key)) return this.prefetchInflight.get(key);

        const work = (async () => {
            try {
                const url = buildTenantApiUrl("voice/tts");
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...getTenantHeaders(),
                    },
                    body: JSON.stringify({ text: text.trim(), language }),
                });
                if (!response.ok) return;
                const blob = await response.blob();
                if (blob.size > 0) {
                    this.prefetchCache.set(key, URL.createObjectURL(blob));
                    console.log(`[PremiumPlayer] Prefetched TTS audio (${blob.size} bytes): "${text.trim().substring(0, 40)}..."`);
                }
            } catch {
                // Silently ignore — play() will fall back to live fetch
            } finally {
                this.prefetchInflight.delete(key);
            }
        })();

        this.prefetchInflight.set(key, work);
        return work;
    }

    /**
     * Revoke all pre-fetched object URLs and clear the cache.
     * Call on page unmount or when room data changes.
     */
    public clearPrefetchCache(): void {
        for (const objectUrl of this.prefetchCache.values()) {
            URL.revokeObjectURL(objectUrl);
        }
        this.prefetchCache.clear();
        this.prefetchInflight.clear();
        console.log("[PremiumPlayer] Prefetch cache cleared");
    }

    /**
     * Fetch and play TTS audio from the backend.
     */
    public async play(
        text: string,
        language: string,
        hooks?: { onStart?: () => void; onEnd?: () => void }
    ): Promise<void> {
        this.stop("superseded");

        // Timeout: short kiosk prompts should fail fast and fall back instead of creating long silence.
        const PREMIUM_TTS_TIMEOUT_MS = 25000;
        const requestId = ++this.requestSequence;
        const controller = new AbortController();
        this.activeController = controller;
        const startedAt = Date.now();

        console.log(
            `[PremiumPlayer][${requestId}] Request start lang=${language} chars=${text.trim().length} timeoutMs=${PREMIUM_TTS_TIMEOUT_MS}`
        );

        this.activeTimeout = setTimeout(() => {
            this.activeAbortReasons.set(requestId, "timeout");
            controller.abort();
        }, PREMIUM_TTS_TIMEOUT_MS);

        try {
            // Check prefetch cache first
            const cacheKey = this.getCacheKey(text.trim(), language);
            let audioUrl: string;
            const cachedUrl = this.prefetchCache.get(cacheKey);

            if (cachedUrl) {
                console.log(
                    `[PremiumPlayer][${requestId}] Cache hit, skipping fetch elapsedMs=${Date.now() - startedAt}: "${text.trim().substring(0, 40)}..."`
                );
                this.clearPendingRequest();
                audioUrl = cachedUrl;
            } else {
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

                console.log(
                    `[PremiumPlayer][${requestId}] Response received status=${response.status} elapsedMs=${Date.now() - startedAt}`
                );
                this.clearPendingRequest();

                if (!response.ok) {
                    throw new Error(`TTS API failed: ${response.status}`);
                }

                const audioBlob = await response.blob();
                audioUrl = URL.createObjectURL(audioBlob);
                console.log(
                    `[PremiumPlayer][${requestId}] Audio blob ready bytes=${audioBlob.size} elapsedMs=${Date.now() - startedAt}`
                );
            }

            return new Promise((resolve, reject) => {
                const audio = new Audio(audioUrl);
                this.currentAudio = audio;
                this.activeReject = reject;

                audio.onplay = () => {
                    console.log(
                        `[PremiumPlayer][${requestId}] Playing AI Audio (${language}) elapsedMs=${Date.now() - startedAt}: "${text.substring(0, 30)}..."`
                    );
                    hooks?.onStart?.();
                };

                audio.onended = () => {
                    this.activeReject = null;
                    this.cleanup();
                    hooks?.onEnd?.();
                    console.log(`[PremiumPlayer][${requestId}] Playback ended totalMs=${Date.now() - startedAt}`);
                    this.activeAbortReasons.delete(requestId);
                    resolve();
                };

                audio.onerror = () => {
                    this.activeReject = null;
                    this.cleanup();
                    console.warn(`[PremiumPlayer][${requestId}] Audio playback failed`);
                    this.activeAbortReasons.delete(requestId);
                    reject(new Error("Audio playback failed"));
                };

                audio.play().catch((error) => {
                    this.activeReject = null;
                    this.cleanup();
                    this.activeAbortReasons.delete(requestId);
                    reject(error instanceof Error ? error : new Error("Audio playback failed"));
                });
            });
        } catch (error) {
            const abortReason = this.activeAbortReasons.get(requestId);
            this.activeAbortReasons.delete(requestId);
            this.clearPendingRequest();

            const isTimeout = error instanceof DOMException && error.name === 'AbortError';
            if (abortReason === "superseded" || abortReason === "stop") {
                console.debug(`[PremiumPlayer][${requestId}] Request stopped reason=${abortReason}`);
                throw new Error("playback_stopped");
            }
            if (abortReason === "timeout" || isTimeout) {
                console.error(
                    `[PremiumPlayer][${requestId}] Timeout elapsedMs=${Date.now() - startedAt}:`,
                    error
                );
            } else {
                console.error(`[PremiumPlayer][${requestId}] Error elapsedMs=${Date.now() - startedAt}:`, error);
            }
            throw error;
        }
    }

    /**
     * Stop the current audio playback instantly.
     */
    public stop(reason: "superseded" | "stop" = "stop"): void {
        const requestId = this.requestSequence;
        if (requestId > 0) {
            this.activeAbortReasons.set(requestId, reason);
        }

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
            // Removed: this.activeAbortReasons.delete(requestId); 
            // The catch block in play() will handle cleanup after reading the reason.
            reject(new Error("playback_stopped"));
        }
    }

    public isPlaying(): boolean {
        return Boolean(this.currentAudio && !this.currentAudio.paused && !this.currentAudio.ended);
    }

    private cleanup(): void {
        if (this.currentAudio) {
            if (this.currentAudio.src && !this.isPrefetchedObjectUrl(this.currentAudio.src)) {
                URL.revokeObjectURL(this.currentAudio.src);
            }
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
