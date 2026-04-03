# Quoin Product Boundary

Quoin is a compliance operating system for Washington, DC building energy compliance work.

It is built to:

- ingest and normalize energy data from Portfolio Manager, Green Button, CSV, and related governed ingestion paths
- reconcile source records into canonical building, meter, and consumption state
- run deterministic benchmarking and BEPS evaluations using governed rule and factor versions
- persist compliance runs, evidence, penalties, artifacts, and submission workflow state
- package governed reports and evidence for review, filing preparation, and customer-facing delivery
- support operator workflows across a multi-building portfolio

## Active product scope

Quoin currently focuses on:

- benchmarking compliance automation
- BEPS compliance operations
- readiness and issue management
- governed penalty visibility and simple deterministic scenarios
- source reconciliation and provenance
- anomaly-to-risk decision-support
- retrofit prioritization
- immutable artifact generation and evidence packaging
- submission workflow operations
- portfolio worklists and operator controls

## Explicitly out of scope

Quoin is not intended to be:

- a financing platform
- a capital marketplace
- a lender workflow product
- a generic BI dashboard
- a direct DOEE submission transport system

Legacy financing persistence and internal code may remain in the repo for historical records and cleanup safety, but they are not active product capabilities.

## Repo references

For the current capability boundary, see:

- [docs/capability-map.md](docs/capability-map.md)
- [README.md](README.md)
- [docs/architecture.md](docs/architecture.md)

Historical roadmap and audit material remains under [docs/archive](docs/archive/).

For the current v1 checkpoint boundary and post-v1 backlog seed, see [docs/v1-release-checkpoint.md](docs/v1-release-checkpoint.md).
