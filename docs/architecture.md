# Architecture

## System shape

Quoin is a Next.js monolith with tRPC, Prisma/Postgres, and worker-side ingestion and sync processing.

The active product architecture is now benchmarking-first:

- Quoin is the governed local benchmarking system of record.
- ESPM is the external benchmarking workspace and integration target.
- The current PM workflow lives in `src/server/portfolio-manager/*`.
- Legacy `src/server/compliance/portfolio-manager-sync*.ts` and `src/server/compliance/portfolio-manager-push.ts` remain compatibility-only until annual benchmarking no longer depends on them.

Primary layers:

- `src/app`
  route handlers and application pages
- `src/components`
  UI surfaces for buildings, benchmarking execution, packets, and admin operations
- `src/server/trpc`
  tenant-safe API routers
- `src/server/compliance`
  benchmarking, provenance, packet, workflow, and retained compatibility services
- `src/server/portfolio-manager`
  active Portfolio Manager connection, property import, setup, meter-linking, and usage services
- `src/server/integrations`
  ESPM and Green Button integrations
- `src/server/pipelines`
  ingestion pipelines and worker execution

## Persistence

Core persisted records include:

- `Building`
- `EnergyReading`
- `ComplianceSnapshot`
- `ComplianceRun`
- `BenchmarkSubmission`
- `BenchmarkPacket`
- `EvidenceArtifact`
- `SourceArtifact`
- `AuditLog`
- `Job`

Rules are versioned through:

- `RulePackage`
- `RuleVersion`
- `FactorSetVersion`

## Ingestion flows

Primary external data paths:

- Portfolio Manager connection/import, setup, and explicit usage import/push
- Green Button webhook and downstream ingestion
- CSV upload and normalization

These flows are backed by:

- canonical ingestion envelope handling
- persistent jobs
- audit logs
- typed error normalization

Legacy `src/server/compliance/portfolio-manager-sync*.ts` and
`src/server/compliance/portfolio-manager-push.ts` remain in the repo for
compatibility and cleanup only. The current product direction is the newer
`src/server/portfolio-manager/*` architecture.

## Compliance engine role

The centralized compliance engine lives in `src/server/compliance/compliance-engine.ts`.

It is responsible for:

- selecting the applicable governed rule and factor versions
- assembling input snapshots
- enforcing QA gates
- invoking deterministic benchmarking evaluation logic
- persisting `ComplianceRun`
- writing audit entries around computation

Routers should call the engine rather than recomputing compliance logic inline.

For the product-reduction target state and phased cleanup plan, see [benchmarking-only-product-direction.md](benchmarking-only-product-direction.md).

## Audit, jobs, and QA

Operational foundation pieces:

- `AuditLog`
  persistent execution and boundary trace records
- `Job`
  durable execution state for ingestion and sync workflows
- data quality verdicts
  explicit `PASS`, `WARN`, `FAIL` gates used by compliance flows

These pieces are intended to make evaluations explainable and replayable, not opaque.
