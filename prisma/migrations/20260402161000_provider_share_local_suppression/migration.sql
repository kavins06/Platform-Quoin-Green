ALTER TABLE "portfolio_manager_remote_properties"
ADD COLUMN "local_suppressed_at" TIMESTAMP(3),
ADD COLUMN "local_suppressed_by_type" "ActorType",
ADD COLUMN "local_suppressed_by_id" TEXT;

CREATE INDEX "portfolio_manager_remote_properties_organization_id_local_suppressed_at_updated_at_idx"
ON "portfolio_manager_remote_properties"("organization_id", "local_suppressed_at", "updated_at" DESC);
