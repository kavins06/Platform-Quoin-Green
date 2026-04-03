# Security Packet

## Overview

Quoin is a benchmarking-only enterprise platform that manages tenant-scoped building data, governed utility evidence, Portfolio Manager operations, and submission workflow artifacts.

This packet summarizes the current security posture for procurement and security review.

## Identity and tenancy

- Authentication: Supabase Auth only
- Session transport: server-managed cookies via Supabase SSR helpers
- Active tenant selection: explicit active-organization cookie validated against membership
- Authorization model:
  - coarse user roles: `ADMIN`, `MANAGER`, `ENGINEER`, `VIEWER`
  - server-side capability matrix for sensitive actions
  - approval requests for the highest-risk writes

## Tenant isolation

- Every tenant-scoped record carries `organization_id`
- Building-scoped records carry both `building_id` and `organization_id`
- tRPC tenant procedures derive tenant context from authenticated membership
- Public and operator routes resolve tenant context before file, PM, or Green Button actions execute
- CI and database validation scripts remain part of the platform contract

## High-risk action controls

Approval-gated actions:
- PM usage push to ESPM
- remote building delete through the provider account
- governed submission workflow transitions

Execution rules:
- managers can request these actions
- admins can review and execute them
- every request, approval, rejection, and failure is auditable

## Auditability

Append-only audit coverage includes:
- organization creation and membership changes
- active organization changes and sign-out
- PM connect, pull, push, and high-risk approval decisions
- utility bill upload creation and confirmation
- Green Button callback and webhook processing
- submission workflow transitions

## Secrets and ownership

Core secrets:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OCR_SPACE_API_KEY`
- `GEMINI_API_KEY`
- `ESPM_USERNAME`
- `ESPM_PASSWORD`
- `ESPM_CREDENTIAL_MASTER_KEY`
- `GREEN_BUTTON_CLIENT_ID`
- `GREEN_BUTTON_CLIENT_SECRET`
- `GREEN_BUTTON_TOKEN_MASTER_KEY`

Ownership matrix:
- Platform engineering owns Supabase, Redis, and runtime env management
- Integration owners manage ESPM and Green Button credentials
- Product engineering manages OCR/Gemini integration usage

Rules:
- secrets are validated server-side
- integration master keys are required before encrypted credentials are used
- service-role access is restricted to server-only helpers

## Edge protections

- Rate limiting on auth tenant switching, CSV upload, bill upload, Green Button authorize/callback/webhook
- Green Button OAuth state cookie verification in callback flow
- Strict upload validation on content type and size
- Safer failure behavior with normalized error responses and audit coverage

## Backup and recovery

- PostgreSQL remains the system of record
- Supabase storage retains original uploaded bill artifacts
- Queue jobs are durable in Redis/BullMQ and surfaced through runtime health
- Recovery runbooks live in `docs/runbooks.md`

## Dependency and release policy

- CI validates Prisma schema, generated client, platform contract, type safety, tests, and build
- Active-source contract explicitly rejects Clerk-era auth references in runtime code
- Documentation is treated as a release artifact for architecture and operations changes
