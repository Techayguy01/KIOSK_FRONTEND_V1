/**
 * Web Speech STT Client
 *
 * Browser-native Web Speech API — the sole STT provider.
 */

type InterimCallback = (transcript: string, isFinal: boolean) => void;
type EndOfTurnCallback = (accumulatedTranscript: string, confidence?: number) => void;
type SpeechStartedCallback = () => void;
type ErrorCallback = (error: Error) => void;

type SpeechRecognitionLike = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    onstart: (() => void) | null;
    onresult: ((event: any) => void) | null;
    onspeechstart: (() => void) | null;
    onerror: ((event: any) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const STT_LANGUAGE = (import.meta.env.VITE_STT_LANGUAGE || "en-US").trim() || "en-US";
const FINAL_COMMIT_GRACE_MS = Number(import.meta.env.VITE_FINAL_COMMIT_GRACE_MS || 250);
const RESTART_DELAY_MS = 100;

class BrowserWebSpeechClient {
    private recognition: SpeechRecognitionLike | null = null;
    private interimCallback: InterimCallback | null = null;
    private endOfTurnCallback: EndOfTurnCallback | null = null;
    private speechStartedCallback: SpeechStartedCallback | null = null;
    private errorCallback: ErrorCallback | null = null;

    private isConnected = false;
    private isStarting = false;
    private shouldBeActive = false;
    private intentionalStop = false;
    private nativeRunning = false;

    private finalCommitTimer: ReturnType<typeof setTimeout> | null = null;
    private finalTranscriptParts: string[] = [];
    private lastInterimTranscript = "";
    private lastConfidence = 0;

    constructor() {
        console.log("[WebSpeech] Client initialized");
    }

    public isSupported(): boolean {
        return !!this.getRecognitionCtor();
    }

    public onInterim(callback: InterimCallback): void {
        this.interimCallback = callback;
    }

    public onEndOfTurn(callback: EndOfTurnCallback): void {
        this.endOfTurnCallback = callback;
    }

    public onSpeechStarted(callback: SpeechStartedCallback): void {
        this.speechStartedCallback = callback;
    }

    public onError(callback: ErrorCallback): void {
        this.errorCallback = callback;
    }

    public connect(): void {
        if (!this.isSupported()) {
            throw new Error("Web Speech API is not supported in this browser.");
        }

        console.log("[WebSpeech] Connecting...");
        this.shouldBeActive = true;
        this.intentionalStop = false;
        this.ensureRecognition();
        this.startRecognition();
    }

    public send(_audioChunk: Int16Array): void {
        // No-op: Web Speech API captures microphone internally.
    }

    public close(): string {
        const transcript = this.assembleTranscript();

        this.shouldBeActive = false;
        this.intentionalStop = true;
        this.clearFinalCommitTimer();

        if (this.recognition && this.nativeRunning) {
            try {
                // Use abort() for immediate cutoff to allow fast restart
                this.recognition.abort();
            } catch (error) {
                console.warn("[WebSpeech] Abort failed:", error);
            }
        }

        this.isConnected = false;
        this.isStarting = false;
        this.nativeRunning = false;
        this.finalTranscriptParts = [];
        this.lastInterimTranscript = "";
        this.lastConfidence = 0;

        return transcript;
    }

    public getIsConnected(): boolean {
        return this.isConnected;
    }

    private getRecognitionCtor(): SpeechRecognitionCtor | null {
        if (typeof window === "undefined") {
            return null;
        }

        const webWindow = window as Window & {
            SpeechRecognition?: SpeechRecognitionCtor;
            webkitSpeechRecognition?: SpeechRecognitionCtor;
        };

        return webWindow.SpeechRecognition || webWindow.webkitSpeechRecognition || null;
    }

    private ensureRecognition(): void {
        if (this.recognition) {
            return;
        }

        const RecognitionCtor = this.getRecognitionCtor();
        if (!RecognitionCtor) {
            throw new Error("SpeechRecognition constructor not available.");
        }

        const recognition = new RecognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = STT_LANGUAGE;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            this.isStarting = false;
            this.isConnected = true;
            this.nativeRunning = true;
            console.log(`[WebSpeech] Listening (${recognition.lang})`);
        };

        recognition.onspeechstart = () => {
            this.clearFinalCommitTimer();
            this.speechStartedCallback?.();
        };

        recognition.onresult = (event: any) => {
            let hasFinal = false;
            let currentFullTranscript = "";
            let bestConfidence = 0;

            // Consolidate all results to prevent duplication from resultIndex shifting
            for (let i = 0; i < event.results.length; i++) {
                const result = event.results[i];
                const alt = result?.[0];
                const text = String(alt?.transcript || "").trim();
                const confidence = typeof alt?.confidence === "number" ? alt.confidence : 0;

                if (text) {
                    currentFullTranscript += (currentFullTranscript ? " " : "") + text;
                    if (result.isFinal) {
                        hasFinal = true;
                    }
                    bestConfidence = Math.max(bestConfidence, confidence);
                }
            }

            if (currentFullTranscript) {
                this.lastInterimTranscript = currentFullTranscript;
                this.lastConfidence = bestConfidence;
                this.interimCallback?.(currentFullTranscript, hasFinal);
            }

            if (hasFinal) {
                this.scheduleFinalCommit();
            }
        };

        recognition.onerror = (event: any) => {
            const code = String(event?.error || "unknown_error");
            console.error(`[WebSpeech] Native Error: ${code}`, event);

            if (code === "aborted" || (code === "no-speech" && this.intentionalStop)) {
                this.nativeRunning = false;
                return;
            }

            if (code === "no-speech") {
                return;
            }

            this.errorCallback?.(new Error(`Web Speech error: ${code}`));
        };

        recognition.onend = () => {
            console.log("[WebSpeech] Native connection closed");
            this.nativeRunning = false;
            this.isConnected = false;
            this.isStarting = false;

            if (this.shouldBeActive && !this.intentionalStop) {
                setTimeout(() => {
                    this.startRecognition();
                }, RESTART_DELAY_MS);
            } else {
                this.triggerEndOfTurn();
            }
        };

        this.recognition = recognition;
    }

    private startRecognition(): void {
        if (!this.recognition) return;

        // If it's already running natively, don't try to start again
        if (this.nativeRunning || this.isConnected || this.isStarting) {
            return;
        }

        try {
            this.isStarting = true;
            this.recognition.start();
        } catch (error: any) {
            this.isStarting = false;
            // Catch "already started" string errors even if flags were out of sync
            if (error?.message?.includes("already started")) {
                this.nativeRunning = true;
                this.isConnected = true;
                return;
            }
            this.errorCallback?.(error instanceof Error ? error : new Error("Web Speech start failed"));
        }
    }

    private assembleTranscript(): string {
        return this.lastInterimTranscript.trim();
    }

    private scheduleFinalCommit(): void {
        this.clearFinalCommitTimer();
        this.finalCommitTimer = setTimeout(() => {
            this.triggerEndOfTurn();
        }, FINAL_COMMIT_GRACE_MS);
    }

    private triggerEndOfTurn(): void {
        this.clearFinalCommitTimer();

        const final = this.assembleTranscript();
        if (!final) {
            return;
        }

        this.endOfTurnCallback?.(final, this.lastConfidence || undefined);
        this.lastInterimTranscript = "";
        this.lastConfidence = 0;
    }

    private clearFinalCommitTimer(): void {
        if (this.finalCommitTimer) {
            clearTimeout(this.finalCommitTimer);
            this.finalCommitTimer = null;
        }
    }
}

export const WebSpeechClient = new BrowserWebSpeechClient();
