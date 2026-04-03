CREATE INDEX IF NOT EXISTS "energy_readings_org_building_meter_period_end_ingested_idx"
ON "energy_readings" (
  "organization_id",
  "building_id",
  "meter_id",
  "period_end" DESC,
  "ingested_at" DESC
);

CREATE INDEX IF NOT EXISTS "jobs_status_created_at_idx"
ON "jobs" (
  "status",
  "created_at" DESC
);

CREATE INDEX IF NOT EXISTS "jobs_status_started_at_idx"
ON "jobs" (
  "status",
  "started_at" DESC
);
