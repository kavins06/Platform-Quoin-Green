CREATE TYPE "DataIssueType" AS ENUM (
  'MISSING_MONTHS',
  'OVERLAPPING_PERIODS',
  'INCOMPLETE_TWELVE_MONTH_COVERAGE',
  'DIRECT_READINGS_MISSING',
  'METER_MAPPING_MISSING',
  'PM_SYNC_REQUIRED',
  'BUILDING_METADATA_INCOMPLETE',
  'GFA_SUPPORT_MISSING',
  'METRIC_AVAILABILITY_MISSING',
  'DQC_SUPPORT_MISSING'
);

CREATE TYPE "DataIssueSeverity" AS ENUM ('BLOCKING', 'WARNING');

CREATE TYPE "DataIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

CREATE TYPE "DataIssueSource" AS ENUM ('QA', 'COMPLIANCE_ENGINE', 'SYSTEM', 'USER');

CREATE TABLE "data_issues" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "reporting_year" INTEGER,
  "issue_key" TEXT NOT NULL,
  "issue_type" "DataIssueType" NOT NULL,
  "severity" "DataIssueSeverity" NOT NULL,
  "status" "DataIssueStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "required_action" TEXT NOT NULL,
  "source" "DataIssueSource" NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "data_issues_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_issues_building_id_issue_key_key"
  ON "data_issues"("building_id", "issue_key");

CREATE INDEX "data_issues_organization_id_status_severity_detected_at_idx"
  ON "data_issues"("organization_id", "status", "severity", "detected_at" DESC);

CREATE INDEX "data_issues_organization_id_building_id_status_severity_det_idx"
  ON "data_issues"("organization_id", "building_id", "status", "severity", "detected_at" DESC);

CREATE INDEX "data_issues_building_id_status_detected_at_idx"
  ON "data_issues"("building_id", "status", "detected_at" DESC);

ALTER TABLE "data_issues"
  ADD CONSTRAINT "data_issues_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "data_issues"
  ADD CONSTRAINT "data_issues_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
