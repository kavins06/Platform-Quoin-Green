# Quoin

Quoin is a benchmarking-focused Next.js monolith for governed building energy benchmarking work.

The active product scope is now centered on ENERGY STAR Portfolio Manager connection, property import, local utility-data normalization, source governance, explicit PM meter setup and usage push/import, annual benchmarking readiness, and evidence-backed submission workflow.

## Current product scope

Quoin currently supports:

- multi-tenant organization and building management
- ENERGY STAR Portfolio Manager connection, import, setup, and explicit usage sync/push
- Green Button, CSV, and manual ingestion into governed local energy records
- deterministic benchmarking readiness and verification
- source reconciliation and provenance for canonical building and meter state
- immutable artifact, evidence, and submission workflow operations for benchmarking
- portfolio worklists and operator controls for benchmarking execution
- persisted compliance runs, evidence, audit logs, and jobs
- benchmarking request/checklist workflows
- packet generation and PDF export for benchmark verification workpapers
- benchmarking-first building and portfolio UI

Quoin is not currently a BEPS planning platform, a retrofit platform, or a financing platform. BEPS, anomaly, retrofit, reporting, and financing code may remain in the repo during the reduction, but they are no longer the active product direction unless a specific piece is required to support benchmarking correctness.

Quoin does not currently implement direct DOEE submission transport or a generic reporting platform.

For the explicit product reset plan, see [docs/benchmarking-only-product-direction.md](docs/benchmarking-only-product-direction.md).

For the current v1 checkpoint boundary and post-v1 backlog seed, see [docs/v1-release-checkpoint.md](docs/v1-release-checkpoint.md).

## Core workflows

For a given organization, the primary workflow is:

1. Ingest or sync building energy data
2. Run deterministic data quality and verification checks
3. Reconcile local source state and govern the canonical meter-level record
4. Configure PM property uses, meters, associations, and explicit usage push/import
5. Evaluate annual benchmarking readiness through governed rules
6. Prepare benchmarking packets, verification evidence, and submission handoff

## High-level architecture

Quoin is a monolith with a clear split between UI, API, and deterministic compliance services:

- `src/app`
  Next.js App Router pages and route handlers
- `src/components`
  UI components for buildings, benchmarking, and workflow surfaces
- `src/server/trpc`
  tRPC routers and auth/tenant middleware
- `src/server/compliance`
  benchmarking services, provenance, packet assembly, workflow logic, and retained compatibility paths
- `src/server/portfolio-manager`
  the active Portfolio Manager connection, setup, meter-linking, and usage workflow
- `src/server/integrations`
  external integrations such as ESPM and Green Button
- `src/server/pipelines`
  ingestion and worker-side pipeline logic
- `prisma`
  schema, migrations, and seed
- `test`
  unit and integration tests
- `docs`
  concise technical documentation and archived project notes

## Engineering principles

Quoin is built around a small set of explicit engineering constraints:

- deterministic compliance logic over heuristic output
- governed rule and factor versioning
- data quality as a computation gate
- append-only or reviewable compliance history where practical
- tenant-safe persistence and API boundaries
- auditable operational flows with jobs and audit logs
- Quoin-local governance before any external PM write

## Local development

Prerequisites:

- Node.js 20+
- PostgreSQL for local development, or Supabase Postgres for hosted environments
- Redis
- npm

Typical setup:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

The default local developer URL is [http://127.0.0.1:3101](http://127.0.0.1:3101).
Quoin now uses `127.0.0.1:3101` by default for both `dev` and local `start`
so local work does not collide with other services already using `localhost:3000`.

For hosted environments, Quoin is prepared to use Supabase Postgres through
`DATABASE_URL` while keeping Redis separate. See [docs/supabase-setup.md](docs/supabase-setup.md).

Quoin now uses Supabase Auth as its only sign-in and sign-up flow.

For a no-Docker runtime, point:

- `DATABASE_URL` at Supabase Postgres
- `REDIS_URL` at a non-Docker Redis service such as Redis Cloud, Upstash, or a locally installed Redis daemon

Docker is optional for the main app runtime.

## Supabase-Only Cutover Reset

The Supabase-only hard cutover is destructive by design. Before applying
the final Supabase-only schema migration on an existing environment, run the
explicit reset command and then re-onboard from scratch.

PowerShell:

```powershell
$env:RESET_QUOIN_SUPABASE_CUTOVER='YES'
npm run db:cutover:reset
```

After the reset:

```bash
npm run prisma:generate
npx prisma migrate deploy
npm run dev
```

## Main scripts

Core developer commands:

```bash
npm run dev
npm run build
npm run start
npm run stop
npm run typecheck
npm run test
npm run test:unit
npm run test:integration:db
```

Local command roles:

- `npm run dev`
  normal development loop at `127.0.0.1:3101`
- `npm run build`
  stops stale Quoin local runtime processes, clears stale build artifacts, then
  produces a fresh production build and worker bundle
- `npm run start`
  runs the local production-style standalone server and worker at
  `127.0.0.1:3101` by default
- `npm run stop`
  stops Quoin-managed local runtime processes if a prior run was interrupted

Prisma and DB validation commands:

```bash
npm run prisma:format
npm run prisma:validate
npm run prisma:generate
npm run db:validate:fresh
npm run db:validate:current
```

Note: `npm run test:integration:db` and `npm run db:validate:fresh` create and
drop temporary databases. They are intended for local or admin-capable
Postgres, not a standard hosted Supabase connection string.

Optional Docker helper commands:

```bash
npm run services:start:docker
npm run services:stop:docker
npm run redis:start:docker
npm run redis:stop:docker
```

Worker commands:

```bash
npm run worker
npm run worker:build
npm run worker:prod
```

## Build and deployment notes

- Production builds use `next build`
- The local production start path uses `scripts/start-server.mjs`
- Docker and deployment assets live in the repo root and `deploy/`
- Environment validation happens in server config code at startup

## Repository structure

```text
src/
  app/                Next.js routes and API handlers
  components/         UI components
  server/
    compliance/       Compliance engine, benchmarking, BEPS, packets, provenance
    integrations/     ESPM, Green Button, external clients
    pipelines/        Ingestion pipelines and worker logic
    trpc/             API routers and context
prisma/               Schema, migrations, seed
scripts/              Validation and local runtime helpers
test/                 Unit and integration tests
docs/                 Technical documentation
```

## Additional documentation

- [Architecture](docs/architecture.md)
- [Capability Map](docs/capability-map.md)
- [V1 Release Checkpoint](docs/v1-release-checkpoint.md)
- [Development](docs/development.md)
- [Compliance Engine](docs/compliance-engine.md)
- [DB Operations](docs/foundation-db-operations.md)
- [Contributing](CONTRIBUTING.md)
