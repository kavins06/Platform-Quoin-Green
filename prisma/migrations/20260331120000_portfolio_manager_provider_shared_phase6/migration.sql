ALTER TYPE "PortfolioManagerManagementMode"
ADD VALUE IF NOT EXISTS 'PROVIDER_SHARED';

ALTER TABLE "portfolio_manager_management"
ADD COLUMN IF NOT EXISTS "target_username" TEXT,
ADD COLUMN IF NOT EXISTS "last_connection_checked_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "last_connection_accepted_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "last_share_accepted_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lifecycle_metadata_json" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "portfolio_manager_remote_properties" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "linked_building_id" TEXT,
    "remote_account_id" BIGINT,
    "property_id" BIGINT NOT NULL,
    "share_status" TEXT,
    "name" TEXT,
    "address" TEXT,
    "primary_function" TEXT,
    "gross_square_feet" INTEGER,
    "year_built" INTEGER,
    "property_uses_json" JSONB NOT NULL DEFAULT '[]',
    "usage_summary_json" JSONB NOT NULL DEFAULT '{}',
    "latest_metrics_json" JSONB NOT NULL DEFAULT '{}',
    "raw_payload_json" JSONB NOT NULL DEFAULT '{}',
    "last_accepted_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "latest_error_code" TEXT,
    "latest_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "portfolio_manager_remote_properties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "portfolio_manager_remote_meters" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "remote_property_id" TEXT NOT NULL,
    "meter_id" BIGINT NOT NULL,
    "share_status" TEXT,
    "name" TEXT,
    "meter_type" TEXT,
    "unit" TEXT,
    "in_use" BOOLEAN NOT NULL DEFAULT true,
    "is_associated" BOOLEAN NOT NULL DEFAULT false,
    "usage_summary_json" JSONB NOT NULL DEFAULT '{}',
    "raw_payload_json" JSONB NOT NULL DEFAULT '{}',
    "last_accepted_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "latest_error_code" TEXT,
    "latest_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "portfolio_manager_remote_meters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_manager_remote_properties_organization_id_property_id_key"
ON "portfolio_manager_remote_properties"("organization_id", "property_id");

CREATE INDEX IF NOT EXISTS "portfolio_manager_remote_properties_organization_id_linked_building_id_updated_at_idx"
ON "portfolio_manager_remote_properties"("organization_id", "linked_building_id", "updated_at" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_manager_remote_meters_organization_id_meter_id_key"
ON "portfolio_manager_remote_meters"("organization_id", "meter_id");

CREATE INDEX IF NOT EXISTS "portfolio_manager_remote_meters_remote_property_id_updated_at_idx"
ON "portfolio_manager_remote_meters"("remote_property_id", "updated_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portfolio_manager_remote_properties_organization_id_fkey'
  ) THEN
    ALTER TABLE "portfolio_manager_remote_properties"
    ADD CONSTRAINT "portfolio_manager_remote_properties_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portfolio_manager_remote_properties_linked_building_id_organization_id_fkey'
  ) THEN
    ALTER TABLE "portfolio_manager_remote_properties"
    ADD CONSTRAINT "portfolio_manager_remote_properties_linked_building_id_organization_id_fkey"
    FOREIGN KEY ("linked_building_id", "organization_id")
    REFERENCES "buildings"("id", "organization_id")
    ON DELETE NO ACTION
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portfolio_manager_remote_meters_organization_id_fkey'
  ) THEN
    ALTER TABLE "portfolio_manager_remote_meters"
    ADD CONSTRAINT "portfolio_manager_remote_meters_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portfolio_manager_remote_meters_remote_property_id_fkey'
  ) THEN
    ALTER TABLE "portfolio_manager_remote_meters"
    ADD CONSTRAINT "portfolio_manager_remote_meters_remote_property_id_fkey"
    FOREIGN KEY ("remote_property_id")
    REFERENCES "portfolio_manager_remote_properties"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;
