-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationTier" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'ENGINEER', 'VIEWER');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('OFFICE', 'MULTIFAMILY', 'MIXED_USE', 'OTHER');

-- CreateEnum
CREATE TYPE "EspmShareStatus" AS ENUM ('PENDING', 'LINKED', 'FAILED', 'UNLINKED');

-- CreateEnum
CREATE TYPE "GreenButtonStatus" AS ENUM ('NONE', 'PENDING_AUTH', 'ACTIVE', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "DataIngestionMethod" AS ENUM ('GREEN_BUTTON', 'CSV_UPLOAD', 'MANUAL');

-- CreateEnum
CREATE TYPE "ComplianceCycle" AS ENUM ('CYCLE_1', 'CYCLE_2', 'CYCLE_3');

-- CreateEnum
CREATE TYPE "SelectedPathway" AS ENUM ('STANDARD', 'PERFORMANCE', 'PRESCRIPTIVE', 'NONE');

-- CreateEnum
CREATE TYPE "EnergySource" AS ENUM ('GREEN_BUTTON', 'CSV_UPLOAD', 'ESPM_SYNC', 'MANUAL');

-- CreateEnum
CREATE TYPE "MeterType" AS ENUM ('ELECTRIC', 'GAS', 'STEAM', 'OTHER');

-- CreateEnum
CREATE TYPE "EnergyUnit" AS ENUM ('KWH', 'THERMS', 'KBTU', 'MMBTU');

-- CreateEnum
CREATE TYPE "SnapshotTrigger" AS ENUM ('PIPELINE_RUN', 'ESPM_SYNC', 'MANUAL', 'SCORE_CHANGE');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('COMPLIANT', 'AT_RISK', 'NON_COMPLIANT', 'EXEMPT', 'PENDING_DATA');

-- CreateEnum
CREATE TYPE "ECMCategory" AS ENUM ('HVAC', 'LIGHTING', 'ENVELOPE', 'CONTROLS', 'DHW', 'PLUG_LOAD', 'OTHER');

-- CreateEnum
CREATE TYPE "ECMStatus" AS ENUM ('RECOMMENDED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PathwayType" AS ENUM ('STANDARD', 'PERFORMANCE', 'PRESCRIPTIVE');

-- CreateEnum
CREATE TYPE "PathwayStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "FundingType" AS ENUM ('CLEER', 'CPACE', 'AHRA_GRANT', 'IRA_REBATE', 'OWNER_EQUITY', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "CapitalStackStatus" AS ENUM ('DRAFT', 'PROPOSED', 'APPROVED', 'FUNDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('EUI_SPIKE', 'SCORE_DROP', 'CONSUMPTION_ANOMALY', 'SEASONAL_DEVIATION', 'SUSTAINED_DRIFT');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "PipelineType" AS ENUM ('DATA_INGESTION', 'PATHWAY_ANALYSIS', 'CAPITAL_STRUCTURING', 'DRIFT_DETECTION', 'FULL_CYCLE');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('SCHEDULED', 'MANUAL', 'WEBHOOK', 'CSV_UPLOAD');

-- CreateEnum
CREATE TYPE "PipelineStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubmissionType" AS ENUM ('BENCHMARKING', 'COMPLETED_ACTIONS_REPORT', 'PATHWAY_SELECTION');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'VALIDATED', 'SUBMITTED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "clerk_org_id" TEXT NOT NULL,
    "tier" "OrganizationTier" NOT NULL DEFAULT 'FREE',
    "stripe_customer_id" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "gross_square_feet" INTEGER NOT NULL,
    "property_type" "PropertyType" NOT NULL,
    "year_built" INTEGER,
    "espm_property_id" BIGINT,
    "espm_share_status" "EspmShareStatus" NOT NULL DEFAULT 'UNLINKED',
    "green_button_status" "GreenButtonStatus" NOT NULL DEFAULT 'NONE',
    "green_button_resource_uri" TEXT,
    "green_button_token_expires_at" TIMESTAMP(3),
    "data_ingestion_method" "DataIngestionMethod" NOT NULL DEFAULT 'CSV_UPLOAD',
    "beps_target_score" DOUBLE PRECISION NOT NULL,
    "compliance_cycle" "ComplianceCycle" NOT NULL DEFAULT 'CYCLE_1',
    "selected_pathway" "SelectedPathway" NOT NULL DEFAULT 'NONE',
    "max_penalty_exposure" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_readings" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source" "EnergySource" NOT NULL,
    "meter_type" "MeterType" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "consumption" DOUBLE PRECISION NOT NULL,
    "unit" "EnergyUnit" NOT NULL,
    "consumption_kbtu" DOUBLE PRECISION NOT NULL,
    "cost" DOUBLE PRECISION,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "upload_batch_id" TEXT,
    "raw_payload" JSONB,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_snapshots" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "snapshot_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger_type" "SnapshotTrigger" NOT NULL,
    "pipeline_run_id" TEXT,
    "energy_star_score" DOUBLE PRECISION,
    "site_eui" DOUBLE PRECISION,
    "source_eui" DOUBLE PRECISION,
    "compliance_status" "ComplianceStatus" NOT NULL,
    "compliance_gap" DOUBLE PRECISION,
    "estimated_penalty" DOUBLE PRECISION,
    "data_quality_score" DOUBLE PRECISION,

    CONSTRAINT "compliance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_conservation_measures" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "pathway_id" TEXT NOT NULL,
    "category" "ECMCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "estimated_cost" DOUBLE PRECISION NOT NULL,
    "annual_savings_kbtu" DOUBLE PRECISION NOT NULL,
    "annual_savings_dollars" DOUBLE PRECISION NOT NULL,
    "score_impact" DOUBLE PRECISION NOT NULL,
    "useful_life_years" INTEGER NOT NULL,
    "implementation_weeks" INTEGER NOT NULL,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "status" "ECMStatus" NOT NULL DEFAULT 'RECOMMENDED',
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_conservation_measures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_sources" (
    "id" TEXT NOT NULL,
    "capital_stack_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "FundingType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "interest_rate" DOUBLE PRECISION,
    "term_months" INTEGER,
    "monthly_payment" DOUBLE PRECISION,
    "is_eligible" BOOLEAN NOT NULL,
    "eligibility_notes" TEXT,
    "application_status" "ApplicationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "application_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_pathways" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "pathway_type" "PathwayType" NOT NULL,
    "baseline_score" DOUBLE PRECISION NOT NULL,
    "baseline_eui" DOUBLE PRECISION NOT NULL,
    "target_metric" TEXT NOT NULL,
    "projected_final_score" DOUBLE PRECISION,
    "projected_penalty_reduction" DOUBLE PRECISION,
    "confidence_level" DOUBLE PRECISION,
    "total_ecm_cost" DOUBLE PRECISION,
    "status" "PathwayStatus" NOT NULL DEFAULT 'DRAFT',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ai_analysis" TEXT,
    "ai_model_used" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_pathways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_stacks" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "pathway_id" TEXT NOT NULL,
    "total_project_cost" DOUBLE PRECISION NOT NULL,
    "estimated_monthly_savings" DOUBLE PRECISION NOT NULL,
    "simple_payback_months" DOUBLE PRECISION NOT NULL,
    "cash_flow_positive_day1" BOOLEAN NOT NULL,
    "status" "CapitalStackStatus" NOT NULL DEFAULT 'DRAFT',
    "proposal_doc_url" TEXT,
    "ai_analysis" TEXT,
    "ai_model_used" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capital_stacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_alerts" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "alert_type" "AlertType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ai_analysis" TEXT,
    "baseline_value" DOUBLE PRECISION NOT NULL,
    "actual_value" DOUBLE PRECISION NOT NULL,
    "deviation_percent" DOUBLE PRECISION NOT NULL,
    "estimated_annual_impact" DOUBLE PRECISION,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drift_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "building_id" TEXT,
    "pipeline_type" "PipelineType" NOT NULL,
    "trigger_type" "TriggerType" NOT NULL,
    "status" "PipelineStatus" NOT NULL DEFAULT 'QUEUED',
    "input_summary" JSONB NOT NULL,
    "output_summary" JSONB,
    "llm_calls" INTEGER NOT NULL DEFAULT 0,
    "llm_tokens_used" INTEGER,
    "llm_model" TEXT,
    "llm_cost_cents" INTEGER,
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doee_submissions" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "submission_type" "SubmissionType" NOT NULL,
    "reporting_year" INTEGER NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "due_date" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "document_url" TEXT,
    "submitted_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doee_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_clerk_org_id_key" ON "organizations"("clerk_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "buildings_organization_id_idx" ON "buildings"("organization_id");

-- CreateIndex
CREATE INDEX "energy_readings_building_id_period_start_idx" ON "energy_readings"("building_id", "period_start" DESC);

-- CreateIndex
CREATE INDEX "energy_readings_building_id_source_ingested_at_idx" ON "energy_readings"("building_id", "source", "ingested_at" DESC);

-- CreateIndex
CREATE INDEX "energy_readings_organization_id_building_id_idx" ON "energy_readings"("organization_id", "building_id");

-- CreateIndex
CREATE INDEX "compliance_snapshots_building_id_snapshot_date_idx" ON "compliance_snapshots"("building_id", "snapshot_date" DESC);

-- CreateIndex
CREATE INDEX "compliance_snapshots_organization_id_building_id_idx" ON "compliance_snapshots"("organization_id", "building_id");

-- CreateIndex
CREATE INDEX "energy_conservation_measures_organization_id_category_statu_idx" ON "energy_conservation_measures"("organization_id", "category", "status");

-- CreateIndex
CREATE INDEX "energy_conservation_measures_organization_id_building_id_idx" ON "energy_conservation_measures"("organization_id", "building_id");

-- CreateIndex
CREATE INDEX "funding_sources_organization_id_type_application_status_idx" ON "funding_sources"("organization_id", "type", "application_status");

-- CreateIndex
CREATE INDEX "funding_sources_organization_id_idx" ON "funding_sources"("organization_id");

-- CreateIndex
CREATE INDEX "compliance_pathways_organization_id_building_id_idx" ON "compliance_pathways"("organization_id", "building_id");

-- CreateIndex
CREATE INDEX "capital_stacks_organization_id_building_id_idx" ON "capital_stacks"("organization_id", "building_id");

-- CreateIndex
CREATE INDEX "drift_alerts_building_id_status_severity_idx" ON "drift_alerts"("building_id", "status", "severity");

-- CreateIndex
CREATE INDEX "drift_alerts_organization_id_building_id_idx" ON "drift_alerts"("organization_id", "building_id");

-- CreateIndex
CREATE INDEX "pipeline_runs_pipeline_type_status_created_at_idx" ON "pipeline_runs"("pipeline_type", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "pipeline_runs_organization_id_building_id_idx" ON "pipeline_runs"("organization_id", "building_id");

-- CreateIndex
CREATE INDEX "doee_submissions_organization_id_building_id_idx" ON "doee_submissions"("organization_id", "building_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_readings" ADD CONSTRAINT "energy_readings_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_snapshots" ADD CONSTRAINT "compliance_snapshots_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_snapshots" ADD CONSTRAINT "compliance_snapshots_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_conservation_measures" ADD CONSTRAINT "energy_conservation_measures_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_conservation_measures" ADD CONSTRAINT "energy_conservation_measures_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "compliance_pathways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_sources" ADD CONSTRAINT "funding_sources_capital_stack_id_fkey" FOREIGN KEY ("capital_stack_id") REFERENCES "capital_stacks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_pathways" ADD CONSTRAINT "compliance_pathways_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_stacks" ADD CONSTRAINT "capital_stacks_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_stacks" ADD CONSTRAINT "capital_stacks_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "compliance_pathways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_alerts" ADD CONSTRAINT "drift_alerts_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_alerts" ADD CONSTRAINT "drift_alerts_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doee_submissions" ADD CONSTRAINT "doee_submissions_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doee_submissions" ADD CONSTRAINT "doee_submissions_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "compliance_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
