/**
 * Deepgram Relay Module
 * 
 * Creates a WebSocket connection to Deepgram Nova-2 on behalf of the browser.
 * This keeps the API key server-side only.
 * 
 * RULE: This is a PIPE, not a BRAIN. Pass through bytes only.
 * 
 * Parameters (forwarded from frontend):
 * - sample_rate: Passed from frontend AudioContext native rate
 */

import WebSocket from 'ws';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || "nova-2";
// Indian-local default; override via DEEPGRAM_LANGUAGE in backend/.env if needed.
const DEEPGRAM_LANGUAGE = process.env.DEEPGRAM_LANGUAGE || "hi";
const parseLatencyMs = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const rounded = Math.round(parsed);
    if (rounded < 200 || rounded > 3000) return fallback;
    return rounded;
};
const DEEPGRAM_ENDPOINTING_MS = parseLatencyMs(process.env.DEEPGRAM_ENDPOINTING_MS, 500);
const DEEPGRAM_UTTERANCE_END_MS = parseLatencyMs(process.env.DEEPGRAM_UTTERANCE_END_MS, 700);

export interface DeepgramRelayOptions {
    sampleRate: number;  // Forwarded from frontend
    language?: string;
    onTranscript: (data: any) => void;
    onError: (error: Error) => void;
    onClose: () => void;
}

export class DeepgramRelay {
    private ws: WebSocket | null = null;
    private options: DeepgramRelayOptions;

    constructor(options: DeepgramRelayOptions) {
        this.options = options;
    }

    public connect(): void {
        if (!DEEPGRAM_API_KEY) {
            console.error('[DeepgramRelay] DEEPGRAM_API_KEY not set in backend .env');
            this.options.onError(new Error('Missing DEEPGRAM_API_KEY'));
            return;
        }

        const sampleRate = this.options.sampleRate;
        const language = this.options.language || DEEPGRAM_LANGUAGE;

        // Nova-2 configuration with forwarded sample_rate
        const url =
            `wss://api.deepgram.com/v1/listen` +
            `?model=${encodeURIComponent(DEEPGRAM_MODEL)}` +
            `&language=${encodeURIComponent(language)}` +
            `&encoding=linear16` +
            `&sample_rate=${sampleRate}` +
            `&interim_results=true` +
            `&smart_format=true` +
            `&endpointing=${encodeURIComponent(String(DEEPGRAM_ENDPOINTING_MS))}` +
            `&utterance_end_ms=${encodeURIComponent(String(DEEPGRAM_UTTERANCE_END_MS))}` +
            `&vad_events=true`;

        console.log(`[DeepgramRelay] Connecting to ${DEEPGRAM_MODEL} (${language}) at ${sampleRate}Hz...`);

        this.ws = new WebSocket(url, {
            headers: {
                Authorization: `Token ${DEEPGRAM_API_KEY}`
            }
        });

        this.ws.on('open', () => {
            console.log(`[DeepgramRelay] Connected to Deepgram Nova-2 at ${sampleRate}Hz`);
        });

        this.ws.on('message', (data: Buffer) => {
            try {
                // Parse Deepgram response and forward to browser
                const json = JSON.parse(data.toString());
                this.options.onTranscript(json);
            } catch (error) {
                console.error('[DeepgramRelay] Failed to parse Deepgram response:', error);
            }
        });

        this.ws.on('error', (error) => {
            console.error('[DeepgramRelay] WebSocket error:', error);
            this.options.onError(error as Error);
        });

        this.ws.on('close', (code, reason) => {
            console.log(`[DeepgramRelay] WebSocket closed: ${code} ${reason}`);
            this.options.onClose();
        });
    }

    /**
     * Forward binary audio from browser to Deepgram.
     * Hardened: Only sends if socket is OPEN, otherwise drops silently.
     */
    public sendAudio(audioData: Buffer): void {
        // Guard: Only send if socket exists and is OPEN
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(audioData);
        }
        // CONNECTING, CLOSING, CLOSED: Drop packet silently (no error)
    }

    /**
     * HARD TERMINATION - "The Zombie Killer" (Phase 8.8)
     * 
     * Destroys the WebSocket connection immediately at OS level.
     * No handshake, no waiting, no zombies.
     * 
     * Protocol:
     * 1. removeAllListeners() - Silence all events
     * 2. terminate() - Destroy socket at OS level (not close())
     * 3. Nullify reference
     */
    public close(): void {
        if (this.ws) {
            console.log('[DeepgramRelay] Killing connection');

            try {
                // 1. Event Silencing: Prevent close/error events during teardown
                this.ws.removeAllListeners();

                // 2. Error Swallower: Attach dummy listener to catch terminate() error
                // Without this, Node.js crashes on unhandled 'error' event
                this.ws.on('error', () => { });

                // 3. Hard Termination: Destroy at OS level, not graceful close
                // .terminate() kills instantly; .close() waits for handshake
                this.ws.terminate();
            } catch {
                // Error Suppression: We don't care if it fails
                // The goal is to ensure the socket is dead
            }

            // 3. Nullification: Prevent any subsequent calls
            this.ws = null;
        }
    }

    public isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}
