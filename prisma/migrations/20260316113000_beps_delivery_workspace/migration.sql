CREATE TYPE "BepsRequestItemCategory" AS ENUM (
  'PATHWAY_SELECTION_SUPPORT',
  'COMPLETED_ACTIONS_EVIDENCE',
  'ENERGY_AUDIT',
  'ACTION_PLAN_SUPPORT',
  'IMPLEMENTATION_DOCUMENTATION',
  'EVALUATION_MONITORING_DOCUMENTATION',
  'DELAY_SUBSTANTIATION',
  'EXEMPTION_SUBSTANTIATION',
  'ACP_SUPPORT_DOCS',
  'OTHER_PATHWAY_EVIDENCE'
);

CREATE TYPE "BepsRequestItemStatus" AS ENUM (
  'NOT_REQUESTED',
  'REQUESTED',
  'RECEIVED',
  'VERIFIED',
  'BLOCKED'
);

CREATE TYPE "BepsPacketType" AS ENUM (
  'PATHWAY_SELECTION',
  'COMPLETED_ACTIONS',
  'PRESCRIPTIVE_PHASE_1_AUDIT',
  'PRESCRIPTIVE_PHASE_2_ACTION_PLAN',
  'PRESCRIPTIVE_PHASE_3_IMPLEMENTATION',
  'PRESCRIPTIVE_PHASE_4_EVALUATION',
  'DELAY_REQUEST',
  'EXEMPTION_REQUEST',
  'ACP_SUPPORT'
);

ALTER TABLE "filing_packets"
  ADD COLUMN "packet_type" "BepsPacketType" NOT NULL DEFAULT 'COMPLETED_ACTIONS';

DROP INDEX IF EXISTS "filing_packets_filing_record_id_version_key";

CREATE UNIQUE INDEX "filing_packets_filing_record_id_packet_type_version_key"
  ON "filing_packets"("filing_record_id", "packet_type", "version");

CREATE INDEX "filing_packets_organization_id_building_id_packet_type_gene_idx"
  ON "filing_packets"("organization_id", "building_id", "packet_type", "generated_at" DESC);

CREATE INDEX "filing_packets_filing_record_id_packet_type_generated_at_idx"
  ON "filing_packets"("filing_record_id", "packet_type", "generated_at" DESC);

CREATE TABLE "beps_request_items" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "filing_record_id" TEXT,
  "compliance_cycle" "ComplianceCycle",
  "filing_year" INTEGER,
  "packet_type" "BepsPacketType",
  "category" "BepsRequestItemCategory" NOT NULL,
  "title" TEXT NOT NULL,
  "status" "BepsRequestItemStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
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

  CONSTRAINT "beps_request_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "beps_request_items_organization_id_building_id_filing_year__idx"
  ON "beps_request_items"("organization_id", "building_id", "filing_year", "updated_at" DESC);

CREATE INDEX "beps_request_items_organization_id_building_id_filing_recor_idx"
  ON "beps_request_items"("organization_id", "building_id", "filing_record_id", "updated_at" DESC);

CREATE INDEX "beps_request_items_organization_id_building_id_packet_type__idx"
  ON "beps_request_items"("organization_id", "building_id", "packet_type", "status", "updated_at" DESC);

ALTER TABLE "beps_request_items"
  ADD CONSTRAINT "beps_request_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "beps_request_items"
  ADD CONSTRAINT "beps_request_items_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "beps_request_items"
  ADD CONSTRAINT "beps_request_items_filing_record_id_fkey"
  FOREIGN KEY ("filing_record_id") REFERENCES "filing_records"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "beps_request_items"
  ADD CONSTRAINT "beps_request_items_source_artifact_id_fkey"
  FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "beps_request_items"
  ADD CONSTRAINT "beps_request_items_evidence_artifact_id_fkey"
  FOREIGN KEY ("evidence_artifact_id") REFERENCES "evidence_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "beps_request_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beps_request_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "beps_request_items";
CREATE POLICY tenant_isolation ON "beps_request_items"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
