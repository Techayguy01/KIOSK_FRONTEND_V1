import type { NextFunction, Request, Response } from "express";
import type { z, ZodTypeAny } from "zod";
import { sendApiError } from "../utils/http.js";
import { logWithContext } from "../utils/logger.js";

const validationMode = (process.env.API_VALIDATION_MODE || "warn").toLowerCase();
const enforceValidation = validationMode === "enforce";

export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (parsed.success) {
      req.body = parsed.data as z.infer<T>;
      next();
      return;
    }

    logWithContext(req, "WARN", "Request body validation failed", {
      issues: parsed.error.issues,
      mode: enforceValidation ? "enforce" : "warn",
    });

    if (!enforceValidation) {
      next();
      return;
    }

    sendApiError(
      res,
      400,
      "VALIDATION_FAILED",
      "Invalid request body",
      req.requestId,
      parsed.error.issues
    );
  };
}
