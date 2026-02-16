# Multi-Tenant Kiosk Deep Audit Pack

## Purpose and Scope
This audit explains the current implementation state of the kiosk app across frontend, backend, and database layers.  
It is a read-only analysis deliverable: no runtime behavior changes are included in this pack.

Repo snapshot reference date: **2026-02-16**

## Document Map
1. [01-executive-summary.md](./01-executive-summary.md)
2. [02-codebase-map.md](./02-codebase-map.md)
3. [03-frontend-backend-wiring.md](./03-frontend-backend-wiring.md)
4. [04-tenant-resolution-walkthrough.md](./04-tenant-resolution-walkthrough.md)
5. [05-data-flow-walkthrough.md](./05-data-flow-walkthrough.md)
6. [06-mock-hardcoding-audit.md](./06-mock-hardcoding-audit.md)
7. [07-database-status-report.md](./07-database-status-report.md)
8. [08-quality-techdebt-report.md](./08-quality-techdebt-report.md)
9. [09-next-steps-plan.md](./09-next-steps-plan.md)

## Quick Legend
- **FSM**: Finite State Machine. A state-transition model for UI behavior.
- **DTO**: Data Transfer Object. The JSON shape exchanged between FE and BE.
- **Middleware**: Express function that runs before route handlers.
- **Tenant isolation**: Ensuring one tenant cannot read/write another tenant's data.

## Ground Rules Used in This Audit
- Claims are tied to concrete files and line references where possible.
- Missing features are labeled as gaps, not implied as present.
- "Implemented" means currently present in source and wired into runtime paths.
