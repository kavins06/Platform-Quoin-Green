-- CreateEnum
CREATE TYPE "PortfolioManagerImportStatus" AS ENUM ('NOT_STARTED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "portfolio_manager_management"
ADD COLUMN "connected_account_id" BIGINT,
ADD COLUMN "connected_username" TEXT,
ADD COLUMN "username_encrypted" TEXT,
ADD COLUMN "password_encrypted" TEXT,
ADD COLUMN "credential_encryption_version" INTEGER,
ADD COLUMN "last_validated_at" TIMESTAMP(3),
ADD COLUMN "property_cache_json" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "property_cache_refreshed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "portfolio_manager_import_states" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" "PortfolioManagerImportStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "latest_job_id" TEXT,
    "selected_property_ids_json" JSONB NOT NULL DEFAULT '[]',
    "result_summary_json" JSONB NOT NULL DEFAULT '{}',
    "selected_count" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "latest_error_code" TEXT,
    "latest_error_message" TEXT,
    "last_attempted_at" TIMESTAMP(3),
    "last_succeeded_at" TIMESTAMP(3),
    "last_failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_manager_import_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_manager_import_states_organization_id_key" ON "portfolio_manager_import_states"("organization_id");

-- CreateIndex
CREATE INDEX "portfolio_manager_import_states_status_updated_at_idx" ON "portfolio_manager_import_states"("status", "updated_at" DESC);

-- AddForeignKey
ALTER TABLE "portfolio_manager_import_states" ADD CONSTRAINT "portfolio_manager_import_states_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
