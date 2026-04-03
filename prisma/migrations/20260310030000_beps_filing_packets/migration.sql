DO $$
BEGIN
  CREATE TYPE "FilingPacketStatus" AS ENUM (
    'DRAFT',
    'GENERATED',
    'STALE',
    'FINALIZED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "filing_packets" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "filing_record_id" TEXT NOT NULL,
  "filing_year" INTEGER,
  "compliance_cycle" "ComplianceCycle",
  "version" INTEGER NOT NULL,
  "status" "FilingPacketStatus" NOT NULL DEFAULT 'DRAFT',
  "packet_hash" TEXT NOT NULL,
  "packet_payload" JSONB NOT NULL DEFAULT '{}',
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stale_marked_at" TIMESTAMP(3),
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "filing_packets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "filing_packets_filing_record_id_version_key"
  ON "filing_packets"("filing_record_id", "version");

CREATE INDEX IF NOT EXISTS "filing_packets_organization_id_building_id_generated_at_idx"
  ON "filing_packets"("organization_id", "building_id", "generated_at" DESC);

CREATE INDEX IF NOT EXISTS "filing_packets_filing_record_id_generated_at_idx"
  ON "filing_packets"("filing_record_id", "generated_at" DESC);

ALTER TABLE "filing_packets"
  DROP CONSTRAINT IF EXISTS "filing_packets_organization_id_fkey";
ALTER TABLE "filing_packets"
  ADD CONSTRAINT "filing_packets_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "filing_packets"
  DROP CONSTRAINT IF EXISTS "filing_packets_building_id_organization_id_fkey";
ALTER TABLE "filing_packets"
  ADD CONSTRAINT "filing_packets_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "filing_packets"
  DROP CONSTRAINT IF EXISTS "filing_packets_filing_record_id_fkey";
ALTER TABLE "filing_packets"
  ADD CONSTRAINT "filing_packets_filing_record_id_fkey"
  FOREIGN KEY ("filing_record_id") REFERENCES "filing_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "filing_packets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "filing_packets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "filing_packets";
CREATE POLICY tenant_isolation ON "filing_packets"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
