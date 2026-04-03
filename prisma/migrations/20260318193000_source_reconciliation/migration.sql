CREATE TYPE "SourceReconciliationStatus" AS ENUM ('CLEAN', 'CONFLICTED', 'INCOMPLETE');

CREATE TYPE "CanonicalSourceSystem" AS ENUM (
  'PORTFOLIO_MANAGER',
  'GREEN_BUTTON',
  'CSV_UPLOAD',
  'MANUAL'
);

CREATE TYPE "SourceReconciliationConflictType" AS ENUM (
  'BUILDING_LINKAGE_INCOMPLETE',
  'GREEN_BUTTON_LINKAGE_INCOMPLETE',
  'METER_SOURCE_CONFLICT',
  'METER_LINKAGE_INCOMPLETE',
  'CONSUMPTION_TOTAL_MISMATCH'
);

CREATE TABLE "building_source_reconciliations" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "status" "SourceReconciliationStatus" NOT NULL,
  "canonical_source" "CanonicalSourceSystem",
  "reference_year" INTEGER,
  "conflict_count" INTEGER NOT NULL DEFAULT 0,
  "incomplete_count" INTEGER NOT NULL DEFAULT 0,
  "source_records_json" JSONB NOT NULL DEFAULT '[]',
  "conflicts_json" JSONB NOT NULL DEFAULT '[]',
  "chosen_values_json" JSONB NOT NULL DEFAULT '{}',
  "last_reconciled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reconciled_by_type" "ActorType" NOT NULL,
  "reconciled_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "building_source_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meter_source_reconciliations" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "meter_id" TEXT NOT NULL,
  "building_source_reconciliation_id" TEXT NOT NULL,
  "status" "SourceReconciliationStatus" NOT NULL,
  "canonical_source" "CanonicalSourceSystem",
  "conflict_count" INTEGER NOT NULL DEFAULT 0,
  "source_records_json" JSONB NOT NULL DEFAULT '[]',
  "conflicts_json" JSONB NOT NULL DEFAULT '[]',
  "chosen_values_json" JSONB NOT NULL DEFAULT '{}',
  "last_reconciled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reconciled_by_type" "ActorType" NOT NULL,
  "reconciled_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "meter_source_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "building_source_reconciliations_building_id_key"
  ON "building_source_reconciliations"("building_id");

CREATE UNIQUE INDEX "building_source_reconciliations_building_id_organization_i_key"
  ON "building_source_reconciliations"("building_id", "organization_id");

CREATE INDEX "building_source_reconciliations_organization_id_status_update_idx"
  ON "building_source_reconciliations"("organization_id", "status", "updated_at" DESC);

CREATE INDEX "building_source_reconciliations_building_id_updated_at_idx"
  ON "building_source_reconciliations"("building_id", "updated_at" DESC);

CREATE UNIQUE INDEX "meter_source_reconciliations_meter_id_key"
  ON "meter_source_reconciliations"("meter_id");

CREATE INDEX "meter_source_reconciliations_organization_id_building_id_st_idx"
  ON "meter_source_reconciliations"("organization_id", "building_id", "status", "updated_at" DESC);

CREATE INDEX "meter_source_reconciliations_building_source_reconciliatio_idx"
  ON "meter_source_reconciliations"("building_source_reconciliation_id");

ALTER TABLE "building_source_reconciliations"
  ADD CONSTRAINT "building_source_reconciliations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "building_source_reconciliations"
  ADD CONSTRAINT "building_source_reconciliations_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meter_source_reconciliations"
  ADD CONSTRAINT "meter_source_reconciliations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meter_source_reconciliations"
  ADD CONSTRAINT "meter_source_reconciliations_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meter_source_reconciliations"
  ADD CONSTRAINT "meter_source_reconciliations_meter_id_fkey"
  FOREIGN KEY ("meter_id") REFERENCES "meters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meter_source_reconciliations"
  ADD CONSTRAINT "meter_source_reconciliations_building_source_reconciliat_fkey"
  FOREIGN KEY ("building_source_reconciliation_id") REFERENCES "building_source_reconciliations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
