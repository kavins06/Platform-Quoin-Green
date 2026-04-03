CREATE TABLE "beps_cycle_registries" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "compliance_cycle" "ComplianceCycle" NOT NULL,
    "cycle_start_year" INTEGER NOT NULL,
    "cycle_end_year" INTEGER NOT NULL,
    "baseline_year_start" INTEGER NOT NULL,
    "baseline_year_end" INTEGER NOT NULL,
    "evaluation_year" INTEGER NOT NULL,
    "rule_package_id" TEXT NOT NULL,
    "factor_set_version_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beps_cycle_registries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "beps_cycle_registries_cycle_id_key" ON "beps_cycle_registries"("cycle_id");
CREATE UNIQUE INDEX "beps_cycle_registries_compliance_cycle_key" ON "beps_cycle_registries"("compliance_cycle");
CREATE INDEX "beps_cycle_registries_rule_package_id_idx" ON "beps_cycle_registries"("rule_package_id");
CREATE INDEX "beps_cycle_registries_factor_set_version_id_idx" ON "beps_cycle_registries"("factor_set_version_id");

ALTER TABLE "beps_cycle_registries"
ADD CONSTRAINT "beps_cycle_registries_rule_package_id_fkey"
FOREIGN KEY ("rule_package_id") REFERENCES "rule_packages"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "beps_cycle_registries"
ADD CONSTRAINT "beps_cycle_registries_factor_set_version_id_fkey"
FOREIGN KEY ("factor_set_version_id") REFERENCES "factor_set_versions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
