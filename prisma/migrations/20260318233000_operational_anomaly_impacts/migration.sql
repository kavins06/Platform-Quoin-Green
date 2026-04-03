CREATE TYPE "OperationalAnomalyConfidenceBand" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TYPE "OperationalAnomalyPenaltyImpactStatus" AS ENUM (
  'ESTIMATED',
  'INSUFFICIENT_CONTEXT',
  'NOT_APPLICABLE'
);

ALTER TABLE "operational_anomalies"
ADD COLUMN "confidence_band" "OperationalAnomalyConfidenceBand" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN "confidence_score" DOUBLE PRECISION,
ADD COLUMN "estimated_penalty_impact_usd" DOUBLE PRECISION,
ADD COLUMN "penalty_impact_status" "OperationalAnomalyPenaltyImpactStatus" NOT NULL DEFAULT 'INSUFFICIENT_CONTEXT';
