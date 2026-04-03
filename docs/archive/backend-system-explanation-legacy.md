# Backend System Explanation

Repository root: `C:\Quoin`

This document is based on code inspection of the actual runtime paths in `src/app/api`, `src/server`, `prisma`, and the generated schema-backed domain modules. It is intentionally not a README summary. Where behavior is unclear, partial, or only implied, that is called out directly.

## 1. Executive overview

### What the platform is

The platform appears to be a multi-tenant building energy and compliance operations system. Its main job is to help an organization manage a portfolio of buildings, ingest energy data from multiple sources, reconcile that data, evaluate external reporting and compliance obligations, assemble evidence packets, and track the operational workflow around those obligations.

The strongest implemented domain themes are:

- annual benchmarking readiness and submission support
- BEPS-style compliance evaluation and filing support
- ingestion of energy usage data from CSV uploads, Green Button utility feeds, and ENERGY STAR Portfolio Manager
- governed rule and factor versioning with provenance for compliance runs
- operational issue tracking, anomaly detection, and retrofit prioritization

### What problem it solves

The product is designed to reduce the manual work of proving compliance for buildings. Instead of relying on spreadsheets and ad hoc file handoffs, it creates a backend system that:

- stores building and meter data
- keeps a historical record of energy readings
- derives compliance metrics and snapshots
- determines readiness or non-readiness using explicit rule logic
- tells operators what is blocking progress
- generates artifacts that support filing or submission workflows

### What the backend is responsible for

The backend is responsible for almost all meaningful state in the platform:

- identity-to-tenant mapping and tenant scoping
- building, meter, and reading persistence
- data ingestion and normalization
- synchronization with external systems
- compliance calculations and governed rule resolution
- provenance, audit logging, and job tracking
- workflow state transitions for submission and filing
- anomaly detection and retrofit ranking
- report and packet generation/export

Portfolio Manager note:

- the current governed PM workflow lives in `src/server/portfolio-manager/*`
- the older `src/server/compliance/portfolio-manager-sync*.ts` and `src/server/compliance/portfolio-manager-push.ts` modules now survive only as a benchmark-compatibility layer for legacy benchmarking state

### High-level design

The actual codebase is a modular monolith, not a microservice system.

- UI and server are both in a Next.js application (`package.json`, `src/app`, `src/server`)
- the primary app API is tRPC over `/api/trpc` (`src/app/api/trpc/[trpc]/route.ts`, `src/server/trpc/routers/index.ts`)
- some backend actions use direct Next.js route handlers for uploads, OAuth callbacks, and webhooks (`src/app/api/upload/route.ts`, `src/app/api/green-button/*`, `src/app/api/webhooks/clerk/route.ts`)
- Postgres via Prisma is the main database (`prisma/schema.prisma`, `src/server/lib/db.ts`)
- Redis + BullMQ exist for async processing, but only the data-ingestion worker is actually started (`src/server/lib/queue.ts`, `src/server/worker-entrypoint.ts`)
- the most important domain logic lives in `src/server/compliance/*` and `src/server/pipelines/*`

At a business level, the system is designed around this sequence:

1. create or sync an organization and user membership
2. create buildings and connect data sources
3. ingest energy data and reconcile conflicting sources
4. derive snapshots and canonical inputs
5. evaluate benchmarking and BEPS obligations using governed rules
6. surface blocking issues and next actions
7. generate packets, reports, and workflow state
8. monitor operational anomalies and retrofit options

## 2. System architecture

### Actual architecture in one view

```text
Users / Operators
    |
    v
Next.js UI
    |
    +--> tRPC endpoint: src/app/api/trpc/[trpc]/route.ts
    |       |
    |       v
    |   tRPC routers: src/server/trpc/routers/*
    |       |
    |       v
    |   Domain services / compliance engines / integrations
    |
    +--> Direct HTTP routes
            - /api/upload
            - /api/green-button/authorize
            - /api/green-button/callback
            - /api/green-button/webhook
            - /api/webhooks/clerk
            - /api/health
                    |
                    v
         Domain services / ingestion pipelines / job creation

Domain services
    |
    +--> Prisma/Postgres
    +--> Redis/BullMQ
    +--> Clerk
    +--> Green Button APIs
    +--> ENERGY STAR Portfolio Manager APIs
```

### App structure

Observed server-facing structure:

- `src/app`: Next.js app router and API routes
- `src/server/trpc`: tRPC initialization and routers
- `src/server/compliance`: the main domain layer
- `src/server/pipelines`: ingestion and other worker-oriented flows
- `src/server/integrations`: external system clients
- `src/server/lib`: auth, tenancy, logging, queue, config, crypto, errors
- `prisma`: schema and migrations

### Frontend/backend boundary

The main frontend/backend boundary is tRPC:

- `src/app/api/trpc/[trpc]/route.ts` exposes the server router
- `src/server/trpc/init.ts` creates request context and enforces auth/tenant policy
- `src/server/trpc/routers/*.ts` are effectively the platform’s application service interface

There is a second boundary for actions that do not fit tRPC well:

- file upload: `src/app/api/upload/route.ts`
- Green Button OAuth and webhook handling: `src/app/api/green-button/*`
- Clerk identity synchronization: `src/app/api/webhooks/clerk/route.ts`

### Server layers

The code naturally falls into these layers:

1. Interface layer
   - tRPC procedures and direct route handlers
   - input validation with Zod
2. Application/service layer
   - orchestration of use cases such as sync, evaluation, packet generation, workflow transition
   - mostly in `src/server/compliance/*` and `src/server/pipelines/*`
3. Domain/rules layer
   - benchmarking rules
   - BEPS rules and formulas
   - readiness, penalty, reconciliation, anomaly, retrofit ranking logic
4. Persistence layer
   - Prisma models in `prisma/schema.prisma`
   - tenant-aware access in `src/server/lib/db.ts`
   - some system services use admin Prisma with explicit organization filters
5. Async/runtime layer
   - BullMQ queues in `src/server/lib/queue.ts`
   - worker boot in `src/server/worker-entrypoint.ts`
   - persistent job lifecycle in `src/server/lib/jobs.ts`

### API layer

Main API domains exposed through tRPC:

- `building`
- `benchmarking`
- `beps`
- `report`
- `operations`
- `retrofit`
- `provenance`
- `drift`

These are registered in `src/server/trpc/routers/index.ts`.

### Services and business logic

Business logic lives primarily in service modules, not in the route layer:

- compliance and workflow logic: `src/server/compliance/*`
- ingestion logic: `src/server/pipelines/data-ingestion/*`
- external system adapters: `src/server/integrations/*`

The routes are relatively thin. They validate input, establish tenant/auth context, and call domain functions.

### Background jobs / workers / queues

Queue infrastructure exists for several job families in `src/server/lib/queue.ts`:

- `data-ingestion`
- `espm-sync`
- `pathway-analysis`
- `capital-structuring`
- `drift-detection`
- `ai-analysis`
- `notifications`
- `report-generator`

Actual runtime reality is narrower:

- only the data-ingestion worker is started in `src/server/worker-entrypoint.ts`
- future worker starts are present as comments, not active code
- some long-running operations still execute synchronously from request paths while also creating persistent `Job` records

This means the system has a partially built async architecture, not a uniformly asynchronous one.

### Database layer

The database is PostgreSQL accessed through Prisma (`prisma/schema.prisma`, `src/server/lib/db.ts`).

Key architectural choices:

- tenant tables use row-level security policies in `prisma/migrations/00000000000001_rls_policies/migration.sql`
- the app uses `set_config('app.organization_id', ...)` plus `SET LOCAL ROLE quoin_app` in `src/server/lib/db.ts`
- a tenant-specific Prisma wrapper is provided by `getTenantClient(organizationId)` and `requireTenantContext(...)`

Important nuance:

- not every domain service uses the tenant client
- several system services use the global admin Prisma client and enforce tenant isolation by explicit `organizationId` and `buildingId` filters
- that can be valid, but it puts more correctness pressure on application code

### External integrations

Core observed integrations:

- Clerk for auth and org membership (`src/server/lib/auth.ts`, `src/app/api/webhooks/clerk/route.ts`)
- ENERGY STAR Portfolio Manager (`src/server/integrations/espm/client.ts`)
- Green Button utility integration (`src/server/integrations/green-button/*`)
- Redis for queueing (`src/server/lib/queue.ts`)

### Auth / tenancy / permissions

Auth and tenancy are implemented through:

- Clerk session auth: `src/server/lib/auth.ts`
- organization membership syncing: `src/server/lib/organization-membership.ts`
- tenant context enforcement: `src/server/lib/tenant-access.ts`
- tRPC procedure classes:
  - `protectedProcedure`
  - `tenantProcedure`
  - `operatorProcedure`
  in `src/server/trpc/init.ts`

`operatorProcedure` restricts higher-risk mutations to application roles such as `ADMIN` and `MANAGER`.

### Logging / observability / auditability

Observed mechanisms:

- structured logging: `src/server/lib/logger.ts`
- persistent audit records: `src/server/lib/audit-log.ts`, `AuditLog` model in `prisma/schema.prisma`
- persistent job records with lifecycle transitions: `src/server/lib/jobs.ts`, `Job` model
- provenance for compliance evaluations: `src/server/compliance/provenance.ts`

### Storage / artifacts / generated outputs

Generated outputs are mostly represented as database-backed artifacts:

- `ReportArtifact`
- `BenchmarkPacket`
- `FilingPacket`
- `EvidenceArtifact`
- `SourceArtifact`

Exports are generated on demand:

- benchmarking and filing packets can be exported as JSON, markdown, and PDF (`src/server/compliance/benchmark-packets.ts`, `src/server/compliance/beps/filing-packets.ts`, `src/server/rendering/packet-documents.ts`)
- report artifacts are stored and exported through the reporting layer (`src/server/compliance/report-artifacts.ts`, `src/server/trpc/routers/report.ts`)

What is not clearly implemented from inspected code:

- a general object storage adapter for `storageUri` or `externalUrl`
- a broader artifact blob storage system outside database payloads and generated export responses

### Major architectural patterns used

- modular monolith
- service-oriented domain modules
- thin controller/router layer
- governed rule/factor versioning
- append-mostly historical records with latest-state projections
- explicit workflow state machines
- hybrid synchronous plus queued processing

### Where important logic lives

- business logic: `src/server/compliance/*`
- orchestration logic: route handlers plus higher-level services such as `benchmarking.ts`, `portfolio-manager/*`, `beps-evaluator.ts`, `report.ts`
- validation: Zod in routers/routes, ingestion validation in pipeline modules
- state transitions:
  - jobs in `src/server/lib/jobs.ts`
  - submission workflow in `src/server/compliance/submission-workflows.ts`
  - filing workflow in `src/server/compliance/beps/filing-workflow.ts`
  - issue/readiness transitions in `src/server/compliance/data-issues.ts`

## 3. Full backend component map

| Component | Purpose | Key files | Inputs | Outputs | Dependencies | Why it exists |
|---|---|---|---|---|---|---|
| API entrypoint | Exposes the application API to the frontend | `src/app/api/trpc/[trpc]/route.ts` | HTTP requests | tRPC procedure results | Next.js, tRPC | Main frontend-to-backend contract |
| tRPC auth/context layer | Builds request context and enforces auth, tenant, and operator permissions | `src/server/trpc/init.ts`, `src/server/lib/auth.ts`, `src/server/lib/tenant-access.ts` | Clerk session, organization context | Context with `organizationId`, `tenantDb`, role data | Clerk, Prisma | Prevents anonymous or cross-tenant access |
| Building router | CRUD, portfolio views, penalty summaries, pipeline runs, issue operations | `src/server/trpc/routers/building.ts` | User mutations/queries | Building records, summaries, issue updates | Prisma, compliance services | Core building-facing app surface |
| Benchmarking router | Legacy benchmark-compatibility reads plus readiness evaluation, request items, and packet generation/export | `src/server/trpc/routers/benchmarking.ts` | Building/reporting year inputs, evidence metadata | Submission state, readiness output, packet exports | Benchmark compatibility state, benchmarking engine, packet services | Supports annual benchmarking workflow while compatibility state still exists |
| BEPS router | Canonical input management, evaluation, filing transitions, packet generation/export | `src/server/trpc/routers/beps.ts` | Building/cycle/year inputs, evidence, filing actions | BEPS outcome, filing state, packet exports | BEPS evaluator, filing workflow, packet services | Supports BEPS compliance workflow |
| Reporting router | Generates governed compliance/exemption report artifacts and publication actions | `src/server/trpc/routers/report.ts` | Artifact generation/export requests | Report artifact rows, export payloads | Report artifact service, governed publication | Produces reportable outputs from backend state |
| Data-ingestion pipeline | Parses, validates, normalizes, stores energy readings, and derives snapshots | `src/server/pipelines/data-ingestion/logic.ts`, `src/server/pipelines/data-ingestion/snapshot.ts` | CSV content, Green Button envelopes, stored readings | `EnergyReading`, `PipelineRun`, `ComplianceSnapshot`, derived inputs | Prisma, provenance | Converts raw energy data into usable platform state |
| Data-ingestion worker | Processes queued ingestion envelopes and records job/audit state | `src/server/pipelines/data-ingestion/worker.ts`, `src/server/pipelines/data-ingestion/envelope.ts` | BullMQ jobs | Completed ingestion, refreshed issues, job updates | BullMQ, Redis, ingestion logic | Handles async ingestion and retries |
| Green Button integration | Manages OAuth, token storage, webhook ingestion, ESPI fetch and aggregation | `src/app/api/green-button/*`, `src/server/integrations/green-button/*`, `src/server/pipelines/data-ingestion/green-button.ts` | OAuth codes, XML notifications, API responses | `GreenButtonConnection`, meters/readings, jobs | Utility API, token crypto, BullMQ | Pulls utility-grade energy data into the system |
| Portfolio Manager integration | Connects/imports buildings, configures PM setup, imports/pushes usage explicitly, and preserves benchmark compatibility where still required | `src/server/integrations/espm/client.ts`, `src/server/portfolio-manager/*`, `src/server/compliance/portfolio-manager-sync.ts`, `src/server/compliance/portfolio-manager-sync-reliable.ts`, `src/server/compliance/portfolio-manager-push.ts` | Building linkage, PM credentials, local readings | PM connection state, setup state, usage state, compatibility state | ESPM API, Prisma, source reconciliation, benchmarking engine | Keeps Quoin authoritative locally while using PM as an external workspace and integration target |
| Governed compliance and provenance layer | Resolves active rule/factor versions, records immutable compliance runs, manifests, evidence | `src/server/compliance/compliance-engine.ts`, `src/server/compliance/provenance.ts`, `src/server/compliance/compliance-surface.ts` | Snapshots, canonical inputs, active rule versions | `ComplianceRun`, `CalculationManifest`, artifacts, surface summaries | Rule/factor tables, Prisma | Creates traceable compliance decisions |
| Benchmarking rules and verification | Determines applicability/readiness and supporting evidence checklist | `src/server/compliance/benchmarking-core.ts`, `src/server/compliance/benchmarking.ts`, `src/server/compliance/verification-engine.ts` | Building state, reporting year, PM state, evidence | `BenchmarkSubmission`, verification results, reason codes | Compliance engine, benchmark compatibility state | Decides whether a building is ready to submit benchmarking data |
| BEPS rules and filing | Evaluates BEPS pathways, penalties, filing state, canonical inputs, and packets | `src/server/compliance/beps/*` | Snapshots, manual inputs, cycle registry, evidence | `FilingRecord`, `BepsMetricInput`, `FilingPacket`, provenance | Compliance engine, factor sets, packet services | Decides and documents BEPS outcomes |
| Operational issue and worklist layer | Converts evaluation/sync problems into user-facing blockers and next actions | `src/server/compliance/data-issues.ts`, `src/server/compliance/governed-operational-summary.ts`, `src/server/compliance/portfolio-worklist.ts` | Compliance results, sync/runtime state, artifact state | `DataIssue`, readiness state, triage bucket, next action | Compliance services, integrations | Tells operators what to do next |
| Source reconciliation | Chooses canonical source among manual, Green Button, PM, and CSV, and records conflicts | `src/server/compliance/source-reconciliation.ts` | Readings and linkage metadata | Building/meter reconciliation records | Prisma, reading history | Prevents silent disagreement between data sources |
| Packet and workflow subsystem | Generates manifests, marks stale versions, tracks approval/submission lifecycle | `src/server/compliance/benchmark-packets.ts`, `src/server/compliance/beps/filing-packets.ts`, `src/server/compliance/submission-workflows.ts`, `src/server/rendering/packet-documents.ts` | Submission/filing context, request items, evidence | Packet rows, workflow rows, exports | Prisma, PDFKit | Turns backend state into filing-ready artifacts |
| Penalty engine | Estimates current exposure and scenarios from governed BEPS context | `src/server/compliance/penalties.ts`, `src/server/compliance/beps/formulas.ts` | Latest BEPS context, readiness, packet state | `PenaltyRun`, scenario summaries | Compliance runs, filing data | Quantifies downside and decision urgency |
| Operational anomaly engine | Detects suspicious energy patterns and estimates operational and compliance impact | `src/server/compliance/operations-anomalies.ts` | Readings, snapshots, sync state, penalties | `OperationalAnomaly` rows and summaries | Prisma, penalty summaries | Flags energy behavior that deserves attention |
| Retrofit ranking engine | Scores retrofit opportunities against penalties, timing, anomalies, and savings proxies | `src/server/compliance/retrofit-optimization.ts`, `src/server/pipelines/pathway-analysis/ecm-scorer.ts` | Building state, candidate estimates, penalties, anomalies | Ranked retrofit opportunities | ECM library, penalties, cycle deadlines | Helps prioritize action beyond compliance reporting |
| Rule governance and publication | Promotes, validates, and publishes rule/factor candidates with regression checks | `src/server/compliance/rule-publication.ts`, `src/server/compliance/rule-regression-harness.ts`, `src/server/compliance/beps/cycle-registry.ts` | Candidate rule/factor versions, fixtures | Active rule/factor versions, publication runs | Fixture regressions, Prisma | Allows policy/rule updates without rewriting code |
| Audit and job state | Tracks operator/system actions and durable job lifecycle state | `src/server/lib/audit-log.ts`, `src/server/lib/jobs.ts`, `prisma/schema.prisma` | Domain events, job actions | `AuditLog`, `Job` | Prisma | Makes runtime history inspectable |

## 4. Request-to-response flows

### 4.1 User and organization setup

Trigger:

- user signs in with Clerk
- Clerk sends organization/user/membership webhooks

Execution path:

1. Clerk webhook hits `src/app/api/webhooks/clerk/route.ts`.
2. The webhook is verified with Svix.
3. Local rows for organizations, users, and memberships are upserted or updated.
4. On authenticated app requests, `getServerAuth()` in `src/server/lib/auth.ts` reads the Clerk session.
5. `requireTenantContext(...)` or `requireTenantContextFromSession()` in `src/server/lib/tenant-access.ts` ensures the active Clerk organization exists locally and maps membership role.
6. `getTenantClient(organizationId)` in `src/server/lib/db.ts` opens a tenant-scoped transaction with row-level security context.

Persistence:

- `Organization`
- `User`
- `OrganizationMembership`

What the user eventually sees:

- a tenant-scoped app session
- role-based access to tenant resources

Important nuance:

- `organization.deleted` does not appear to hard-delete tenant data locally; the route logs and preserves local records. That is a deliberate retention decision, not a full identity-driven purge.

### 4.2 Building creation and editing

Trigger:

- frontend calls building mutations through `src/server/trpc/routers/building.ts`

Execution path:

1. tRPC validates payloads with Zod.
2. `tenantProcedure` ensures tenant context.
3. A `Building` row is created or updated through Prisma.
4. Queries such as `building.get`, `building.list`, and `building.portfolioStats` read current state back.

Persistence:

- `Building`

What the user eventually sees:

- updated building records in lists and detail screens

Important implementation note:

- building create/update is mostly direct persistence
- there is no strong evidence that a building edit automatically triggers downstream recomputation of snapshots, benchmarking, BEPS, or issues
- the backend relies more on explicit refresh/evaluation actions than on reactive recalculation

### 4.3 CSV file upload and immediate ingestion

Trigger:

- `POST /api/upload` in `src/app/api/upload/route.ts`

Execution path:

1. The route requires tenant context via `requireTenantContextFromSession()`.
2. It validates file presence, extension, size, and `buildingId`.
3. It verifies the building exists in the tenant database.
4. It reads file text into memory.
5. `processCSVUpload(...)` in `src/server/pipelines/data-ingestion/logic.ts`:
   - parses CSV/TSV/TXT
   - detects columns
   - normalizes rows
   - validates readings
   - deduplicates overlapping periods
   - appends `EnergyReading` rows
6. The route then calls `runIngestionPipeline(...)` inline, not through BullMQ:
   - loads building and readings
   - computes derived metrics and snapshot data
   - computes data quality
   - creates a `PipelineRun`
   - records provenance through `recordComplianceEvaluation(...)`
   - persists a new `ComplianceSnapshot`
   - refreshes derived BEPS metric inputs
7. `refreshBuildingIssuesAfterDataChange(...)` runs to regenerate blocking/non-blocking issues.

Persistence:

- `EnergyReading`
- `PipelineRun`
- `ComplianceSnapshot`
- `ComplianceRun` and `CalculationManifest` through provenance helpers
- refreshed issue/reconciliation state

Outputs:

- JSON response describing upload success, warnings, and batch information

What the user eventually sees:

- uploaded data available immediately
- usually an updated snapshot and issue state
- if inline pipeline generation fails after data save, the user gets a warning that data was saved but snapshot generation failed

Important implementation details:

- this path is synchronous and request-bound
- it is operationally different from queued Green Button ingestion
- `src/server/pipelines/data-ingestion/logic.ts` has a probable bug where `uploadBatchId` is created with a trailing space

### 4.4 Green Button connection and webhook-driven ingestion

Trigger:

- user initiates utility authorization
- utility sends callback and later sends webhook notifications

Execution path:

1. `GET /api/green-button/authorize` in `src/app/api/green-button/authorize/route.ts`:
   - validates tenant and building
   - sets building status to `PENDING_AUTH`
   - redirects to the utility authorization URL
2. `GET /api/green-button/callback` in `src/app/api/green-button/callback/route.ts`:
   - creates a durable `Job` row of type `GREEN_BUTTON_CALLBACK`
   - exchanges the authorization code for tokens
   - encrypts and stores credentials in `GreenButtonConnection`
   - updates building integration state to active
   - refreshes source reconciliation and issues
3. `POST /api/green-button/webhook` in `src/app/api/green-button/webhook/route.ts`:
   - creates a durable `Job` row of type `GREEN_BUTTON_WEBHOOK`
   - parses the XML webhook
   - resolves the `GreenButtonConnection`
   - records webhook receipt/runtime
   - enqueues a `GREEN_BUTTON_NOTIFICATION` envelope to the `data-ingestion` queue
   - deduplicates queue jobs by connection and notification hash
4. The worker in `src/server/pipelines/data-ingestion/worker.ts` picks up the job.
5. `processGreenButtonNotificationEnvelope(...)` in `src/server/pipelines/data-ingestion/green-button.ts`:
   - fetches ESPI data from the utility
   - aggregates interval data to monthly readings
   - upserts meters and readings with `source=GREEN_BUTTON`
   - re-runs the ingestion pipeline
   - refreshes issues

Persistence:

- `GreenButtonConnection`
- `Job`
- `Meter`
- `EnergyReading`
- `PipelineRun`
- `ComplianceSnapshot`
- related issue and runtime state

What the user eventually sees:

- building connection state turns active
- later, utility readings appear without manual upload
- issues and compliance state refresh after successful ingestion

Important security/operational note:

- token storage is encrypted using the secret-envelope crypto utilities in `src/server/lib/crypto/secret-envelope.ts`
- no strong webhook authenticity verification for the utility payload was evident in inspected code beyond connection resolution and dedupe

### 4.5 Portfolio Manager connection, setup, and explicit usage workflow

Trigger:

- an operator connects an existing Portfolio Manager account from the dashboard or settings
- imported buildings move through explicit building-level PM setup in Secondary tools
- an operator explicitly imports usage from PM or pushes approved local usage back to PM

Execution path:

1. Org-level connection and import live in `src/server/trpc/routers/portfolio-manager.ts` and `src/server/portfolio-manager/existing-account.ts`.
2. That path:
   - validates the ESPM credentials
   - fetches accessible PM properties
   - encrypts and stores credentials for the organization
   - marks the organization as `EXISTING_ESPM`
   - imports accessible PM properties into local `Building` rows without importing meters, usage, snapshots, or submissions
3. Building-level PM setup lives in `src/server/portfolio-manager/setup.ts` and `src/server/portfolio-manager/meter-setup.ts`.
4. Building-level PM usage import/push lives in `src/server/portfolio-manager/usage.ts`.
5. That usage flow:
   - validates PM linkage, setup, meter associations, and reconciliation readiness
   - imports PM readings into `ESPM_SYNC` rows only where allowed
   - pushes only approved canonical local readings back to PM after explicit operator review
   - updates PM usage/runtime state without auto-running benchmarking or compliance workflows
6. Legacy `src/server/compliance/portfolio-manager-sync*.ts` and `src/server/compliance/portfolio-manager-push.ts` still exist only to feed benchmarking compatibility state while annual benchmarking has not been fully re-based on the newer PM runtime.

Persistence:

- `PortfolioManagerManagement`
- `PortfolioManagerImportState`
- `PortfolioManagerSetupState`
- `PortfolioManagerMeterLinkState`
- `PortfolioManagerUsageState`
- `Building`
- `Meter`
- `EnergyReading`
- related issue/reconciliation state

What the user eventually sees:

- connected ESPM account state
- imported Quoin buildings
- explicit PM setup progress
- explicit PM usage import/push readiness, review, and runtime state

Important implementation nuance:

- the current PM workflow is explicit and governed inside `src/server/portfolio-manager/*`
- the legacy sync/push modules should be treated as compatibility-only until benchmarking no longer depends on them

### 4.6 Benchmarking readiness, request items, and packet generation

Trigger:

- user evaluates benchmarking readiness
- user updates request items or generates/finalizes a packet

Execution path:

1. `benchmarking.evaluateReadiness` in `src/server/trpc/routers/benchmarking.ts` calls `evaluateAndUpsertBenchmarkSubmission(...)` in `src/server/compliance/benchmarking.ts`.
2. The benchmarking service:
   - resolves rule/factor context
   - runs `evaluateBenchmarkingReadiness(...)`
   - persists a governed compliance run
   - upserts `BenchmarkSubmission`
   - runs the verification engine
   - refreshes issue/readiness state
3. `src/server/compliance/benchmarking-core.ts` decides readiness based on:
   - applicability band
   - reporting year coverage
   - PM linkage validity
   - overlap/data-quality freshness
   - verification requirement and evidence
   - gross floor area support
4. Supporting documents are tracked through `BenchmarkRequestItem`.
5. `generateBenchmarkPacket(...)` in `src/server/compliance/benchmark-packets.ts` creates a packet manifest and disposition such as `READY`, `READY_WITH_WARNINGS`, or `BLOCKED`.
6. Finalization/export functions produce a serializable output and PDF/markdown/JSON exports.
7. Submission lifecycle is tracked in `SubmissionWorkflow`.

Persistence:

- `BenchmarkSubmission`
- `ComplianceRun`
- `CalculationManifest`
- `EvidenceArtifact`
- `BenchmarkRequestItem`
- `BenchmarkPacket`
- `SubmissionWorkflow`

What the user eventually sees:

- explicit readiness or blocking reasons
- a checklist of supporting items
- generated packet artifacts
- a submission workflow state

### 4.7 BEPS evaluation, filing, and packet generation

Trigger:

- user evaluates BEPS for a building
- user edits canonical metric inputs or prescriptive items
- user transitions filing state or generates a filing packet

Execution path:

1. BEPS-related mutations in `src/server/trpc/routers/beps.ts` validate tenant/building/year/cycle inputs.
2. `evaluateBepsForBuilding(...)` in `src/server/compliance/beps/beps-evaluator.ts` is the key orchestration path.
3. It loads:
   - building and latest snapshot
   - prior compliance history
   - active cycle registry
   - canonical metric inputs from `src/server/compliance/beps/canonical-inputs.ts`
   - derived metric inputs from `src/server/compliance/beps/metric-derivation.ts`
4. It normalizes governed rule/factor config in `src/server/compliance/beps/config.ts`.
5. It evaluates:
   - applicability
   - pathway eligibility
   - performance pathway
   - standard target pathway
   - prescriptive pathway
   - trajectory pathway
   - alternative compliance agreement effects
6. It selects an overall status such as `COMPLIANT`, `NON_COMPLIANT`, `PENDING_DATA`, or `NOT_APPLICABLE`.
7. It records provenance through the compliance engine and upserts a `FilingRecord`.
8. Filing packets are generated through `src/server/compliance/beps/filing-packets.ts`.
9. Filing state transitions are governed by `src/server/compliance/beps/filing-workflow.ts`.
10. Related submission/workflow state and stale packet detection are updated when upstream inputs change.

Persistence:

- `BepsMetricInput`
- `BepsPrescriptiveItem`
- `BepsAlternativeComplianceAgreement`
- `ComplianceRun`
- `CalculationManifest`
- `FilingRecord`
- `FilingRecordEvent`
- `FilingPacket`
- `SubmissionWorkflow`

What the user eventually sees:

- a governed BEPS outcome with pathway explanation
- current filing status
- generated filing packets and exports

### 4.8 Dashboard, workbench, and portfolio loading

Trigger:

- user opens building detail, portfolio overview, or worklist screens

Execution path:

1. Frontend queries `building.get`, `building.portfolioStats`, `building.portfolioWorklist`, `building.getArtifactWorkspace`, `operations.listBuildingAnomalies`, or `retrofit.rankBuilding`.
2. These procedures aggregate state from:
   - `Building`
   - latest `ComplianceSnapshot`
   - latest compliance and penalty context
   - issue state from `DataIssue`
   - source reconciliation
   - integration runtime state
   - packet/workflow state
   - anomalies and retrofit recommendations
3. `src/server/compliance/governed-operational-summary.ts` and `src/server/compliance/portfolio-worklist.ts` turn raw backend state into operator-facing summaries and triage buckets.

What the user eventually sees:

- a worklist with next actions such as resolve blockers, refresh integration, regenerate artifact, finalize artifact, submit artifact, or monitor submission

This is one of the most important product layers: it translates many backend tables into an actionable operational queue.

### 4.9 Operational anomaly refresh

Trigger:

- user explicitly calls `operations.refreshAnomalies`

Execution path:

1. Router in `src/server/trpc/routers/operations.ts` calls anomaly refresh logic.
2. `src/server/compliance/operations-anomalies.ts` reads:
   - building
   - meters
   - readings
   - latest snapshot
   - sync state
   - readiness summary
   - penalty summary
3. It computes deterministic anomaly candidates such as:
   - elevated baseload
   - consumption spike or drop
   - coverage gaps
   - overlapping periods
   - meter divergence from building trend
4. It estimates energy and penalty impact where possible.
5. It upserts `OperationalAnomaly` rows and returns summaries.

What the user eventually sees:

- an anomaly list with severity, confidence, and estimated impact

Important note:

- no scheduler was found that refreshes anomalies automatically on a cadence
- this appears to be on-demand logic unless invoked from another path

### 4.10 Report and exemption artifact generation

Trigger:

- user calls report-related mutations in `src/server/trpc/routers/report.ts`

Execution path:

1. The router assembles report payloads from governed summaries rather than inventing separate report-only logic.
2. `buildComplianceReportOutput(...)` composes:
   - operational summary
   - penalty context
   - artifact workspace
   - deduplicated readings
   - recent pipeline runs
3. `buildExemptionReportOutput(...)` screens for exemption-related facts such as occupancy or financial distress together with governed context.
4. Report artifact services persist outputs as `ReportArtifact`.
5. Export handlers serialize report artifacts for downstream use.

Persistence:

- `ReportArtifact`

What the user eventually sees:

- a generated compliance or exemption report artifact derived from the current backend truth

## 5. Core business logic

### What workflow the platform assumes

The backend assumes a fairly opinionated operating model:

1. an organization owns a portfolio of buildings
2. each building has one or more data sources for energy consumption
3. energy data needs to be normalized and reconciled before it can be trusted
4. trusted data becomes snapshots and canonical inputs
5. compliance rules are applied using explicit versioned packages
6. the system determines whether the building is ready, compliant, blocked, or exposed
7. operators gather supporting evidence, generate packets, and transition submission/filing workflows
8. the platform continues monitoring for anomalies and retrofit opportunities

### What the user is supposed to do in sequence

In plain business terms, the expected user journey is:

- create the building record
- connect/import from Portfolio Manager and/or Green Button, or upload CSV data
- complete explicit PM setup where PM linkage is required
- review data quality and source reconciliation
- fix blocking issues
- evaluate benchmarking readiness for the reporting year
- evaluate BEPS for the relevant compliance cycle
- assemble and finalize evidence packets
- move workflow states toward submission or filing
- monitor anomalies and choose retrofit actions if risk or penalty exposure remains

### Business states that matter

The platform revolves around a few state families:

- integration state
  - Green Button active, failed, pending
  - Portfolio Manager connection, setup, and usage state
  - legacy benchmark compatibility state where annual benchmarking still depends on it
- data readiness state
  - `DATA_INCOMPLETE`
  - `READY_FOR_REVIEW`
  - `READY_TO_SUBMIT`
  - `SUBMITTED`
- compliance state
  - benchmarking readiness or blocked state
  - BEPS `COMPLIANT`, `NON_COMPLIANT`, `PENDING_DATA`, `NOT_APPLICABLE`
- workflow state
  - submission workflow states in `src/server/compliance/submission-workflows.ts`
  - filing states in `src/server/compliance/beps/filing-workflow.ts`
- runtime state
  - job lifecycle
  - sync step statuses
  - issue lifecycle
  - anomaly lifecycle

### What blocks progress

Progress is blocked when the system believes the underlying evidence is not trustworthy or sufficient. Examples found in code:

- missing or incomplete energy coverage
- overlapping readings
- broken or missing Portfolio Manager linkage
- blocked Portfolio Manager setup/usage state
- stale or failed benchmark compatibility state
- missing verification support
- missing gross floor area support
- unresolved source reconciliation conflicts

The platform is more concerned with evidence sufficiency than with simple form completion.

### How the system decides what comes next

The key operator-facing “what next” logic is in:

- `src/server/compliance/data-issues.ts`
- `src/server/compliance/governed-operational-summary.ts`
- `src/server/compliance/portfolio-worklist.ts`

The system converts backend state into triage buckets such as:

- `COMPLIANCE_BLOCKER`
- `ARTIFACT_ATTENTION`
- `REVIEW_QUEUE`
- `SUBMISSION_QUEUE`
- `SYNC_ATTENTION`
- `OPERATIONAL_RISK`
- `RETROFIT_QUEUE`
- `MONITORING`

It also assigns next-action codes such as:

- `RESOLVE_BLOCKING_ISSUES`
- `REFRESH_INTEGRATION`
- `REGENERATE_ARTIFACT`
- `FINALIZE_ARTIFACT`
- `REVIEW_COMPLIANCE_RESULT`
- `SUBMIT_ARTIFACT`
- `MONITOR_SUBMISSION`

This is important business logic. The platform is not only storing compliance data; it is actively sequencing operator work.

### Deterministic vs heuristic logic

Deterministic logic:

- benchmarking readiness rules
- BEPS applicability and pathway evaluation
- governed penalty calculations
- workflow transitions
- source-priority reconciliation
- provenance linkage

Heuristic logic:

- anomaly severity and confidence scoring
- estimated penalty impact attribution for anomalies
- retrofit priority scoring

Observed “AI” usage:

- a queue named `ai-analysis` exists
- a deprecated capital-structuring worker contains optional narrative generation logic
- no active generalized AI engine was found on the main product path

So the system feels “intelligent” mostly because of deterministic rules, governed versioning, state aggregation, and ranking heuristics, not because of an always-on LLM service.

### Compliance-critical vs convenience logic

Most compliance-critical logic lives in:

- governed rule/factor resolution
- benchmarking readiness evaluation
- BEPS evaluator and formulas
- provenance recording
- filing and submission workflow state

Operational convenience logic lives in:

- anomaly detection
- retrofit ranking
- dashboards/worklists
- report composition

## 6. Data model and source of truth

### Main entities and relationships

| Entity group | Main models in `prisma/schema.prisma` | Role in system | Source-of-truth status |
|---|---|---|---|
| Identity and tenancy | `Organization`, `User`, `OrganizationMembership` | Maps Clerk identities into local tenant scope | Canonical local tenant map |
| Core portfolio | `Building` | Main anchor for almost all business records | Canonical building record |
| Metering | `Meter`, `EnergyReading` | Stores energy data by meter and time period | Canonical persisted reading history |
| Derived operational state | `ComplianceSnapshot`, `PipelineRun` | Stores derived building-level metrics and ingestion run history | Projection derived from readings and rules |
| External integration state | `GreenButtonConnection`, `PortfolioManagerSyncState` | Stores credential/runtime/linkage state | Canonical runtime state for those integrations |
| Governance | `RulePackage`, `RuleVersion`, `FactorSetVersion`, `BepsCycleRegistry`, `GovernedPublicationRun` | Stores rule and factor versions and what is active | Canonical policy/rule layer |
| Provenance | `ComplianceRun`, `CalculationManifest`, `SourceArtifact`, `EvidenceArtifact` | Stores immutable evidence of what was calculated and with what inputs | Canonical audit trail for governed calculations |
| Benchmarking workflow | `BenchmarkSubmission`, `BenchmarkRequestItem`, `BenchmarkPacket`, `SubmissionWorkflow`, `SubmissionWorkflowEvent` | Tracks annual benchmarking readiness and packet lifecycle | Canonical workflow state for benchmarking |
| BEPS workflow | `FilingRecord`, `FilingRecordEvent`, `FilingPacket` | Tracks BEPS status, filing events, and packet lifecycle | Canonical workflow state for BEPS |
| Issue and exposure state | `DataIssue`, `PenaltyRun` | Tracks blockers and estimated penalty exposure | Current operational state and derived financial signal |
| Canonical BEPS inputs | `BepsMetricInput`, `BepsPrescriptiveItem`, `BepsAlternativeComplianceAgreement` | Stores manual/derived inputs for BEPS filing | Canonical BEPS input layer |
| Operations intelligence | `OperationalAnomaly`, `RetrofitCandidate`, `DriftAlert` | Flags issues and recommended actions | Mixed: anomalies/candidates are active; `DriftAlert` looks legacy or secondary |
| Audit and jobs | `AuditLog`, `Job` | Tracks actions and background/operational execution | Canonical runtime history |

### Relationship model

At a conceptual level:

```text
Organization
  -> Buildings
      -> Meters
          -> EnergyReadings
      -> ComplianceSnapshots
      -> PipelineRuns
      -> GreenButtonConnection
      -> PortfolioManagerSyncState
      -> DataIssues
      -> BenchmarkSubmissions
      -> FilingRecords
      -> OperationalAnomalies
      -> RetrofitCandidates

Governance tables
  -> RuleVersion / FactorSetVersion / CycleRegistry
      -> ComplianceRuns
          -> CalculationManifest
          -> EvidenceArtifacts / SourceArtifacts
          -> BenchmarkSubmission or FilingRecord linkage
```

### Lifecycle of important records

#### Building

- created by user mutation
- edited over time
- serves as the parent for operational and compliance records

#### EnergyReading

- created by CSV upload, Green Button ingestion, manual override, or ESPM sync
- used as the raw fact base for snapshots and compliance-derived metrics
- treated as append-mostly in business intent

Important nuance:

- the migration comments suggest append-only enforcement was intended for readings and snapshots
- the database rules that would enforce that are commented out in `prisma/migrations/00000000000001_rls_policies/migration.sql`

#### ComplianceSnapshot

- created after ingestion and some sync/evaluation flows
- acts as a latest-state projection of energy/compliance metrics
- useful operationally, but not the only source of truth

#### ComplianceRun

- created by governed evaluation flows
- should be treated as immutable evidence of one specific calculation run
- linked to rule/factor versions and calculation manifests

#### BenchmarkSubmission

- unique by building and reporting year
- represents the current state of annual benchmarking evaluation and evidence

#### FilingRecord

- unique by building, filing type, filing year, and compliance cycle
- represents the current official filing track for a BEPS obligation

#### Packet records

- generated from current submission/filing state
- become stale when upstream inputs change
- finalization and workflow state are separate from raw compliance calculations

### Canonical source-of-truth tables/models

Most canonical records:

- building identity: `Building`
- raw energy history: `EnergyReading`
- governed policy version: `RuleVersion`, `FactorSetVersion`, `BepsCycleRegistry`
- immutable compliance evidence: `ComplianceRun`, `CalculationManifest`
- benchmarking current state: `BenchmarkSubmission`
- BEPS current state: `FilingRecord`
- current operator blockers: `DataIssue`

### Derived data, projections, and summaries

Derived/projection-heavy records:

- `ComplianceSnapshot`
- `PenaltyRun`
- `PortfolioManagerSyncState.qaPayload`
- source reconciliation summary rows
- `OperationalAnomaly`
- `RetrofitCandidate` rankings
- report artifacts and packet manifests

### Immutable vs mutable records

Mostly immutable or intended to be immutable:

- `ComplianceRun`
- `CalculationManifest`
- most artifact/evidence records
- historical events such as `FilingRecordEvent`, `SubmissionWorkflowEvent`

Mutable current-state records:

- `Building`
- `PortfolioManagerSyncState`
- `GreenButtonConnection`
- `BenchmarkSubmission`
- `FilingRecord`
- `SubmissionWorkflow`
- `DataIssue`
- `OperationalAnomaly`

### Versioned vs latest-state concepts

This codebase uses both:

- versioned governance:
  - `RulePackage`
  - `RuleVersion`
  - `FactorSetVersion`
  - `BepsCycleRegistry`
- latest-state operational views:
  - latest compliance snapshot
  - current benchmark submission
  - current filing record
  - current sync state
  - current open issues

### Tenant and org scoping

Tenant scoping is built into:

- row-level security policies in Postgres
- organization-aware tenant Prisma client
- organization filters in system services
- `organizationId` on major domain records

### Audit and provenance relationships

Provenance is not an afterthought. The system explicitly links:

- rule and factor versions
- calculation manifests
- evidence artifacts
- compliance runs
- downstream benchmark submissions or filing records

That makes it possible to answer:

- what rules were active
- what calculation logic version was used
- what artifacts supported the conclusion

### Data model explained in plain English

In plain English, a building is the hub of the entire system.

- It belongs to an organization.
- It has meters and energy readings.
- Those readings are turned into snapshots and compliance calculations.
- The calculations create official-looking records of whether the building is ready or non-compliant.
- Supporting documents and packets are attached to that history.
- The platform then keeps a living to-do list of what still needs to happen.

So the database is not just storing facts. It is storing:

- the raw evidence
- the interpreted compliance meaning of that evidence
- the workflow around acting on that meaning

## 7. Rules, calculations, and decision logic

### Summary table

| Area | Where it lives | How it works technically | What it means non-technically | Risk notes |
|---|---|---|---|---|
| Benchmark applicability/readiness | `src/server/compliance/benchmarking-core.ts` | Evaluates coverage, PM linkage, overlap, data quality freshness, verification and GFA support | Decides whether a building is actually ready to submit annual benchmarking data | This is operationally critical because it determines whether the team can move forward |
| Verification checklist | `src/server/compliance/verification-engine.ts` | Builds checklist items from metadata, meter completeness, data coverage, PM linkage, DQC | Converts backend facts into evidence requests | Good for operator clarity; wrong checklist logic would create needless work |
| BEPS applicability | `src/server/compliance/beps/applicability.ts` | Uses size thresholds, property type, and exemption logic such as recent construction | Decides whether a building is in scope for BEPS | Compliance-critical |
| Pathway eligibility | `src/server/compliance/beps/pathway-eligibility.ts` | Routes buildings to performance, standard target, prescriptive, or trajectory pathways based on governed config and available metrics | Decides which kind of compliance path the building can claim | Critical because pathway choice changes penalty logic |
| BEPS formulas | `src/server/compliance/beps/formulas.ts` | Computes max penalty and pathway-specific penalty adjustment amounts | Quantifies how far from compliance the building is financially | High-risk if factors or caps are wrong |
| Readiness derivation | `src/server/compliance/data-issues.ts` | Uses blocking issues plus submission/filing/workflow state to derive readiness | Tells operators if they are blocked, review-ready, or submission-ready | Drives worklist behavior |
| Source reconciliation | `src/server/compliance/source-reconciliation.ts` | Chooses canonical source by explicit priority: manual, then Green Button, then PM, then CSV | Decides which data source wins if multiple systems disagree | Important because silent bad source choice would corrupt downstream outputs |
| Penalty scenarios | `src/server/compliance/penalties.ts` | Builds a baseline governed penalty and scenarios such as meet target or small metric improvement | Gives teams a financial picture of current exposure and improvement scenarios | Depends on valid governed context |
| Anomaly detection | `src/server/compliance/operations-anomalies.ts` | Uses monthly buckets, ratios, gaps, and trend divergence to create deterministic anomaly candidates | Flags suspicious operating behavior | Useful but heuristic, not official compliance truth |
| Retrofit ranking | `src/server/compliance/retrofit-optimization.ts` | Scores candidates on avoided penalty, savings proxy, timing, cost efficiency, confidence, anomaly alignment | Suggests which upgrades matter most right now | Decision support only; not itself a compliance determination |

### Benchmarking readiness logic

In `src/server/compliance/benchmarking-core.ts`, the system checks whether a building can credibly submit benchmarking data for a reporting year.

Observed rule ingredients include:

- applicability band
- deadline logic
- whether Portfolio Manager linkage exists and matches
- whether the building has sufficient year coverage
- whether periods overlap
- data-quality freshness
- whether verification is required and supported
- whether gross floor area support exists

Important business nuance:

- an out-of-scope building can still come back as `READY`
- that means “not blocked for this process,” not necessarily “must submit”

### Verification logic

`src/server/compliance/verification-engine.ts` turns readiness context into explicit checklist items for:

- property metadata
- gross floor area
- meter completeness
- coverage completeness
- metric availability
- Portfolio Manager linkage
- data quality checks

Non-technical meaning:

- the product is not assuming the calculation result is enough
- it is asking whether the organization has enough documentary support to defend that result

### BEPS applicability and pathway selection

The BEPS engine in `src/server/compliance/beps/beps-evaluator.ts` pulls together several rule modules:

- `applicability.ts`
- `pathway-eligibility.ts`
- `performance-pathway.ts`
- `standard-target-pathway.ts`
- `prescriptive-pathway.ts`
- `trajectory-pathway.ts`

This means BEPS is not a single formula. It is a decision tree plus pathway-specific calculations.

Business meaning:

- first decide whether the building is in scope
- then decide what compliance route is available
- then calculate whether the building meets it or what penalty remains

### BEPS formulas

The explicit penalty and adjustment formulas are in `src/server/compliance/beps/formulas.ts`.

Implemented formulas include:

- `calculateMaximumAlternativeComplianceAmount`
  - gross square feet times penalty per square foot
  - capped by `maxPenaltyCap`
- `calculatePerformancePenaltyAdjustment`
  - reduces maximum amount according to achieved vs required reduction fraction
- `calculatePrescriptivePenaltyAdjustment`
  - reduces maximum amount according to points earned vs points needed
- `calculateStandardTargetPenaltyAdjustment`
  - combines gap reduction and savings achievement into a remaining penalty fraction
- `calculateAgreementAdjustedAmount`
  - applies agreement multiplier and floor amount
- `calculateTrajectoryPenaltyAdjustment`
  - reduces penalty based on target years met, unless final target is not met

Non-technical meaning:

- the platform models penalty exposure as something that can be partially reduced by progress, not only all-or-nothing
- agreements can override standard penalty results but still respect floors

### Penalty summary logic

`src/server/compliance/penalties.ts` is a governed penalty summary layer on top of BEPS results.

Key observed behaviors:

- it caches by deterministic input hash
- it records a baseline payload plus scenario summaries
- it returns `INSUFFICIENT_CONTEXT` if governed context is missing
- it models scenarios such as:
  - `MEET_TARGET`
  - `RESOLVE_CURRENT_PATHWAY_GAP`
  - `IMPROVE_PRIMARY_METRIC_SMALL`

Important distinction:

- the simple ingestion snapshot estimate in `src/server/pipelines/data-ingestion/snapshot.ts` is not the same as this governed penalty engine
- the governed penalty engine is the stronger financial/compliance signal

### Source reconciliation rules

`src/server/compliance/source-reconciliation.ts` defines an explicit source priority:

1. `MANUAL`
2. `GREEN_BUTTON`
3. `PORTFOLIO_MANAGER`
4. `CSV_UPLOAD`

It also uses a mismatch threshold ratio of `0.05`.

Business meaning:

- the product is saying manual corrections outrank imported data
- utility data outranks PM
- PM outranks raw CSV

That is a major trust policy encoded in the backend.

### Readiness and issue derivation

In `src/server/compliance/data-issues.ts`:

- blocking QA, verification, and reconciliation findings become persistent `DataIssue` rows
- blocking issues cannot simply be hand-resolved away
- they must be fixed upstream and re-evaluated

The readiness state is then derived:

- `DATA_INCOMPLETE` if blocking issues exist
- `SUBMITTED` if submitted/filed/completed states exist
- `READY_TO_SUBMIT` if approved/generated states exist
- otherwise `READY_FOR_REVIEW`

This is important because it encodes a disciplined operational model rather than letting users override backend truth casually.

### Anomaly and risk logic

`src/server/compliance/operations-anomalies.ts` implements deterministic anomaly detection, not ML inference.

Observed technical features:

- monthly bucket aggregation
- ratio-based severity thresholds
- confidence bands
- specific reason codes such as baseload, schedule drift proxy, spikes, gaps, overlap, suspect zero usage
- estimated penalty impact using current penalty context where available

Business meaning:

- the system is trying to tell operators which buildings may be operationally drifting in ways that threaten compliance or efficiency

### Retrofit ranking logic

`src/server/compliance/retrofit-optimization.ts` ranks retrofit candidates with weighted breakdown factors including:

- avoided penalty score
- compliance impact score
- energy impact score
- timing score
- cycle impact score
- cost efficiency score
- confidence score
- anomaly context score

Other observed mechanics:

- a savings dollar proxy constant is defined as `0.03` dollars per kBtu
- implementation month defaults vary by project type
- anomaly types can align to certain retrofit types

Business meaning:

- this is a prioritization engine, not an optimization solver
- it estimates which projects are strategically attractive in the current compliance context

### Rule versioning and publication logic

The governance layer in `src/server/compliance/rule-publication.ts` and `src/server/compliance/rule-regression-harness.ts` does three important things:

- promotes candidate rule or factor versions
- validates them against regression fixtures
- publishes them as active versions and updates cycle mappings

This is one of the strongest architecture choices in the repo. It separates policy versioning from application deployment.

### Especially important or risky areas

- BEPS factor/rule resolution is compliance-critical
- source priority is a strong trust assumption
- readiness state drives user workflow and could create false blockers if wrong
- penalty outputs can influence investment/operational decisions
- `CYCLE_3` is recognized in code but explicitly unsupported in `src/server/compliance/beps/config.ts`

## 8. Background processing and async behavior

### What is actually asynchronous

Clearly asynchronous:

- data-ingestion queue processing via BullMQ
- Green Button webhook ingestion after enqueue

Tracked as jobs but not clearly queue-decoupled:

- Portfolio Manager sync
- Green Button callback processing

Declared but not actively booted:

- pathway analysis
- capital structuring
- drift detection
- AI analysis
- report generation
- notifications

### Job and queue model

There are two layers:

1. BullMQ queue/job infrastructure in `src/server/lib/queue.ts`
2. persistent domain job records in `src/server/lib/jobs.ts` and the `Job` table

The `Job` lifecycle is explicit:

- `QUEUED`
- `RUNNING`
- `COMPLETED`
- `FAILED`
- `DEAD`

This is good because durable job state survives process boundaries better than relying on queue internals alone.

### Retries and failure handling

Observed patterns:

- BullMQ default retries: 3 attempts with exponential backoff
- integration clients classify retryable vs non-retryable failures
- persistent jobs can be marked failed or dead
- workers record audit/log events

Green Button runtime helpers in `src/server/compliance/integration-runtime.ts` also update integration-specific runtime state for success/failure.

### Idempotency protections

Observed protections include:

- deduplicated Green Button queue job IDs using connection + notification hash
- deterministic input hashing for `PenaltyRun` reuse
- unique constraints on many current-state records, such as benchmark submission and filing record identity

What is less clear:

- broad idempotency strategy across all mutating routes
- whether repeated upload requests or repeated PM sync calls are systematically collapsed

### Stuck job and operational recovery risks

Strengths:

- durable `Job` rows
- explicit state transitions
- queue retry behavior
- audit logging

Weaknesses:

- only one worker is actually started
- several async domains are scaffolded but not operationalized
- no scheduler/cron process was found for routine refreshes
- some expensive operations still happen inline in request paths

### Background processing maturity assessment

The async architecture is real but incomplete.

- It is stronger than “no jobs at all.”
- It is weaker than a fully worker-driven platform.
- The system currently mixes synchronous request orchestration with durable job tracking and one active BullMQ worker.

## 9. External integrations

### Clerk

- purpose: authentication and organization membership
- code: `src/server/lib/auth.ts`, `src/app/api/webhooks/clerk/route.ts`, `src/server/lib/organization-membership.ts`
- inbound data: users, organizations, memberships, roles
- outbound data: none beyond local sync state
- trust assumption: Clerk is the identity source of truth
- failure points: webhook verification, stale local membership mapping
- core or optional: core

### ENERGY STAR Portfolio Manager

- purpose: import linked properties, support explicit PM setup, import/push usage, and provide benchmark compatibility state where older benchmarking still depends on it
- code: `src/server/integrations/espm/client.ts`, `src/server/portfolio-manager/*`, `src/server/compliance/portfolio-manager-sync*.ts`, `src/server/compliance/portfolio-manager-push.ts`
- inbound data: property metadata, PM-native meter entities, consumption readings, score and intensity metrics
- outbound data: explicitly reviewed local readings and PM meter/property configuration
- trust assumption: PM is an external benchmarking workspace, not the owner of Quoin-local compliance workflow state
- failure points:
  - auth/basic auth configuration
  - XML parsing
  - rate limiting
  - partial sync state
  - linkage mismatches
- core or optional: very important, but optional in the sense that CSV and Green Button also exist

### Green Button

- purpose: ingest utility-grade interval data
- code: `src/server/integrations/green-button/*`, `src/app/api/green-button/*`, `src/server/pipelines/data-ingestion/green-button.ts`
- inbound data: OAuth tokens, webhook XML, ESPI usage data
- outbound data: OAuth redirects and token refresh requests
- trust assumption: utility feed is a high-trust meter source
- failure points:
  - incomplete OAuth config
  - token refresh failures
  - webhook authenticity/validity concerns
  - XML parsing
  - duplicate notifications
- core or optional: optional integration, but strategically important

### Redis / BullMQ

- purpose: queue-based ingestion and future worker workloads
- code: `src/server/lib/queue.ts`, `src/server/pipelines/data-ingestion/worker.ts`
- inbound/outbound data: serialized job payloads
- trust assumption: queue delivery and Redis availability
- failure points: worker not running, Redis outage, partial adoption of queue model
- core or optional: operationally important, but currently only critical for queued ingestion

## 10. Security, permissions, and trust boundaries

### Authentication

Authentication is handled by Clerk sessions:

- `src/server/lib/auth.ts`
- `src/middleware.ts`

Most app routes are protected by middleware except for landing/auth pages, health, and webhook endpoints.

### Authorization

Authorization has three layers:

1. Clerk-authenticated session
2. tenant organization resolution
3. application role gating through `operatorProcedure`

Role mapping is implemented in `src/server/lib/organization-membership.ts`.

### Tenant isolation

Tenant isolation is one of the stronger technical choices in the repo:

- Postgres RLS policies check `organization_id` against session config
- `getTenantClient(organizationId)` sets org config and local DB role
- tenant procedures use that client

Important caveat:

- several backend services use the admin Prisma client directly
- those services generally filter by `organizationId`
- this is workable, but it means isolation depends partly on disciplined service code

### Sensitive operations

Higher-sensitivity operations include:

- integration sync and push
- rule/factor publication
- workflow transitions
- evidence attachment
- packet finalization/export

These are typically exposed through protected or operator-level procedures.

### Secrets and token handling

Green Button tokens are handled carefully:

- encrypted at rest using AES-256-GCM envelope logic in `src/server/lib/crypto/secret-envelope.ts`
- key material is required through validated environment variables in `src/server/lib/config.ts`

This is a strong sign of security maturity for that specific integration.

### Likely weak points or assumptions

- Green Button webhook authenticity verification was not clearly present
- append-only regulatory intent is not enforced in DB because related rules are commented out
- admin Prisma usage increases reliance on correct query scoping
- retained tenant data after Clerk organization deletion may be acceptable, but it is a policy choice that should be explicit

### Trust boundaries

Main trust boundaries are:

- browser to server API
- server to database
- server to Clerk
- server to Green Button utilities
- server to Portfolio Manager
- route handlers to worker queue

The most important boundary is between tenant-scoped request handling and global system services. The code generally respects it, but not all paths rely solely on DB-enforced tenancy.

## 11. Observability and operational maturity

### Strong signs

- structured logging support in `src/server/lib/logger.ts`
- durable audit log model and repeated audit writes in major workflows
- durable job lifecycle model in `src/server/lib/jobs.ts`
- explicit retryable/non-retryable integration errors
- governed regression harness for rule/factor publication
- sync step-level diagnostics for Portfolio Manager

### Weak signs

- some runtime code still uses lightweight process logging patterns rather than one uniform telemetry stack
- some important workflows are synchronous while others are queued
- multiple job families are defined but not actually operated
- operational summaries are strong, but automated maintenance loops are weak

### Missing or unclear pieces

- no clear metrics backend or tracing system was found
- no scheduler/cron service was found
- no obvious dead-letter or replay console was found beyond persistent job state
- object/blob storage handling for artifacts is unclear from inspected code

### Production-readiness signals

Positive signals:

- tenant-aware DB access
- RLS
- structured error taxonomy
- governed rule publication and regression checks
- durable audit/job/provenance records

Negative signals:

- incomplete async architecture
- some duplication and legacy modules still present
- a few correctness gaps between data mutation and recalculation

## 12. Implemented vs partially implemented vs missing

### Clearly implemented

| Area | Evidence |
|---|---|
| Multi-tenant auth and org mapping | `src/server/lib/auth.ts`, `src/server/lib/tenant-access.ts`, Clerk webhook route, RLS migrations |
| Building/meter/reading persistence | `prisma/schema.prisma`, building router, ingestion pipeline |
| CSV ingestion and snapshot derivation | `src/app/api/upload/route.ts`, `src/server/pipelines/data-ingestion/logic.ts` |
| Green Button OAuth, token storage, and webhook-driven ingestion | `src/app/api/green-button/*`, `src/server/integrations/green-button/*`, worker path |
| Portfolio Manager connection, setup, and explicit usage workflow | `src/server/portfolio-manager/*` |
| Governed benchmarking and verification | `src/server/compliance/benchmarking-core.ts`, `benchmarking.ts`, `verification-engine.ts` |
| Governed BEPS evaluation and filing packets | `src/server/compliance/beps/*` |
| Provenance and rule/factor versioning | `src/server/compliance/provenance.ts`, `rule-publication.ts`, `rule-regression-harness.ts` |
| Issue/readiness/worklist generation | `src/server/compliance/data-issues.ts`, `governed-operational-summary.ts`, `portfolio-worklist.ts` |
| Penalty summaries, anomaly detection, retrofit ranking | `penalties.ts`, `operations-anomalies.ts`, `retrofit-optimization.ts` |

### Partially implemented or fragile

| Area | Why it is partial/fragile | Evidence |
|---|---|---|
| Async processing architecture | Many queues exist, but only ingestion worker is started | `src/server/lib/queue.ts`, `src/server/worker-entrypoint.ts` |
| Append-only compliance history enforcement | Intended DB rules are commented out | `prisma/migrations/00000000000001_rls_policies/migration.sql` |
| CSV upload operational model | Runs inline and can save data even when downstream snapshot generation fails | `src/app/api/upload/route.ts` |
| Reading override recalculation | Manual override mutation does not clearly force recompute/issue refresh | `src/server/trpc/routers/building.ts` |
| Drift/anomaly subsystem coherence | Legacy `DriftAlert` path and active `OperationalAnomaly` path both exist | `src/server/trpc/routers/drift.ts`, `src/server/pipelines/drift-detection/*`, `src/server/compliance/operations-anomalies.ts` |
| Artifact storage model | Artifact metadata exists, but generalized storage backend is unclear | `prisma/schema.prisma`, report/packet modules |
| BEPS future cycle support | `CYCLE_3` is recognized but explicitly unsupported | `src/server/compliance/beps/config.ts` |

### Implied but not actually implemented

| Area | Why it appears implied but not fully implemented | Evidence |
|---|---|---|
| Full multi-worker backend | Worker entrypoint comments mention future workers, but they are not started | `src/server/worker-entrypoint.ts` |
| Automated drift detection operations | Drift worker and rules engine exist, but no active boot path was found | `src/server/pipelines/drift-detection/worker.ts`, `src/server/worker-entrypoint.ts` |
| Active capital structuring product surface | Worker code is explicitly marked deprecated historical support | `src/server/pipelines/capital-structuring/worker.ts` |
| Broad AI analysis layer | Queue exists, but no active product-critical worker path was found | `src/server/lib/queue.ts` |
| Fully surfaced financing workflow | `src/server/compliance/financing-packets.ts` exists, but no main router surface was found during inspection | `src/server/compliance/financing-packets.ts`, `src/server/trpc/routers/*` |

## 13. Technical debt and architecture risks

### 1. Async architecture is only half-finished

The code declares a broader worker platform than it actually runs.

- queue names suggest ambitions for sync, drift, AI, reporting, notifications
- `src/server/worker-entrypoint.ts` only starts the data-ingestion worker

Risk:

- operators may assume backend actions are decoupled and resilient when some still depend on request lifetimes
- failure and retry semantics vary by workflow

### 2. Ingestion behavior is inconsistent by source

CSV uploads run inline inside `src/app/api/upload/route.ts`, while Green Button notifications use the queue and worker path.

Risk:

- inconsistent user experience
- inconsistent retry and timeout behavior
- data can be written successfully while downstream derivation fails

### 3. Append-only compliance intent is not strongly enforced

The migration file contains commented-out rules intended to prevent updates/deletes on readings and snapshots.

Risk:

- records that appear audit-like may still be mutable at the DB level
- this is especially relevant for compliance defensibility

### 4. Tenant isolation relies partly on service discipline

The tenant client with RLS is strong, but many deeper services use the global admin Prisma client.

Risk:

- a missed `organizationId` filter in future code could become a tenant leak
- this is an architecture risk even if current inspected paths look careful

### 5. Manual reading override does not clearly trigger recomputation

The platform lets users create a manual reading override through the building router, but the inspected mutation path does not clearly trigger snapshot refresh, issue refresh, or compliance reevaluation.

Risk:

- backend truth can drift from newly entered data
- user may believe the override has taken effect when downstream state is stale

### 6. The anomaly story is split across two subsystems

There is a legacy or secondary drift system (`DriftAlert`, drift-detection pipeline) and a stronger current anomaly system (`OperationalAnomaly`).

Risk:

- conceptual confusion for maintainers
- duplicate or diverging alert semantics
- UI/backend mismatches if both are surfaced

### 7. Legacy and current paths coexist in ways that increase cognitive load

Examples:

- `portfolio-manager-sync.ts` and `portfolio-manager-sync-reliable.ts` as compatibility-only benchmarking support
- legacy drift pipeline and active anomaly engine
- deprecated capital structuring code still in repo

Risk:

- harder onboarding
- accidental use of secondary codepaths
- unclear ownership of “the real implementation”

### 8. Report/artifact storage abstraction is incomplete or opaque

Artifacts are well-modeled in the schema, but a unified storage/export story is not obvious from inspected backend code.

Risk:

- operators may outgrow DB-backed payload storage
- retention, reproducibility, and external delivery could become ad hoc

### 9. Hidden correctness bug in upload batch ID generation

`src/server/pipelines/data-ingestion/logic.ts` creates an `uploadBatchId` string with a trailing space.

Risk:

- subtle mismatches in equality checks, debugging, grouping, or downstream integrations

### 10. Rule sophistication exceeds surrounding runtime maturity

The governed compliance layer is relatively sophisticated, but surrounding scheduler/worker/observability tooling is less mature.

Risk:

- strong calculation core can still be undermined by operational fragility

## 14. How this platform really works

If explained to a smart non-engineer, the platform really works like this:

It is a system for turning messy building energy evidence into operationally usable compliance truth.

Under the UI, the product keeps three different layers of reality:

1. raw facts
   - buildings
   - meters
   - energy readings
   - external integration state
2. interpreted truth
   - snapshots
   - benchmarking readiness
   - BEPS outcomes
   - penalty exposure
   - source reconciliation decisions
3. action state
   - issues
   - workflows
   - packets
   - anomalies
   - retrofit recommendations

When the product feels “operational,” that is mostly because the backend is continually translating raw facts into next actions.

When the product feels “intelligent,” that is mostly because:

- it has explicit policy logic
- it preserves governed versions of those policies
- it keeps provenance for what was calculated
- it derives a worklist from the resulting state
- it scores risk and opportunity on top of that state

The hidden engines under the UI are therefore:

- ingestion and normalization
- source reconciliation
- governed compliance evaluation
- evidence and packet generation
- readiness and worklist derivation
- anomaly and retrofit ranking

The most important concepts to understand are:

- a building is the central unit of work
- readings are the raw evidence
- snapshots are derived projections
- compliance runs are the durable record of governed calculations
- benchmark submissions and filing records are the live obligation records
- data issues and workflows determine what operators do next

This is not primarily a generic analytics app. It is a workflow engine wrapped around regulated building-energy evidence.

## 15. Appendix: file evidence

### Key files to read first

- `C:\Quoin\package.json`
- `C:\Quoin\prisma\schema.prisma`
- `C:\Quoin\src\app\api\trpc\[trpc]\route.ts`
- `C:\Quoin\src\server\trpc\init.ts`
- `C:\Quoin\src\server\trpc\routers\index.ts`
- `C:\Quoin\src\server\worker-entrypoint.ts`

### Key directories and what they contain

- `C:\Quoin\src\server\trpc\routers`
  - app-facing backend API surface
- `C:\Quoin\src\server\compliance`
  - most domain logic, workflow state, rules, provenance, and packet generation
- `C:\Quoin\src\server\pipelines`
  - ingestion and worker-oriented operational flows
- `C:\Quoin\src\server\integrations`
  - external system clients and token handling
- `C:\Quoin\src\server\lib`
  - auth, tenancy, config, queue, job, logging, crypto, error foundations
- `C:\Quoin\prisma`
  - schema and migration-level enforcement

### Most important backend entry points

- `C:\Quoin\src\app\api\trpc\[trpc]\route.ts`
- `C:\Quoin\src\app\api\upload\route.ts`
- `C:\Quoin\src\app\api\green-button\authorize\route.ts`
- `C:\Quoin\src\app\api\green-button\callback\route.ts`
- `C:\Quoin\src\app\api\green-button\webhook\route.ts`
- `C:\Quoin\src\app\api\webhooks\clerk\route.ts`

### Most important domain logic files

- `C:\Quoin\src\server\compliance\benchmarking-core.ts`
- `C:\Quoin\src\server\compliance\benchmarking.ts`
- `C:\Quoin\src\server\compliance\verification-engine.ts`
- `C:\Quoin\src\server\compliance\beps\beps-evaluator.ts`
- `C:\Quoin\src\server\compliance\beps\formulas.ts`
- `C:\Quoin\src\server\compliance\penalties.ts`
- `C:\Quoin\src\server\compliance\data-issues.ts`
- `C:\Quoin\src\server\compliance\portfolio-worklist.ts`
- `C:\Quoin\src\server\compliance\source-reconciliation.ts`
- `C:\Quoin\src\server\compliance\operations-anomalies.ts`
- `C:\Quoin\src\server\compliance\retrofit-optimization.ts`

### Most important schema/model files

- `C:\Quoin\prisma\schema.prisma`
- `C:\Quoin\prisma\migrations\00000000000001_rls_policies\migration.sql`
- `C:\Quoin\prisma\migrations\00000000000002_app_role\migration.sql`

### Most important integration files

- `C:\Quoin\src\server\integrations\espm\client.ts`
- `C:\Quoin\src\server\portfolio-manager\existing-account.ts`
- `C:\Quoin\src\server\portfolio-manager\meter-setup.ts`
- `C:\Quoin\src\server\portfolio-manager\usage.ts`
- `C:\Quoin\src\server\compliance\portfolio-manager-sync.ts` (compatibility only)
- `C:\Quoin\src\server\compliance\portfolio-manager-sync-reliable.ts` (compatibility only)
- `C:\Quoin\src\server\compliance\portfolio-manager-push.ts` (compatibility only)
- `C:\Quoin\src\server\integrations\green-button\client.ts`
- `C:\Quoin\src\server\integrations\green-button\token-manager.ts`
- `C:\Quoin\src\server\integrations\green-button\credentials.ts`

### Most important artifact/report/workflow files

- `C:\Quoin\src\server\compliance\benchmark-packets.ts`
- `C:\Quoin\src\server\compliance\beps\filing-packets.ts`
- `C:\Quoin\src\server\compliance\submission-workflows.ts`
- `C:\Quoin\src\server\rendering\packet-documents.ts`
- `C:\Quoin\src\server\compliance\report-artifacts.ts`
- `C:\Quoin\src\server\trpc\routers\report.ts`

### Most important governance/provenance files

- `C:\Quoin\src\server\compliance\provenance.ts`
- `C:\Quoin\src\server\compliance\compliance-engine.ts`
- `C:\Quoin\src\server\compliance\rule-publication.ts`
- `C:\Quoin\src\server\compliance\rule-regression-harness.ts`
- `C:\Quoin\src\server\compliance\beps\cycle-registry.ts`

### Files that are important because they show partial or legacy behavior

- `C:\Quoin\src\server\worker-entrypoint.ts`
- `C:\Quoin\src\server\pipelines\drift-detection\worker.ts`
- `C:\Quoin\src\server\pipelines\drift-detection\rules-engine.ts`
- `C:\Quoin\src\server\pipelines\capital-structuring\worker.ts`
- `C:\Quoin\src\server\compliance\financing-packets.ts`
