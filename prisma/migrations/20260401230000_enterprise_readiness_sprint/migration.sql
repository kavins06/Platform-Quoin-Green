DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'ApprovalRequestType'
  ) THEN
    CREATE TYPE "ApprovalRequestType" AS ENUM (
      'PM_USAGE_PUSH',
      'REMOTE_BUILDING_DELETE',
      'SUBMISSION_WORKFLOW_TRANSITION'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'ApprovalRequestStatus'
  ) THEN
    CREATE TYPE "ApprovalRequestStatus" AS ENUM (
      'PENDING',
      'APPROVED',
      'REJECTED',
      'FAILED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "approval_requests" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT,
  "request_type" "ApprovalRequestType" NOT NULL,
  "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "request_id" TEXT,
  "requested_by_type" "ActorType" NOT NULL,
  "requested_by_id" TEXT,
  "reviewed_by_type" "ActorType",
  "reviewed_by_id" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  "review_notes" TEXT,
  "execution_error_code" TEXT,
  "execution_error_message" TEXT,
  "executed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "approval_requests_organization_id_status_requeste_idx"
  ON "approval_requests"("organization_id", "status", "requested_at" DESC);

CREATE INDEX IF NOT EXISTS "approval_requests_building_id_status_requested_at_idx"
  ON "approval_requests"("building_id", "status", "requested_at" DESC);

CREATE INDEX IF NOT EXISTS "approval_requests_organization_id_request_type_st_idx"
  ON "approval_requests"("organization_id", "request_type", "status", "requested_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approval_requests_organization_id_fkey'
  ) THEN
    ALTER TABLE "approval_requests"
      ADD CONSTRAINT "approval_requests_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approval_requests_building_id_organization_id_fkey'
  ) THEN
    ALTER TABLE "approval_requests"
      ADD CONSTRAINT "approval_requests_building_id_organization_id_fkey"
      FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
