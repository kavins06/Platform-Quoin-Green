ALTER TYPE "VersionStatus" ADD VALUE 'CANDIDATE';

CREATE TYPE "GovernedPublicationKind" AS ENUM ('RULE_VERSION', 'FACTOR_SET_VERSION');

CREATE TYPE "GovernedPublicationRunStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'PUBLISHED');

CREATE TABLE "governed_publication_runs" (
    "id" TEXT NOT NULL,
    "publication_kind" "GovernedPublicationKind" NOT NULL,
    "target_key" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "rule_version_id" TEXT,
    "factor_set_version_id" TEXT,
    "fixture_set_key" TEXT NOT NULL,
    "status" "GovernedPublicationRunStatus" NOT NULL DEFAULT 'PENDING',
    "summary_payload" JSONB NOT NULL DEFAULT '{}',
    "results_payload" JSONB NOT NULL DEFAULT '[]',
    "validated_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_by_type" "ActorType" NOT NULL,
    "created_by_id" TEXT,
    "superseded_by_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governed_publication_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "governed_publication_runs_publication_kind_target_key_created_" ON "governed_publication_runs"("publication_kind", "target_key", "created_at" DESC);
CREATE INDEX "governed_publication_runs_scope_key_created_at_idx" ON "governed_publication_runs"("scope_key", "created_at" DESC);
CREATE INDEX "governed_publication_runs_status_created_at_idx" ON "governed_publication_runs"("status", "created_at" DESC);
CREATE INDEX "governed_publication_runs_rule_version_id_created_at_idx" ON "governed_publication_runs"("rule_version_id", "created_at" DESC);
CREATE INDEX "governed_publication_runs_factor_set_version_id_created_at_i" ON "governed_publication_runs"("factor_set_version_id", "created_at" DESC);

ALTER TABLE "governed_publication_runs" ADD CONSTRAINT "governed_publication_runs_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "rule_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "governed_publication_runs" ADD CONSTRAINT "governed_publication_runs_factor_set_version_id_fkey" FOREIGN KEY ("factor_set_version_id") REFERENCES "factor_set_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "governed_publication_runs" ADD CONSTRAINT "governed_publication_runs_superseded_by_run_id_fkey" FOREIGN KEY ("superseded_by_run_id") REFERENCES "governed_publication_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
