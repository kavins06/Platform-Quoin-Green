-- Foundation Sprint 1
-- Reconcile migrations with the active runtime schema, replace single-org
-- user modeling with explicit memberships, and tighten low-risk tenant
-- integrity constraints for rows that duplicate organization_id + building_id.

ALTER TYPE "PipelineType" ADD VALUE IF NOT EXISTS 'PATHWAY_ANALYSIS';
ALTER TYPE "PipelineType" ADD VALUE IF NOT EXISTS 'CAPITAL_STRUCTURING';
ALTER TYPE "PipelineType" ADD VALUE IF NOT EXISTS 'DRIFT_DETECTION';

DO $$
BEGIN
  CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "organization_memberships" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "clerk_membership_id" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_clerk_membership_id_key"
  ON "organization_memberships"("clerk_membership_id");
CREATE INDEX IF NOT EXISTS "organization_memberships_organization_id_idx"
  ON "organization_memberships"("organization_id");
CREATE INDEX IF NOT EXISTS "organization_memberships_user_id_idx"
  ON "organization_memberships"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_organization_id_user_id_key"
  ON "organization_memberships"("organization_id", "user_id");

ALTER TABLE "organization_memberships"
  DROP CONSTRAINT IF EXISTS "organization_memberships_organization_id_fkey";
ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_memberships"
  DROP CONSTRAINT IF EXISTS "organization_memberships_user_id_fkey";
ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'organization_id'
  ) THEN
    EXECUTE $sql$
      INSERT INTO "organization_memberships" (
        "id",
        "organization_id",
        "user_id",
        "role",
        "created_at",
        "updated_at"
      )
      SELECT
        CONCAT('legacy_', "id", '_', "organization_id"),
        "organization_id",
        "id",
        COALESCE("role", 'VIEWER'::"UserRole"),
        COALESCE("created_at", CURRENT_TIMESTAMP),
        CURRENT_TIMESTAMP
      FROM "users"
      WHERE "organization_id" IS NOT NULL
      ON CONFLICT ("organization_id", "user_id")
      DO UPDATE SET
        "role" = EXCLUDED."role",
        "updated_at" = CURRENT_TIMESTAMP
    $sql$;
  END IF;
END
$$;

DROP POLICY IF EXISTS tenant_isolation ON "users";
ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_organization_id_fkey";
DROP INDEX IF EXISTS "users_organization_id_idx";
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "organization_id",
  DROP COLUMN IF EXISTS "role";

ALTER TABLE "buildings"
  ADD COLUMN IF NOT EXISTS "has_financial_distress" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "occupancy_rate" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "drift_alerts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "pipeline_run_id" TEXT,
  "rule_id" TEXT NOT NULL,
  "severity" "AlertSeverity" NOT NULL,
  "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "current_value" DOUBLE PRECISION NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "ai_root_cause" TEXT,
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledged_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),

  CONSTRAINT "drift_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "drift_alerts_building_id_status_detected_at_idx"
  ON "drift_alerts"("building_id", "status", "detected_at" DESC);
CREATE INDEX IF NOT EXISTS "drift_alerts_organization_id_building_id_idx"
  ON "drift_alerts"("organization_id", "building_id");

CREATE UNIQUE INDEX IF NOT EXISTS "buildings_id_organization_id_key"
  ON "buildings"("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "green_button_connections_building_id_organization_id_key"
  ON "green_button_connections"("building_id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_runs_id_organization_id_key"
  ON "pipeline_runs"("id", "organization_id");

ALTER TABLE "meters" DROP CONSTRAINT IF EXISTS "meters_building_id_fkey";
ALTER TABLE "meters"
  ADD CONSTRAINT "meters_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id")
  REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "energy_readings" DROP CONSTRAINT IF EXISTS "energy_readings_building_id_fkey";
ALTER TABLE "energy_readings"
  ADD CONSTRAINT "energy_readings_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id")
  REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "compliance_snapshots" DROP CONSTRAINT IF EXISTS "compliance_snapshots_building_id_fkey";
ALTER TABLE "compliance_snapshots"
  ADD CONSTRAINT "compliance_snapshots_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id")
  REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "green_button_connections" DROP CONSTRAINT IF EXISTS "green_button_connections_building_id_fkey";
ALTER TABLE "green_button_connections"
  ADD CONSTRAINT "green_button_connections_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id")
  REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "pipeline_runs" DROP CONSTRAINT IF EXISTS "pipeline_runs_building_id_fkey";
ALTER TABLE "pipeline_runs"
  ADD CONSTRAINT "pipeline_runs_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id")
  REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "drift_alerts" DROP CONSTRAINT IF EXISTS "drift_alerts_building_id_fkey";
ALTER TABLE "drift_alerts"
  ADD CONSTRAINT "drift_alerts_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id")
  REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "drift_alerts" DROP CONSTRAINT IF EXISTS "drift_alerts_pipeline_run_id_fkey";
ALTER TABLE "drift_alerts"
  ADD CONSTRAINT "drift_alerts_pipeline_run_id_fkey"
  FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quoin_app') THEN
    CREATE ROLE quoin_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO quoin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quoin_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quoin_app;

DO $$
DECLARE
  runtime_grantee text := current_user;
BEGIN
  IF runtime_grantee = 'quoin_app' THEN
    RETURN;
  END IF;

  EXECUTE format('GRANT quoin_app TO %I WITH SET TRUE', runtime_grantee);
END
$$;

ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_memberships" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "organization_memberships";
CREATE POLICY tenant_isolation ON "organization_memberships"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "buildings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "buildings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "buildings";
CREATE POLICY tenant_isolation ON "buildings"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "meters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meters" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "meters";
CREATE POLICY tenant_isolation ON "meters"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "energy_readings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "energy_readings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "energy_readings";
CREATE POLICY tenant_isolation ON "energy_readings"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "compliance_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "compliance_snapshots";
CREATE POLICY tenant_isolation ON "compliance_snapshots"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "green_button_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "green_button_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "green_button_connections";
CREATE POLICY tenant_isolation ON "green_button_connections"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "pipeline_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "pipeline_runs";
CREATE POLICY tenant_isolation ON "pipeline_runs"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "drift_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drift_alerts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "drift_alerts";
CREATE POLICY tenant_isolation ON "drift_alerts"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
