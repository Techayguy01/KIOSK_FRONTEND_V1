/**
 * Voice Relay + LLM Brain Server
 * 
 * Two responsibilities:
 * 1. WebSocket server for real-time STT relay (voice → Deepgram → text)
 * 2. HTTP server for LLM chat endpoint (text → Groq → intent)
 * 
 * Architecture:
 *   Browser (AudioWorklet) → Backend Relay → Deepgram Nova-2
 *   Deepgram Transcripts → Backend Relay → Browser VoiceRuntime
 *   Transcript → /api/chat → Groq LLM → Intent + Speech
 * 
 * RULE: Voice Relay is a PIPE, not a BRAIN.
 * RULE: LLM endpoint is an ADVISOR, not a CONTROLLER.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { DeepgramRelay } from './deepgramRelay.js';
import chatRouter from './src/routes/chat.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3002', 10);
const DEFAULT_SAMPLE_RATE = 48000;

// ============================================
// 1. HTTP Server (Express) for LLM Endpoints
// ============================================
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'kiosk-brain' });
});

// LLM Chat endpoint
app.use('/api/chat', chatRouter);

const httpServer = createServer(app);
httpServer.listen(HTTP_PORT, () => {
    console.log(`[Brain] HTTP server listening on http://localhost:${HTTP_PORT}`);
    console.log(`[Brain] Chat endpoint: POST http://localhost:${HTTP_PORT}/api/chat`);
});

// ============================================
// 2. WebSocket Server for Voice Relay (STT)
// ============================================
const wss = new WebSocketServer({ port: PORT });

console.log(`[VoiceRelay] WebSocket server starting on ws://localhost:${PORT}`);

wss.on('connection', (clientWs: WebSocket, req) => {
    console.log(`[VoiceRelay] Browser connected from ${req.socket.remoteAddress}`);

    // Extract sample_rate from query params (forwarded from frontend)
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const sampleRate = parseInt(url.searchParams.get('sample_rate') || String(DEFAULT_SAMPLE_RATE), 10);

    console.log(`[VoiceRelay] Client requested sample_rate=${sampleRate}Hz`);

    // Create Deepgram relay for this session with forwarded sample_rate
    const deepgram = new DeepgramRelay({
        sampleRate,  // Forward to Deepgram
        onTranscript: (data) => {
            // Forward Deepgram response to browser (no modification)
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        },
        onError: (error) => {
            console.error('[VoiceRelay] Deepgram error:', error.message);
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ error: error.message }));
            }
        },
        onClose: () => {
            console.log('[VoiceRelay] Deepgram connection closed');
        }
    });

    // Connect to Deepgram
    deepgram.connect();

    // Handle binary audio from browser
    clientWs.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
            // Forward audio to Deepgram
            deepgram.sendAudio(data);
        } else {
            // Handle control messages if needed
            const message = data.toString();
            console.log('[VoiceRelay] Control message:', message);
        }
    });

    // Cleanup on browser disconnect
    clientWs.on('close', (code, reason) => {
        console.log(`[VoiceRelay] Browser disconnected: ${code} ${reason}`);
        deepgram.close();
    });

    clientWs.on('error', (error) => {
        console.error('[VoiceRelay] Client error:', error);
        deepgram.close();
    });
});

wss.on('error', (error) => {
    console.error('[VoiceRelay] Server error:', error);
});

console.log(`[VoiceRelay] Ready. Waiting for connections on port ${PORT}`);
