CREATE TYPE "IntegrationRuntimeStatus" AS ENUM (
  'IDLE',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'RETRYING',
  'STALE'
);

ALTER TABLE "green_button_connections"
ADD COLUMN "runtime_status" "IntegrationRuntimeStatus" NOT NULL DEFAULT 'IDLE',
ADD COLUMN "last_webhook_received_at" TIMESTAMP(3),
ADD COLUMN "last_attempted_ingestion_at" TIMESTAMP(3),
ADD COLUMN "last_successful_ingestion_at" TIMESTAMP(3),
ADD COLUMN "last_failed_ingestion_at" TIMESTAMP(3),
ADD COLUMN "latest_error_code" TEXT,
ADD COLUMN "latest_error_message" TEXT,
ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "latest_job_id" TEXT;

ALTER TABLE "portfolio_manager_sync_states"
ADD COLUMN "last_failed_sync_at" TIMESTAMP(3),
ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "latest_job_id" TEXT,
ADD COLUMN "latest_error_code" TEXT,
ADD COLUMN "latest_error_message" TEXT;
