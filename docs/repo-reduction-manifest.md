# Repository Reduction Manifest

This manifest drives the benchmarking-only cleanup.

Decision meanings:

- `keep`: active benchmarking runtime, UI, docs, and tests
- `delete`: out-of-scope product code and direct dependents
- `hold`: transitional code still backing retained benchmarking workflows

## `src/app`

| Domain | Path / glob | Decision | Reason | Blocking dependency |
| --- | --- | --- | --- | --- |
| Dashboard routes | `src/app/(dashboard)/dashboard/**`, `src/app/(dashboard)/buildings/**`, `src/app/(dashboard)/settings/**` | keep | Active benchmark portfolio, buildings, and settings surfaces | |
| Generic reports page | `src/app/(dashboard)/reports/**` | delete | Broad reporting product surface is out of scope | |
| Onboarding | `src/app/(onboarding)/**` | keep | Active organization and ESPM onboarding | |
| Green Button API | `src/app/api/green-button/**` | keep | Active ingestion path | |

## `src/components`

| Domain | Path / glob | Decision | Reason | Blocking dependency |
| --- | --- | --- | --- | --- |
| Benchmark workflow UI | `src/components/building/benchmark-workbench-tab.tsx`, `src/components/building/benchmarking-tab.tsx`, `src/components/building/verification-requests-tab.tsx`, `src/components/building/decision-record-tab.tsx`, `src/components/building/artifact-workspace-panel.tsx` | keep | Core benchmarking execution, verification, and submission workflow | |
| Building operations UI | `src/components/building/beps-*.tsx`, `src/components/building/operations-tab.tsx`, `src/components/building/retrofit-tab.tsx`, `src/components/dashboard/portfolio-insights.tsx` | delete | BEPS, anomaly, and retrofit surfaces are out of scope | |
| Generic reports UI | `src/components/reports/**` | delete | Generic reporting and publication workspace is out of scope | |
| Portfolio/buildings/settings core | `src/components/dashboard/**`, `src/components/layout/**`, `src/components/settings/**` | keep | Active benchmark-facing portfolio and settings UI | |
| Shared admin/status primitives | `src/components/internal/**` | hold | Some copy and helpers still reference legacy penalty or BEPS language | Needs benchmark-only copy pass |
| Add building form | `src/components/onboarding/building-form.tsx`, `src/components/onboarding/beps-targets.ts` | hold | Runtime still persists benchmark target fields that were originally BEPS-derived | Needs building schema/input narrowing |

## `src/server`

| Domain | Path / glob | Decision | Reason | Blocking dependency |
| --- | --- | --- | --- | --- |
| Portfolio Manager | `src/server/portfolio-manager/**`, `src/server/integrations/espm/**`, `src/server/integrations/green-button/**` | keep | Active PM connection, sync, and ingestion boundaries | |
| Benchmark runtime | `src/server/compliance/benchmarking*.ts`, `src/server/compliance/verification-engine.ts`, `src/server/compliance/source-reconciliation.ts`, `src/server/compliance/submission-workflows.ts`, `src/server/compliance/compliance-artifacts.ts`, `src/server/compliance/data-issues.ts` | keep | Core governed benchmarking flow | |
| BEPS / retrofit / anomaly runtime | `src/server/compliance/beps/**`, `src/server/compliance/retrofit-optimization.ts`, `src/server/compliance/operations-anomalies.ts`, `src/server/compliance/financing-packets.ts`, `src/server/pipelines/capital-structuring/**` | delete | Deprecated product domains | |
| Public routers | `src/server/trpc/routers/portfolio-manager.ts`, `src/server/trpc/routers/benchmarking.ts`, `src/server/trpc/routers/building.ts`, `src/server/trpc/routers/organization.ts` | keep | Active public API | |
| Deprecated public routers | `src/server/trpc/routers/beps.ts`, `src/server/trpc/routers/operations.ts`, `src/server/trpc/routers/retrofit.ts`, `src/server/trpc/routers/report.ts` | delete | Out-of-scope public API | |
| Shared worklists and compatibility | `src/server/compliance/portfolio-worklist.ts`, `src/server/compliance/governed-operational-summary.ts`, `src/server/compliance/portfolio-manager-sync*.ts`, `src/server/compliance/portfolio-manager-push.ts` | hold | Benchmark runtime still reads compatibility data mixed with deprecated domains | Needs benchmark-only read model replacement |

## `prisma`

| Domain | Path / glob | Decision | Reason | Blocking dependency |
| --- | --- | --- | --- | --- |
| Active benchmark schema | benchmark, ESPM, ingestion, verification, artifact, submission, organization, building models | keep | Required runtime data model | |
| BEPS / retrofit / anomaly / financing models | deprecated BEPS, retrofit, operations-anomaly, financing, capital-stack models and their migrations | hold | Schema can only be removed after runtime code and tests stop depending on them | Needs runtime and test cleanup first |
| Seeds with deprecated domain data | BEPS, retrofit, financing seed records | hold | Seed still boots legacy models and benchmark-adjacent defaults together | Needs seed split after schema reduction |

## `test`

| Domain | Path / glob | Decision | Reason | Blocking dependency |
| --- | --- | --- | --- | --- |
| Benchmark-core tests | PM, ingestion, source reconciliation, benchmarking, verification, packet, submission, building/core auth tests | keep | Protect active product | |
| Deprecated-domain tests | `test/**/beps-*.test.ts`, `test/**/operations-anomalies.test.ts`, `test/**/retrofit-optimization.test.ts`, financing and generic reporting tests | delete | Out-of-scope domains | |
| Mixed omnibus tests | `test/unit/consultant-ui.test.ts`, `test/integration/portfolio-worklist.test.ts`, penalty-oriented tests | hold | Still assert both active benchmark behavior and deprecated domain behavior | Needs benchmark-only assertions rewrite |

## `docs` and `scripts`

| Domain | Path / glob | Decision | Reason | Blocking dependency |
| --- | --- | --- | --- | --- |
| Benchmark docs | `README.md`, `docs/architecture.md`, `docs/capability-map.md`, `docs/benchmarking-only-product-direction.md`, `docs/development.md` | keep | Active product direction and engineering docs | |
| Archived or full-product docs | legacy product docs, broad compliance docs, archive-only references | hold | Some still explain runtime compatibility or historical behavior | Needs doc prune after code cleanup |
| Cleanup/runtime helper scripts | benchmark runtime and db validation helpers | keep | Needed for local validation | |
| One-off rewrite/fix scripts | deprecated repo surgery scripts in root | delete | Not part of active benchmark product or runtime | |
