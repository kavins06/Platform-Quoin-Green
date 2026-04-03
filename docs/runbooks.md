# Runbooks

## Redis or worker outage

Symptoms:
- `/api/health` reports `redis: error` or worker `OFFLINE` / `UNAVAILABLE`
- PM auto-pull stops advancing
- bill extraction jobs do not progress

Actions:
1. Restore Redis connectivity.
2. Restart the worker process.
3. Confirm worker heartbeat and queue counts in Settings governance.
4. Re-run blocked PM sync or bill extraction jobs if needed.

## Supabase Auth outage

Symptoms:
- sign-in or tenant resolution fails
- active organization cannot be set
- protected routes redirect unexpectedly

Actions:
1. Verify Supabase auth env values.
2. Verify Supabase project availability.
3. Confirm middleware session refresh is working.
4. Check recent `AUTH_*` audit entries for impact scope.

## PM sync wave failure

Symptoms:
- portfolio manager import state shows repeated failures
- governance runtime shows PM failures increasing
- linked buildings stop refreshing usage or metrics

Actions:
1. Review PM runtime health and latest failed job class.
2. Review org-level PM integration error state in Settings.
3. Approve or reject queued PM push requests explicitly.
4. Retry targeted building pull after integration health is restored.

## OCR or bill extraction queue failure

Symptoms:
- utility bill uploads remain `FAILED` or `QUEUED`
- no review candidates appear

Actions:
1. Check OCR.space key and outbound network health.
2. Check worker and queue state for `utility-bill-extraction`.
3. Retry failed uploads from the building workflow.
4. Review bill-upload audit trail for the exact failing stage.

## Migration rollback

Symptoms:
- Prisma migration deploy fails
- runtime or tests break after schema change

Actions:
1. Stop the deploy or local rollout.
2. Identify the failing migration and affected tables.
3. Restore the last known-good database snapshot where required.
4. Re-run `prisma generate`, contract validation, typecheck, and targeted integration tests before retrying.
