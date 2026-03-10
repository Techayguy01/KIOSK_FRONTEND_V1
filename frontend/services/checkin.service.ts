import { getPythonApiBaseUrl, getTenantHeaders } from "./tenantContext";

export interface ConfirmCheckInPayload {
  bookingId: string;
  tenantId?: string;
  tenantSlug?: string;
  verifiedName: string;
  documentType: string;
  documentLast4: string;
  sessionId: string;
}

export interface ConfirmCheckInResponse {
  success: boolean;
  bookingId: string;
  checkinStatus: string;
  checkedInAt: string;
}

export class CheckInConfirmError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CheckInConfirmError";
    this.status = status;
  }
}

async function parseError(response: Response): Promise<CheckInConfirmError> {
  let message = `Check-in confirm failed (${response.status})`;
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string" && payload.detail.trim()) {
      message = payload.detail;
    } else if (typeof payload?.error?.message === "string" && payload.error.message.trim()) {
      message = payload.error.message;
    }
  } catch {
    // Keep the fallback message.
  }
  return new CheckInConfirmError(message, response.status);
}

export async function confirmCheckIn(payload: ConfirmCheckInPayload): Promise<ConfirmCheckInResponse> {
  const response = await fetch(`${getPythonApiBaseUrl()}/api/checkin/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getTenantHeaders(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as ConfirmCheckInResponse;
}
