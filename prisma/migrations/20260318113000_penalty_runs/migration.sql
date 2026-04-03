CREATE TYPE "PenaltyCalculationMode" AS ENUM ('CURRENT_BEPS_EXPOSURE');

CREATE TABLE "penalty_runs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "compliance_run_id" TEXT,
  "rule_version_id" TEXT,
  "factor_set_version_id" TEXT,
  "calculation_mode" "PenaltyCalculationMode" NOT NULL,
  "input_snapshot_ref" TEXT,
  "input_snapshot_hash" TEXT NOT NULL,
  "implementation_key" TEXT NOT NULL,
  "baseline_result_payload" JSONB NOT NULL DEFAULT '{}',
  "scenario_results_payload" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "penalty_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "penalty_runs_building_id_calculation_mode_input_snapsho_key"
  ON "penalty_runs"("building_id", "calculation_mode", "input_snapshot_hash");

CREATE INDEX "penalty_runs_organization_id_building_id_created_at_idx"
  ON "penalty_runs"("organization_id", "building_id", "created_at" DESC);

CREATE INDEX "penalty_runs_compliance_run_id_created_at_idx"
  ON "penalty_runs"("compliance_run_id", "created_at" DESC);

ALTER TABLE "penalty_runs"
  ADD CONSTRAINT "penalty_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "penalty_runs"
  ADD CONSTRAINT "penalty_runs_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "penalty_runs"
  ADD CONSTRAINT "penalty_runs_compliance_run_id_fkey"
  FOREIGN KEY ("compliance_run_id") REFERENCES "compliance_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "penalty_runs"
  ADD CONSTRAINT "penalty_runs_rule_version_id_fkey"
  FOREIGN KEY ("rule_version_id") REFERENCES "rule_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "penalty_runs"
  ADD CONSTRAINT "penalty_runs_factor_set_version_id_fkey"
  FOREIGN KEY ("factor_set_version_id") REFERENCES "factor_set_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
