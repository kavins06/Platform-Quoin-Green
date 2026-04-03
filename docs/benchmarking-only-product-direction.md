# Benchmarking-Only Product Direction

## 1. Product Definition

Quoin is now a benchmarking platform only.

That means Quoin exists to:

- connect to ENERGY STAR Portfolio Manager (ESPM)
- import buildings and properties into governed local state
- ingest and normalize utility data locally
- reconcile and govern the canonical local energy record
- set up PM property uses, meters, and associations safely
- push approved local usage to ESPM explicitly
- evaluate annual benchmarking readiness
- support benchmark submission workflow, evidence, packet generation, and operator review

Quoin is the governed local benchmarking system. ESPM is the external benchmarking workspace and integration target.

## 2. In-Scope Capabilities

- Org-level ESPM connection and existing-account property import
- Quoin-managed PM provisioning where already retained
- Local utility ingestion from Green Button, CSV upload, manual overrides, and PM import
- Source reconciliation and canonical-source governance
- Building-level PM setup:
  - property-use setup
  - meter matching / creation
  - property-to-meter associations
  - usage import from PM
  - explicit local-to-PM usage push
- Benchmark readiness evaluation, verification checklisting, and data-issue tracking
- Benchmark submission records, request items, verification support, packet generation, evidence, and workflow transitions
- Runtime health, jobs, audit logs, and operator recovery actions that directly support benchmarking correctness

## 3. Out-Of-Scope Capabilities

Unless a specific piece is strictly required for benchmarking correctness, these are out of scope:

- BEPS product expansion beyond immediate benchmarking needs
- decarbonization planning
- retrofit ranking and portfolio optimization tooling
- financing workflows
- broad consultant or operations surfaces that are not part of benchmarking execution
- anomaly-detection products not directly tied to benchmarking correctness
- broad reporting/product surfaces that imply Quoin is a generic compliance platform

## 4. Keep / De-Emphasize / Remove / Defer Matrix

| Area | Decision | Repo-grounded reason |
| --- | --- | --- |
| `src/server/portfolio-manager/*` | Keep | This is the active PM architecture for connection, setup, meter linkage, and explicit usage import/push. |
| `src/server/trpc/routers/portfolio-manager.ts` | Keep | Cleanest product-aligned API surface for PM benchmarking work. |
| `src/server/trpc/routers/benchmarking.ts` benchmark submission/readiness routes | Keep | Core benchmarking workflow. |
| `src/server/compliance/benchmarking.ts`, `benchmark-packets.ts`, `verification-engine.ts`, `source-reconciliation.ts` | Keep | Core governed benchmarking and evidence pipeline. |
| `src/components/building/benchmark-workbench-tab.tsx` | Keep | Already the clearest active benchmark-execution surface. |
| `src/components/building/secondary-tools-tab.tsx` PM setup + recovery areas | Keep, but narrow | PM setup and recovery remain useful for benchmarking execution. |
| `src/components/settings/settings-page.tsx` PM connection + compatibility view | Keep, but de-emphasize | Needed for org PM connection and compatibility visibility, but should stay explicitly benchmark-scoped. |
| `src/server/compliance/data-issues.ts`, `governed-operational-summary.ts`, `portfolio-worklist.ts` | De-emphasize / narrow | They currently blend benchmarking and BEPS/penalty/retrofit state into one portfolio story. |
| `src/server/trpc/routers/beps.ts` and `src/server/compliance/beps/*` | Remove later | Full BEPS product surface is out of scope, but current repo/tests still assume it exists. |
| `src/server/trpc/routers/operations.ts` and `src/server/compliance/operations-anomalies.ts` | Remove later | Operational anomalies are not part of the active benchmarking product story. |
| `src/server/trpc/routers/retrofit.ts` and `src/server/compliance/retrofit-optimization.ts` | Remove later | Retrofit planning is out of scope after the reset. |
| `src/server/compliance/portfolio-manager-sync*.ts`, `portfolio-manager-push.ts` | Defer | Benchmarking still depends on `PortfolioManagerSyncState` compatibility reads. |
| Broad dashboard/reporting surfaces | De-emphasize, then narrow | Several active copy paths still imply a larger compliance platform than the code’s core workflow requires. |
| Financing schema and legacy financing code | Defer | Already marked legacy; safe cleanup comes after product-surface narrowing and compatibility replacement. |

## 5. Current Repo Audit Findings

### Already aligned with the benchmarking-only product

- `src/server/portfolio-manager/existing-account.ts`
  - ESPM credential validation, property preview caching, import queueing, and governed local building creation
- `src/server/portfolio-manager/setup.ts`
  - building-level PM property-use setup with explicit readiness state
- `src/server/portfolio-manager/meter-setup.ts`
  - safe local/remote meter linking, import, creation, and association governance
- `src/server/portfolio-manager/usage.ts`
  - governed PM usage import/push, reconciliation-aware push blocking, metrics refresh, and review state
- `src/server/trpc/routers/portfolio-manager.ts`
  - active PM product API
- `src/server/trpc/routers/benchmarking.ts`
  - readiness evaluation, submission records, request items, checklist, and packet workflow
- `src/server/compliance/benchmarking.ts`
- `src/server/compliance/benchmark-packets.ts`
- `src/server/compliance/source-reconciliation.ts`
- `src/components/building/benchmark-workbench-tab.tsx`
- `test/integration/portfolio-manager-existing-account.test.ts`
- `test/integration/portfolio-manager-setup.test.ts`
- `test/integration/portfolio-manager-meter-setup.test.ts`
- `test/integration/portfolio-manager-usage.test.ts`
- `test/integration/benchmarking-workflow.test.ts`
- `test/integration/benchmark-packets.test.ts`

### Adjacent but should be deprioritized

- settings/governance surfaces for rule packages and factor sets
- compatibility-only PM benchmarking views
- artifact/reporting surfaces that are still useful for benchmark packets and evidence
- operator recovery actions that directly support ingestion, reconciliation, and PM setup/runtime recovery

### Clearly out of scope after the reset

- `src/server/trpc/routers/beps.ts`
- `src/server/trpc/routers/operations.ts`
- `src/server/trpc/routers/retrofit.ts`
- `src/server/compliance/beps/*`
- `src/server/compliance/operations-anomalies.ts`
- `src/server/compliance/retrofit-optimization.ts`
- penalty/portfolio-optimization framing in active dashboard and worklist surfaces
- landing/sidebar/dashboard copy that still positions Quoin as a BEPS or broad compliance suite

### Hidden dependencies that block immediate deletion

- `src/server/trpc/routers/benchmarking.ts` still reads legacy compatibility state through:
  - `getLegacyPortfolioManagerBenchmarkStatus`
  - `listLegacyPortfolioBenchmarkReadiness`
  - `getLegacyPortfolioManagerQaFindings`
- `src/server/compliance/benchmark-packets.ts` still uses `PortfolioManagerSyncState` compatibility diagnostics in packet assembly.
- `src/components/building/benchmarking-tab.tsx` and `src/components/settings/settings-page.tsx` still present legacy benchmark-compatibility views.
- `src/server/compliance/data-issues.ts` and `src/server/compliance/portfolio-worklist.ts` still merge benchmarking and BEPS state into shared building readiness/worklist logic.
- `prisma/schema.prisma` still carries extensive BEPS, anomaly, retrofit, penalty, report, and financing models; they cannot be removed safely until services/routes/tests are narrowed first.
- The current test suite still includes broad product expectations:
  - `test/integration/beps-*.test.ts`
  - `test/integration/operations-anomalies.test.ts`
  - `test/integration/retrofit-optimization.test.ts`
  - `test/integration/portfolio-worklist.test.ts`
  - `test/unit/beps-*.test.ts`
  - `test/unit/operations-anomalies.test.ts`
  - `test/unit/retrofit-optimization.test.ts`
  - `test/unit/consultant-ui.test.ts`

## 6. Target Architecture After Scope Reduction

### Active runtime layers

- `src/server/portfolio-manager/*`
  - the canonical PM connection/setup/usage boundary
- `src/server/compliance/benchmarking.ts`
  - annual benchmarking evaluation and submission orchestration
- `src/server/compliance/source-reconciliation.ts`
  - canonical local source governance
- `src/server/compliance/data-issues.ts`
  - benchmark-focused issue tracking after narrowing
- `src/server/compliance/submission-workflows.ts`
  - benchmark submission state machine
- `src/server/compliance/benchmark-packets.ts`
  - benchmark verification packet generation/export
- `src/server/trpc/routers/portfolio-manager.ts`
- `src/server/trpc/routers/benchmarking.ts`
- `src/server/trpc/routers/building.ts`
  - eventually narrowed to benchmarking execution data only

### Compatibility boundary

- `src/server/compliance/portfolio-manager-sync.ts`
- `src/server/compliance/portfolio-manager-sync-reliable.ts`
- `src/server/compliance/portfolio-manager-push.ts`

These remain compatibility-only until benchmark readiness and packet assembly no longer depend on `PortfolioManagerSyncState`.

### UI target

- Portfolio/building/settings surfaces lead with:
  - PM connection
  - PM setup
  - local data governance
  - benchmark readiness
  - submission evidence
- Non-benchmarking surfaces are either:
  - hidden from active UI
  - clearly labeled as retained/deferred
  - removed once dependencies and tests are retired

## 7. Phased Reduction Plan

### Phase 1: Product story and UI narrowing

- Rewrite active docs and product copy around benchmarking.
- De-emphasize BEPS, anomaly, retrofit, and penalty language in active UI.
- Keep retained non-benchmarking surfaces behind explicit “deferred” framing.

### Phase 2: Benchmark-only read model shaping

- Narrow portfolio summaries and worklists to benchmark execution:
  - readiness
  - source governance
  - PM runtime/setup state
  - submission queue
- Stop using BEPS/penalty/retrofit signals to define the main portfolio narrative.

### Phase 3: Isolate or retire non-benchmarking routes and components

- Remove first-class reliance on:
  - `bepsRouter`
  - `operationsRouter`
  - `retrofitRouter`
  - broad reporting surfaces
- Keep only the pieces that directly support benchmark packets/evidence if still required.

### Phase 4: Replace legacy PM compatibility reads

- Build a benchmark compatibility/readiness projection from the newer PM runtime plus governed local data.
- Move settings/building packet surfaces off `PortfolioManagerSyncState`.
- Delete legacy PM sync/push compatibility services after that replacement is validated.

### Phase 5: Schema and test cleanup

- Remove or archive out-of-scope tests and services.
- Clean up Prisma models left behind by retired product areas.
- Reduce the repo to a clearly benchmark-only domain model.

## 8. Key Risks If We Remove The Wrong Things Too Early

- Removing `PortfolioManagerSyncState` too early will break:
  - benchmark compatibility views
  - some packet diagnostics
  - legacy compatibility tests
- Removing BEPS/operations/retrofit services before narrowing the shared worklist/readiness model will create broken portfolio summaries and failing tests.
- Deleting schema models before service and route cleanup will cause migration churn with little product payoff.
- Removing operator recovery tools too aggressively could degrade benchmarking runtime reliability even though the broader product areas are out of scope.
- Treating unused-looking dashboard code as active behavior can waste cleanup effort; current user flow routes through `/buildings` and the building workflow first.
