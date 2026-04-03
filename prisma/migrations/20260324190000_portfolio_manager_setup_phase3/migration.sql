-- CreateEnum
CREATE TYPE "PortfolioManagerSetupStatus" AS ENUM (
    'NOT_STARTED',
    'INPUT_REQUIRED',
    'READY_TO_APPLY',
    'APPLY_QUEUED',
    'APPLY_RUNNING',
    'APPLIED',
    'NEEDS_ATTENTION'
);

-- CreateEnum
CREATE TYPE "PortfolioManagerSetupComponentStatus" AS ENUM (
    'NOT_STARTED',
    'INPUT_REQUIRED',
    'READY_TO_APPLY',
    'APPLIED',
    'NEEDS_ATTENTION'
);

-- CreateEnum
CREATE TYPE "PortfolioManagerPropertyUseType" AS ENUM (
    'OFFICE',
    'MULTIFAMILY'
);

-- CreateTable
CREATE TABLE "portfolio_manager_setup_states" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "status" "PortfolioManagerSetupStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "property_uses_status" "PortfolioManagerSetupComponentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "meters_status" "PortfolioManagerSetupComponentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "associations_status" "PortfolioManagerSetupComponentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "usage_coverage_status" "PortfolioManagerSetupComponentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "latest_job_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "latest_error_code" TEXT,
    "latest_error_message" TEXT,
    "missing_input_codes_json" JSONB NOT NULL DEFAULT '[]',
    "last_applied_at" TIMESTAMP(3),
    "last_attempted_at" TIMESTAMP(3),
    "last_failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_manager_setup_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_manager_property_use_inputs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "use_type" "PortfolioManagerPropertyUseType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "gross_square_feet" INTEGER NOT NULL,
    "weekly_operating_hours" DOUBLE PRECISION,
    "workers_on_main_shift" INTEGER,
    "number_of_computers" INTEGER,
    "total_residential_units" INTEGER,
    "total_bedrooms" INTEGER,
    "espm_property_use_id" BIGINT,
    "espm_use_details_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_manager_property_use_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_manager_setup_states_building_id_key" ON "portfolio_manager_setup_states"("building_id");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_manager_setup_states_building_id_organization_id_key" ON "portfolio_manager_setup_states"("building_id", "organization_id");

-- CreateIndex
CREATE INDEX "portfolio_manager_setup_states_organization_id_status_updated_at_idx" ON "portfolio_manager_setup_states"("organization_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "portfolio_manager_property_use_inputs_organization_id_building_id_sort_order_idx" ON "portfolio_manager_property_use_inputs"("organization_id", "building_id", "sort_order");

-- AddForeignKey
ALTER TABLE "portfolio_manager_setup_states" ADD CONSTRAINT "portfolio_manager_setup_states_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_manager_setup_states" ADD CONSTRAINT "portfolio_manager_setup_states_building_id_organization_id_fkey" FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_manager_property_use_inputs" ADD CONSTRAINT "portfolio_manager_property_use_inputs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_manager_property_use_inputs" ADD CONSTRAINT "portfolio_manager_property_use_inputs_building_id_organization_id_fkey" FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
