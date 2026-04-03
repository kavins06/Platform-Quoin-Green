CREATE TYPE "PortfolioManagerMeterLinkStrategy" AS ENUM (
  'LINK_EXISTING_REMOTE',
  'CREATE_REMOTE',
  'IMPORT_REMOTE_AS_LOCAL'
);

CREATE TABLE "portfolio_manager_meter_link_states" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "meter_id" TEXT NOT NULL,
  "strategy" "PortfolioManagerMeterLinkStrategy" NOT NULL,
  "selected_remote_meter_id" BIGINT,
  "meter_status" "PortfolioManagerSetupComponentStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "association_status" "PortfolioManagerSetupComponentStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "latest_job_id" TEXT,
  "latest_error_code" TEXT,
  "latest_error_message" TEXT,
  "last_meter_applied_at" TIMESTAMP(3),
  "last_association_applied_at" TIMESTAMP(3),
  "last_failed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "portfolio_manager_meter_link_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_manager_meter_link_states_meter_id_key"
  ON "portfolio_manager_meter_link_states"("meter_id");

CREATE UNIQUE INDEX "portfolio_manager_meter_link_states_building_id_meter_id_key"
  ON "portfolio_manager_meter_link_states"("building_id", "meter_id");

CREATE INDEX "portfolio_manager_meter_link_states_organization_id_building_id_updated_at_idx"
  ON "portfolio_manager_meter_link_states"("organization_id", "building_id", "updated_at" DESC);

ALTER TABLE "portfolio_manager_meter_link_states"
  ADD CONSTRAINT "portfolio_manager_meter_link_states_organization_id_fkey"
  FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "portfolio_manager_meter_link_states"
  ADD CONSTRAINT "portfolio_manager_meter_link_states_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id")
  REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "portfolio_manager_meter_link_states"
  ADD CONSTRAINT "portfolio_manager_meter_link_states_meter_id_fkey"
  FOREIGN KEY ("meter_id")
  REFERENCES "meters"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
