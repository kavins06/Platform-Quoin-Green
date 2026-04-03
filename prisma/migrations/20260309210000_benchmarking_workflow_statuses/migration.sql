-- Sprint 3: DC Benchmarking workflow statuses and readiness tracking

BEGIN;

CREATE TYPE "BenchmarkSubmissionStatus_new" AS ENUM (
  'DRAFT',
  'IN_REVIEW',
  'READY',
  'BLOCKED',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED'
);

ALTER TABLE "benchmark_submissions"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "benchmark_submissions"
  ALTER COLUMN "status" TYPE "BenchmarkSubmissionStatus_new"
  USING (
    CASE "status"::text
      WHEN 'PREPARED' THEN 'IN_REVIEW'
      ELSE "status"::text
    END::"BenchmarkSubmissionStatus_new"
  );

ALTER TYPE "BenchmarkSubmissionStatus" RENAME TO "BenchmarkSubmissionStatus_old";
ALTER TYPE "BenchmarkSubmissionStatus_new" RENAME TO "BenchmarkSubmissionStatus";
DROP TYPE "BenchmarkSubmissionStatus_old";

ALTER TABLE "benchmark_submissions"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

COMMIT;

ALTER TABLE "benchmark_submissions"
  ADD COLUMN IF NOT EXISTS "readiness_evaluated_at" TIMESTAMP(3);
