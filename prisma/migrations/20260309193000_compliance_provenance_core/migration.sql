-- Sprint 2: Compliance Provenance Core
-- Add immutable rule/factor version records, governed compliance runs,
-- execution manifests, artifact provenance, and canonical submission/filing
-- records without changing the monolith architecture.

DO $$
BEGIN
  CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "ComplianceRunType" AS ENUM (
    'SNAPSHOT_REFRESH',
    'BENCHMARKING_EVALUATION',
    'BEPS_EVALUATION'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "ComplianceRunStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'USER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "SourceArtifactType" AS ENUM (
    'LAW',
    'GUIDE',
    'FORM',
    'PM_EXPORT',
    'UTILITY_FILE',
    'CSV_UPLOAD',
    'GENERATED_REPORT',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "EvidenceArtifactType" AS ENUM (
    'CALCULATION_OUTPUT',
    'ENERGY_DATA',
    'PM_REPORT',
    'OWNER_ATTESTATION',
    'SYSTEM_NOTE',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "BenchmarkSubmissionStatus" AS ENUM (
    'DRAFT',
    'PREPARED',
    'SUBMITTED',
    'ACCEPTED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "FilingType" AS ENUM (
    'BENCHMARKING',
    'BEPS_COMPLIANCE',
    'BEPS_EXEMPTION',
    'BEPS_PATHWAY'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "FilingStatus" AS ENUM (
    'DRAFT',
    'GENERATED',
    'FILED',
    'ACCEPTED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "compliance_snapshots"
  ADD COLUMN IF NOT EXISTS "compliance_run_id" TEXT;

ALTER TABLE "organization_memberships"
  ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE TABLE IF NOT EXISTS "rule_packages" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL DEFAULT 'DC',
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rule_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "rule_versions" (
  "id" TEXT NOT NULL,
  "rule_package_id" TEXT NOT NULL,
  "source_artifact_id" TEXT,
  "version" TEXT NOT NULL,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "implementation_key" TEXT NOT NULL,
  "source_metadata" JSONB NOT NULL DEFAULT '{}',
  "config_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rule_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "factor_set_versions" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "source_artifact_id" TEXT,
  "version" TEXT NOT NULL,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_to" TIMESTAMP(3),
  "source_metadata" JSONB NOT NULL DEFAULT '{}',
  "factors_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "factor_set_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "compliance_runs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "rule_version_id" TEXT NOT NULL,
  "factor_set_version_id" TEXT NOT NULL,
  "pipeline_run_id" TEXT,
  "run_type" "ComplianceRunType" NOT NULL,
  "status" "ComplianceRunStatus" NOT NULL DEFAULT 'PENDING',
  "input_snapshot_ref" TEXT NOT NULL,
  "input_snapshot_hash" TEXT NOT NULL,
  "result_payload" JSONB NOT NULL DEFAULT '{}',
  "produced_by_type" "ActorType" NOT NULL,
  "produced_by_id" TEXT,
  "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "calculation_manifests" (
  "id" TEXT NOT NULL,
  "compliance_run_id" TEXT NOT NULL,
  "rule_version_id" TEXT NOT NULL,
  "factor_set_version_id" TEXT NOT NULL,
  "code_version" TEXT NOT NULL,
  "implementation_key" TEXT NOT NULL,
  "input_snapshot_ref" TEXT NOT NULL,
  "input_snapshot_hash" TEXT NOT NULL,
  "manifest_payload" JSONB NOT NULL DEFAULT '{}',
  "executed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calculation_manifests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "source_artifacts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "building_id" TEXT,
  "artifact_type" "SourceArtifactType" NOT NULL,
  "name" TEXT NOT NULL,
  "storage_uri" TEXT,
  "external_url" TEXT,
  "source_hash" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "source_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "evidence_artifacts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT,
  "compliance_run_id" TEXT,
  "benchmark_submission_id" TEXT,
  "filing_record_id" TEXT,
  "source_artifact_id" TEXT,
  "artifact_type" "EvidenceArtifactType" NOT NULL,
  "name" TEXT NOT NULL,
  "artifact_ref" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evidence_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "benchmark_submissions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "reporting_year" INTEGER NOT NULL,
  "rule_version_id" TEXT NOT NULL,
  "factor_set_version_id" TEXT NOT NULL,
  "compliance_run_id" TEXT,
  "status" "BenchmarkSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  "submission_payload" JSONB NOT NULL DEFAULT '{}',
  "submitted_at" TIMESTAMP(3),
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "benchmark_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "filing_records" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "filing_type" "FilingType" NOT NULL,
  "filing_year" INTEGER,
  "compliance_cycle" "ComplianceCycle",
  "benchmark_submission_id" TEXT,
  "compliance_run_id" TEXT,
  "status" "FilingStatus" NOT NULL DEFAULT 'DRAFT',
  "filing_payload" JSONB NOT NULL DEFAULT '{}',
  "packet_uri" TEXT,
  "filed_at" TIMESTAMP(3),
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "filing_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rule_packages_key_key"
  ON "rule_packages"("key");
CREATE INDEX IF NOT EXISTS "rule_versions_rule_package_id_status_effective_from_idx"
  ON "rule_versions"("rule_package_id", "status", "effective_from" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "rule_versions_rule_package_id_version_key"
  ON "rule_versions"("rule_package_id", "version");
CREATE INDEX IF NOT EXISTS "factor_set_versions_key_status_effective_from_idx"
  ON "factor_set_versions"("key", "status", "effective_from" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "factor_set_versions_key_version_key"
  ON "factor_set_versions"("key", "version");
CREATE INDEX IF NOT EXISTS "compliance_runs_organization_id_building_id_executed_at_idx"
  ON "compliance_runs"("organization_id", "building_id", "executed_at" DESC);
CREATE INDEX IF NOT EXISTS "compliance_runs_rule_version_id_executed_at_idx"
  ON "compliance_runs"("rule_version_id", "executed_at" DESC);
CREATE INDEX IF NOT EXISTS "compliance_runs_factor_set_version_id_executed_at_idx"
  ON "compliance_runs"("factor_set_version_id", "executed_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "calculation_manifests_compliance_run_id_key"
  ON "calculation_manifests"("compliance_run_id");
CREATE INDEX IF NOT EXISTS "calculation_manifests_executed_at_idx"
  ON "calculation_manifests"("executed_at" DESC);
CREATE INDEX IF NOT EXISTS "source_artifacts_organization_id_building_id_created_at_idx"
  ON "source_artifacts"("organization_id", "building_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "evidence_artifacts_organization_id_building_id_created_at_idx"
  ON "evidence_artifacts"("organization_id", "building_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "evidence_artifacts_compliance_run_id_idx"
  ON "evidence_artifacts"("compliance_run_id");
CREATE INDEX IF NOT EXISTS "evidence_artifacts_benchmark_submission_id_idx"
  ON "evidence_artifacts"("benchmark_submission_id");
CREATE INDEX IF NOT EXISTS "evidence_artifacts_filing_record_id_idx"
  ON "evidence_artifacts"("filing_record_id");
CREATE INDEX IF NOT EXISTS "benchmark_submissions_organization_id_reporting_year_idx"
  ON "benchmark_submissions"("organization_id", "reporting_year");
CREATE UNIQUE INDEX IF NOT EXISTS "benchmark_submissions_building_id_reporting_year_key"
  ON "benchmark_submissions"("building_id", "reporting_year");
CREATE INDEX IF NOT EXISTS "filing_records_organization_id_building_id_filing_type_crea_idx"
  ON "filing_records"("organization_id", "building_id", "filing_type", "created_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "compliance_snapshots_compliance_run_id_key"
  ON "compliance_snapshots"("compliance_run_id");

ALTER TABLE "compliance_snapshots"
  DROP CONSTRAINT IF EXISTS "compliance_snapshots_compliance_run_id_fkey";
ALTER TABLE "compliance_snapshots"
  ADD CONSTRAINT "compliance_snapshots_compliance_run_id_fkey"
  FOREIGN KEY ("compliance_run_id") REFERENCES "compliance_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rule_versions"
  DROP CONSTRAINT IF EXISTS "rule_versions_rule_package_id_fkey";
ALTER TABLE "rule_versions"
  ADD CONSTRAINT "rule_versions_rule_package_id_fkey"
  FOREIGN KEY ("rule_package_id") REFERENCES "rule_packages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rule_versions"
  DROP CONSTRAINT IF EXISTS "rule_versions_source_artifact_id_fkey";
ALTER TABLE "rule_versions"
  ADD CONSTRAINT "rule_versions_source_artifact_id_fkey"
  FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "factor_set_versions"
  DROP CONSTRAINT IF EXISTS "factor_set_versions_source_artifact_id_fkey";
ALTER TABLE "factor_set_versions"
  ADD CONSTRAINT "factor_set_versions_source_artifact_id_fkey"
  FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "compliance_runs"
  DROP CONSTRAINT IF EXISTS "compliance_runs_organization_id_fkey";
ALTER TABLE "compliance_runs"
  ADD CONSTRAINT "compliance_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compliance_runs"
  DROP CONSTRAINT IF EXISTS "compliance_runs_building_id_organization_id_fkey";
ALTER TABLE "compliance_runs"
  ADD CONSTRAINT "compliance_runs_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compliance_runs"
  DROP CONSTRAINT IF EXISTS "compliance_runs_rule_version_id_fkey";
ALTER TABLE "compliance_runs"
  ADD CONSTRAINT "compliance_runs_rule_version_id_fkey"
  FOREIGN KEY ("rule_version_id") REFERENCES "rule_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compliance_runs"
  DROP CONSTRAINT IF EXISTS "compliance_runs_factor_set_version_id_fkey";
ALTER TABLE "compliance_runs"
  ADD CONSTRAINT "compliance_runs_factor_set_version_id_fkey"
  FOREIGN KEY ("factor_set_version_id") REFERENCES "factor_set_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compliance_runs"
  DROP CONSTRAINT IF EXISTS "compliance_runs_pipeline_run_id_fkey";
ALTER TABLE "compliance_runs"
  ADD CONSTRAINT "compliance_runs_pipeline_run_id_fkey"
  FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "calculation_manifests"
  DROP CONSTRAINT IF EXISTS "calculation_manifests_compliance_run_id_fkey";
ALTER TABLE "calculation_manifests"
  ADD CONSTRAINT "calculation_manifests_compliance_run_id_fkey"
  FOREIGN KEY ("compliance_run_id") REFERENCES "compliance_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calculation_manifests"
  DROP CONSTRAINT IF EXISTS "calculation_manifests_rule_version_id_fkey";
ALTER TABLE "calculation_manifests"
  ADD CONSTRAINT "calculation_manifests_rule_version_id_fkey"
  FOREIGN KEY ("rule_version_id") REFERENCES "rule_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "calculation_manifests"
  DROP CONSTRAINT IF EXISTS "calculation_manifests_factor_set_version_id_fkey";
ALTER TABLE "calculation_manifests"
  ADD CONSTRAINT "calculation_manifests_factor_set_version_id_fkey"
  FOREIGN KEY ("factor_set_version_id") REFERENCES "factor_set_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "source_artifacts"
  DROP CONSTRAINT IF EXISTS "source_artifacts_organization_id_fkey";
ALTER TABLE "source_artifacts"
  ADD CONSTRAINT "source_artifacts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "source_artifacts"
  DROP CONSTRAINT IF EXISTS "source_artifacts_building_id_organization_id_fkey";
ALTER TABLE "source_artifacts"
  ADD CONSTRAINT "source_artifacts_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "evidence_artifacts"
  DROP CONSTRAINT IF EXISTS "evidence_artifacts_organization_id_fkey";
ALTER TABLE "evidence_artifacts"
  ADD CONSTRAINT "evidence_artifacts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evidence_artifacts"
  DROP CONSTRAINT IF EXISTS "evidence_artifacts_building_id_organization_id_fkey";
ALTER TABLE "evidence_artifacts"
  ADD CONSTRAINT "evidence_artifacts_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evidence_artifacts"
  DROP CONSTRAINT IF EXISTS "evidence_artifacts_compliance_run_id_fkey";
ALTER TABLE "evidence_artifacts"
  ADD CONSTRAINT "evidence_artifacts_compliance_run_id_fkey"
  FOREIGN KEY ("compliance_run_id") REFERENCES "compliance_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evidence_artifacts"
  DROP CONSTRAINT IF EXISTS "evidence_artifacts_benchmark_submission_id_fkey";
ALTER TABLE "evidence_artifacts"
  ADD CONSTRAINT "evidence_artifacts_benchmark_submission_id_fkey"
  FOREIGN KEY ("benchmark_submission_id") REFERENCES "benchmark_submissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evidence_artifacts"
  DROP CONSTRAINT IF EXISTS "evidence_artifacts_filing_record_id_fkey";
ALTER TABLE "evidence_artifacts"
  ADD CONSTRAINT "evidence_artifacts_filing_record_id_fkey"
  FOREIGN KEY ("filing_record_id") REFERENCES "filing_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evidence_artifacts"
  DROP CONSTRAINT IF EXISTS "evidence_artifacts_source_artifact_id_fkey";
ALTER TABLE "evidence_artifacts"
  ADD CONSTRAINT "evidence_artifacts_source_artifact_id_fkey"
  FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "benchmark_submissions"
  DROP CONSTRAINT IF EXISTS "benchmark_submissions_organization_id_fkey";
ALTER TABLE "benchmark_submissions"
  ADD CONSTRAINT "benchmark_submissions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "benchmark_submissions"
  DROP CONSTRAINT IF EXISTS "benchmark_submissions_building_id_organization_id_fkey";
ALTER TABLE "benchmark_submissions"
  ADD CONSTRAINT "benchmark_submissions_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "benchmark_submissions"
  DROP CONSTRAINT IF EXISTS "benchmark_submissions_rule_version_id_fkey";
ALTER TABLE "benchmark_submissions"
  ADD CONSTRAINT "benchmark_submissions_rule_version_id_fkey"
  FOREIGN KEY ("rule_version_id") REFERENCES "rule_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "benchmark_submissions"
  DROP CONSTRAINT IF EXISTS "benchmark_submissions_factor_set_version_id_fkey";
ALTER TABLE "benchmark_submissions"
  ADD CONSTRAINT "benchmark_submissions_factor_set_version_id_fkey"
  FOREIGN KEY ("factor_set_version_id") REFERENCES "factor_set_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "benchmark_submissions"
  DROP CONSTRAINT IF EXISTS "benchmark_submissions_compliance_run_id_fkey";
ALTER TABLE "benchmark_submissions"
  ADD CONSTRAINT "benchmark_submissions_compliance_run_id_fkey"
  FOREIGN KEY ("compliance_run_id") REFERENCES "compliance_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "filing_records"
  DROP CONSTRAINT IF EXISTS "filing_records_organization_id_fkey";
ALTER TABLE "filing_records"
  ADD CONSTRAINT "filing_records_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "filing_records"
  DROP CONSTRAINT IF EXISTS "filing_records_building_id_organization_id_fkey";
ALTER TABLE "filing_records"
  ADD CONSTRAINT "filing_records_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "filing_records"
  DROP CONSTRAINT IF EXISTS "filing_records_benchmark_submission_id_fkey";
ALTER TABLE "filing_records"
  ADD CONSTRAINT "filing_records_benchmark_submission_id_fkey"
  FOREIGN KEY ("benchmark_submission_id") REFERENCES "benchmark_submissions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "filing_records"
  DROP CONSTRAINT IF EXISTS "filing_records_compliance_run_id_fkey";
ALTER TABLE "filing_records"
  ADD CONSTRAINT "filing_records_compliance_run_id_fkey"
  FOREIGN KEY ("compliance_run_id") REFERENCES "compliance_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "compliance_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "compliance_runs";
CREATE POLICY tenant_isolation ON "compliance_runs"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "source_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_artifacts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "source_artifacts";
CREATE POLICY tenant_isolation ON "source_artifacts"
  FOR ALL
  USING (
    "organization_id" IS NULL
    OR "organization_id" = current_setting('app.organization_id', true)::text
  )
  WITH CHECK (
    "organization_id" IS NULL
    OR "organization_id" = current_setting('app.organization_id', true)::text
  );

ALTER TABLE "evidence_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence_artifacts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "evidence_artifacts";
CREATE POLICY tenant_isolation ON "evidence_artifacts"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "benchmark_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "benchmark_submissions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "benchmark_submissions";
CREATE POLICY tenant_isolation ON "benchmark_submissions"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "filing_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "filing_records" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "filing_records";
CREATE POLICY tenant_isolation ON "filing_records"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
