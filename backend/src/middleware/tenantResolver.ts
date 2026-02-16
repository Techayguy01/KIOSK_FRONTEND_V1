import { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma.js";

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
      res.status(400).json({
        message: "Tenant slug is required",
      });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      include: {
        hotelConfig: true,
      },
    });

    if (!tenant) {
      res.status(404).json({ message: "Tenant not found" });
      return;
    }

    req.tenant = tenant;
    req.tenantSlug = tenantSlug;
    next();
  } catch (error) {
    console.error("[TenantResolver] Failed to resolve tenant:", error);
    res.status(500).json({ message: "Failed to resolve tenant" });
  }
}
