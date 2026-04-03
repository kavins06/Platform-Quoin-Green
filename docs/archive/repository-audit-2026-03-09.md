# Quoin Main Repository Audit (Comprehensive)

Date: 2026-03-09
Scope: `/workspace/Quoin`
Method: Code-first inspection across application code, schema, migrations, infra, workflows, and tests.

## SECTION A — Executive summary

### What the product appears to do today
Quoin currently implements a multi-tenant web application for DC BEPS-oriented building energy compliance operations. The active implemented flow is:
1. Tenant-authenticated users (Clerk org context) create/manage buildings.
2. Energy data is ingested from CSV uploads and Green Button integration, with optional ENERGY STAR Portfolio Manager (ESPM) synchronization.
3. Deterministic EUI/compliance/penalty estimations are computed and persisted as append-only snapshots.
4. Additional deterministic modules provide drift alerts, exemption screening, pathway/penalty utilities, and capital-structuring analysis.
5. UI surfaces portfolio/dashboard, building detail tabs, and onboarding.

### Product stage assessment
The repo looks like a **production-leaning MVP with uneven depth**:
- Strong deterministic pipeline and multi-tenant controls are present.
- Many workflow outputs are advisory or heuristic rather than compliance-grade final engines.
- Architecture is coherent but still transitional (legacy migration history, placeholder docs, some brittle assumptions).

### Top 5 strongest parts
1. Multi-tenant isolation strategy (RLS + tenant-scoped Prisma client + role middleware).
2. Deterministic ingestion and snapshot pipeline with idempotency keys.
3. Broad integration foundation (Clerk, ESPM, Green Button, Stripe webhooks, Inngest orchestration).
4. Nontrivial domain-specific deterministic modules (penalty calculations, exemptions, drift rules, financing eligibility).
5. Solid CI/testing footprint for unit/integration/eval layers.

### Top 5 biggest weaknesses / missing foundations
1. Compliance engine is not yet a fully versioned, canonical rules-as-code system.
2. Schema/migration history indicates churn and partial de-scoping (legacy entities in early migrations absent in current schema).
3. Auditability is partial: append-only snapshots/readings exist, but formal provenance/version stamping for all calculations is incomplete.
4. Some security/compliance-critical areas remain flagged or weak (token handling comments, SSE endpoint trusts caller-supplied orgId).
5. Operational docs are immature/generic (README still Next.js boilerplate).

## SECTION B — Repo inventory

### High-level tree (important areas)
- `src/app` — Next.js app routes (auth, dashboard, onboarding, API endpoints)
- `src/components` — UI components (dashboard/building/onboarding/layout)
- `src/server/trpc` — typed API routers and auth/tenant middleware
- `src/server/pipelines` — deterministic business logic pipelines
- `src/server/inngest` — async workflow/event orchestration
- `src/server/integrations` — external integrations (ESPM, Green Button, Stripe)
- `src/server/lib` — db/auth/access/config core runtime utilities
- `prisma` — schema, migrations, seed, RLS SQL helpers
- `test` — unit/integration/eval suites
- `deploy`, `Dockerfile`, `docker-compose*`, `nginx` — deployment/infrastructure artifacts
- `.github/workflows` — CI pipeline
- `.specs/tasks.md` — historical implementation task log

### Major directory responsibilities
- `src/app/api/*`: ingestion trigger endpoints, webhooks, health, SSE events, tRPC transport.
- `src/server/pipelines/data-ingestion/*`: parsing/normalization/validation/EUI/snapshot orchestration.
- `src/server/pipelines/pathway-analysis/*`: penalties, exemptions, ECM scoring.
- `src/server/pipelines/capital-structuring/*`: program eligibility and capital stack assembly.
- `src/server/pipelines/drift-detection/*`: deterministic anomaly rules.
- `src/server/inngest/functions/*`: event-driven orchestration for ingestion, drift, pathway, capital, Green Button, Stripe.

### Active vs experimental vs likely stale
- **Active**: building/router flow, ingestion, snapshots, drift/capital/report tabs, Green Button callbacks, Inngest jobs, tests.
- **Experimental / heuristic**: capital narrative generation via Anthropic call; simplified pathway sweep recalculation.
- **Likely stale / inconsistent**:
  - README does not describe real system.
  - `.specs/tasks.md` references prior BullMQ/Redis plans not reflected in current runtime.
  - Early migration includes tables/enums not in current Prisma schema (indicates model contraction).

## SECTION C — Current architecture

### Frontend architecture
- Next.js 14 App Router with route groups for auth/dashboard/onboarding.
- Clerk for auth UI/session.
- Client data layer via tRPC + React Query provider.
- Dashboard + Building-detail componentized UI with charts (Recharts) and optional map view.
- UI state mostly local; data fetched through tRPC hooks.

### Backend architecture
- Backend is embedded in Next.js app server:
  - tRPC routers for typed application API.
  - REST-like route handlers for uploads/webhooks/oauth callbacks/SSE.
  - Inngest background functions for async workflows.
- No separate microservice boundary; monolith with modular folders.

### Data/storage architecture
- PostgreSQL via Prisma + `@prisma/adapter-pg`.
- Tenant isolation uses Postgres row-level security and session `app.organization_id` set via tenant-specific connection options.
- Core persistent entities include organizations, users, buildings, readings, snapshots, pipeline runs, drift alerts, meters, Green Button connections.

### API architecture
- Primary app API via tRPC routers:
  - `building`, `report`, `capital`, `drift`.
- Additional API routes for ingestion/webhooks/health/events.
- Typed Zod inputs/outputs for most router procedures.

### Auth / multi-tenant architecture
- Clerk auth with org role mapping to app roles (`ADMIN/MANAGER/ENGINEER/VIEWER`).
- Middleware and tRPC procedures enforce role minimums.
- Tenant DB client sets Postgres session vars for RLS-based isolation.

### Background jobs / workflows / queues
- Inngest event-driven model (not BullMQ in active code).
- Chained events: ingestion -> drift detection -> optional ESPM metric sync.
- Additional jobs for Green Button sync, pathway sweep, capital structuring, Stripe webhook async handling.

### Third-party integrations
- Clerk (auth + org webhooks)
- ENERGY STAR Portfolio Manager XML API
- Green Button OAuth/token + ESPI parsing
- Stripe webhook signature verification + async tier updates
- Optional Anthropic API for narrative text in capital pipeline

### Deployment / infrastructure shape
- Docker multi-stage build for standalone Next.js output.
- Local compose for Postgres; prod/ec2 compose for app (+ optional postgres).
- Nginx reverse-proxy config for staging domain.
- GitHub Actions CI with Postgres service, migrations, lint/test/build/docker/eval.

### Observability / logging / auditability
- Logging largely via console logs.
- Audit trail partly modeled via `pipeline_runs` + append-only snapshot/readings rules.
- Limited centralized observability/metrics/tracing in repo.

### Testing strategy
- Vitest for unit/integration.
- Integration test for RLS isolation.
- Custom eval harness for deterministic golden datasets (penalty suite).
- CI runs TypeScript, lint, test, build, docker build, eval.

## SECTION D — Domain model and product capabilities

### Organizations / users / tenant access
- **Exists:** `Organization`, `User`, role mapping, Clerk sync webhooks, tenant middleware.
- **Missing:** richer org policy model, RBAC granularity beyond role tiers, admin audit logs.
- **Where:** `prisma/schema.prisma`, `src/server/lib/access.ts`, `src/app/api/webhooks/clerk/route.ts`, `src/server/trpc/init.ts`.

### Buildings / portfolio
- **Exists:** core building metadata, soft-archive support, list/search/stats/detail retrieval.
- **Missing:** rigorous address normalization/geospatial indexing, detailed property taxonomy.
- **Where:** `prisma/schema.prisma`, `src/server/trpc/routers/building.ts`, `src/components/dashboard/*`, `src/components/building/*`.

### Energy data (meters/readings)
- **Exists:** meter + reading models; CSV/Green Button ingest; ESPM sync support; idempotent persistence.
- **Missing:** comprehensive meter provenance lifecycle, strict source reconciliation rules, utility account abstractions.
- **Where:** `prisma/schema.prisma`, `src/server/pipelines/data-ingestion/*`, `src/server/integrations/green-button/*`, `src/server/integrations/espm/*`.

### Compliance snapshots / penalties / pathway support
- **Exists:** append-only snapshots with status/gap/penalty fields; deterministic penalty calculators and pathway selector helpers.
- **Missing:** full regulatory-grade rule/version model linking each result to law version + factor version + formula artifact hash.
- **Where:** `prisma/schema.prisma`, `src/server/pipelines/data-ingestion/snapshot.ts`, `src/server/pipelines/pathway-analysis/*`, `docs/calculation-reference.md`.

### Exemptions
- **Exists:** deterministic exemption screener + report output packaging.
- **Missing:** evidence object model and document management workflow for filing packets.
- **Where:** `src/server/pipelines/pathway-analysis/exemption-screener.ts`, `src/server/trpc/routers/report.ts`, tests under `test/unit/report-exemption.test.ts`.

### Drift/anomaly detection
- **Exists:** rules-engine for EUI spikes, score drops, anomalies, seasonal deviation, sustained drift; persistence + ack/resolve flows.
- **Missing:** model calibration/versioning and explainability provenance.
- **Where:** `src/server/pipelines/drift-detection/rules-engine.ts`, `src/server/inngest/functions/drift-detection.ts`, `src/server/trpc/routers/drift.ts`.

### Capital/retrofit/financing
- **Exists:** ECM scoring, eligibility screeners (AHRA/CLEER/C-PACE), capital stack assembly, narrative generation.
- **Missing:** persisted canonical ECM/project entities and workflow states in current schema.
- **Where:** `src/server/pipelines/pathway-analysis/ecm-scorer.ts`, `src/server/pipelines/capital-structuring/*`, `src/server/trpc/routers/capital.ts`, `src/server/inngest/functions/capital-structuring.ts`.

### Documents/audit logs
- **Exists:** pipeline run summaries + snapshots as operational trace.
- **Missing:** dedicated document store, immutable evidence chain, cryptographic signing, comprehensive user action audit table.
- **Where:** `prisma/schema.prisma` (`PipelineRun`, `ComplianceSnapshot`), report router outputs.

## SECTION E — Regulatory/compliance readiness

### Rules-as-code foundation
- **Partially exists.** Deterministic formulas and rule modules are present and tested (penalty, exemptions, drift, eligibility).
- **Not yet complete** as a governance-grade rules engine (no explicit policy package version registry persisted per run).

### Determinism vs scatter
- **Mostly deterministic core calculations** in pipeline modules.
- **Some scatter:** pathway/penalty logic appears in both ingestion simplification and separate analysis helpers; UI infers pathway directly in tab.

### Calculation versioning
- **Partially exists:** comments and factor constants have effective dates; snapshot has `penaltyInputsJson` field.
- **Missing:** systematic version IDs (ruleset version, factor version, formula version) attached to every computed artifact.

### Evidence, traceability, auditability
- **Exists:** append-only SQL rules for key tables; pipeline run records with input/output summaries; idempotency keys.
- **Missing:** full evidence graph linking source docs/raw files/rule versions, plus immutable signed audit records.

### Data model suitability for compliance-grade calculations
- **Moderately suitable baseline:** core entities and snapshoting support essential workflows.
- **Gaps:** no first-class legal rule/version entities; limited provenance per reading beyond raw payload JSON and source factor fields.

### Suitability for future DC benchmarking / BEPS engine
- **Can serve as base platform**, but needs formalized rule governance, versioned calculation lineage, richer domain entities, and stricter evidence handling before being compliance-authoritative.

## SECTION F — Data model and persistence audit

### Main entities
- `organizations`, `users`, `buildings`, `meters`, `energy_readings`, `compliance_snapshots`, `green_button_connections`, `pipeline_runs`, `drift_alerts`.

### Relationship sketch
- Organization 1..* Users/Buildings
- Building 1..* EnergyReadings/Snapshots/PipelineRuns/DriftAlerts/Meters
- Building 1..1 optional GreenButtonConnection
- PipelineRun 1..* ComplianceSnapshots/DriftAlerts (optional foreign keys)

### Schema quality observations
- Good use of enums for status and pathways.
- Soft-delete via `archivedAt` on buildings and filtered in query paths.
- Idempotency unique keys added for readings/runs/alerts.
- Appendix-style comments highlight token encryption TODO in `GreenButtonConnection`.

### Naming/constraint/duplication issues
- Migration history indicates legacy enums/tables (ECM/pathways/capital stacks/funding) removed from live Prisma schema, creating potential historical drift confusion.
- Some model fields may encode derived values without explicit provenance (`estimatedPenalty`, `complianceGap`) unless `penaltyInputsJson` is populated consistently.
- SSE endpoint relies on caller-provided `organizationId` query param and bypasses tenant middleware pattern.

### Likely migration risks
- Long-lived environments may have residual legacy objects from early migrations.
- Manual SQL/rules for append-only behavior can complicate migration evolution and test cleanup.
- RLS/app role assumptions depend on DB role setup consistency outside Prisma schema.

## SECTION G — Code quality and engineering quality

### Maintainability
- Generally modular folder decomposition.
- Naming mostly clear and domain-oriented.
- Some very large UI/route files and mixed concerns in handlers (business + transport + orchestration).

### Modularity / coupling
- Strong coupling to Prisma models and Inngest events is intentional but tight.
- Shared deterministic logic is reasonably isolated in `src/server/pipelines/*`.

### Error handling
- Mixed quality:
  - Good explicit `TRPCError` usage in routers.
  - Many `console.error`/`catch {}` fallbacks without structured error taxonomy.

### Test quality
- Good breadth for deterministic logic and RLS isolation.
- Less apparent end-to-end coverage of full async workflow chains and auth/webhook hardening paths.

### Security posture visible in repo
- Positive: webhook signature verification (Stripe/Svix), RLS, role checks, Green Button state nonce/cookie.
- Concerns: explicit TODO for token encryption maturity, SSE org-id trust surface, broad console logging may leak operational detail.

### Config/env hygiene
- Zod env validation exists.
- README lacks operational guidance.
- Prisma config includes import-time try/catch pattern generated by toolchain.

### Type safety
- Strong TS strict mode overall.
- Still some `any` usage and explicit casts in router transformations/integration adapters.

### Migration discipline
- Migrations are present and CI applies them.
- Early migration breadth vs current schema mismatch suggests evolving scope and potential dead structures.

### API consistency / separation of concerns
- tRPC interface coherent.
- Mix of tRPC and ad-hoc route handlers is pragmatic but increases mental model complexity.

## SECTION H — Technical debt and architectural risks (priority order)

1. **Missing formal rules/version governance**
   - Why: Compliance-grade systems require reproducible outputs tied to immutable ruleset versions.
   - Consequence: Future audits/challenges cannot reliably replay historical determinations.
   - Remediation: introduce first-class ruleset/version entities + run-level provenance references.

2. **Schema/migration drift and legacy artifacts**
   - Why: Historical table/enum churn increases migration fragility and team confusion.
   - Consequence: environment inconsistencies, accidental dependencies, complex upgrades.
   - Remediation: perform schema archaeology, deprecate/drop obsolete objects with explicit migration plan.

3. **Partial audit trail model**
   - Why: `PipelineRun` summaries are helpful but insufficient for evidence-grade lineage.
   - Consequence: weak legal defensibility of compliance outputs.
   - Remediation: immutable evidence ledger linking readings, source docs, factors, formulas, and decisions.

4. **Security edge cases in integration/event routes**
   - Why: webhook/callback/SSE paths are high-risk surfaces.
   - Consequence: data leakage or spoofed update streams in worst case.
   - Remediation: enforce auth/tenant binding on SSE, harden route-level checks, centralize security middleware.

5. **Heuristic/placeholder assumptions in capital/pathway workflows**
   - Why: some modules use simplified defaults and derived assumptions.
   - Consequence: decision quality risk if treated as authoritative.
   - Remediation: codify assumption registry, require explicit confidence/provenance flags in outputs.

6. **Operational documentation gap**
   - Why: onboarding/maintenance depends on tribal knowledge.
   - Consequence: slower scaling and higher ops risk.
   - Remediation: replace boilerplate README with architecture/runbook/compliance model docs.

## SECTION I — What has been built vs what still needs to be built

### 1) Already built or partially built
- Multi-tenant auth + role enforcement + RLS isolation.
- Building/portfolio CRUD and dashboard UI.
- CSV + Green Button ingestion and ESPM synchronization hooks.
- Deterministic EUI/status/simple penalty snapshots.
- Deterministic penalty functions for multiple pathways.
- Drift detection rules and alert lifecycle.
- Exemption screening and filing-oriented report data assembly.
- Capital eligibility screening + stack assembly + advisory narrative.
- CI pipeline with tests, eval suites, build, docker validation.

### 2) Still missing for target product (serious compliance platform)
- Deterministic compliance engine with explicit legal rule package/versioning and historical replay guarantees.
- Canonical energy/compliance ontology with full evidence provenance and document chain of custody.
- Benchmarking automation as a first-class governed workflow with robust exception handling and attestations.
- BEPS penalty computation engine that is legally traceable end-to-end (inputs, constants, rules, pathway rationale).
- Forecasting engine (scenario/time-series with model management and validation).
- Event/anomaly intelligence beyond static rules (while preserving deterministic compliance boundaries).
- Retrofit optimization as persisted portfolio optimization workflow (not only per-building heuristic recommendations).
- Financing packet generation with document assembly, underwriting artifacts, and submission workflow state.

## SECTION J — Recommended next build sequence (milestones)

1. **Compliance calculation provenance framework**
   - Objective: add ruleset/version/factor version IDs and immutable provenance references to every snapshot/decision.
   - Why now: foundational for all future compliance-grade features.
   - Dependencies: schema changes + pipeline run contract updates.
   - Code areas: `prisma/schema.prisma`, ingestion/pathway pipelines, report router.

2. **Canonical compliance domain model expansion**
   - Objective: introduce explicit entities for rule packages, evidence artifacts, filing records, and calculation manifests.
   - Why now: needed before broad feature scaling.
   - Dependencies: milestone 1.
   - Code areas: Prisma schema/migrations, report/capital/pathway modules.

3. **Benchmarking & BEPS engine hardening**
   - Objective: consolidate pathway and penalty logic into one authoritative orchestrator with deterministic outputs and reason codes.
   - Why now: currently logic is distributed and partially simplified.
   - Dependencies: milestones 1–2.
   - Code areas: `src/server/pipelines/pathway-analysis/*`, ingestion snapshot builder, tRPC/report surfaces.

4. **Evidence/document pipeline and audit ledger**
   - Objective: persist source files, attestations, generated packets, and immutable action logs.
   - Why now: required for exemption/filing readiness.
   - Dependencies: milestones 1–2.
   - Code areas: new storage layer, API routes, report generation paths.

5. **Security hardening pass on integration and event surfaces**
   - Objective: close auth/tenant and callback risks, add stricter validation and secrets handling.
   - Why now: system is integration-heavy and externally triggered.
   - Dependencies: none (parallelizable).
   - Code areas: `src/app/api/*`, middleware, Green Button token management.

6. **Asynchronous workflow observability and reliability upgrades**
   - Objective: structured logs, traces, retries visibility, dead-letter triage dashboards.
   - Why now: async orchestration complexity is growing.
   - Dependencies: minor schema/logging additions.
   - Code areas: Inngest functions, pipeline run model, deployment observability stack.

7. **Forecasting module (bounded scope, deterministic where needed)**
   - Objective: add scenario-based consumption/score/penalty forecast layer.
   - Why now: once compliance baseline is governed.
   - Dependencies: milestones 1–3.
   - Code areas: new pipeline package, UI tabs, report extension.

8. **Retrofit portfolio optimization + financing workflow persistence**
   - Objective: move from point-in-time advisory to actionable pipeline with project states and financing packet export.
   - Why now: after canonical model and evidence framework exist.
   - Dependencies: milestones 2,4,7.
   - Code areas: capital/pathway modules, schema, onboarding and building tabs.

## SECTION K — Paste-back summary for ChatGPT

Quoin is currently a production-leaning MVP monolith (Next.js + tRPC + Prisma/Postgres + Inngest) focused on DC BEPS workflows: multi-tenant building management, deterministic ingestion/snapshot calculations, Green Button/ESPM integrations, drift detection, exemption screening, and capital structuring. It has real strengths in tenant isolation (RLS), deterministic calculation modules, and testing/CI coverage.

However, it is not yet a compliance-authoritative platform. The biggest architectural gap is missing first-class rules/version governance and full provenance for every compliance output. Current auditability is partial (append-only snapshots/pipeline runs) but not end-to-end legal traceability. Schema history indicates scope churn and legacy artifacts, and some security/ops surfaces need hardening (especially event/SSE/callback edges and token lifecycle rigor).

Recommended immediate next milestone: implement a compliance provenance framework (ruleset versions + factor versions + calculation manifest IDs persisted on each snapshot/run), then evolve schema/domain model around evidence artifacts and filing records before expanding forecasting/optimization.

Critical repo facts for CTO-level planning:
- Deterministic calculation code exists and is test-covered, but formal rules governance does not.
- Async workflows are Inngest-based (not Redis/BullMQ in active runtime).
- Core data model is solid baseline but lacks compliance-evidence entities.
- README is boilerplate and not reflective of production architecture.

## APPENDIX — Key files ChatGPT should inspect mentally

- `prisma/schema.prisma`
- `prisma/migrations/00000000000000_init/migration.sql`
- `prisma/migrations/00000000000001_rls_policies/migration.sql`
- `src/server/lib/db.ts`
- `src/server/trpc/init.ts`
- `src/server/trpc/routers/building.ts`
- `src/server/pipelines/data-ingestion/logic.ts`
- `src/server/pipelines/data-ingestion/snapshot.ts`
- `src/server/pipelines/pathway-analysis/penalty-calculator.ts`
- `src/server/pipelines/pathway-analysis/exemption-screener.ts`
- `src/server/pipelines/drift-detection/rules-engine.ts`
- `src/server/pipelines/capital-structuring/logic.ts`
- `src/server/inngest/functions/data-ingestion.ts`
- `src/server/inngest/functions/green-button-sync.ts`
- `src/server/inngest/functions/pathway-analysis.ts`
- `src/app/api/upload/route.ts`
- `src/app/api/green-button/*`
- `src/app/api/webhooks/clerk/route.ts`
- `src/app/api/events/route.ts`
- `test/integration/rls-isolation.test.ts`
- `test/unit/*` and `test/eval/*`
- `.github/workflows/ci.yml`
- `Dockerfile`, `docker-compose*.yml`, `deploy/*`, `nginx/quoin.conf`
