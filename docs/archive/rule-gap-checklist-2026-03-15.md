# Rule Gap Checklist

Date: 2026-03-15

Source documents reviewed:
- `C:\Users\kavin\Downloads\Normalization rule.pdf`
- `C:\Users\kavin\Downloads\Source of Truth.pdf`

Scope:
- Compare the rule statements in the two PDFs against Quoin's implemented governed rules, factor sets, and rule logic.
- Focus on benchmarking and BEPS applicability / timing / cycle logic.

Primary code reviewed:
- [prisma/seed.ts](/C:/Quoin/prisma/seed.ts)
- [src/server/compliance/benchmarking.ts](/C:/Quoin/src/server/compliance/benchmarking.ts)
- [src/server/compliance/provenance.ts](/C:/Quoin/src/server/compliance/provenance.ts)
- [src/server/compliance/beps/config.ts](/C:/Quoin/src/server/compliance/beps/config.ts)
- [src/server/compliance/beps/applicability.ts](/C:/Quoin/src/server/compliance/beps/applicability.ts)
- [src/server/compliance/beps/cycle-registry.ts](/C:/Quoin/src/server/compliance/beps/cycle-registry.ts)
- [src/server/compliance/beps/pathway-eligibility.ts](/C:/Quoin/src/server/compliance/beps/pathway-eligibility.ts)
- [src/server/compliance/beps/trajectory-pathway.ts](/C:/Quoin/src/server/compliance/beps/trajectory-pathway.ts)

## Summary

Quoin does not fully implement the rules in the two PDFs.

Current status:
- BEPS Cycle 1 is mostly implemented correctly.
- Benchmarking is operational, but its governed rule package is still a bootstrap workflow, not a full codification of the source-of-truth table.
- Cycle 2 and Cycle 3 start thresholds/dates from the PDFs are not fully aligned with current governed factors.

## Rule-by-rule status

### Normalization rule.pdf

| Rule key | Document rule | Status | Current implementation | Required change |
| --- | --- | --- | --- | --- |
| `private_benchmarking_due_date` | May 1 of year N+1 for prior calendar year N | Missing | No governed benchmarking due-date field exists. The readiness engine in [src/server/compliance/benchmarking.ts](/C:/Quoin/src/server/compliance/benchmarking.ts) evaluates data quality, coverage, PM share, and evidence only. | Add governed benchmarking deadline config to the active benchmarking rule/factor package and expose it in readiness / filing outputs. |
| `private_verification_years` | 2024, 2027, and every 6 years thereafter | Missing / incorrect | Seeded benchmarking config currently uses `requiredReportingYears: [2025]` in [prisma/seed.ts](/C:/Quoin/prisma/seed.ts). | Replace hardcoded bootstrap years with governed recurrence or explicit series aligned to the document. |
| `district_benchmarking_due_date` | Within 60 days of benchmark generation | Missing | No district/public-specific deadline logic exists in benchmarking config or evaluator. | Add district/public benchmarking deadline rule and branch readiness / reporting behavior by ownership type. |
| `beps_cycle1_special_case` | 2021 cohort has 6-year cycle ending 2026-12-31 | Implemented | Cycle 1 factors and cycle registry use 2021-2026 and deadline `2026-12-31` in [prisma/seed.ts](/C:/Quoin/prisma/seed.ts). | None for core date/cycle logic. |
| `beps_cycle2_start_private_25k` | 2028-01-01 | Missing / incorrect | Current Cycle 2 factor config still uses `minGrossSquareFeetPrivate: 50000` in [prisma/seed.ts](/C:/Quoin/prisma/seed.ts). | Change Cycle 2 governed applicability threshold for private buildings to `25000` effective `2028-01-01`. |
| `beps_cycle3_start_private_10k` | 2034-01-01 | Missing | Config has a `CYCLE_3` key reference in [src/server/compliance/beps/config.ts](/C:/Quoin/src/server/compliance/beps/config.ts), but there is no governed Cycle 3 rule package / factor set / registry. | Add Cycle 3 governed records before claiming support. |
| `trajectory_pathway_available_from` | cycle beginning 2028-01-01 | Partial / date-misaligned | Trajectory code exists in [src/server/compliance/beps/trajectory-pathway.ts](/C:/Quoin/src/server/compliance/beps/trajectory-pathway.ts), but Cycle 2 is currently seeded with `cycleStartYear: 2027`, targets in 2027-2028, and effective-from `2027-01-01` in [prisma/seed.ts](/C:/Quoin/prisma/seed.ts). | Align Cycle 2 cycle start / effective date / trajectory target years to the source document. |

### Source of Truth.pdf

| Ownership / size / program | Document rule | Status | Current implementation | Required change |
| --- | --- | --- | --- | --- |
| Private 10,000-24,999 / Benchmarking | Benchmarking covered; deadline May 1; verification cadence 2027 then every 6 years | Missing | No benchmarking size-band governance exists. Current readiness logic does not branch on private 10k-24,999. | Add governed benchmarking applicability tiers, deadlines, and verification cadence by ownership + size band. |
| Private 10,000-24,999 / BEPS | No BEPS yet; prepare for future coverage; cycle start 2034-01-01 | Missing | No Cycle 3 governed support exists. | Add Cycle 3 registry/rule/factor support when in scope. |
| Private 25,000-49,999 / Benchmarking | Benchmarking covered; deadline May 1; verification cadence 2024, 2027, then every 6 years | Missing | Current benchmarking rules do not encode this band as governed policy. | Add the band to governed benchmarking config and readiness logic. |
| Private 25,000-49,999 / BEPS | BEPS starts in 2028 | Missing / incorrect | Current Cycle 2 BEPS threshold remains private 50k+. | Lower Cycle 2 private threshold to 25k in governed factors and verify applicability tests. |
| Private 50,000+ / Benchmarking | Benchmarking covered; deadline May 1; verification cadence 2024, 2027, then every 6 years | Partial | Benchmarking workflow exists, but the exact source-of-truth deadline and verification cadence are not encoded correctly. | Replace bootstrap benchmarking config with governed values that match the table. |
| Private 50,000+ / BEPS | Already in BEPS Cycle 1 | Implemented | Cycle 1 private 50k+ applicability is encoded and used by [src/server/compliance/beps/applicability.ts](/C:/Quoin/src/server/compliance/beps/applicability.ts). | None for threshold logic. |
| District-owned / District instrumentality 10,000+ / Benchmarking | Covered; annual benchmarking; statements due within 60 days; manual benchmarking path if not benchmarkable | Missing | Ownership exists on buildings, but benchmarking logic does not encode district/public deadline or non-benchmarkable manual path behavior. | Add governed district/public benchmarking rules and model the non-benchmarkable/manual submission path. |
| District-owned / District instrumentality 10,000+ / BEPS | Already in BEPS since 2021 | Implemented | District 10k+ BEPS threshold is encoded in [src/server/compliance/beps/config.ts](/C:/Quoin/src/server/compliance/beps/config.ts) and applied in [src/server/compliance/beps/applicability.ts](/C:/Quoin/src/server/compliance/beps/applicability.ts). | None for threshold logic. |

## Concrete gaps by area

### Benchmarking

Status: partial implementation only.

What exists:
- full-calendar-year coverage checks
- no-overlap checks
- PM linkage checks
- DQC evidence freshness
- verification evidence presence
- GFA correction evidence presence

Where:
- [src/server/compliance/benchmarking.ts](/C:/Quoin/src/server/compliance/benchmarking.ts)
- benchmark bootstrap rule package in [prisma/seed.ts](/C:/Quoin/prisma/seed.ts)

What is missing:
- ownership-aware benchmarking applicability
- size-band governance
- May 1 private deadline rule
- 60-day district/public deadline rule
- verification recurrence from the source document
- explicit public/district non-benchmarkable manual process rule

### BEPS

Status: Cycle 1 strong, Cycle 2 partial, Cycle 3 absent.

What exists:
- Cycle 1 registry and factor set
- Cycle 2 registry and factor set
- pathway logic including trajectory
- district 10k threshold
- Cycle 1 special case timing

What is missing or misaligned:
- Cycle 2 private threshold should be 25k per the document, but is still 50k
- trajectory availability should align to 2028 start, but current factors start in 2027
- Cycle 3 start rule for private 10k is not implemented

## Exact files that need change if Quoin is to match the PDFs

### Benchmarking rule codification

- [prisma/seed.ts](/C:/Quoin/prisma/seed.ts)
  - replace bootstrap benchmarking dates / verification years with governed values from the PDFs
  - add size-band and ownership-aware benchmarking rules

- [src/server/compliance/benchmarking.ts](/C:/Quoin/src/server/compliance/benchmarking.ts)
  - consume governed benchmarking deadlines
  - branch verification and readiness logic by ownership + size band
  - represent district/public 60-day deadline behavior

- [src/server/compliance/provenance.ts](/C:/Quoin/src/server/compliance/provenance.ts)
  - only if benchmarking rule package/version structure needs new config fields surfaced in provenance outputs

### BEPS threshold/date alignment

- [prisma/seed.ts](/C:/Quoin/prisma/seed.ts)
  - set Cycle 2 private threshold to 25k if the document is the intended source of truth
  - align Cycle 2 start/effective dates and trajectory start to 2028 if that document governs the platform
  - add Cycle 3 governed records when in scope

- [src/server/compliance/beps/config.ts](/C:/Quoin/src/server/compliance/beps/config.ts)
  - likely no logic redesign needed; current resolver structure can consume corrected factor data

- [src/server/compliance/beps/applicability.ts](/C:/Quoin/src/server/compliance/beps/applicability.ts)
  - no formula rewrite likely needed; it should follow corrected factor data after seed/config updates

- [src/server/compliance/beps/cycle-registry.ts](/C:/Quoin/src/server/compliance/beps/cycle-registry.ts)
  - only if Cycle 2/Cycle 3 registry dates change

## Recommended implementation order

1. Benchmarking rule package codification
   - This is the largest gap and currently the least aligned with the PDFs.

2. Cycle 2 private threshold correction
   - Change private 50k to private 25k if the PDFs are the intended source of truth.

3. Trajectory start date correction
   - Align 2027 vs 2028.

4. Cycle 3 support decision
   - Either add governed Cycle 3 records or explicitly document that Quoin does not yet implement the source-of-truth rules beyond Cycle 2.

## Final assessment

If these PDFs are intended to be Quoin's actual governing source:
- BEPS Cycle 1 is mostly aligned.
- Benchmarking is not yet aligned.
- Cycle 2 is only partially aligned.
- Cycle 3 is not implemented.

Quoin should not claim full implementation of the rules in these two documents yet.
