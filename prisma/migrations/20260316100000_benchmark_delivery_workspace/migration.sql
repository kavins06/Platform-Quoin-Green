CREATE TYPE "BenchmarkRequestItemCategory" AS ENUM (
  'DC_REAL_PROPERTY_ID',
  'GROSS_FLOOR_AREA_SUPPORT',
  'AREA_ANALYSIS_DRAWINGS',
  'PROPERTY_USE_DETAILS_SUPPORT',
  'METER_ROSTER_SUPPORT',
  'UTILITY_BILLS',
  'PORTFOLIO_MANAGER_ACCESS',
  'THIRD_PARTY_VERIFICATION_SUPPORT',
  'OTHER_BENCHMARKING_SUPPORT'
);

CREATE TYPE "BenchmarkRequestItemStatus" AS ENUM (
  'NOT_REQUESTED',
  'REQUESTED',
  'RECEIVED',
  'VERIFIED',
  'BLOCKED'
);

CREATE TYPE "BenchmarkPacketStatus" AS ENUM (
  'DRAFT',
  'GENERATED',
  'STALE',
  'FINALIZED'
);

CREATE TABLE "benchmark_request_items" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "reporting_year" INTEGER,
  "category" "BenchmarkRequestItemCategory" NOT NULL,
  "title" TEXT NOT NULL,
  "status" "BenchmarkRequestItemStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "due_date" TIMESTAMP(3),
  "assigned_to" TEXT,
  "requested_from" TEXT,
  "notes" TEXT,
  "source_artifact_id" TEXT,
  "evidence_artifact_id" TEXT,
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "benchmark_request_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "benchmark_request_items_organization_id_building_id_reporting_y_idx"
  ON "benchmark_request_items"("organization_id", "building_id", "reporting_year", "updated_at" DESC);

CREATE INDEX "benchmark_request_items_organization_id_building_id_status_upd_idx"
  ON "benchmark_request_items"("organization_id", "building_id", "status", "updated_at" DESC);

ALTER TABLE "benchmark_request_items"
  ADD CONSTRAINT "benchmark_request_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "benchmark_request_items"
  ADD CONSTRAINT "benchmark_request_items_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "benchmark_request_items"
  ADD CONSTRAINT "benchmark_request_items_source_artifact_id_fkey"
  FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "benchmark_request_items"
  ADD CONSTRAINT "benchmark_request_items_evidence_artifact_id_fkey"
  FOREIGN KEY ("evidence_artifact_id") REFERENCES "evidence_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "benchmark_packets" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "benchmark_submission_id" TEXT NOT NULL,
  "reporting_year" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "BenchmarkPacketStatus" NOT NULL DEFAULT 'DRAFT',
  "packet_hash" TEXT NOT NULL,
  "packet_payload" JSONB NOT NULL DEFAULT '{}',
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stale_marked_at" TIMESTAMP(3),
  "finalized_at" TIMESTAMP(3),
  "finalized_by_type" "ActorType",
  "finalized_by_id" TEXT,
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "benchmark_packets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "benchmark_packets_benchmark_submission_id_version_key"
  ON "benchmark_packets"("benchmark_submission_id", "version");

CREATE INDEX "benchmark_packets_organization_id_building_id_reporting_year_ge_idx"
  ON "benchmark_packets"("organization_id", "building_id", "reporting_year", "generated_at" DESC);

CREATE INDEX "benchmark_packets_benchmark_submission_id_generated_at_idx"
  ON "benchmark_packets"("benchmark_submission_id", "generated_at" DESC);

ALTER TABLE "benchmark_packets"
  ADD CONSTRAINT "benchmark_packets_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "benchmark_packets"
  ADD CONSTRAINT "benchmark_packets_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "benchmark_packets"
  ADD CONSTRAINT "benchmark_packets_benchmark_submission_id_fkey"
  FOREIGN KEY ("benchmark_submission_id") REFERENCES "benchmark_submissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "benchmark_request_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "benchmark_request_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "benchmark_request_items";
CREATE POLICY tenant_isolation ON "benchmark_request_items"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "benchmark_packets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "benchmark_packets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "benchmark_packets";
CREATE POLICY tenant_isolation ON "benchmark_packets"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
