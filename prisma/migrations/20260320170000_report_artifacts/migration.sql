CREATE TYPE "GovernedReportType" AS ENUM ('COMPLIANCE_REPORT', 'EXEMPTION_REPORT');

CREATE TYPE "ReportArtifactStatus" AS ENUM ('GENERATED');

CREATE TYPE "ReportArtifactExportFormat" AS ENUM ('JSON');

CREATE TABLE "report_artifacts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "report_type" "GovernedReportType" NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ReportArtifactStatus" NOT NULL DEFAULT 'GENERATED',
  "report_hash" TEXT NOT NULL,
  "source_summary_hash" TEXT NOT NULL,
  "source_lineage" JSONB NOT NULL DEFAULT '{}',
  "payload" JSONB NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "latest_exported_at" TIMESTAMP(3),
  "latest_export_format" "ReportArtifactExportFormat",
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "report_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "report_artifacts_building_id_report_type_version_key"
  ON "report_artifacts"("building_id", "report_type", "version");

CREATE INDEX "report_artifacts_organization_id_building_id_report_type_g_idx"
  ON "report_artifacts"("organization_id", "building_id", "report_type", "generated_at" DESC);

CREATE INDEX "report_artifacts_organization_id_report_type_generated_at_idx"
  ON "report_artifacts"("organization_id", "report_type", "generated_at" DESC);

ALTER TABLE "report_artifacts"
  ADD CONSTRAINT "report_artifacts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "report_artifacts"
  ADD CONSTRAINT "report_artifacts_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
