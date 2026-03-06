# Database Overview

## Source of Truth
- Prisma schema: `backend/prisma/schema.prisma`
- Prisma client: `backend/src/db/prisma.ts`
- Seed script: `backend/prisma/seed.ts`
- Migration history: `backend/prisma/migrations/*`

## Data Access Pattern
- Backend routes/services should use Prisma client from `backend/src/db/prisma.ts`.
- Avoid direct SQL in feature code unless there is a specific migration/performance reason.
- Keep tenant-aware queries explicit where hotel-scoped data is involved.

## Schema Evolution
1. Update `backend/prisma/schema.prisma`.
2. Create/apply migration with Prisma migrate scripts in `backend/package.json`.
3. Run seed/verify scripts if data assumptions changed.
4. Validate contract impact in `shared/contracts/*` and backend route responses.

## Verification Utilities
- `backend/prisma/verifyIsolation.ts`
- `backend/prisma/verifyPhase4Contracts.ts`

Use these scripts after schema/tenant-contract changes to reduce regression risk.

