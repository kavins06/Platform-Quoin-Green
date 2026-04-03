# Foundation DB Operations

This repo now has two supported validation paths for tenant-safe persistence.

## Fresh database proof

Use this to prove the checked-in migrations, Prisma schema, generated client, and
seed all work from an empty Postgres database:

```bash
npm run db:start
npm run db:validate:fresh
```

`npm run db:start` is a Docker helper for local validation infrastructure. It is
not required for the normal Supabase-backed runtime path.

`db:validate:fresh` does all of the following against a temporary database:

- applies all Prisma migrations
- generates the Prisma client
- validates the Prisma schema
- runs the seed
- audits tenant invariants
- validates the composite org/building foreign keys
- checks for schema drift with `prisma migrate diff`

This path requires a Postgres role that can create and drop temporary
databases. Use local Docker Postgres or another admin-capable Postgres instance
for it. A normal hosted Supabase `DATABASE_URL` is not suitable for this
workflow.

## Existing database upgrade proof

Use this before tightening constraints on an existing environment:

```bash
npx prisma migrate deploy
npm run db:audit:tenant
npm run db:validate:constraints
```

Or run the same sequence with:

```bash
npm run db:validate:current
```

This path works against a hosted Supabase database because it validates the
current database in place and does not create temporary databases.

## Hosted Supabase-compatible commands

These commands are suitable for a hosted Supabase Postgres connection:

```bash
npx prisma migrate deploy
npm run prisma:generate
npm run db:audit:tenant
npm run db:validate:constraints
npm run db:validate:current
```

## What the tenant audit checks

`npm run db:audit:tenant` exits non-zero if any of these are present:

- child rows whose `organization_id` does not match the referenced building
- users that exist without any `organization_memberships` row

## Manual remediation guidance

If the audit reports non-zero counts in production, do not blindly validate the
constraints. The violating rows need to be reviewed and corrected first.

- For `*_building_org_mismatch`: fix the child row's `organization_id`, move it
  to the correct building, or delete the orphaned row if it is invalid data.
- For `users_without_memberships`: either add the correct
  `organization_memberships` row or remove the unused user if it should not
  remain in the tenant-scoped system.

Only run `npm run db:validate:constraints` after the audit returns zero rows for
all checks.
