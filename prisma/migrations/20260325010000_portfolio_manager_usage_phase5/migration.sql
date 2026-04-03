CREATE TYPE "PortfolioManagerUsageDirection" AS ENUM (
  'PUSH_LOCAL_TO_PM',
  'IMPORT_PM_TO_LOCAL'
);

CREATE TYPE "PortfolioManagerUsageStatus" AS ENUM (
  'NOT_STARTED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED'
);

CREATE TYPE "PortfolioManagerMetricsStatus" AS ENUM (
  'NOT_STARTED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
  'SKIPPED'
);

CREATE TYPE "PortfolioManagerCoverageStatus" AS ENUM (
  'NOT_STARTED',
  'NO_USABLE_DATA',
  'PARTIAL_COVERAGE',
  'READY_FOR_METRICS',
  'NEEDS_ATTENTION'
);

CREATE TABLE "portfolio_manager_usage_states" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "overall_status" "PortfolioManagerUsageStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "usage_status" "PortfolioManagerUsageStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "metrics_status" "PortfolioManagerMetricsStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "coverage_status" "PortfolioManagerCoverageStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "last_run_direction" "PortfolioManagerUsageDirection",
  "reporting_year" INTEGER,
  "latest_job_id" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "latest_error_code" TEXT,
  "latest_error_message" TEXT,
  "last_usage_result_json" JSONB NOT NULL DEFAULT '{}',
  "coverage_summary_json" JSONB NOT NULL DEFAULT '{}',
  "latest_metrics_json" JSONB NOT NULL DEFAULT '{}',
  "last_usage_applied_at" TIMESTAMP(3),
  "last_metrics_refreshed_at" TIMESTAMP(3),
  "last_attempted_at" TIMESTAMP(3),
  "last_failed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "portfolio_manager_usage_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_manager_usage_states_building_id_key"
  ON "portfolio_manager_usage_states"("building_id");

CREATE UNIQUE INDEX "portfolio_manager_usage_states_building_id_organization_id_key"
  ON "portfolio_manager_usage_states"("building_id", "organization_id");

CREATE INDEX "portfolio_manager_usage_states_organization_id_overall_status_updated_at_idx"
  ON "portfolio_manager_usage_states"("organization_id", "overall_status", "updated_at" DESC);

ALTER TABLE "portfolio_manager_usage_states"
  ADD CONSTRAINT "portfolio_manager_usage_states_organization_id_fkey"
  FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "portfolio_manager_usage_states"
  ADD CONSTRAINT "portfolio_manager_usage_states_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id")
  REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
