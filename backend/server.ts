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
import bookingChatRouter from './src/routes/bookingChat.js';
import { resolveTenant } from './src/middleware/tenantResolver.js';
import { prisma } from './src/db/prisma.js';
import { attachRequestContext, requestAccessLogger } from './src/middleware/requestContext.js';
import { sendApiError } from './src/utils/http.js';
import { logWithContext } from './src/utils/logger.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3002', 10);
const DEFAULT_SAMPLE_RATE = 48000;

// ============================================
// 1. HTTP Server (Express) for LLM Endpoints
// ============================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(attachRequestContext);
app.use(requestAccessLogger);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'kiosk-brain', requestId: req.requestId });
});

// Tenant resolution probe endpoints
app.get('/api/tenant', resolveTenant, (req, res) => {
    res.json({ tenant: req.tenant, requestId: req.requestId });
});

app.get('/api/:tenantSlug/tenant', resolveTenant, (req, res) => {
    res.json({ tenant: req.tenant, requestId: req.requestId });
});

app.get('/api/rooms', resolveTenant, async (req, res) => {
    try {
        const tenant = req.tenant;
        if (!tenant) {
            sendApiError(res, 404, "TENANT_NOT_FOUND", "Tenant not found", req.requestId);
            return;
        }

        const roomTypes = await prisma.roomType.findMany({
            where: { tenantId: tenant.id },
            orderBy: { price: 'asc' },
        });

        const rooms = roomTypes.map((room, idx) => ({
            id: room.id,
            name: room.name,
            price: Number(room.price),
            currency: "USD",
            image: `https://picsum.photos/400/300?random=${idx + 1}`,
            features: room.amenities,
            code: room.code,
        }));

        res.json({ rooms, requestId: req.requestId });
    } catch (error) {
        logWithContext(req, "ERROR", "Failed to fetch tenant rooms", {
            error: error instanceof Error ? error.message : String(error),
        });
        sendApiError(res, 500, "ROOMS_FETCH_FAILED", "Failed to fetch rooms", req.requestId);
    }
});

app.get('/api/:tenantSlug/rooms', resolveTenant, async (req, res) => {
    try {
        const tenant = req.tenant;
        if (!tenant) {
            sendApiError(res, 404, "TENANT_NOT_FOUND", "Tenant not found", req.requestId);
            return;
        }

        const roomTypes = await prisma.roomType.findMany({
            where: { tenantId: tenant.id },
            orderBy: { price: 'asc' },
        });

        const rooms = roomTypes.map((room, idx) => ({
            id: room.id,
            name: room.name,
            price: Number(room.price),
            currency: "USD",
            image: `https://picsum.photos/400/300?random=${idx + 1}`,
            features: room.amenities,
            code: room.code,
        }));

        res.json({ rooms, requestId: req.requestId });
    } catch (error) {
        logWithContext(req, "ERROR", "Failed to fetch tenant rooms", {
            error: error instanceof Error ? error.message : String(error),
        });
        sendApiError(res, 500, "ROOMS_FETCH_FAILED", "Failed to fetch rooms", req.requestId);
    }
});

// LLM Chat endpoint
app.use('/api/chat', resolveTenant, chatRouter);
app.use('/api/chat/booking', resolveTenant, bookingChatRouter);

// URL path-based tenant routing support
app.use('/api/:tenantSlug/chat', resolveTenant, chatRouter);
app.use('/api/:tenantSlug/chat/booking', resolveTenant, bookingChatRouter);

const httpServer = createServer(app);
httpServer.listen(HTTP_PORT, () => {
    logWithContext(undefined, "INFO", `HTTP server listening on http://localhost:${HTTP_PORT}`);
    logWithContext(undefined, "INFO", `Chat endpoint: POST http://localhost:${HTTP_PORT}/api/chat`);
    logWithContext(undefined, "INFO", `Booking endpoint: POST http://localhost:${HTTP_PORT}/api/chat/booking`);
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
