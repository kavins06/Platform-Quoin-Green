# V1 Release Checkpoint

This document marks the focused Quoin v1 boundary.

## Active v1 capabilities

Quoin v1 is a compliance operating system for Washington, DC building energy compliance work. Active v1 capabilities are:

- deterministic benchmarking and BEPS compliance evaluation
- governed rule and factor publication with regression gating
- source reconciliation and provenance for canonical building, meter, and consumption state
- governed penalty runs and simple deterministic scenario deltas
- immutable compliance artifacts and persisted submission workflows
- shared governed operational summaries across building, portfolio, and report surfaces
- triage-oriented portfolio worklist with operator actions and bulk recovery actions
- anomaly decision-support and retrofit prioritization
- persisted governed report artifacts for compliance and exemption reporting

## Deprecated legacy retained after v1

These paths remain in the repo only for historical records, cleanup safety, or low-risk transitional support:

- financing persistence models in the Prisma schema
- legacy financing packet service code
- legacy capital-structuring pipeline code and eligibility helpers
- delete-time cleanup of historical financing records

They are not active routes, active user-facing surfaces, or active product dependencies.

## Post-v1 backlog

These are valid follow-on items, but they are not required for the focused v1 checkpoint:

- deeper portfolio worklist scaling beyond cursor pagination
- cleanup of remaining `pg` nested-query deprecation warnings in DB-backed runs
- schema-level retirement of legacy financing and capital models in a dedicated migration pass
- direct regulator submission transport if Quoin later expands beyond filing preparation and governed submission tracking

## Release gate

The focused v1 checkpoint is expected to stay green on:

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration:db`
- `npm run build`
