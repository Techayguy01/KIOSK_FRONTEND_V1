import { Router } from "express";
import { z } from "zod";
import { createWorker } from "tesseract.js";
import { sendApiError } from "../utils/http.js";
import { logWithContext } from "../utils/logger.js";

const router = Router();

const ocrRequestSchema = z.object({
  imageDataUrl: z.string().min(1, "imageDataUrl is required"),
  language: z.string().trim().optional(),
});

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], "base64");
}

function extractIdFields(rawText: string) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/[|]/g, " ").trim())
    .filter(Boolean);

  const cleaned = lines
    .join(" ")
    .replace(/[|]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const nameCandidate = lines.find((line) => /^[A-Za-z][A-Za-z\s.'-]{4,}$/.test(line));
  const docMatch = cleaned.match(/\b[A-Z0-9]{6,18}\b/);
  const dobMatch = cleaned.match(/\b(?:\d{2}[\/-]\d{2}[\/-]\d{4}|\d{4}[\/-]\d{2}[\/-]\d{2})\b/);

  return {
    fullName: nameCandidate || undefined,
    documentNumber: docMatch?.[0],
    dateOfBirth: dobMatch?.[0],
  };
}

router.post("/", async (req, res) => {
  const parsed = ocrRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendApiError(res, 400, "INVALID_OCR_REQUEST", "Invalid OCR payload", req.requestId, parsed.error.flatten());
    return;
  }

  const { imageDataUrl, language } = parsed.data;
  const imageBuffer = dataUrlToBuffer(imageDataUrl);
  if (!imageBuffer) {
    sendApiError(res, 400, "INVALID_IMAGE_DATA", "Expected a base64 image data URL", req.requestId);
    return;
  }

  const normalizedLanguage = language?.trim() || process.env.OCR_LANGUAGE || "eng";

  try {
    const worker = await createWorker(normalizedLanguage);
    try {
      const { data } = await worker.recognize(imageBuffer);

      const text = (data.text || "").trim();
      const confidence = Number.isFinite(data.confidence) ? data.confidence : 0;
      const fields = extractIdFields(text);

      res.json({
        ocr: {
          text,
          confidence,
          fields,
        },
        requestId: req.requestId,
      });
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    logWithContext(req, "ERROR", "OCR processing failed", {
      error: error instanceof Error ? error.message : String(error),
      language: normalizedLanguage,
    });
    sendApiError(res, 500, "OCR_FAILED", "Failed to process image with OCR", req.requestId);
  }
});

export default router;
