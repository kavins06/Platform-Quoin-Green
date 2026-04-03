CREATE TYPE "OperationalAnomalyType" AS ENUM (
  'ABNORMAL_BASELOAD',
  'OFF_HOURS_SCHEDULE_DRIFT',
  'UNUSUAL_CONSUMPTION_SPIKE',
  'UNUSUAL_CONSUMPTION_DROP',
  'MISSING_OR_SUSPECT_METER_DATA',
  'INCONSISTENT_METER_BEHAVIOR'
);

CREATE TYPE "OperationalAnomalyStatus" AS ENUM (
  'ACTIVE',
  'ACKNOWLEDGED',
  'DISMISSED'
);

CREATE TABLE "operational_anomalies" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "meter_id" TEXT,
  "anomaly_type" "OperationalAnomalyType" NOT NULL,
  "severity" "AlertSeverity" NOT NULL,
  "status" "OperationalAnomalyStatus" NOT NULL DEFAULT 'ACTIVE',
  "detection_hash" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "detection_window_start" TIMESTAMP(3) NOT NULL,
  "detection_window_end" TIMESTAMP(3) NOT NULL,
  "comparison_window_start" TIMESTAMP(3),
  "comparison_window_end" TIMESTAMP(3),
  "basis_json" JSONB NOT NULL DEFAULT '{}',
  "reason_codes_json" JSONB NOT NULL DEFAULT '[]',
  "estimated_energy_impact_kbtu" DOUBLE PRECISION,
  "attribution_json" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by_type" "ActorType",
  "acknowledged_by_id" TEXT,
  "dismissed_at" TIMESTAMP(3),
  "dismissed_by_type" "ActorType",
  "dismissed_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "operational_anomalies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_anomalies_building_id_detection_hash_key"
  ON "operational_anomalies"("building_id", "detection_hash");

CREATE INDEX "operational_anomalies_organization_id_building_id_status_severit_idx"
  ON "operational_anomalies"("organization_id", "building_id", "status", "severity", "updated_at" DESC);

CREATE INDEX "operational_anomalies_meter_id_idx"
  ON "operational_anomalies"("meter_id");

ALTER TABLE "operational_anomalies"
  ADD CONSTRAINT "operational_anomalies_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operational_anomalies"
  ADD CONSTRAINT "operational_anomalies_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operational_anomalies"
  ADD CONSTRAINT "operational_anomalies_meter_id_fkey"
  FOREIGN KEY ("meter_id") REFERENCES "meters"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "operational_anomalies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operational_anomalies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "operational_anomalies";
CREATE POLICY tenant_isolation ON "operational_anomalies"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
