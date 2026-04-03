CREATE TYPE "SubmissionWorkflowType" AS ENUM ('BENCHMARK_VERIFICATION', 'BEPS_FILING');

CREATE TYPE "SubmissionWorkflowState" AS ENUM (
  'DRAFT',
  'READY_FOR_REVIEW',
  'APPROVED_FOR_SUBMISSION',
  'SUBMITTED',
  'COMPLETED',
  'NEEDS_CORRECTION',
  'SUPERSEDED'
);

CREATE TABLE "submission_workflows" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "workflow_type" "SubmissionWorkflowType" NOT NULL,
  "state" "SubmissionWorkflowState" NOT NULL,
  "benchmark_packet_id" TEXT,
  "filing_packet_id" TEXT,
  "latest_transition_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ready_for_review_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "needs_correction_at" TIMESTAMP(3),
  "superseded_at" TIMESTAMP(3),
  "superseded_by_id" TEXT,
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "submission_workflows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "submission_workflow_events" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "from_state" "SubmissionWorkflowState",
  "to_state" "SubmissionWorkflowState" NOT NULL,
  "notes" TEXT,
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "submission_workflow_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "submission_workflows_benchmark_packet_id_key"
  ON "submission_workflows"("benchmark_packet_id");

CREATE UNIQUE INDEX "submission_workflows_filing_packet_id_key"
  ON "submission_workflows"("filing_packet_id");

CREATE INDEX "submission_workflows_organization_id_building_id_workflow_ty_idx"
  ON "submission_workflows"("organization_id", "building_id", "workflow_type", "latest_transition_at" DESC);

CREATE INDEX "submission_workflows_organization_id_workflow_type_state_l_idx"
  ON "submission_workflows"("organization_id", "workflow_type", "state", "latest_transition_at" DESC);

CREATE INDEX "submission_workflow_events_workflow_id_created_at_idx"
  ON "submission_workflow_events"("workflow_id", "created_at" DESC);

CREATE INDEX "submission_workflow_events_organization_id_building_id_cre_idx"
  ON "submission_workflow_events"("organization_id", "building_id", "created_at" DESC);

ALTER TABLE "submission_workflows"
  ADD CONSTRAINT "submission_workflows_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "submission_workflows"
  ADD CONSTRAINT "submission_workflows_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "submission_workflows"
  ADD CONSTRAINT "submission_workflows_benchmark_packet_id_fkey"
  FOREIGN KEY ("benchmark_packet_id") REFERENCES "benchmark_packets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "submission_workflows"
  ADD CONSTRAINT "submission_workflows_filing_packet_id_fkey"
  FOREIGN KEY ("filing_packet_id") REFERENCES "filing_packets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "submission_workflows"
  ADD CONSTRAINT "submission_workflows_superseded_by_id_fkey"
  FOREIGN KEY ("superseded_by_id") REFERENCES "submission_workflows"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "submission_workflow_events"
  ADD CONSTRAINT "submission_workflow_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "submission_workflow_events"
  ADD CONSTRAINT "submission_workflow_events_building_id_organization_id_fkey"
  FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "submission_workflow_events"
  ADD CONSTRAINT "submission_workflow_events_workflow_id_fkey"
  FOREIGN KEY ("workflow_id") REFERENCES "submission_workflows"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
