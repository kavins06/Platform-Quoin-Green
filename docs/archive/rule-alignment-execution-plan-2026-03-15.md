# Rule Alignment Execution Plan

Date: 2026-03-15

Companion document:
- [C:\Quoin\docs\rule-gap-checklist-2026-03-15.md](/C:/Quoin/docs/rule-gap-checklist-2026-03-15.md)

Source documents:
- `C:\Users\kavin\Downloads\Normalization rule.pdf`
- `C:\Users\kavin\Downloads\Source of Truth.pdf`

## Objective

Bring Quoin's governed benchmarking and BEPS rules into alignment with the two source documents without redesigning the architecture.

This plan assumes the PDFs are the intended product source of truth for:
- benchmarking applicability and deadline logic
- benchmarking verification cadence
- BEPS cycle start thresholds and trajectory availability dates

## Scope

In scope:
- governed rule/factor data changes
- evaluator wiring changes where current code does not consume the needed governed values
- regression tests
- fresh-db validation updates

Out of scope:
- major architecture changes
- Cycle 3 full feature expansion beyond what is required to truthfully represent support status
- UI redesign

## Current state

Already solid:
- BEPS Cycle 1 formula logic
- BEPS Cycle 1 applicability thresholds
- Cycle 1 special-case timing
- district 10k BEPS applicability
- multi-cycle registry structure
- trajectory pathway code path

Main gaps:
- benchmarking rules are still bootstrap-level, not source-of-truth codified
- Cycle 2 private threshold is still 50k instead of 25k
- trajectory start timing is seeded as 2027 instead of 2028
- Cycle 3 rule support is absent

## Delivery phases

### Phase 1: Benchmarking source-of-truth codification

Goal:
- Replace bootstrap benchmarking assumptions with governed rules that match the PDFs.

Work items:
1. Expand benchmarking governed config shape in [C:\Quoin\prisma\seed.ts](/C:/Quoin/prisma/seed.ts) to include:
   - private benchmarking applicability bands
   - district/public benchmarking applicability bands
   - private due date rule
   - district/public due date rule
   - verification cadence rule
   - non-benchmarkable public/manual path flags if supported by current workflows

2. Update [C:\Quoin\src\server\compliance\benchmarking.ts](/C:/Quoin/src/server/compliance/benchmarking.ts) to consume governed fields for:
   - ownership-aware applicability
   - size-band behavior
   - verification requirement determination
   - deadline metadata surfaced in outputs

3. Preserve current deterministic checks:
   - full-calendar-year coverage
   - overlap detection
   - PM linkage
   - DQC freshness
   - evidence checks

4. Add or update output metadata so downstream views can distinguish:
   - private May 1 submission expectation
   - district/public 60-day submission expectation

Acceptance criteria:
- Benchmarking readiness is driven by governed ownership/size/deadline/verification rules.
- 10k-24,999 private, 25k-49,999 private, 50k+ private, and 10k+ district/public cases evaluate differently where the PDFs require it.
- No hardcoded `[2025]` verification-year bootstrap remains.

Target files:
- [C:\Quoin\prisma\seed.ts](/C:/Quoin/prisma/seed.ts)
- [C:\Quoin\src\server\compliance\benchmarking.ts](/C:/Quoin/src/server/compliance/benchmarking.ts)
- [C:\Quoin\scripts\validate-fresh-db.mjs](/C:/Quoin/scripts/validate-fresh-db.mjs)
- Benchmarking unit/integration tests under [C:\Quoin\test](/C:/Quoin/test)

### Phase 2: Align Cycle 2 BEPS thresholds and dates

Goal:
- Make Cycle 2 governance match the documents.

Work items:
1. Change Cycle 2 private applicability threshold in [C:\Quoin\prisma\seed.ts](/C:/Quoin/prisma/seed.ts):
   - from `50000`
   - to `25000`

2. Align Cycle 2 effective timing:
   - `cycleStartYear`
   - factor effective date
   - registry dates
   - trajectory target years
   - trajectory availability date

3. Confirm current resolver logic in:
   - [C:\Quoin\src\server\compliance\beps\config.ts](/C:/Quoin/src/server/compliance/beps/config.ts)
   - [C:\Quoin\src\server\compliance\beps\applicability.ts](/C:/Quoin/src/server/compliance/beps/applicability.ts)
   - [C:\Quoin\src\server\compliance\beps\cycle-registry.ts](/C:/Quoin/src/server/compliance/beps/cycle-registry.ts)
   can consume corrected data without formula changes

Acceptance criteria:
- Private 25k-49,999 buildings become Cycle 2 BEPS-covered.
- Trajectory pathway availability aligns with the governed cycle start date from the documents.
- Existing Cycle 1 behavior remains unchanged.

Target files:
- [C:\Quoin\prisma\seed.ts](/C:/Quoin/prisma/seed.ts)
- [C:\Quoin\src\server\compliance\beps\config.ts](/C:/Quoin/src/server/compliance/beps/config.ts)
- [C:\Quoin\src\server\compliance\beps\cycle-registry.ts](/C:/Quoin/src/server/compliance/beps/cycle-registry.ts)
- BEPS tests under [C:\Quoin\test](/C:/Quoin/test)

### Phase 3: Decide and represent Cycle 3 truthfully

Goal:
- Remove ambiguity about Cycle 3 support.

Decision required:
- Either implement minimum governed Cycle 3 records now, or explicitly keep it unsupported and document that the PDF rule is known but not yet active in Quoin.

Option A: minimum governed Cycle 3 support
- Add:
  - rule package
  - rule version
  - factor set version
  - cycle registry entry
- Seed only enough to represent:
  - private 10k start at 2034
  - any other fields needed for clean fail-fast or future activation

Option B: explicit unsupported posture
- Keep `CYCLE_3` unsupported in runtime behavior
- Add explicit metadata/tests/documentation so Quoin does not imply full implementation

Recommended approach:
- Option B unless product requires immediate Cycle 3 activation.

Acceptance criteria:
- The product does not overstate Cycle 3 support.
- Tests clearly assert the expected runtime behavior.

Target files:
- [C:\Quoin\prisma\seed.ts](/C:/Quoin/prisma/seed.ts)
- [C:\Quoin\src\server\compliance\beps\config.ts](/C:/Quoin/src/server/compliance/beps/config.ts)
- [C:\Quoin\src\server\compliance\beps\cycle-registry.ts](/C:/Quoin/src/server/compliance/beps/cycle-registry.ts)
- BEPS tests under [C:\Quoin\test](/C:/Quoin/test)

### Phase 4: Regression coverage

Goal:
- Prevent drift back to bootstrap assumptions.

Required tests:
1. Benchmarking
   - private 10k-24,999 case
   - private 25k-49,999 case
   - private 50k+ case
   - district/public 10k+ case
   - verification cadence year hit and non-hit
   - due-date metadata correct for private vs district/public

2. BEPS
   - private 25k building not applicable in Cycle 1, applicable in Cycle 2
   - trajectory available on correct cycle/date
   - district 10k still applicable
   - unsupported Cycle 3 behavior remains explicit if not implemented

3. Fresh DB
   - seeded governed rule packages and factor sets reflect updated source-of-truth values

Acceptance criteria:
- Tests fail if thresholds or dates revert to pre-alignment values.

Target files:
- [C:\Quoin\test\unit\beps-multi-cycle.test.ts](/C:/Quoin/test/unit/beps-multi-cycle.test.ts)
- benchmarking-related tests in [C:\Quoin\test](/C:/Quoin/test)
- [C:\Quoin\scripts\validate-fresh-db.mjs](/C:/Quoin/scripts/validate-fresh-db.mjs)

### Phase 5: Surface governance clearly

Goal:
- Make it obvious in outputs which governed rule was applied.

Work items:
1. Ensure readiness/evaluation result payloads expose:
   - rule package/version used
   - factor set version used
   - ownership class used
   - size-band/threshold used
   - deadline metadata where applicable

2. Ensure reports or admin views do not imply unsupported rules are active.

Acceptance criteria:
- Product/debug outputs are auditable enough to explain why a building is in or out of scope.

Target files:
- [C:\Quoin\src\server\compliance\benchmarking.ts](/C:/Quoin/src/server/compliance/benchmarking.ts)
- [C:\Quoin\src\server\compliance\beps\types.ts](/C:/Quoin/src/server/compliance/beps/types.ts)
- relevant routers under [C:\Quoin\src\server\trpc\routers](/C:/Quoin/src/server/trpc/routers)

## Implementation sequence

Recommended order:
1. Phase 1
2. Phase 2
3. Phase 4
4. Phase 5
5. Phase 3 decision closeout

Reasoning:
- Benchmarking is the largest governance gap.
- Cycle 2 threshold/date corrections are narrow and high-value.
- Regression coverage should land immediately after behavior changes.

## Risks

1. Benchmarking workflow semantics
- The PDFs define deadlines and applicability more precisely than the current readiness engine.
- Risk: accidentally mixing readiness checks with submission-deadline logic without keeping concepts separate.

Mitigation:
- Keep readiness evaluation and deadline metadata distinct.

2. Cycle 2 change impact
- Lowering the private threshold to 25k will change applicability outcomes for existing seeded and tenant data.

Mitigation:
- Add targeted applicability tests and verify seeded demo buildings explicitly.

3. Overstating Cycle 3 support
- Adding config references without full support is misleading.

Mitigation:
- Either seed full minimum governed support or keep explicit unsupported behavior.

## Validation plan

Run after each phase and once at the end:
- `npx prisma validate`
- `npx prisma generate`
- `npm run db:validate:fresh`
- `npm run test:unit`
- `npm run test:integration:db`
- `npm run typecheck`
- `npm run build`

## Delivery checklist

- [ ] Benchmarking governed rules match the PDFs
- [ ] Verification cadence matches the PDFs
- [ ] Private benchmarking due date rule is governed
- [ ] District/public benchmarking deadline rule is governed
- [ ] Cycle 2 private threshold changed to 25k if the PDFs govern product behavior
- [ ] Trajectory availability date aligned
- [ ] Cycle 3 support posture is explicit
- [ ] Regression tests cover the document rules
- [ ] Fresh DB validation proves the governed records exist
- [ ] Result payloads expose the applied governed rule context

## Final success condition

Quoin can truthfully say:
- benchmarking and BEPS applicability/timing rules implemented in the platform match the two source documents for the supported cycles
- unsupported cycles or not-yet-codified rules are explicit rather than implicit
