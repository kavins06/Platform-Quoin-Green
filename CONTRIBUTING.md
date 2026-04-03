# Contributing

## Expectations

- keep changes scoped and reviewable
- preserve deterministic behavior in compliance-critical paths
- do not introduce ad hoc business logic into routers or UI when a server-side source of truth already exists
- keep tenant isolation, auditability, and QA behavior explicit

## Before opening a change

Run the relevant checks:

```bash
npm run typecheck
npm run test:unit
npm run test:integration:db
npm run build
```

For Prisma changes, also run:

```bash
npm run prisma:format
npm run prisma:validate
npm run prisma:generate
npm run db:validate:fresh
```

## Repo hygiene

Do not commit:

- local env files
- logs
- temporary exports
- scratch analysis artifacts
- local runtime caches

If a file is needed only locally, add or update `.gitignore` instead of checking it in.
