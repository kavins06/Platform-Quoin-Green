DO $$
BEGIN
  CREATE TYPE "FilingRecordEventAction" AS ENUM (
    'CREATED',
    'STATUS_TRANSITION',
    'EVIDENCE_LINKED',
    'EVALUATION_REFRESH'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "filing_record_events" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "filing_record_id" TEXT NOT NULL,
  "action" "FilingRecordEventAction" NOT NULL,
  "from_status" "FilingStatus",
  "to_status" "FilingStatus",
  "notes" TEXT,
  "event_payload" JSONB NOT NULL DEFAULT '{}',
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "filing_record_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "filing_record_events_organization_id_building_id_created_at_idx"
  ON "filing_record_events"("organization_id", "building_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "filing_record_events_filing_record_id_created_at_idx"
  ON "filing_record_events"("filing_record_id", "created_at" DESC);

ALTER TABLE "filing_record_events"
  DROP CONSTRAINT IF EXISTS "filing_record_events_organization_id_fkey";
ALTER TABLE "filing_record_events"
  ADD CONSTRAINT "filing_record_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "filing_record_events"
  DROP CONSTRAINT IF EXISTS "filing_record_events_building_id_organization_id_fkey";
ALTER TABLE "filing_record_events"
  ADD CONSTRAINT "filing_record_events_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "filing_record_events"
  DROP CONSTRAINT IF EXISTS "filing_record_events_filing_record_id_fkey";
ALTER TABLE "filing_record_events"
  ADD CONSTRAINT "filing_record_events_filing_record_id_fkey"
  FOREIGN KEY ("filing_record_id") REFERENCES "filing_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "filing_record_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "filing_record_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "filing_record_events";
CREATE POLICY tenant_isolation ON "filing_record_events"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
