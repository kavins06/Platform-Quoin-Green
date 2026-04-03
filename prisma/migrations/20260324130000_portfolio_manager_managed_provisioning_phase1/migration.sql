-- CreateEnum
CREATE TYPE "PortfolioManagerManagementMode" AS ENUM ('QUOIN_MANAGED', 'EXISTING_ESPM');

-- CreateEnum
CREATE TYPE "PortfolioManagerManagementStatus" AS ENUM ('NOT_STARTED', 'RUNNING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "PortfolioManagerProvisioningStatus" AS ENUM ('NOT_STARTED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "portfolio_manager_management" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "management_mode" "PortfolioManagerManagementMode" NOT NULL,
    "status" "PortfolioManagerManagementStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "provider_customer_id" BIGINT,
    "latest_job_id" TEXT,
    "latest_error_code" TEXT,
    "latest_error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_manager_management_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_manager_provisioning_states" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "status" "PortfolioManagerProvisioningStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "espm_property_id" BIGINT,
    "latest_job_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "latest_error_code" TEXT,
    "latest_error_message" TEXT,
    "last_attempted_at" TIMESTAMP(3),
    "last_succeeded_at" TIMESTAMP(3),
    "last_failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_manager_provisioning_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_manager_management_organization_id_key" ON "portfolio_manager_management"("organization_id");

-- CreateIndex
CREATE INDEX "portfolio_manager_management_management_mode_status_updated_idx" ON "portfolio_manager_management"("management_mode", "status", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_manager_provisioning_states_building_id_key" ON "portfolio_manager_provisioning_states"("building_id");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_manager_provisioning_states_building_id_organization_id_key" ON "portfolio_manager_provisioning_states"("building_id", "organization_id");

-- CreateIndex
CREATE INDEX "portfolio_manager_provisioning_states_organization_id_status_updated_idx" ON "portfolio_manager_provisioning_states"("organization_id", "status", "updated_at" DESC);

-- AddForeignKey
ALTER TABLE "portfolio_manager_management" ADD CONSTRAINT "portfolio_manager_management_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_manager_provisioning_states" ADD CONSTRAINT "portfolio_manager_provisioning_states_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_manager_provisioning_states" ADD CONSTRAINT "portfolio_manager_provisioning_states_building_id_organization_id_fkey" FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
