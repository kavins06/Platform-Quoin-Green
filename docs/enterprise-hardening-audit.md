# Enterprise Hardening Audit

## Executive Judgment

Quoin is directionally strong but still in a transition state. The intended architecture is now clear in code: the governed Portfolio Manager workflow lives in `src/server/portfolio-manager/*`, where Quoin owns local building creation, PM setup, meter linkage, reconciliation-aware usage import/push, and operator-facing review. That newer direction is visible in `src/server/portfolio-manager/existing-account.ts`, `src/server/portfolio-manager/meter-setup.ts`, `src/server/portfolio-manager/usage.ts`, `src/components/dashboard/espm-connect-card.tsx`, and `src/components/building/portfolio-manager-setup-panel.tsx`.

Wave 1 removed the active operator-facing legacy PM retry path from `src/server/compliance/operator-controls.ts`, `src/server/trpc/routers/building.ts`, `src/components/building/secondary-tools-tab.tsx`, and `src/components/dashboard/compliance-queue.tsx`. Wave 2 removes the remaining public legacy PM sync/push mutations from `src/server/trpc/routers/benchmarking.ts` and renames the surviving read surface to explicit benchmark-compatibility semantics.

The codebase is now materially cleaner, but it still carries a compatibility-only legacy PM layer in:

- `src/server/compliance/portfolio-manager-sync.ts`
- `src/server/compliance/portfolio-manager-sync-reliable.ts`
- `src/server/compliance/portfolio-manager-push.ts`
- `src/server/trpc/routers/benchmarking.ts`

That layer can remain temporarily only because current benchmarking surfaces still read `PortfolioManagerSyncState`-backed compatibility data. It should not be expanded further.

## Severity-Ordered Findings

### High

1. **Legacy PM compatibility still underpins current benchmarking read models**
   - `src/server/trpc/routers/benchmarking.ts`
   - `src/components/building/benchmarking-tab.tsx`
   - `src/components/building/energy-tab.tsx`
   - `src/components/settings/settings-page.tsx`
   - Why it matters:
     - Current product flows no longer use legacy PM sync/push as actions, but benchmarking and settings still read compatibility state derived from the old shadow-sync layer.
     - That is acceptable only as an explicitly named compatibility boundary.
     - Any future work that treats this layer as the primary PM workflow would reopen the two-architecture problem.

2. **Legacy PM shadow-sync still mutates governed local state**
   - `src/server/compliance/portfolio-manager-sync.ts`
   - `src/server/compliance/portfolio-manager-sync-reliable.ts`
   - `src/server/compliance/portfolio-manager-push.ts`
   - Why it matters:
     - The compatibility path still imports PM structure, writes `ESPM_SYNC` readings, builds compatibility QA payloads, creates snapshots, and upserts benchmark submissions.
     - That is exactly why it must remain isolated and clearly labeled until benchmarking is fully re-based.
     - It should not be allowed to look like a generic integration utility.

### Medium

3. **Repo knowledge still taught the wrong PM model**
   - `docs/archive/backend-system-explanation-legacy.md`
   - `docs/architecture.md`
   - Why it matters:
     - The repo previously taught PM sync/push as the default model.
     - That would mislead future work toward the wrong boundary and reintroduce shadow-sync thinking.

4. **Current settings and benchmarking surfaces still need explicit compatibility framing**
   - `src/components/building/benchmarking-tab.tsx`
   - `src/components/settings/settings-page.tsx`
   - Why it matters:
     - These surfaces are legitimate, but they are reading compatibility state rather than the current PM setup/usage runtime.
     - The product must not imply those screens are the main PM workflow.

5. **The active UI architecture test suite is still source-string heavy**
   - `test/unit/consultant-ui.test.ts`
   - Why it matters:
     - The suite is now repo-relative and useful as a guardrail, but it still verifies implementation strings more often than behavior.
     - That is acceptable for architecture smoke coverage, but it should not become the dominant testing style.

### Low

6. **The repo root still contains one-off rewrite/fix scripts with unclear ownership**
   - `C:\Quoin\fix-*.js`
   - `C:\Quoin\flatten*.js`
   - historical root codemod scripts
   - Why it matters:
     - They look like historical repo surgery, not supported tooling.
     - They remain strong deletion candidates after one final reference audit.

7. **Deprecated financing models still add noise to the main schema**
   - `prisma/schema.prisma`
   - Why it matters:
     - They are not the highest-risk issue, but they still burden the core domain model.

## Keep / Clean Up / Delete / Defer Matrix

| Area | Decision | Why |
| --- | --- | --- |
| `src/server/portfolio-manager/existing-account.ts` | Keep | Correct org-level connection/import model. |
| `src/server/portfolio-manager/meter-setup.ts` | Keep | Correct explicit PM setup/linkage model. |
| `src/server/portfolio-manager/usage.ts` | Keep | Correct explicit PM usage import/push model with review/readiness. |
| `src/components/dashboard/espm-connect-card.tsx` | Keep | Correct dashboard-first PM entry point. |
| `src/components/building/portfolio-manager-setup-panel.tsx` | Keep | Correct building-level PM workspace. |
| `src/server/trpc/routers/benchmarking.ts` | Clean up | Keep only explicit benchmark-compatibility reads; do not expose legacy sync/push mutations. |
| `src/components/building/benchmarking-tab.tsx` | Clean up | Legitimate compatibility surface, but it must stay clearly separate from the main PM workflow. |
| `src/components/settings/settings-page.tsx` | Clean up | Same as above; current PM runtime belongs elsewhere. |
| `src/components/building/energy-tab.tsx` | Clean up | Still needs compatibility invalidations until benchmarking is re-based. |
| `src/server/compliance/portfolio-manager-sync*.ts` | Defer / isolate | Compatibility-only until annual benchmarking no longer depends on `PortfolioManagerSyncState`. |
| `src/server/compliance/portfolio-manager-push.ts` | Defer / isolate | Same as above. |
| `test/integration/portfolio-manager-benchmark-compatibility.test.ts` | Keep but narrow | Valid only as compatibility coverage, not as product-direction coverage. |
| historical root `fix*.js`, `flatten*.js`, `rewrite-dashboard.js`, `deep-distill.js`, `normalize.js`, `quiet.js`, `typeset.js` | Delete later | Strong trash candidates after a final safety pass. |
| deprecated financing models in `prisma/schema.prisma` | Defer | Historical data risk is higher than the immediate cleanup gain. |

## Trash Inventory

### Removed from active product

- `building.retryPortfolioManagerSync` and the related legacy PM retry branch
- `RETRY_PORTFOLIO_MANAGER_SYNC` bulk operator action
- public benchmarking-router mutations for legacy PM sync/push
- stale user-facing PM wording that framed the current product like an autopilot

### Compatibility-only now

- `src/server/compliance/portfolio-manager-sync.ts`
- `src/server/compliance/portfolio-manager-sync-reliable.ts`
- `src/server/compliance/portfolio-manager-push.ts`
- `src/server/trpc/routers/benchmarking.ts` legacy benchmark-compatibility queries
- `test/integration/portfolio-manager-benchmark-compatibility.test.ts`

### Strong delete candidates

- root one-off rewrite/fix scripts with no package-level contract
- any remaining docs or comments that still present PM sync/push as the current default model

## Target Architecture Going Forward

Quoin should continue on this model:

- **Quoin is the governed local system of record for compliance operations, canonical utility data, reconciliation, readiness, submissions, packet generation, and auditability.**
- **ESPM is an external benchmarking workspace and integration target, not the owner of Quoin-local workflow state.**
- **The current PM workflow lives in `src/server/portfolio-manager/*`.**
  - Org connection/import: `existing-account.ts`
  - Building setup and meter linkage: `setup.ts`, `meter-setup.ts`
  - Usage import/push and review: `usage.ts`
- **Legacy PM sync/push must remain compatibility-only until benchmarking no longer depends on `PortfolioManagerSyncState`.**
- **Primary product surfaces should point operators to the governed PM workflow, not to shadow-sync controls or compatibility state.**

## Recommended Wave Plan

### Wave 1: Remove active legacy PM controls and rough product language
- Completed.

### Wave 2: Isolate the remaining legacy PM compatibility layer
- Completed in this pass.
- Removed public legacy PM sync/push mutations from `src/server/trpc/routers/benchmarking.ts`.
- Renamed the remaining benchmarking read surface to explicit compatibility semantics.
- Retitled the surviving integration test to compatibility-only coverage.
- Updated stale backend knowledge so the newer governed PM model is the default.

### Wave 3: Retire benchmarking’s dependence on legacy PM compatibility state
- Replace `PortfolioManagerSyncState`-driven benchmarking compatibility reads with a read model derived from the newer PM runtime and governed local data.
- Remove `src/server/compliance/portfolio-manager-sync*.ts` and `src/server/compliance/portfolio-manager-push.ts` once benchmarking no longer depends on them.
- Remove remaining compatibility invalidations from `src/components/building/energy-tab.tsx`.

### Wave 4: Delete proven repo trash and de-noise the schema/tooling surface
- Final reference audit for root rewrite/fix scripts, then delete or relocate.
- Decide archival strategy for deprecated financing models.
- Continue converting source-string architecture tests into more behavioral coverage where practical.
