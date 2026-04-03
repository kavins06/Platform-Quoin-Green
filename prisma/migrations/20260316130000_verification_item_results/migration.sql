CREATE TYPE "VerificationItemCategory" AS ENUM (
  'PROPERTY_METADATA',
  'GFA',
  'METER_COMPLETENESS',
  'DATA_COVERAGE',
  'METRIC_AVAILABILITY',
  'PM_LINKAGE',
  'DQC'
);

CREATE TYPE "VerificationItemStatus" AS ENUM (
  'PASS',
  'FAIL',
  'NEEDS_REVIEW'
);

CREATE TABLE "verification_item_results" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "reporting_year" INTEGER NOT NULL,
  "category" "VerificationItemCategory" NOT NULL,
  "key" TEXT NOT NULL,
  "status" "VerificationItemStatus" NOT NULL,
  "explanation" TEXT NOT NULL,
  "evidence_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "verification_item_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "verification_item_results_building_id_reporting_year_key_key"
  ON "verification_item_results"("building_id", "reporting_year", "key");

CREATE INDEX "verification_item_results_organization_id_building_id_repor_idx"
  ON "verification_item_results"("organization_id", "building_id", "reporting_year", "created_at" DESC);

ALTER TABLE "verification_item_results"
  ADD CONSTRAINT "verification_item_results_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "verification_item_results"
  ADD CONSTRAINT "verification_item_results_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "verification_item_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_item_results" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "verification_item_results";
CREATE POLICY tenant_isolation ON "verification_item_results"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
