/**
 * Web Speech STT Client
 *
 * Browser-native fallback when Deepgram relay is unavailable.
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

        this.shouldBeActive = true;
        this.intentionalStop = false;
        this.ensureRecognition();
        this.startRecognition();
    }

    public send(_audioChunk: Int16Array): void {
        // No-op: Web Speech API captures microphone internally.
    }

    public close(): string {
        const transcript = this.finalTranscriptParts.join(" ").trim() || this.lastInterimTranscript.trim();

        this.shouldBeActive = false;
        this.intentionalStop = true;
        this.clearFinalCommitTimer();

        if (this.recognition && (this.isConnected || this.isStarting)) {
            try {
                this.recognition.stop();
            } catch (error) {
                console.warn("[WebSpeech] Stop failed:", error);
            }
        }

        this.isConnected = false;
        this.isStarting = false;
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
            console.log(`[WebSpeech] Listening (${recognition.lang})`);
        };

        recognition.onspeechstart = () => {
            this.clearFinalCommitTimer();
            this.finalTranscriptParts = [];
            this.lastInterimTranscript = "";
            this.speechStartedCallback?.();
        };

        recognition.onresult = (event: any) => {
            let hasFinal = false;

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const alt = result?.[0];
                const transcript = String(alt?.transcript || "").trim();
                if (!transcript) {
                    continue;
                }

                const confidence = typeof alt?.confidence === "number" ? alt.confidence : 0;
                const isFinal = result?.isFinal === true;
                this.interimCallback?.(transcript, isFinal);

                if (isFinal) {
                    hasFinal = true;
                    this.finalTranscriptParts.push(transcript);
                    this.lastConfidence = Math.max(this.lastConfidence, confidence);
                } else {
                    this.lastInterimTranscript = transcript;
                    this.lastConfidence = confidence || this.lastConfidence;
                }
            }

            if (hasFinal) {
                this.scheduleFinalCommit();
            }
        };

        recognition.onerror = (event: any) => {
            const code = String(event?.error || "unknown_error");
            if (code === "aborted" && this.intentionalStop) {
                return;
            }
            if (code === "no-speech") {
                return;
            }
            this.errorCallback?.(new Error(`Web Speech error: ${code}`));
        };

        recognition.onend = () => {
            this.triggerEndOfTurn();
            this.isConnected = false;
            this.isStarting = false;

            if (this.shouldBeActive && !this.intentionalStop) {
                setTimeout(() => {
                    this.startRecognition();
                }, RESTART_DELAY_MS);
            }
        };

        this.recognition = recognition;
    }

    private startRecognition(): void {
        if (!this.recognition || this.isConnected || this.isStarting) {
            return;
        }

        try {
            this.isStarting = true;
            this.recognition.start();
        } catch (error) {
            this.isStarting = false;
            this.errorCallback?.(error instanceof Error ? error : new Error("Web Speech start failed"));
        }
    }

    private scheduleFinalCommit(): void {
        this.clearFinalCommitTimer();
        this.finalCommitTimer = setTimeout(() => {
            this.triggerEndOfTurn();
        }, FINAL_COMMIT_GRACE_MS);
    }

    private triggerEndOfTurn(): void {
        this.clearFinalCommitTimer();

        const final = this.finalTranscriptParts.join(" ").trim() || this.lastInterimTranscript.trim();
        if (!final) {
            return;
        }

        this.endOfTurnCallback?.(final, this.lastConfidence || undefined);
        this.finalTranscriptParts = [];
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
