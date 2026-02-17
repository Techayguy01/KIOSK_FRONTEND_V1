import type { Request } from "express";

type LogLevel = "INFO" | "WARN" | "ERROR";

function safeString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function logWithContext(
  req: Request | undefined,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>
) {
  const requestId = req?.requestId || "n/a";
  const tenant = req?.tenantSlug || req?.tenant?.slug || "n/a";
  const line = `[${level}] [requestId=${requestId}] [tenant=${tenant}] ${message}`;

  if (!data || Object.keys(data).length === 0) {
    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
    return;
  }

  const detail = safeString(data);
  if (level === "ERROR") console.error(line, detail);
  else if (level === "WARN") console.warn(line, detail);
  else console.log(line, detail);
}
