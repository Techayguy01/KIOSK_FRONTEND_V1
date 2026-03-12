/**
 * TTS Controller (Phase 9.4)
 *
 * Audio authority model for speech output.
 *
 * Rules:
 * - Single active audio source (no overlap)
 * - Cancelable mid-utterance (barge-in)
 * - Promise-safe lifecycle events
 * - STT always has higher priority than TTS
 */

import { TtsEvent, TtsState } from "./tts.types";
import { PremiumAudioPlayer } from "./premiumPlayer";

const VOICE_QUALITY_HINTS = ["google", "microsoft", "samantha", "hindi", "india"];
const FEMALE_VOICE_HINTS = ["female", "woman", "zira", "hazel", "heera", "samantha", "neerja", "aditi", "ritu", "anushka"];

function normalizeTtsLanguage(language?: string): string {
    const normalized = String(language || "").trim().toLowerCase();
    if (normalized.startsWith("hi") || normalized === "hindi") return "hi-IN";
    if (normalized.startsWith("mr") || normalized === "marathi") return "mr-IN";
    if (normalized.startsWith("en") || normalized === "english") return "en-IN";
    return "en-IN";
}

function shouldUseBrowserFallbackForPremiumError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || "");
    const normalized = message.toLowerCase();
    return (
        normalized.includes("tts api failed")
        || normalized.includes("aborterror")
        || normalized.includes("signal is aborted")
        || normalized.includes("timeout")
        || normalized.includes("network")
        || normalized.includes("failed to fetch")
    );
}

class TTSControllerService {
    private listeners: ((event: TtsEvent) => void)[] = [];
    private state: TtsState = "IDLE";
    private selectedVoice: SpeechSynthesisVoice | null = null;
    private isCancelling = false;
    private activeText: string | null = null;

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

            let selected = voices.find(v =>
                (v.lang === "en-IN" || v.lang === "hi-IN") &&
                this.isLikelyFemaleVoice(v)
            );

            if (!selected) {
                selected = voices.find(v => this.isLikelyFemaleVoice(v));
            }

            if (!selected) {
                selected = voices.find(v => {
                    const lowerName = v.name.toLowerCase();
                    return VOICE_QUALITY_HINTS.some((hint) => lowerName.includes(hint));
                });
            }

            this.selectedVoice = selected || voices[0];

            if (this.selectedVoice) {
                console.log(`[TTSController] Selected fallback voice: ${this.selectedVoice.name} (${this.selectedVoice.lang})`);
            }
        };

        if (synth.getVoices().length > 0) {
            loadVoices();
        } else {
            synth.onvoiceschanged = loadVoices;
        }
    }

    /**
     * Speak text with strict lifecycle semantics.
     */
    public async speak(text: string, language?: string): Promise<void> {
        if (!text || !text.trim()) return;

        // Cancel any existing speech immediately
        this.hardStop("state_change");

        const currentLang = normalizeTtsLanguage(language || this.selectedVoice?.lang || "en-IN");
        const normalizedText = text.trim();
        this.isCancelling = false;
        this.activeText = normalizedText;

        try {
            this.state = "SPEAKING";
            await PremiumAudioPlayer.play(normalizedText, currentLang, {
                onStart: () => {
                    this.emit({ type: "TTS_STARTED", text: normalizedText });
                },
                onEnd: () => {
                    this.emit({ type: "TTS_ENDED", text: normalizedText });
                },
            });

            this.state = "IDLE";
            this.activeText = null;
        } catch (err) {
            const isStopped = err instanceof Error && err.message === "playback_stopped";
            if (this.isCancelling || isStopped) {
                this.state = "IDLE";
                this.activeText = null;
                return;
            }

            if (shouldUseBrowserFallbackForPremiumError(err)) {
                console.warn("[TTSController] Premium voice failed due to API/network issue. Trying browser fallback:", err);
                try {
                    await this.speakWithBrowserFallback(normalizedText, currentLang);
                    this.activeText = null;
                    return;
                } catch (fallbackError) {
                    console.warn("[TTSController] Browser TTS fallback failed. Text shown on screen instead:", fallbackError);
                    this.state = "IDLE";
                    this.emit({
                        type: "TTS_ERROR",
                        error: fallbackError instanceof Error ? fallbackError.message : "browser_tts_fallback_failed",
                        text: this.activeText || normalizedText,
                        fallbackToText: true,
                    });
                    this.activeText = null;
                    return;
                }
            }

            console.warn("[TTSController] Premium voice failed. Text shown on screen instead:", err);
            this.state = "IDLE";
            this.emit({
                type: "TTS_ERROR",
                error: err instanceof Error ? err.message : "premium_tts_failed",
                text: this.activeText || normalizedText,
                fallbackToText: true,
            });
            this.activeText = null;
        }
    }

    /**
     * Instant barge-in: stop TTS immediately.
     */
    public bargeIn(): void {
        if (this.isSpeaking()) {
            console.log("[TTSController] BARGE-IN: Stopping TTS instantly");
            this.hardStop("barge_in");
        }
    }

    /**
     * Hard stop all speech output.
     */
    public hardStop(reason: "barge_in" | "hard_stop" | "state_change" = "hard_stop"): void {
        const synth = window.speechSynthesis;
        const wasSpeaking = this.state === "SPEAKING" || synth.speaking || synth.pending;

        this.isCancelling = true;

        if (synth.speaking || synth.pending) {
            synth.cancel();
        }

        PremiumAudioPlayer.stop();

        this.state = "IDLE";
        this.activeText = null;

        if (wasSpeaking) {
            this.emit({ type: "TTS_CANCELLED", reason });
        }
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

    /**
     * Destroy this instance and stop audio.
     */
    public destroy(): void {
        this.hardStop();
        this.listeners = [];
        console.log("[TTSController] Destroyed (HMR cleanup)");
    }

    private async speakWithBrowserFallback(text: string, language: string): Promise<void> {
        const synth = window.speechSynthesis;
        const targetLang = normalizeTtsLanguage(language);
        const voice = this.findBestVoiceForLanguage(targetLang);

        return new Promise((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = targetLang;
            if (voice) {
                utterance.voice = voice;
            }
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            utterance.onstart = () => {
                this.state = "SPEAKING";
                console.log(
                    `[TTSController] Browser fallback voice: ${utterance.voice?.name || "default"} (${utterance.voice?.lang || targetLang})`
                );
                this.emit({ type: "TTS_STARTED", text });
            };

            utterance.onend = () => {
                this.state = "IDLE";
                this.emit({ type: "TTS_ENDED", text });
                resolve();
            };

            utterance.onerror = (event) => {
                const errorCode = String(event.error || "browser_tts_failed");
                if (errorCode === "interrupted" || errorCode === "canceled") {
                    this.state = "IDLE";
                    resolve();
                    return;
                }
                this.state = "IDLE";
                reject(new Error(errorCode));
            };

            synth.speak(utterance);
        });
    }

    private findBestVoiceForLanguage(targetLang: string): SpeechSynthesisVoice | null {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length === 0) {
            return this.selectedVoice;
        }

        const preferredByExactFemale = voices.find(
            (voice) => voice.lang.toLowerCase() === targetLang.toLowerCase() && this.isLikelyFemaleVoice(voice)
        );
        if (preferredByExactFemale) return preferredByExactFemale;

        const preferredByExact = voices.find((voice) => voice.lang.toLowerCase() === targetLang.toLowerCase());
        if (preferredByExact) return preferredByExact;

        const prefix = targetLang.split("-")[0].toLowerCase();
        const preferredByPrefixFemale = voices.find(
            (voice) => voice.lang.toLowerCase().startsWith(prefix) && this.isLikelyFemaleVoice(voice)
        );
        if (preferredByPrefixFemale) return preferredByPrefixFemale;

        const preferredByPrefix = voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix));
        if (preferredByPrefix) return preferredByPrefix;

        const fallbackFemale = voices.find((voice) => this.isLikelyFemaleVoice(voice));
        if (fallbackFemale) return fallbackFemale;

        const qualityVoice = voices.find((voice) => {
            const lowerName = voice.name.toLowerCase();
            return VOICE_QUALITY_HINTS.some((hint) => lowerName.includes(hint));
        });

        return qualityVoice || this.selectedVoice || voices[0];
    }

    private isLikelyFemaleVoice(voice: SpeechSynthesisVoice): boolean {
        const lowerName = String(voice.name || "").toLowerCase();
        return FEMALE_VOICE_HINTS.some((hint) => lowerName.includes(hint));
    }
}

export const TTSController = new TTSControllerService();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        TTSController.destroy();
    });
}
