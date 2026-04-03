ALTER TABLE "energy_readings"
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_reason" TEXT,
  ADD COLUMN "archived_by_operational_job_id" TEXT;

CREATE INDEX "energy_readings_organization_id_building_id_meter_id_archived_at_period_end_ingested_at_idx"
ON "energy_readings"("organization_id", "building_id", "meter_id", "archived_at", "period_end" DESC, "ingested_at" DESC);
