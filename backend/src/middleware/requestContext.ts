import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { logWithContext } from "../utils/logger.js";

export function attachRequestContext(req: Request, res: Response, next: NextFunction) {
  const incomingRequestId = req.header("x-request-id")?.trim();
  req.requestId = incomingRequestId || randomUUID();
  res.setHeader("x-request-id", req.requestId);
  req.startTimeMs = Date.now();
  next();
}

export function requestAccessLogger(req: Request, res: Response, next: NextFunction) {
  logWithContext(req, "INFO", "HTTP request started", {
    method: req.method,
    path: req.originalUrl,
  });

  res.on("finish", () => {
    const elapsedMs = req.startTimeMs ? Date.now() - req.startTimeMs : undefined;
    logWithContext(req, "INFO", "HTTP request completed", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      elapsedMs,
    });
  });

  next();
}
