CREATE TYPE "FinancingCaseType" AS ENUM (
  'SINGLE_CANDIDATE',
  'BUNDLE'
);

CREATE TYPE "FinancingCaseStatus" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'ARCHIVED'
);

CREATE TYPE "FinancingPacketStatus" AS ENUM (
  'DRAFT',
  'GENERATED',
  'STALE',
  'FINALIZED'
);

CREATE TABLE "financing_cases" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "case_type" "FinancingCaseType" NOT NULL DEFAULT 'SINGLE_CANDIDATE',
  "status" "FinancingCaseStatus" NOT NULL DEFAULT 'DRAFT',
  "compliance_cycle" "ComplianceCycle",
  "target_filing_year" INTEGER,
  "estimated_capex" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "estimated_annual_savings_kbtu" DOUBLE PRECISION,
  "estimated_annual_savings_usd" DOUBLE PRECISION,
  "estimated_avoided_penalty" DOUBLE PRECISION,
  "estimated_compliance_improvement_pct" DOUBLE PRECISION,
  "case_payload" JSONB NOT NULL DEFAULT '{}',
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "financing_cases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "financing_cases_organization_id_building_id_status_updated_at_idx"
  ON "financing_cases"("organization_id", "building_id", "status", "updated_at" DESC);

ALTER TABLE "financing_cases"
  ADD CONSTRAINT "financing_cases_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financing_cases"
  ADD CONSTRAINT "financing_cases_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "financing_case_candidates" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "financing_case_id" TEXT NOT NULL,
  "retrofit_candidate_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "financing_case_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "financing_case_candidates_financing_case_id_retrofit_candidate_id_key"
  ON "financing_case_candidates"("financing_case_id", "retrofit_candidate_id");

CREATE INDEX "financing_case_candidates_organization_id_building_id_financing_case_i_idx"
  ON "financing_case_candidates"("organization_id", "building_id", "financing_case_id", "sort_order");

ALTER TABLE "financing_case_candidates"
  ADD CONSTRAINT "financing_case_candidates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financing_case_candidates"
  ADD CONSTRAINT "financing_case_candidates_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financing_case_candidates"
  ADD CONSTRAINT "financing_case_candidates_financing_case_id_fkey"
  FOREIGN KEY ("financing_case_id") REFERENCES "financing_cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financing_case_candidates"
  ADD CONSTRAINT "financing_case_candidates_retrofit_candidate_id_fkey"
  FOREIGN KEY ("retrofit_candidate_id") REFERENCES "retrofit_candidates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "financing_packets" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "financing_case_id" TEXT NOT NULL,
  "compliance_cycle" "ComplianceCycle",
  "target_filing_year" INTEGER,
  "version" INTEGER NOT NULL,
  "status" "FinancingPacketStatus" NOT NULL DEFAULT 'DRAFT',
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

  CONSTRAINT "financing_packets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "financing_packets_financing_case_id_version_key"
  ON "financing_packets"("financing_case_id", "version");

CREATE INDEX "financing_packets_organization_id_building_id_generated_at_idx"
  ON "financing_packets"("organization_id", "building_id", "generated_at" DESC);

CREATE INDEX "financing_packets_financing_case_id_generated_at_idx"
  ON "financing_packets"("financing_case_id", "generated_at" DESC);

ALTER TABLE "financing_packets"
  ADD CONSTRAINT "financing_packets_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financing_packets"
  ADD CONSTRAINT "financing_packets_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financing_packets"
  ADD CONSTRAINT "financing_packets_financing_case_id_fkey"
  FOREIGN KEY ("financing_case_id") REFERENCES "financing_cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financing_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financing_cases" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "financing_cases";
CREATE POLICY tenant_isolation ON "financing_cases"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "financing_case_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financing_case_candidates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "financing_case_candidates";
CREATE POLICY tenant_isolation ON "financing_case_candidates"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);

ALTER TABLE "financing_packets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financing_packets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "financing_packets";
CREATE POLICY tenant_isolation ON "financing_packets"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
