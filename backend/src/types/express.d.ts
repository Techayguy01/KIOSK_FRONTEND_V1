import type { Prisma } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      tenant?: Prisma.TenantGetPayload<{
        include: {
          hotelConfig: true;
        };
      }>;
      tenantSlug?: string;
    }
  }
}

export {};
