# Quoin-ESPM Relationship Audit

## Findings First

### Product intent

**Intended product relationship**

Quoin is intended to be a **governed DC benchmarking/compliance operating layer above multiple upstream data systems**, not a thin ESPM wrapper and not a pure PM mirror. The clearest evidence is that Quoin has its own canonical compliance pipeline, provenance objects, and source-reconciliation layer:

- `src/server/compliance/source-reconciliation.ts:16-21,181-217` establishes a local canonical-source selection policy of `MANUAL > GREEN_BUTTON > PORTFOLIO_MANAGER > CSV_UPLOAD`.
- `src/server/compliance/compliance-engine.ts:298-387` evaluates compliance from local `Building`, `EnergyReading`, and `EvidenceArtifact` records.
- `src/server/compliance/benchmarking-core.ts:269-301,508-538` treats PM linkage as a readiness dependency, but evaluates readiness from local readings and local evidence.
- `prisma/schema.prisma:1251-1343` defines Quoin-governed `SourceArtifact`, `EvidenceArtifact`, and `BenchmarkSubmission` models.
- `src/server/compliance/benchmark-packets.ts:465-485` assembles packets from local submission/evidence state and includes PM only as linkage/sync context.

**Actual product relationship**

The codebase currently implements a **mixed model**:

- The newer `src/server/portfolio-manager/*` modules treat Quoin as the operational and compliance system of record, with ESPM used for linkage, remote setup, usage exchange, and metrics input.
- The legacy `src/server/compliance/portfolio-manager-sync*.ts` and `portfolio-manager-push.ts` path still behaves like a **shadow mirror plus autopilot** that imports PM structure and metrics into local canonical tables and then creates compliance artifacts from the integration run.

That means Quoin is currently **both**:

1. a governed local compliance system above ESPM, and
2. a PM mirror/sync engine that still mutates core local state from ESPM.

Those two models do not fit together cleanly.

### Intended and actual ESPM relationship

There are two distinct ESPM relationships in the code:

1. **Quoin-managed mode**
   - Quoin uses the env/provider client from `src/server/integrations/espm/index.ts:27-40`.
   - It provisions a PM customer and property on the organization's behalf in `src/server/portfolio-manager/managed-provisioning.ts:178-260,561-610`.
   - `src/server/integrations/espm/account.ts:12-51` explicitly creates a PM customer with `webserviceUser: true`.

2. **Existing-account mode**
   - Quoin authenticates directly as the user-entered PM account with `createESPMClientFromCredentials(...)` in `src/server/portfolio-manager/existing-account.ts:650-659`.
   - It stores those encrypted credentials and reuses them later for import/setup/usage in `src/server/portfolio-manager/existing-account.ts:662-680,821-846,1030-1031`.

These modes converge only partially. They share the same downstream linkage fields and newer PM setup/usage runtime, but they do **not** share the same caller identity or sharing model. `src/server/portfolio-manager/existing-account.ts:821-846` resolves to:

- env/provider client for non-`EXISTING_ESPM` orgs
- direct user-credential client for `EXISTING_ESPM` orgs

So "Quoin connected to PM" does not mean one thing consistently across the product.

### System-of-record boundaries

The clean boundary in the repo is:

- **Quoin-governed**: compliance readiness, evidence, submissions, packets, workflow, provenance, and the final compliance decision.
- **ESPM-governed**: PM-native property/meter ids, PM sharing/access state, and PM metrics/scores as upstream metrics.
- **Ambiguous today**: building metadata, gross floor area, PM property-use structure, meter roster, and sometimes the usage record shape, because legacy PM sync still overwrites or mirrors data that the newer PM lifecycle treats as local canonical state.

### Real data-flow map

#### 1. Pulling data from ESPM into Quoin

**Existing-account connection and import**

- `src/server/portfolio-manager/existing-account.ts:650-680` validates the entered PM credentials with `GET /account`, fetches the property list, and stores an org-level property cache.
- `src/server/portfolio-manager/existing-account.ts:1058-1124` imports selected PM properties into local `Building` rows and sets `Building.espmPropertyId` / `Building.espmShareStatus = LINKED`.
- That import is intentionally narrow: it creates a local building profile and PM linkage only. It does not import meters, usage, metrics, or compliance artifacts.

**Legacy PM sync**

- `src/server/compliance/portfolio-manager-sync.ts:13-16` delegates sync work to `syncPortfolioManagerForBuildingReliable(...)`.
- `src/server/compliance/portfolio-manager-sync-reliable.ts:922-942` updates local `Building.grossSquareFeet` and `Building.yearBuilt` from PM property data.
- `src/server/compliance/portfolio-manager-sync-reliable.ts:1015-1025` creates or updates local `Meter` rows from the PM meter list.
- `src/server/compliance/portfolio-manager-sync-reliable.ts:1199-1217` creates or updates local `EnergyReading` rows with `source = ESPM_SYNC`.
- `src/server/compliance/portfolio-manager-sync-reliable.ts:1376-1402` creates a local `ComplianceSnapshot` from PM metrics.
- `src/server/compliance/portfolio-manager-sync-reliable.ts:1443-1460` then calls `evaluateAndUpsertBenchmarkSubmission(...)`.

**Newer PM usage import**

- `src/server/portfolio-manager/usage.ts:904-1015` imports PM consumption only for linked local meters.
- Imported usage lands in local `EnergyReading` rows with `source = ESPM_SYNC`.
- `src/server/portfolio-manager/usage.ts:656-671,1407-1441` stores PM metrics in `PortfolioManagerUsageState.latestMetricsJson`, not directly in `BenchmarkSubmission`.

#### 2. Pushing local data from Quoin to ESPM

**Newer PM setup/runtime**

- `src/server/portfolio-manager/setup.ts:168-258` evaluates PM property-use requirements from local building fields and local saved PM-use inputs.
- `src/server/portfolio-manager/meter-setup.ts:532-567,1036-1115,1456-1525` treats local meters as canonical and manages PM linkage through explicit strategies such as `LINK_EXISTING_REMOTE`, `CREATE_REMOTE`, and `IMPORT_REMOTE_AS_LOCAL`.
- `src/server/portfolio-manager/usage.ts:753-883` pushes local, non-`ESPM_SYNC` readings to PM and then computes coverage from local canonical linked readings.

**Legacy PM push**

- `src/server/compliance/portfolio-manager-push.ts:76,263,427-627` excludes `ESPM_SYNC` rows from push, which is good.
- But after push it immediately calls `syncPortfolioManagerForBuilding(...)` again in `src/server/compliance/portfolio-manager-push.ts:627`, re-entering the legacy sync/autopilot path.

#### 3. Using ESPM-derived data in benchmarking and packets

- `src/server/compliance/compliance-engine.ts:298-387` reads local `Building`, `EnergyReading`, and `EvidenceArtifact` rows.
- `src/server/compliance/benchmarking-core.ts:269-301` only checks that PM linkage/share exists; it does not read PM directly.
- `src/server/compliance/benchmark-packets.ts:473-482` includes PM linkage and sync diagnostics in the packet payload, but the packet is still assembled from `BenchmarkSubmission` and `EvidenceArtifact`.

#### 4. Resolving conflicts between PM, CSV, Green Button, and manual data

- `src/server/compliance/source-reconciliation.ts:16-21` gives Quoin a local arbitration policy.
- `src/server/compliance/source-reconciliation.ts:181-191` maps `ESPM_SYNC` to canonical source system `PORTFOLIO_MANAGER`.
- `src/server/compliance/source-reconciliation.ts:211-217` chooses the canonical source locally using that priority order.

This is the strongest evidence that Quoin is supposed to sit **above** multiple source systems, including ESPM, rather than merely mirror one of them.

### Correctness audit

#### Safe as-is

- **Quoin-governed compliance artifacts are correctly local.**
  - `prisma/schema.prisma:1251-1343`
  - `src/server/compliance/compliance-engine.ts:298-387`
  - `src/server/compliance/benchmarking.ts:51-120`
  - `src/server/compliance/benchmark-packets.ts:196-207,465-485`
- **Source reconciliation is conceptually correct.**
  - `src/server/compliance/source-reconciliation.ts:16-21,181-217`
- **The newer PM setup/usage architecture is internally coherent.**
  - `src/server/portfolio-manager/setup.ts:168-258`
  - `src/server/portfolio-manager/meter-setup.ts:67-153,532-567,1036-1115`
  - `src/server/portfolio-manager/usage.ts:753-883,904-1015`
- **Existing-account property import is intentionally narrow and operationally appropriate.**
  - `src/server/portfolio-manager/existing-account.ts:1058-1124`

#### Needs cleanup

- **Two PM operating models coexist in the UI and server surface.**
  - Legacy PM sync/push is still exposed from `src/server/trpc/routers/benchmarking.ts:92-141`.
  - The Workflow tab still shows `PM sync state` in `src/components/building/benchmarking-tab.tsx:193-223`.
  - The newer authoritative PM lifecycle lives in `src/components/building/portfolio-manager-setup-panel.tsx:881` and `src/components/building/secondary-tools-tab.tsx:191`.
- **`Building.espmPropertyId` and `Meter.espmMeterId` are reasonable linkage fields, but they live inside otherwise canonical local entities.**
  - `prisma/schema.prisma:700-823`
  - That is acceptable only if local building and meter structure stays authoritative. The legacy sync path currently violates that assumption.
- **Packets still report legacy sync diagnostics, not the newer PM setup/usage state.**
  - `src/server/compliance/benchmark-packets.ts:473-482`

#### Likely incorrect

- **Legacy PM sync overwrites core local building metadata from ESPM.**
  - `src/server/compliance/portfolio-manager-sync-reliable.ts:922-942`
  - This is incompatible with Quoin being the governed local compliance system, because `grossSquareFeet` and `yearBuilt` are direct compliance inputs in `src/server/compliance/compliance-engine.ts:300-313` and `src/server/compliance/benchmarking-core.ts:304-315`.
- **Legacy PM sync auto-mirrors remote PM meters into local canonical `Meter` rows while the newer PM architecture says local meters are canonical and PM linkage is explicit.**
  - Mirror behavior: `src/server/compliance/portfolio-manager-sync-reliable.ts:1015-1025`
  - Canonical-linkage model: `src/server/portfolio-manager/meter-setup.ts:532-567,1036-1115,1456-1525`
- **Legacy PM sync creates local `ComplianceSnapshot` records directly from PM metrics and then immediately upserts `BenchmarkSubmission`.**
  - `src/server/compliance/portfolio-manager-sync-reliable.ts:1376-1402,1443-1460`
  - This collapses integration runtime, local metric mirroring, and governed compliance workflow into one job. For DC compliance operations, that layering is wrong.
- **Legacy PM push chaining straight back into legacy PM sync makes the usage lifecycle non-explicit.**
  - `src/server/compliance/portfolio-manager-push.ts:427-627`
- **`PortfolioManagerSyncState` is overloaded.**
  - Schema: `prisma/schema.prisma:1757-1773`
  - It is simultaneously storing runtime status, retry metadata, source metadata, sync metadata, and QA payload.
  - The same object is then used for building UI, packet exports, operational attention, and legacy benchmarking surfaces.
- **There are two different PM caller identities depending on PM mode, and the product does not express that difference clearly.**
  - env/provider client: `src/server/integrations/espm/index.ts:27-40`
  - direct user credentials: `src/server/portfolio-manager/existing-account.ts:650-680,821-846`
  - This is not necessarily a bug, but it is architecturally significant and currently under-explained.

### Bottom-line judgment

For DC benchmarking/compliance operations, the **newer layering is coherent** and the **legacy sync/autopilot layering is not**.

The repo already contains the right product direction:

- Quoin-governed compliance state
- local source reconciliation
- explicit PM setup/meter/usage/metrics lifecycle

But the old PM sync/push path still cuts across that model and turns ESPM into a partial shadow authority over local building data, meter structure, snapshots, and even benchmark submissions. That is the main architectural problem.

## Source-of-Truth Matrix

| Area | Source of truth | Why / current write-read paths | Boundary quality |
| --- | --- | --- | --- |
| Property identity | **Shared** | Quoin owns the local building id; ESPM owns the PM property id. Linkage is stored on `Building.espmPropertyId` in `prisma/schema.prisma:700-723`. Existing-account import and managed provisioning both write that linkage in `src/server/portfolio-manager/existing-account.ts:1107-1124` and `src/server/portfolio-manager/managed-provisioning.ts:592-610`. | **Clean enough** |
| Building metadata | **Unclear** | Local `Building` is used by compliance in `src/server/compliance/compliance-engine.ts:300-313`, but legacy sync overwrites `grossSquareFeet` and `yearBuilt` from PM in `src/server/compliance/portfolio-manager-sync-reliable.ts:922-942`. | **Ambiguous** |
| Gross floor area | **Unclear** | Quoin uses `Building.grossSquareFeet` for readiness/compliance in `src/server/compliance/compliance-engine.ts:308` and `src/server/compliance/benchmarking-core.ts:314-315`. New PM setup also uses local GSF in `src/server/portfolio-manager/setup.ts:247-258`. Legacy sync still overwrites it from PM. | **Ambiguous** |
| Property use breakdown | **Shared** | Quoin stores intended PM-use inputs locally in `PortfolioManagerPropertyUseInput` and evaluates them from local building fields in `src/server/portfolio-manager/setup.ts:237-280`. PM remains the remote home of actual PM property-use objects applied through setup. | **Mostly clean** |
| Meter roster | **Unclear** | New meter setup treats local meters as canonical with explicit linkage state in `src/server/portfolio-manager/meter-setup.ts:532-567,1036-1115`, but legacy sync auto-creates and updates local `Meter` rows from PM in `src/server/compliance/portfolio-manager-sync-reliable.ts:1015-1025`. | **Architecturally muddy** |
| Utility consumption history | **Quoin** | Compliance, readiness, and source reconciliation operate on local `EnergyReading` rows in `src/server/compliance/compliance-engine.ts:315-333` and `src/server/compliance/source-reconciliation.ts:181-217`. PM import lands as `ESPM_SYNC`, and push excludes `ESPM_SYNC` in `src/server/portfolio-manager/usage.ts:753-883` and `src/server/compliance/portfolio-manager-push.ts:76,263`. | **Clean in the new model; muddied by legacy sync** |
| ENERGY STAR metrics / scores | **ESPM** | Raw PM metrics come from ESPM metrics APIs. New usage runtime caches them in `PortfolioManagerUsageState.latestMetricsJson` in `src/server/portfolio-manager/usage.ts:656-671,1407-1441`. Legacy sync also copies them into `ComplianceSnapshot` in `src/server/compliance/portfolio-manager-sync-reliable.ts:1376-1402`. | **Input is clean; local landing zone is ambiguous** |
| Benchmark submission readiness | **Quoin** | Readiness is evaluated locally in `src/server/compliance/benchmarking-core.ts:508-538` and `src/server/compliance/benchmarking.ts:51-120`. PM linkage is a dependency, not the decision-maker. | **Clean** |
| Verification evidence | **Quoin** | `SourceArtifact` and `EvidenceArtifact` are local governed objects in `prisma/schema.prisma:1251-1311`. Compliance and packets read them locally in `src/server/compliance/compliance-engine.ts:335-380` and `src/server/compliance/benchmark-packets.ts:196-207,373-413`. | **Clean** |
| Packet generation | **Quoin** | Packet assembly is local and governed in `src/server/compliance/benchmark-packets.ts:196-207,465-485`. PM only contributes linkage/sync diagnostics. | **Clean** |
| Submission workflow state | **Quoin** | `BenchmarkSubmission` is local in `prisma/schema.prisma:1313-1343`, and workflow state is reconciled in packet/submission flows in `src/server/compliance/benchmark-packets.ts` and related submission workflow code. | **Clean** |
| Audit / provenance history | **Quoin** | Audit logs, source artifacts, evidence artifacts, and benchmark submissions are local models in `prisma/schema.prisma:1251-1343` and `Building.auditLogs` in `prisma/schema.prisma:767`. | **Clean** |
| Canonical compliance decision | **Quoin** | The compliance engine and submission upsert path are local in `src/server/compliance/compliance-engine.ts:298-387` and `src/server/compliance/benchmarking.ts:51-120`. | **Clean** |

## Target Architecture

### Clean relationship model

Quoin should be the **governed local compliance operating system**. ESPM should be treated as:

- the external benchmarking workspace
- the remote home of PM-specific entities and associations
- the upstream source of PM metrics/scores
- one of several upstream utility-data sources, not the master record for Quoin compliance state

### What must remain in ESPM

- PM property ids and PM meter ids
- PM property-use objects and PM property-to-meter associations
- PM sharing/access state
- PM-native metrics/scores and score-eligibility reasons

Relevant code paths:

- `src/server/integrations/espm/*`
- `src/server/portfolio-manager/managed-provisioning.ts`
- `src/server/portfolio-manager/meter-setup.ts`
- `src/server/portfolio-manager/usage.ts`

### What must exist only in Quoin

- Local building identity and DC-specific identity (`doeeBuildingId`)
- Canonical reconciled meter roster used for compliance operations
- Canonical reconciled utility-consumption history
- Source-reconciliation outcomes
- Evidence and provenance chain
- Benchmark readiness
- Benchmark submission
- Packet generation
- Submission workflow state
- Canonical compliance decision

Relevant code paths:

- `prisma/schema.prisma:700-823,1251-1343`
- `src/server/compliance/source-reconciliation.ts`
- `src/server/compliance/compliance-engine.ts`
- `src/server/compliance/benchmarking.ts`
- `src/server/compliance/benchmark-packets.ts`

### What can be mirrored or cached in Quoin

- PM property preview cache for existing-account import
  - `src/server/portfolio-manager/existing-account.ts:662-680`
- PM metrics cache for operational use
  - `src/server/portfolio-manager/usage.ts:1407-1441`
- PM runtime/health and linkage summaries
  - `PortfolioManagerManagement`, `PortfolioManagerProvisioningState`, `PortfolioManagerSetupState`, `PortfolioManagerUsageState`

These should be treated as **integration runtime state**, not governed compliance state.

### What should never be edited locally

- Raw PM metrics values as if Quoin authored them
- PM share/access state
- PM remote entity ids

Quoin may cache these, but it should not pretend to author them.

### What should never be edited remotely as a side effect of readiness or compliance evaluation

- `BenchmarkSubmission`
- `EvidenceArtifact`
- `BenchmarkPacket`
- local submission workflow state

These are Quoin-governed and should stay fully local.

### What should be versioned and governed in Quoin regardless of ESPM

- readiness findings
- compliance decisions
- evidence selection
- packet content
- filing workflow
- provenance/audit history

## Remediation Plan

### 1. Make the newer `src/server/portfolio-manager/*` lifecycle authoritative

Keep:

- org PM mode and connection state
- managed provisioning
- existing-account import
- explicit PM setup
- explicit PM meter linkage
- explicit PM usage push/import
- explicit PM metrics cache

The repo already has this architecture in:

- `src/server/portfolio-manager/setup.ts`
- `src/server/portfolio-manager/meter-setup.ts`
- `src/server/portfolio-manager/usage.ts`
- `src/server/portfolio-manager/setup-summary.ts`

### 2. Demote legacy PM sync from "authority" to "legacy diagnostic/import helper"

Smallest high-leverage change:

- stop legacy PM sync from overwriting local `Building` metadata
- stop legacy PM sync from auto-mirroring PM meters into canonical local `Meter`
- stop legacy PM sync from creating `ComplianceSnapshot`
- stop legacy PM sync from calling `evaluateAndUpsertBenchmarkSubmission(...)`

The integration job may still exist temporarily for diagnostics or compatibility, but it should no longer mutate governed compliance state.

Main files:

- `src/server/compliance/portfolio-manager-sync-reliable.ts`
- `src/server/compliance/portfolio-manager-sync.ts`
- `src/server/compliance/portfolio-manager-push.ts`

### 3. Narrow `PortfolioManagerSyncState` to integration runtime only, or deprecate it

Today it stores runtime, source metadata, sync metadata, and QA payload all together in `prisma/schema.prisma:1757-1773`.

Smallest fix:

- remove its role in benchmark workflow surfaces
- remove its role in packet exports as the primary PM status signal
- keep it only as backward-compatible legacy runtime state until the migration is complete

Longer-term:

- fold any needed surviving diagnostics into the newer PM setup/usage read models

### 4. Treat local building/meter/readings as canonical once linked

After import/provisioning:

- `Building.espmPropertyId` should remain a linkage field, not a permission for PM to overwrite local compliance inputs
- `Meter.espmMeterId` should remain a linkage field, not a signal that PM owns the local meter roster
- `EnergyReading` should remain the canonical local usage table, with PM represented as one source among many

Main files:

- `prisma/schema.prisma:700-823`
- `src/server/portfolio-manager/meter-setup.ts`
- `src/server/portfolio-manager/usage.ts`
- `src/server/compliance/source-reconciliation.ts`

### 5. Clean the product language so PM state means one thing

Remove or isolate legacy "PM sync" language from the benchmark workflow path:

- `src/server/trpc/routers/benchmarking.ts:92-141`
- `src/components/building/benchmarking-tab.tsx:193-223`

Make the visible PM operational model consistently:

- connection / provisioning
- setup
- usage
- metrics

### 6. Keep existing-account and Quoin-managed PM modes, but document the caller identity difference explicitly

The code can support both:

- provider/env client for Quoin-managed mode
- direct stored user credentials for existing-account mode

But the product and architecture docs must explicitly acknowledge that these are different API-caller models with different permission expectations:

- `src/server/integrations/espm/index.ts:27-40`
- `src/server/portfolio-manager/existing-account.ts:650-680,821-846`

### Final recommendation

The smallest correct refactor is **not** to rewrite the entire PM integration. It is to:

1. preserve the newer PM lifecycle,
2. stop the legacy PM sync path from mutating governed compliance state,
3. make Quoin's local compliance/evidence/submission pipeline the only decision authority,
4. treat PM as a linked external system plus metrics source, not as a shadow master for local compliance inputs.
