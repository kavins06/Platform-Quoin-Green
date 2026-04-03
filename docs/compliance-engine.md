# Compliance Engine

## What it does today

The compliance engine is the centralized deterministic computation path for benchmarking and BEPS evaluation.

Current implementation:

- benchmarking path
- BEPS path
- governed rule and factor version resolution
- QA-gated execution
- persisted `ComplianceRun`
- audit logging around computation start, success, and failure

## Inputs

The engine works from persisted product state rather than ad hoc UI state.

Typical inputs include:

- building identity and configuration
- energy readings
- latest compliance snapshot
- canonical BEPS inputs
- evidence artifacts
- governed rule version
- governed factor set version
- QA verdict and issues

## Outputs

The stable engine result contract includes:

- `status`
- `applicability`
- `reportingYear`
- `rulePackageKey`
- `ruleVersion`
- `factorSetKey`
- `factorSetVersion`
- `metricUsed`
- `qa`
- `reasonCodes`
- `decision`
- `domainResult`

The engine also persists:

- `ComplianceRun`
- calculation manifest through existing provenance flow
- audit entries

## Rule-versioning primitives

The engine reuses existing governed models:

- `RulePackage`
- `RuleVersion`
- `FactorSetVersion`
- `BepsCycleRegistry`

It does not create a parallel rule system.

## QA behavior

QA is an explicit gate:

- `PASS`
  computation proceeds normally
- `WARN`
  computation proceeds with explicit recorded warnings
- `FAIL`
  computation returns a blocked or insufficient-data style result

Silent compute-on-bad-data is intentionally not allowed.

## Intentionally deferred

The current engine does not attempt to do all of the following:

- full codification of every regulatory edge case
- regulator-side submission transport
- speculative AI-based compliance decisions
- generic rules execution for unrelated modules

It is intentionally scoped to the governed benchmarking and BEPS paths already present in the repository.
