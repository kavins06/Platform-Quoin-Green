DO $$
BEGIN
  CREATE TYPE "BuildingOwnershipType" AS ENUM ('PRIVATE', 'DISTRICT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "BepsPathway" AS ENUM ('PERFORMANCE', 'STANDARD_TARGET', 'PRESCRIPTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "BepsPrescriptiveItemStatus" AS ENUM (
    'PLANNED',
    'IN_PROGRESS',
    'COMPLETED',
    'APPROVED',
    'WAIVED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "AlternativeComplianceAgreementStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'SUPERSEDED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "buildings"
  ADD COLUMN IF NOT EXISTS "ownership_type" "BuildingOwnershipType" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN IF NOT EXISTS "is_energy_star_score_eligible" BOOLEAN;

ALTER TABLE "compliance_snapshots"
  ADD COLUMN IF NOT EXISTS "weather_normalized_source_eui" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "beps_metric_inputs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "compliance_cycle" "ComplianceCycle" NOT NULL,
  "filing_year" INTEGER NOT NULL,
  "baseline_year_start" INTEGER,
  "baseline_year_end" INTEGER,
  "evaluation_year_start" INTEGER,
  "evaluation_year_end" INTEGER,
  "comparison_year" INTEGER,
  "delayed_cycle_1_option_applied" BOOLEAN NOT NULL DEFAULT false,
  "baseline_adjusted_site_eui" DOUBLE PRECISION,
  "evaluation_adjusted_site_eui" DOUBLE PRECISION,
  "baseline_weather_normalized_site_eui" DOUBLE PRECISION,
  "evaluation_weather_normalized_site_eui" DOUBLE PRECISION,
  "baseline_weather_normalized_source_eui" DOUBLE PRECISION,
  "evaluation_weather_normalized_source_eui" DOUBLE PRECISION,
  "baseline_energy_star_score" DOUBLE PRECISION,
  "evaluation_energy_star_score" DOUBLE PRECISION,
  "baseline_snapshot_id" TEXT,
  "evaluation_snapshot_id" TEXT,
  "source_artifact_id" TEXT,
  "notes_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "beps_metric_inputs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "beps_prescriptive_items" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "compliance_cycle" "ComplianceCycle" NOT NULL,
  "filing_year" INTEGER NOT NULL,
  "item_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "milestone_name" TEXT,
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "points_possible" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "points_earned" DOUBLE PRECISION,
  "status" "BepsPrescriptiveItemStatus" NOT NULL DEFAULT 'PLANNED',
  "completed_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "due_at" TIMESTAMP(3),
  "source_artifact_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "beps_prescriptive_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "beps_alternative_compliance_agreements" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "compliance_cycle" "ComplianceCycle" NOT NULL,
  "filing_year" INTEGER NOT NULL,
  "agreement_identifier" TEXT NOT NULL,
  "pathway" "BepsPathway" NOT NULL,
  "multiplier" DOUBLE PRECISION NOT NULL,
  "status" "AlternativeComplianceAgreementStatus" NOT NULL DEFAULT 'DRAFT',
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "source_artifact_id" TEXT,
  "agreement_payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "beps_alternative_compliance_agreements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "beps_metric_inputs_building_id_compliance_cycle_filing_year_key"
  ON "beps_metric_inputs"("building_id", "compliance_cycle", "filing_year");
CREATE INDEX IF NOT EXISTS "beps_metric_inputs_organization_id_building_id_filing_year_idx"
  ON "beps_metric_inputs"("organization_id", "building_id", "filing_year");
CREATE INDEX IF NOT EXISTS "beps_metric_inputs_baseline_snapshot_id_idx"
  ON "beps_metric_inputs"("baseline_snapshot_id");
CREATE INDEX IF NOT EXISTS "beps_metric_inputs_evaluation_snapshot_id_idx"
  ON "beps_metric_inputs"("evaluation_snapshot_id");

CREATE UNIQUE INDEX IF NOT EXISTS "beps_prescriptive_items_building_id_compliance_cycle_filing_ite_key"
  ON "beps_prescriptive_items"("building_id", "compliance_cycle", "filing_year", "item_key");
CREATE INDEX IF NOT EXISTS "beps_prescriptive_items_organization_id_building_id_filing_year_idx"
  ON "beps_prescriptive_items"("organization_id", "building_id", "filing_year");

CREATE UNIQUE INDEX IF NOT EXISTS "beps_alternative_compliance_agreements_building_id_cycle_year_identifier_key"
  ON "beps_alternative_compliance_agreements"(
    "building_id",
    "compliance_cycle",
    "filing_year",
    "agreement_identifier"
  );
CREATE INDEX IF NOT EXISTS "beps_alternative_compliance_agreements_org_building_cycle_year_status_idx"
  ON "beps_alternative_compliance_agreements"(
    "organization_id",
    "building_id",
    "compliance_cycle",
    "filing_year",
    "status"
  );

ALTER TABLE "beps_metric_inputs"
  DROP CONSTRAINT IF EXISTS "beps_metric_inputs_organization_id_fkey";
ALTER TABLE "beps_metric_inputs"
  ADD CONSTRAINT "beps_metric_inputs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beps_metric_inputs"
  DROP CONSTRAINT IF EXISTS "beps_metric_inputs_building_id_organization_id_fkey";
ALTER TABLE "beps_metric_inputs"
  ADD CONSTRAINT "beps_metric_inputs_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beps_metric_inputs"
  DROP CONSTRAINT IF EXISTS "beps_metric_inputs_baseline_snapshot_id_fkey";
ALTER TABLE "beps_metric_inputs"
  ADD CONSTRAINT "beps_metric_inputs_baseline_snapshot_id_fkey"
  FOREIGN KEY ("baseline_snapshot_id") REFERENCES "compliance_snapshots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "beps_metric_inputs"
  DROP CONSTRAINT IF EXISTS "beps_metric_inputs_evaluation_snapshot_id_fkey";
ALTER TABLE "beps_metric_inputs"
  ADD CONSTRAINT "beps_metric_inputs_evaluation_snapshot_id_fkey"
  FOREIGN KEY ("evaluation_snapshot_id") REFERENCES "compliance_snapshots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "beps_metric_inputs"
  DROP CONSTRAINT IF EXISTS "beps_metric_inputs_source_artifact_id_fkey";
ALTER TABLE "beps_metric_inputs"
  ADD CONSTRAINT "beps_metric_inputs_source_artifact_id_fkey"
  FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "beps_prescriptive_items"
  DROP CONSTRAINT IF EXISTS "beps_prescriptive_items_organization_id_fkey";
ALTER TABLE "beps_prescriptive_items"
  ADD CONSTRAINT "beps_prescriptive_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beps_prescriptive_items"
  DROP CONSTRAINT IF EXISTS "beps_prescriptive_items_building_id_organization_id_fkey";
ALTER TABLE "beps_prescriptive_items"
  ADD CONSTRAINT "beps_prescriptive_items_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beps_prescriptive_items"
  DROP CONSTRAINT IF EXISTS "beps_prescriptive_items_source_artifact_id_fkey";
ALTER TABLE "beps_prescriptive_items"
  ADD CONSTRAINT "beps_prescriptive_items_source_artifact_id_fkey"
  FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "beps_alternative_compliance_agreements"
  DROP CONSTRAINT IF EXISTS "beps_alternative_compliance_agreements_organization_id_fkey";
ALTER TABLE "beps_alternative_compliance_agreements"
  ADD CONSTRAINT "beps_alternative_compliance_agreements_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beps_alternative_compliance_agreements"
  DROP CONSTRAINT IF EXISTS "beps_alternative_compliance_agreements_building_id_organization__fkey";
ALTER TABLE "beps_alternative_compliance_agreements"
  ADD CONSTRAINT "beps_alternative_compliance_agreements_building_id_organization__fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beps_alternative_compliance_agreements"
  DROP CONSTRAINT IF EXISTS "beps_alternative_compliance_agreements_source_artifact_id_fkey";
ALTER TABLE "beps_alternative_compliance_agreements"
  ADD CONSTRAINT "beps_alternative_compliance_agreements_source_artifact_id_fkey"
  FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "beps_metric_inputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beps_metric_inputs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "beps_metric_inputs";
CREATE POLICY tenant_isolation ON "beps_metric_inputs"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "beps_prescriptive_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beps_prescriptive_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "beps_prescriptive_items";
CREATE POLICY tenant_isolation ON "beps_prescriptive_items"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "beps_alternative_compliance_agreements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beps_alternative_compliance_agreements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "beps_alternative_compliance_agreements";
CREATE POLICY tenant_isolation ON "beps_alternative_compliance_agreements"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
