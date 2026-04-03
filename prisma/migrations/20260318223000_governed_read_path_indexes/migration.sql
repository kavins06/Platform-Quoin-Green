CREATE INDEX IF NOT EXISTS "benchmark_submissions_organization_id_building_id_reporting_year_updated_at_idx"
ON "benchmark_submissions" (
  "organization_id",
  "building_id",
  "reporting_year" DESC,
  "updated_at" DESC
);

CREATE INDEX IF NOT EXISTS "filing_records_organization_id_building_id_filing_type_filing_year_updated_at_idx"
ON "filing_records" (
  "organization_id",
  "building_id",
  "filing_type",
  "filing_year" DESC,
  "updated_at" DESC
);

CREATE INDEX IF NOT EXISTS "penalty_runs_organization_id_building_id_calculation_mode_created_at_idx"
ON "penalty_runs" (
  "organization_id",
  "building_id",
  "calculation_mode",
  "created_at" DESC
);
