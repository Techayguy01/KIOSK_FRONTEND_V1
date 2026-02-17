import type { Response } from "express";

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  requestId?: string,
  details?: unknown
) {
  const payload: ApiErrorPayload = {
    error: {
      code,
      message,
      requestId,
      details,
    },
  };
  res.status(status).json(payload);
}
