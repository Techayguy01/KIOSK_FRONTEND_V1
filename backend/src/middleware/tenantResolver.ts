import { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { sendApiError } from "../utils/http.js";
import { logWithContext } from "../utils/logger.js";

function getTenantSlug(req: Request): string | null {
  const fromPath =
    typeof req.params?.tenantSlug === "string" ? req.params.tenantSlug.trim() : "";
  if (fromPath) return fromPath;

  const fromHeader =
    req.header("x-tenant-slug")?.trim() ||
    req.header("x-kiosk-tenant")?.trim() ||
    "";
  if (fromHeader) return fromHeader;

  return null;
}

export async function resolveTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantSlug = getTenantSlug(req);
    if (!tenantSlug) {
      sendApiError(res, 400, "TENANT_SLUG_REQUIRED", "Tenant slug is required", req.requestId);
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      include: {
        hotelConfig: true,
      },
    });

    if (!tenant) {
      sendApiError(res, 404, "TENANT_NOT_FOUND", "Tenant not found", req.requestId);
      return;
    }

    req.tenant = tenant;
    req.tenantSlug = tenantSlug;
    logWithContext(req, "INFO", "Tenant resolved", { tenantId: tenant.id, slug: tenant.slug });
    next();
  } catch (error) {
    logWithContext(req, "ERROR", "Tenant resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    sendApiError(res, 500, "TENANT_RESOLUTION_FAILED", "Failed to resolve tenant", req.requestId);
  }
}
