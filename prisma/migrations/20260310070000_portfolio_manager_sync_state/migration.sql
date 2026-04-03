CREATE TYPE "PortfolioManagerSyncStatus" AS ENUM (
  'IDLE',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED'
);

CREATE TABLE "portfolio_manager_sync_states" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "status" "PortfolioManagerSyncStatus" NOT NULL DEFAULT 'IDLE',
  "last_attempted_sync_at" TIMESTAMP(3),
  "last_successful_sync_at" TIMESTAMP(3),
  "last_error_metadata" JSONB NOT NULL DEFAULT '{}',
  "source_metadata" JSONB NOT NULL DEFAULT '{}',
  "sync_metadata" JSONB NOT NULL DEFAULT '{}',
  "qa_payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "portfolio_manager_sync_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_manager_sync_states_building_id_key"
  ON "portfolio_manager_sync_states"("building_id");

CREATE INDEX "portfolio_manager_sync_states_organization_id_status_updated_at_idx"
  ON "portfolio_manager_sync_states"("organization_id", "status", "updated_at" DESC);

ALTER TABLE "portfolio_manager_sync_states"
  ADD CONSTRAINT "portfolio_manager_sync_states_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portfolio_manager_sync_states"
  ADD CONSTRAINT "portfolio_manager_sync_states_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portfolio_manager_sync_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_manager_sync_states" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "portfolio_manager_sync_states";
CREATE POLICY tenant_isolation ON "portfolio_manager_sync_states"
  FOR ALL
  USING ("organization_id" = current_setting('app.organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.organization_id', true)::text);
