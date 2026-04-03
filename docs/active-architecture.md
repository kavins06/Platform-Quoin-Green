# Active Architecture

## Runtime boundary

Quoin is an active, benchmarking-only platform.

Active runtime surface:
- Supabase Auth and organization tenancy
- Building portfolio management
- Governed utility ingestion and utility bill OCR review
- Portfolio Manager provider-share connection, setup, pull, and push
- Benchmarking readiness, evidence, packets, and submission workflow
- Audit, approvals, runtime health, and operator governance

Archive or compatibility surface:
- Legacy broad compliance remnants not required for active benchmarking runtime
- Historical migration-era auth references
- Deprecated compatibility code that is retained only for data continuity

## Deployment shape

Quoin remains a single Next.js + tRPC + Prisma + Redis/BullMQ application.

The monolith is split logically into:
- `src/app`: HTTP, auth-facing routes, dashboard routes
- `src/server/trpc`: tenant-scoped application API
- `src/server/compliance`: governed benchmarking logic and submission workflow
- `src/server/portfolio-manager`: ESPM provider-share runtime
- `src/server/pipelines`: queue-backed background jobs
- `src/server/lib`: auth, tenancy, audit, approvals, runtime, storage, and security primitives

## Trust boundaries

Primary trust boundaries:
- browser to app
- app to Supabase/Postgres
- app to Redis/BullMQ
- app to ESPM
- app to Green Button utilities
- app to OCR.space and optional Gemini fallback

Key enforcement points:
- Supabase-authenticated request context
- tenant resolution in `requireTenantContext`
- capability checks for sensitive actions
- approval requests for high-risk writes
- audit logging for benchmark-critical actions
- rate limiting on public and integration-facing routes

## Enterprise controls introduced

- Capability-based authorization on top of coarse roles
- Approval-gated PM push, destructive remote delete, and submission transitions
- Governance workspace in Settings for active org, runtime, approvals, integrations, and audit trail
- Expanded runtime health including queue and job visibility
- CI contract validation for Supabase-only auth assumptions
