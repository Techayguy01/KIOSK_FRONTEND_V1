import type { OcrRequestDTO, OcrResponseDTO } from "@contracts/api.contract";
import { buildTenantApiUrl, getTenantHeaders, getTenantSlug } from "./tenantContext";

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
    }
    code = payload?.error?.code;
  } catch {
    // keep fallback message
  }
  return new OcrServiceError(message, response.status, code);
}

export async function scanIdWithOcr(imageDataUrl: string, language = "eng"): Promise<OcrResponseDTO> {
  const payload: OcrRequestDTO = { imageDataUrl, language };
  const headers = { "Content-Type": "application/json", ...getTenantHeaders() };

  const primaryResponse = await fetch(buildTenantApiUrl("ocr"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const response = primaryResponse.ok
    ? primaryResponse
    : await fetch("http://localhost:3002/api/ocr", {
        method: "POST",
        headers: {
          ...headers,
          "x-tenant-slug": getTenantSlug(),
        },
        body: JSON.stringify(payload),
      });

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as OcrResponseDTO;
}
