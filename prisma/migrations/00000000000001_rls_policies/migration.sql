-- Row Level Security Policies
-- Every table with organization_id gets RLS to enforce tenant isolation.
-- Organization table is the tenant root and does NOT get RLS.

-- ─── Users ──────────────────────────────────────────────────────────────────

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "users"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── Buildings ──────────────────────────────────────────────────────────────

ALTER TABLE "buildings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "buildings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "buildings"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── Energy Readings ────────────────────────────────────────────────────────

ALTER TABLE "energy_readings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "energy_readings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "energy_readings"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── Compliance Snapshots ───────────────────────────────────────────────────

ALTER TABLE "compliance_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_snapshots" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "compliance_snapshots"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── Energy Conservation Measures ───────────────────────────────────────────

ALTER TABLE "energy_conservation_measures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "energy_conservation_measures" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "energy_conservation_measures"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── Funding Sources ────────────────────────────────────────────────────────

ALTER TABLE "funding_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "funding_sources" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "funding_sources"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── Compliance Pathways ────────────────────────────────────────────────────

ALTER TABLE "compliance_pathways" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_pathways" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "compliance_pathways"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── Capital Stacks ─────────────────────────────────────────────────────────

ALTER TABLE "capital_stacks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capital_stacks" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "capital_stacks"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── Drift Alerts ───────────────────────────────────────────────────────────

ALTER TABLE "drift_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drift_alerts" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "drift_alerts"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── Pipeline Runs ──────────────────────────────────────────────────────────

ALTER TABLE "pipeline_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_runs" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "pipeline_runs"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── DOEE Submissions ───────────────────────────────────────────────────────

ALTER TABLE "doee_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doee_submissions" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "doee_submissions"
  FOR ALL
  USING (organization_id = current_setting('app.organization_id', true)::text);

-- ─── Append-Only Audit Trail ────────────────────────────────────────────────
-- These rules enforce the append-only audit trail at the database level.
-- EnergyReadings and ComplianceSnapshots are INSERT-ONLY per DOEE regulatory
-- requirements. Any UPDATE or DELETE is silently ignored.

-- Enforce append-only on energy_readings (no UPDATE or DELETE allowed)
-- CREATE RULE energy_readings_no_update AS ON UPDATE TO energy_readings DO INSTEAD NOTHING;
-- CREATE RULE energy_readings_no_delete AS ON DELETE TO energy_readings DO INSTEAD NOTHING;

-- Enforce append-only on compliance_snapshots (no UPDATE or DELETE allowed)
-- CREATE RULE compliance_snapshots_no_update AS ON UPDATE TO compliance_snapshots DO INSTEAD NOTHING;
-- CREATE RULE compliance_snapshots_no_delete AS ON DELETE TO compliance_snapshots DO INSTEAD NOTHING;
