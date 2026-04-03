-- AlterEnum
BEGIN;
CREATE TYPE "PipelineType_new" AS ENUM ('DATA_INGESTION', 'FULL_CYCLE');
ALTER TABLE "pipeline_runs" ALTER COLUMN "pipeline_type" TYPE "PipelineType_new" USING ("pipeline_type"::text::"PipelineType_new");
ALTER TYPE "PipelineType" RENAME TO "PipelineType_old";
ALTER TYPE "PipelineType_new" RENAME TO "PipelineType";
DROP TYPE "public"."PipelineType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "capital_stacks" DROP CONSTRAINT "capital_stacks_building_id_fkey";

-- DropForeignKey
ALTER TABLE "capital_stacks" DROP CONSTRAINT "capital_stacks_pathway_id_fkey";

-- DropForeignKey
ALTER TABLE "compliance_pathways" DROP CONSTRAINT "compliance_pathways_building_id_fkey";

-- DropForeignKey
ALTER TABLE "doee_submissions" DROP CONSTRAINT "doee_submissions_building_id_fkey";

-- DropForeignKey
ALTER TABLE "doee_submissions" DROP CONSTRAINT "doee_submissions_snapshot_id_fkey";

-- DropForeignKey
ALTER TABLE "drift_alerts" DROP CONSTRAINT "drift_alerts_building_id_fkey";

-- DropForeignKey
ALTER TABLE "drift_alerts" DROP CONSTRAINT "drift_alerts_resolved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "energy_conservation_measures" DROP CONSTRAINT "energy_conservation_measures_building_id_fkey";

-- DropForeignKey
ALTER TABLE "energy_conservation_measures" DROP CONSTRAINT "energy_conservation_measures_pathway_id_fkey";

-- DropForeignKey
ALTER TABLE "funding_sources" DROP CONSTRAINT "funding_sources_capital_stack_id_fkey";

-- AlterTable
ALTER TABLE "buildings" DROP COLUMN "green_button_access_token",
DROP COLUMN "green_button_connected_at",
DROP COLUMN "green_button_refresh_token",
DROP COLUMN "green_button_resource_uri",
DROP COLUMN "green_button_subscription_id",
DROP COLUMN "green_button_token_expires_at",
ADD COLUMN     "baseline_year" INTEGER,
ADD COLUMN     "doee_building_id" TEXT,
ADD COLUMN     "target_eui" DOUBLE PRECISION,
ADD COLUMN     "ward" INTEGER,
ALTER COLUMN "max_penalty_exposure" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "compliance_snapshots" ADD COLUMN     "active_pathway" "SelectedPathway",
ADD COLUMN     "penalty_inputs_json" JSONB,
ADD COLUMN     "target_eui" DOUBLE PRECISION,
ADD COLUMN     "target_score" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "energy_readings" ADD COLUMN     "meter_id" TEXT;

-- DropTable
DROP TABLE "capital_stacks";

-- DropTable
DROP TABLE "compliance_pathways";

-- DropTable
DROP TABLE "doee_submissions";

-- DropTable
DROP TABLE "drift_alerts";

-- DropTable
DROP TABLE "energy_conservation_measures";

-- DropTable
DROP TABLE "funding_sources";

-- DropEnum
DROP TYPE "AlertSeverity";

-- DropEnum
DROP TYPE "AlertStatus";

-- DropEnum
DROP TYPE "AlertType";

-- DropEnum
DROP TYPE "ApplicationStatus";

-- DropEnum
DROP TYPE "CapitalStackStatus";

-- DropEnum
DROP TYPE "ECMCategory";

-- DropEnum
DROP TYPE "ECMStatus";

-- DropEnum
DROP TYPE "FundingType";

-- DropEnum
DROP TYPE "PathwayStatus";

-- DropEnum
DROP TYPE "PathwayType";

-- DropEnum
DROP TYPE "SubmissionStatus";

-- DropEnum
DROP TYPE "SubmissionType";

-- CreateTable
CREATE TABLE "meters" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "espm_meter_id" BIGINT,
    "meter_type" "MeterType" NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "EnergyUnit" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "green_button_connections" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" "GreenButtonStatus" NOT NULL DEFAULT 'PENDING_AUTH',
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "resource_uri" TEXT,
    "subscription_id" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "green_button_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meters_building_id_idx" ON "meters"("building_id");

-- CreateIndex
CREATE INDEX "meters_organization_id_idx" ON "meters"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "green_button_connections_building_id_key" ON "green_button_connections"("building_id");

-- CreateIndex
CREATE INDEX "green_button_connections_organization_id_idx" ON "green_button_connections"("organization_id");

-- AddForeignKey
ALTER TABLE "meters" ADD CONSTRAINT "meters_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_readings" ADD CONSTRAINT "energy_readings_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "green_button_connections" ADD CONSTRAINT "green_button_connections_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
