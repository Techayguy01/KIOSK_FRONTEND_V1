import { Router, Request, Response } from 'express';

const router = Router();

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:5000';
const DEFAULT_SPEAKER = process.env.VIBEVOICE_DEFAULT_SPEAKER || 'hi-Priya_woman';
const REQUEST_TIMEOUT_MS = parseInt(process.env.TTS_REQUEST_TIMEOUT_MS || '15000', 10);

router.post('/', async (req: Request, res: Response) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const speaker = typeof req.body?.speaker === 'string' ? req.body.speaker : DEFAULT_SPEAKER;

    if (!text) {
        res.status(400).json({ ok: false, provider: 'none', reason: 'text_required' });
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(`${AI_ENGINE_URL}/generate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, speaker }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`ai_engine_${response.status}: ${detail}`);
        }

        const data = await response.json() as { url?: string; cached?: boolean; status?: string };
        if (!data?.url || typeof data.url !== 'string') {
            throw new Error('ai_engine_invalid_response');
        }

        res.json({
            ok: true,
            provider: 'vibevoice',
            audioUrl: data.url,
            cached: Boolean(data.cached),
        });
    } catch (error) {
        clearTimeout(timeout);
        console.warn('[TTS] Falling back to frontend speech synthesis:', error);
        res.json({
            ok: false,
            provider: 'browser',
            reason: error instanceof Error ? error.message : 'unknown_tts_error',
        });
    }
});

export default router;
