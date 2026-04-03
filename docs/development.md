# Development

## Prerequisites

- Node.js 20+
- npm
- PostgreSQL for local development, or Supabase Postgres for hosted environments
- Redis

## Setup

```bash
npm install
npm run prisma:generate
npx prisma migrate deploy
npm run dev
```

The default local developer URL is now [http://127.0.0.1:3101](http://127.0.0.1:3101).
Quoin uses `127.0.0.1:3101` by default so local work does not collide with the
existing `localhost:3000` listeners that are common on this machine.

For hosted environments, point `DATABASE_URL` at Supabase Postgres and keep
`REDIS_URL` pointed at a separate Redis service. See [Supabase Setup](./supabase-setup.md).

That means the normal Quoin runtime no longer requires Docker if you have:

- Supabase Postgres in `DATABASE_URL`
- a reachable Redis service in `REDIS_URL`

Use Docker only when you want local infrastructure helpers, for example:

```bash
npm run services:start:docker
npm run redis:start:docker
```

## Common commands

```bash
npm run dev
npm run build
npm run start
npm run stop
npm run typecheck
npm run test:unit
npm run test:integration:db
npm run db:validate:fresh
```

Use the local commands like this:

1. `npm run dev`
   The normal developer loop. Runs Next in dev mode at `127.0.0.1:3101`.
2. `npm run build`
   Stops any stale Quoin local runtime processes, clears stale build artifacts,
   then produces a fresh production build and worker bundle.
3. `npm run start`
   Runs the local production-style Next standalone server plus the worker at
   `127.0.0.1:3101` by default.
4. `npm run stop`
   Stops Quoin-managed local runtime processes if a prior `start`, `build`, or
   interrupted local run left them behind.

## Local workflow

Recommended developer loop:

1. make focused changes
2. run `npm run typecheck`
3. run the smallest relevant test target
4. run `npm run build` before finishing cross-cutting work

If a build or production-style local run is interrupted, use `npm run stop`
before retrying. The build script also performs this cleanup automatically.

For schema-affecting changes:

1. update `prisma/schema.prisma`
2. create and review the migration
3. run:
   - `npm run prisma:format`
   - `npm run prisma:validate`
   - `npm run prisma:generate`
   - `npm run db:validate:fresh`

## Branching and change discipline

- keep changes small and reviewable
- avoid broad refactors unless they remove real risk or drift
- prefer deterministic service logic over duplicated router logic
- keep UI changes thin when the source of truth already exists in persisted records

## Testing notes

- unit tests live in `test/unit`
- DB-backed integration tests live in `test/integration`
- `scripts/run-integration-db.mjs` provisions an isolated integration database and
  requires a Postgres role that can create and drop databases
- `npm run db:start` is now a Docker convenience wrapper for local validation infrastructure, not a required app startup step

## Local artifacts

Do not commit:

- logs
- HTML dumps
- temporary packet exports
- local env files
- local tool runtime folders

The repo `.gitignore` is configured to keep those out of version control.
