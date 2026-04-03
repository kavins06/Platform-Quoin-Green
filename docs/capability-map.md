# Capability Map

This file defines Quoin's active product boundary.

For the current v1 checkpoint and post-v1 backlog seed, see [v1-release-checkpoint.md](v1-release-checkpoint.md).

## Active product capabilities

Quoin is a benchmarking platform for governed building energy benchmarking work.

Active capabilities:

- ENERGY STAR Portfolio Manager connection, account import, and safe property linking
- local ingestion and normalization for utility data from PM, Green Button, CSV, and manual sources
- source reconciliation and provenance for building, meter, and consumption state
- PM property-use setup, meter linking, association checks, and explicit usage import/push
- deterministic benchmarking readiness evaluation with governed rule and factor versioning
- persisted readiness, issue, and runtime summaries for benchmarking execution
- immutable benchmark artifacts, evidence packaging, and submission workflows
- portfolio worklists and operator actions for benchmarking execution
- benchmark verification packets and evidence-oriented exports
- runtime health visibility for PM and ingestion workflows

## Deprecated or legacy areas

These areas are retained only where needed for historical records, cleanup, or low-risk transitional support:

- BEPS evaluation, filing, and packet services
- anomaly and operations-analysis services
- retrofit ranking and candidate services
- governed reporting and broad compliance packaging
- financing persistence models in the Prisma schema
- legacy financing packet service code
- legacy capital-structuring pipeline code and eligibility helpers
- retired workflow/risk heuristics that parsed benchmark or filing payload internals directly
- legacy PM benchmark-compatibility sync/push services

They are not active product workflows, active routes, or active user-facing surfaces.

## Not current scope

These are explicitly out of scope for the active product:

- BEPS product expansion beyond what benchmarking immediately needs
- decarbonization planning
- retrofit ranking and portfolio optimization
- anomaly-detection products not tied directly to benchmarking correctness
- financing platform workflows
- capital stack assembly as a user-facing product area
- direct regulator submission transport
- generic business intelligence dashboards
- financing marketplace or lender workflow orchestration

## Operator rule

When adding new surfaces or backend paths, prefer governed benchmarking summaries, persisted artifacts, auditable workflow state, and explicit PM integration boundaries. Do not reintroduce BEPS, retrofit, anomaly, or financing breadth as active product framing unless it is strictly required for benchmarking execution.
