import type { NormalizedCropBoxDTO, OcrRequestDTO, OcrResponseDTO } from "@contracts/api.contract";
import { buildTenantApiUrl, getTenantHeaders } from "./tenantContext";

export class OcrServiceError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "OcrServiceError";
    this.status = status;
    this.code = code;
  }
}

async function parseError(response: Response): Promise<OcrServiceError> {
  let message = `OCR request failed (${response.status})`;
  let code: string | undefined;
  try {
    const payload = await response.json();
    if (payload?.error?.message) {
      message = payload.error.message;
    } else if (typeof payload?.detail === "string" && payload.detail.trim()) {
      message = payload.detail;
    }
    code = payload?.error?.code || payload?.error?.type;
  } catch {
    // keep fallback message
  }
  return new OcrServiceError(message, response.status, code);
}

export async function scanIdWithOcr(
  imageDataUrl: string,
  cropBox?: NormalizedCropBoxDTO,
  language = "eng",
): Promise<OcrResponseDTO> {
  const payload: OcrRequestDTO = { imageDataUrl, language, cropBox };
  const headers = { "Content-Type": "application/json", ...getTenantHeaders() };

  const response = await fetch(buildTenantApiUrl("ocr"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as OcrResponseDTO;
}
