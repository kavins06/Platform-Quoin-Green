-- Remove obsolete stabilization artifacts that were present in some legacy dev
-- databases but are not part of the canonical runtime schema.

DROP INDEX IF EXISTS "buildings_organization_id_archived_at_idx";
DROP INDEX IF EXISTS "energy_readings_idempotency_key_key";
DROP INDEX IF EXISTS "pipeline_runs_idempotency_key_key";
DROP INDEX IF EXISTS "green_button_connections_subscription_id_key";

ALTER TABLE "buildings"
  DROP COLUMN IF EXISTS "archived_at",
  DROP COLUMN IF EXISTS "archived_by_clerk_user_id";

ALTER TABLE "energy_readings"
  DROP COLUMN IF EXISTS "idempotency_key",
  DROP COLUMN IF EXISTS "source_kbtu",
  DROP COLUMN IF EXISTS "source_factor_used";

ALTER TABLE "compliance_snapshots"
  DROP COLUMN IF EXISTS "total_site_kbtu",
  DROP COLUMN IF EXISTS "total_source_kbtu";

ALTER TABLE "pipeline_runs"
  DROP COLUMN IF EXISTS "idempotency_key";
