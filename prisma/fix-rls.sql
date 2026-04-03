-- Re-apply app role and RLS policies after db push reset

-- Create app role if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quoin_app') THEN
    CREATE ROLE quoin_app NOLOGIN;
  END IF;
END
$$;

-- Grant schema access
GRANT USAGE ON SCHEMA public TO quoin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quoin_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quoin_app;

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

-- Enable RLS on current tables (only tables that exist in the new schema)
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "users";
CREATE POLICY tenant_isolation ON "users"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

ALTER TABLE "buildings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "buildings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "buildings";
CREATE POLICY tenant_isolation ON "buildings"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

ALTER TABLE "meters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meters" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "meters";
CREATE POLICY tenant_isolation ON "meters"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

ALTER TABLE "energy_readings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "energy_readings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "energy_readings";
CREATE POLICY tenant_isolation ON "energy_readings"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

ALTER TABLE "compliance_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "compliance_snapshots";
CREATE POLICY tenant_isolation ON "compliance_snapshots"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

ALTER TABLE "pipeline_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "pipeline_runs";
CREATE POLICY tenant_isolation ON "pipeline_runs"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

ALTER TABLE "green_button_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "green_button_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "green_button_connections";
CREATE POLICY tenant_isolation ON "green_button_connections"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);
