/**
 * Web Speech STT Client
 *
 * Browser-native Web Speech API - the sole STT provider.
 */

type InterimCallback = (transcript: string, isFinal: boolean) => void;
type EndOfTurnCallback = (accumulatedTranscript: string, confidence?: number) => void;
type SpeechStartedCallback = () => void;
type ErrorCallback = (error: SttClientError) => void;

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
type SttErrorCode =
    | "aborted"
    | "no-speech"
    | "not-allowed"
    | "service-not-allowed"
    | "network"
    | "audio-capture"
    | "unknown_error";

type SttClientError = Error & {
    code: SttErrorCode | string;
    fatal: boolean;
    recoverable: boolean;
    expected: boolean;
    permissionDenied: boolean;
};

const STT_LANGUAGE = (import.meta.env.VITE_STT_LANGUAGE || "en-US").trim() || "en-US";
const FINAL_COMMIT_GRACE_MS = Number(import.meta.env.VITE_FINAL_COMMIT_GRACE_MS || 250);
const RESTART_DELAY_MS = 100;
const PERMISSION_DENIED_COOLDOWN_MS = Number(import.meta.env.VITE_STT_PERMISSION_DENIED_COOLDOWN_MS || 15000);

function normalizeSpeechRecognitionLanguage(lang: string): string {
    const normalized = String(lang || "").trim().toLowerCase();
    if (normalized.startsWith("hi") || normalized === "hindi") return "hi-IN";
    if (normalized.startsWith("mr") || normalized === "marathi") return "mr-IN";
    if (normalized.startsWith("en") || normalized === "english") return "en-IN";
    return normalized || "en-IN";
}

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
    private activeSessionId = 0;
    private sessionSequence = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private permissionDeniedUntil = 0;
    private preferredLanguage = STT_LANGUAGE;

    private finalCommitTimer: ReturnType<typeof setTimeout> | null = null;
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

        if (this.isPermissionDeniedLocked()) {
            const retryInMs = Math.max(0, this.permissionDeniedUntil - Date.now());
            const lockError = this.buildClientError(
                "not-allowed",
                `Web Speech permission denied recently; retry after ${Math.ceil(retryInMs / 1000)}s`,
                true,
                false,
                false,
                true
            );
            this.errorCallback?.(lockError);
            throw lockError;
        }

        console.log("[WebSpeech] Connecting...");
        this.shouldBeActive = true;
        this.intentionalStop = false;
        this.beginSession();
    }

    public send(_audioChunk: Int16Array): void {
        // No-op: Web Speech API captures microphone internally.
    }

    public close(): string {
        const transcript = this.assembleTranscript();

        this.shouldBeActive = false;
        this.intentionalStop = true;
        this.clearFinalCommitTimer();
        this.clearReconnectTimer();

        this.destroyRecognition({ stopNative: true });

        this.isConnected = false;
        this.isStarting = false;
        this.nativeRunning = false;
        this.lastInterimTranscript = "";
        this.lastConfidence = 0;

        return transcript;
    }

    public getIsConnected(): boolean {
        return this.isConnected;
    }

    /**
     * Update the recognition language at runtime.
     * Use "hi-IN" for Hindi, "en-IN" or "en-US" for English.
     */
    public setLanguage(lang: string): void {
        const targetLang = normalizeSpeechRecognitionLanguage(lang);
        this.preferredLanguage = targetLang;

        if (this.recognition && this.recognition.lang !== targetLang) {
            console.log(`[WebSpeech] Updating language: ${this.recognition.lang} -> ${targetLang}`);
            this.recognition.lang = targetLang;
        }
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

    private beginSession(): void {
        this.clearReconnectTimer();
        const sessionId = ++this.sessionSequence;
        this.activeSessionId = sessionId;
        this.createRecognition(sessionId);
        this.startRecognition(sessionId);
    }

    private createRecognition(sessionId: number): void {
        this.destroyRecognition({ stopNative: false });

        const RecognitionCtor = this.getRecognitionCtor();
        if (!RecognitionCtor) {
            throw new Error("SpeechRecognition constructor not available.");
        }

        const recognition = new RecognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = this.preferredLanguage;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            if (this.isStaleSession(sessionId)) {
                console.debug(`[WebSpeech] Ignoring stale onstart (session=${sessionId}, active=${this.activeSessionId})`);
                return;
            }
            this.isStarting = false;
            this.isConnected = true;
            this.nativeRunning = true;
            console.log(`[WebSpeech] Listening (${recognition.lang})`);
        };

        recognition.onspeechstart = () => {
            if (this.isStaleSession(sessionId)) {
                console.debug(`[WebSpeech] Ignoring stale onspeechstart (session=${sessionId}, active=${this.activeSessionId})`);
                return;
            }
            this.clearFinalCommitTimer();
            this.speechStartedCallback?.();
        };

        recognition.onresult = (event: any) => {
            if (this.isStaleSession(sessionId)) {
                console.debug(`[WebSpeech] Ignoring stale onresult (session=${sessionId}, active=${this.activeSessionId})`);
                return;
            }

            let hasFinal = false;
            let currentFullTranscript = "";
            let bestConfidence = 0;

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
            if (this.isStaleSession(sessionId)) {
                console.debug(`[WebSpeech] Ignoring stale onerror (session=${sessionId}, active=${this.activeSessionId})`);
                return;
            }

            const code = String(event?.error || "unknown_error") as SttErrorCode;

            if (code === "aborted") {
                this.nativeRunning = false;
                if (this.intentionalStop || !this.shouldBeActive) {
                    console.info("[WebSpeech] Expected abort during intentional stop");
                    return;
                }
                console.info("[WebSpeech] Non-fatal abort observed while active");
                return;
            }

            if (code === "no-speech") {
                return;
            }

            if (code === "not-allowed" || code === "service-not-allowed") {
                this.permissionDeniedUntil = Date.now() + PERMISSION_DENIED_COOLDOWN_MS;
                this.shouldBeActive = false;
                this.intentionalStop = true;
                console.warn(`[WebSpeech] Permission denied (${code}). Cooling down retries for ${PERMISSION_DENIED_COOLDOWN_MS}ms`);
                this.errorCallback?.(this.buildClientError(
                    code,
                    `Web Speech permission denied (${code})`,
                    true,
                    false,
                    false,
                    true
                ));
                return;
            }

            console.error(`[WebSpeech] Native Error: ${code}`, event);
            this.errorCallback?.(this.buildClientError(
                code,
                `Web Speech error: ${code}`,
                false,
                true,
                false,
                false
            ));
        };

        recognition.onend = () => {
            if (this.isStaleSession(sessionId)) {
                console.debug(`[WebSpeech] Ignoring stale onend (session=${sessionId}, active=${this.activeSessionId})`);
                return;
            }

            console.log("[WebSpeech] Native connection closed");
            this.nativeRunning = false;
            this.isConnected = false;
            this.isStarting = false;

            if (this.shouldBeActive && !this.intentionalStop && !this.isPermissionDeniedLocked()) {
                this.clearReconnectTimer();
                this.reconnectTimer = setTimeout(() => {
                    this.startRecognition(sessionId);
                }, RESTART_DELAY_MS);
            } else {
                this.triggerEndOfTurn();
            }
        };

        this.recognition = recognition;
    }

    private startRecognition(sessionId: number): void {
        if (!this.recognition) return;
        if (this.isStaleSession(sessionId)) return;

        if (this.nativeRunning || this.isConnected || this.isStarting) {
            return;
        }

        try {
            this.isStarting = true;
            this.recognition.start();
        } catch (error: any) {
            this.isStarting = false;
            if (error?.message?.includes("already started")) {
                this.nativeRunning = true;
                this.isConnected = true;
                return;
            }
            const message = String(error?.message || "Web Speech start failed");
            const lowered = message.toLowerCase();
            if (lowered.includes("not-allowed") || lowered.includes("service-not-allowed")) {
                const permissionError = this.buildClientError(
                    "not-allowed",
                    message,
                    true,
                    false,
                    false,
                    true
                );
                this.permissionDeniedUntil = Date.now() + PERMISSION_DENIED_COOLDOWN_MS;
                this.shouldBeActive = false;
                this.intentionalStop = true;
                this.errorCallback?.(permissionError);
                return;
            }
            this.errorCallback?.(this.buildClientError(
                "unknown_error",
                message,
                false,
                true,
                false,
                false
            ));
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

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private isPermissionDeniedLocked(): boolean {
        return this.permissionDeniedUntil > Date.now();
    }

    private isStaleSession(sessionId: number): boolean {
        return sessionId !== this.activeSessionId;
    }

    private destroyRecognition(options: { stopNative: boolean }): void {
        if (!this.recognition) return;

        const recognition = this.recognition;
        this.recognition = null;

        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onspeechstart = null;
        recognition.onerror = null;
        recognition.onend = null;

        if (options.stopNative) {
            try {
                recognition.abort();
            } catch (error) {
                console.debug("[WebSpeech] Abort during destroy failed (safe to ignore):", error);
            }
        }
    }

    private buildClientError(
        code: SttErrorCode | string,
        message: string,
        fatal: boolean,
        recoverable: boolean,
        expected: boolean,
        permissionDenied: boolean
    ): SttClientError {
        const error = new Error(message) as SttClientError;
        error.code = code;
        error.fatal = fatal;
        error.recoverable = recoverable;
        error.expected = expected;
        error.permissionDenied = permissionDenied;
        return error;
    }
}

export const WebSpeechClient = new BrowserWebSpeechClient();
