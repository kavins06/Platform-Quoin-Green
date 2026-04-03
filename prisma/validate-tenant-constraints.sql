ALTER TABLE "meters"
  VALIDATE CONSTRAINT "meters_building_id_organization_id_fkey";

ALTER TABLE "energy_readings"
  VALIDATE CONSTRAINT "energy_readings_building_id_organization_id_fkey";

ALTER TABLE "compliance_snapshots"
  VALIDATE CONSTRAINT "compliance_snapshots_building_id_organization_id_fkey";

ALTER TABLE "green_button_connections"
  VALIDATE CONSTRAINT "green_button_connections_building_id_organization_id_fkey";

ALTER TABLE "pipeline_runs"
  VALIDATE CONSTRAINT "pipeline_runs_building_id_organization_id_fkey";

ALTER TABLE "drift_alerts"
  VALIDATE CONSTRAINT "drift_alerts_building_id_organization_id_fkey";
