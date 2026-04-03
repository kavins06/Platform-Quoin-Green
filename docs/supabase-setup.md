# Supabase Setup

Quoin is prepared to use Supabase Postgres as its primary hosted database and
Supabase Auth as the primary application sign-in path.

Supabase Storage is still not fully integrated in this pass.

## What Supabase is used for right now

- Supabase Postgres is the intended hosted system of record for Prisma data.
- `DATABASE_URL` remains the active database connection variable.
- Supabase Auth is the only supported Quoin sign-in provider.
- Redis remains a separate dependency for worker queues and runtime coordination.

## Required environment variables

Use the examples in [`.env.example`](/C:/Quoin/.env.example) and
[`.env.production.example`](/C:/Quoin/.env.production.example).

Required now:

- `DATABASE_URL`
- `REDIS_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- ESPM credentials

Required for migration tooling or admin-side flows:

- `SUPABASE_SERVICE_ROLE_KEY`

## Connecting Quoin to Supabase Postgres

1. Create a Supabase project.
2. Copy the project Postgres connection string into `DATABASE_URL`.
3. Ensure the connection uses SSL, for example `?sslmode=require`.
4. Run:

```bash
npm install
npm run prisma:generate
npx prisma migrate deploy
npm run dev
```

Or for a production-style local verification:

```bash
npm run build
npm run start
```

## Destructive Supabase-only cutover

Quoin's final auth cutover is a full clean-slate reset. Existing users,
organizations, memberships, and tenant-scoped benchmarking data are
intentionally wiped before the Supabase-only schema cleanup is applied.

Run the reset explicitly before `prisma migrate deploy`:

PowerShell:

```powershell
$env:RESET_QUOIN_SUPABASE_CUTOVER='YES'
npm run db:cutover:reset
```

Then apply the Supabase-only schema and re-onboard:

```bash
npm run prisma:generate
npx prisma migrate deploy
npm run dev
```

After this step:

- previous organizations and memberships are gone
- onboarding must be completed again
- there is no mixed-mode auth fallback

## No-Docker runtime

Quoin can run without Docker if you provide:

- `DATABASE_URL` pointing at Supabase Postgres
- `REDIS_URL` pointing at an external Redis service or a locally installed Redis daemon

That is enough for:

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run worker`

Supabase Auth-backed sign-in and sign-up also work on this path as long as the
public Supabase URL and anon key are configured.

Docker is only optional infrastructure for:

- local Postgres or Redis convenience
- temp-database validation paths like `npm run db:validate:fresh`
- DB-backed integration harness runs like `npm run test:integration:db`

If you still want Docker just for Redis, use:

```bash
npm run redis:start:docker
npm run redis:stop:docker
```

## How RLS works in Supabase

Quoin still uses a dedicated Postgres role named `quoin_app` for tenant-scoped
queries.

The setup SQL now works like this:

- create `quoin_app` as a `NOLOGIN` role if it does not already exist
- grant schema and table privileges to `quoin_app`
- grant `quoin_app` to the current migration/login role instead of assuming a
  local role named `quoin`

At runtime, [db.ts](/C:/Quoin/src/server/lib/db.ts) still enforces tenant access by:

1. setting `app.organization_id`
2. running `SET LOCAL ROLE quoin_app`

That keeps the current RLS model intact on Supabase Postgres as long as the role
grant setup has been applied by migrations.

## What still requires local admin-style Postgres

These scripts create and drop temporary databases and are not suitable for a
normal hosted Supabase connection string:

- `npm run test:integration:db`
- `npm run db:validate:fresh`

They are still useful locally against Docker or another Postgres instance where
the connected role can create and drop databases.

These commands remain compatible with a standard hosted database connection:

- `npx prisma migrate deploy`
- `npm run prisma:generate`
- `npm run db:audit:tenant`
- `npm run db:validate:constraints`
- `npm run db:validate:current`

## Redis remains separate

Supabase does not replace Quoin's Redis dependency in this pass.

Keep `REDIS_URL` pointed at the queue/runtime Redis service used by:

- `npm run worker`
- `npm run start`

## Later work for Supabase Storage

Storage is not wired into Quoin yet. Later integration work will need:

- a storage abstraction for source and evidence artifacts
- upload/download flows backed by Supabase Storage buckets
- signed URL and service-role handling
- migration of file-path assumptions to storage object keys
- operator-facing docs for bucket setup, retention, and access rules
