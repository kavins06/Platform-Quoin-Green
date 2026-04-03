CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "organization_id" TEXT,
    "building_id" TEXT,
    "action" TEXT NOT NULL,
    "input_snapshot" JSONB,
    "output_snapshot" JSONB,
    "error_code" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "organization_id" TEXT,
    "building_id" TEXT,
    "last_error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_organization_id_timestamp_idx" ON "audit_logs"("organization_id", "timestamp" DESC);
CREATE INDEX "audit_logs_building_id_timestamp_idx" ON "audit_logs"("building_id", "timestamp" DESC);
CREATE INDEX "audit_logs_action_timestamp_idx" ON "audit_logs"("action", "timestamp" DESC);

CREATE INDEX "jobs_organization_id_status_created_at_idx" ON "jobs"("organization_id", "status", "created_at" DESC);
CREATE INDEX "jobs_building_id_status_created_at_idx" ON "jobs"("building_id", "status", "created_at" DESC);
CREATE INDEX "jobs_type_status_created_at_idx" ON "jobs"("type", "status", "created_at" DESC);

ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_building_id_organization_id_fkey"
    FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jobs"
    ADD CONSTRAINT "jobs_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jobs"
    ADD CONSTRAINT "jobs_building_id_organization_id_fkey"
    FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
    ON DELETE SET NULL ON UPDATE CASCADE;
