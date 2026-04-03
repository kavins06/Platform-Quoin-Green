CREATE TYPE "RetrofitProjectType" AS ENUM (
  'LED_LIGHTING_RETROFIT',
  'RETRO_COMMISSIONING',
  'BMS_UPGRADE',
  'VARIABLE_FREQUENCY_DRIVES',
  'LOW_FLOW_FIXTURES',
  'HEAT_PUMP_CONVERSION',
  'ENVELOPE_AIR_SEALING',
  'WINDOW_REPLACEMENT',
  'ROOF_INSULATION_UPGRADE',
  'ROOFTOP_SOLAR_PV',
  'CUSTOM'
);

CREATE TYPE "RetrofitCandidateStatus" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'DEFERRED',
  'COMPLETED',
  'ARCHIVED'
);

CREATE TYPE "RetrofitCandidateSource" AS ENUM (
  'MANUAL',
  'ECM_LIBRARY',
  'ANOMALY_DERIVED'
);

CREATE TYPE "RetrofitConfidenceBand" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH'
);

CREATE TABLE "retrofit_candidates" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "source_artifact_id" TEXT,
  "project_type" "RetrofitProjectType" NOT NULL,
  "candidate_source" "RetrofitCandidateSource" NOT NULL DEFAULT 'MANUAL',
  "status" "RetrofitCandidateStatus" NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "compliance_cycle" "ComplianceCycle",
  "target_filing_year" INTEGER,
  "estimated_capex" DOUBLE PRECISION NOT NULL,
  "estimated_incentive_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "estimated_annual_savings_kbtu" DOUBLE PRECISION,
  "estimated_annual_savings_usd" DOUBLE PRECISION,
  "estimated_site_eui_reduction" DOUBLE PRECISION,
  "estimated_source_eui_reduction" DOUBLE PRECISION,
  "estimated_beps_improvement_pct" DOUBLE PRECISION,
  "estimated_implementation_months" INTEGER,
  "confidence_band" "RetrofitConfidenceBand" NOT NULL DEFAULT 'MEDIUM',
  "source_metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "retrofit_candidates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "retrofit_candidates_organization_id_building_id_status_updated_at_idx"
  ON "retrofit_candidates"("organization_id", "building_id", "status", "updated_at" DESC);

CREATE INDEX "retrofit_candidates_organization_id_project_type_updated_at_idx"
  ON "retrofit_candidates"("organization_id", "project_type", "updated_at" DESC);

ALTER TABLE "retrofit_candidates"
  ADD CONSTRAINT "retrofit_candidates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "retrofit_candidates"
  ADD CONSTRAINT "retrofit_candidates_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "retrofit_candidates"
  ADD CONSTRAINT "retrofit_candidates_source_artifact_id_fkey"
  FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "retrofit_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retrofit_candidates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "retrofit_candidates";
CREATE POLICY tenant_isolation ON "retrofit_candidates"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
