import type { Prisma } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTimeMs?: number;
      tenant?: Prisma.TenantGetPayload<{
        include: {
          tenant_configs: true;
        };
      }>;
      tenantSlug?: string;
    }
  }
}

export {};
