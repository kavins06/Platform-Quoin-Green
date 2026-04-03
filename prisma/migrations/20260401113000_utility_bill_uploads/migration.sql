ALTER TYPE "EnergySource" ADD VALUE IF NOT EXISTS 'BILL_UPLOAD';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'UtilityBillUploadStatus'
  ) THEN
    CREATE TYPE "UtilityBillUploadStatus" AS ENUM (
      'QUEUED',
      'PROCESSING',
      'READY_FOR_REVIEW',
      'FAILED',
      'CONFIRMED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'UtilityBillCandidateStatus'
  ) THEN
    CREATE TYPE "UtilityBillCandidateStatus" AS ENUM (
      'PENDING_REVIEW',
      'CONFIRMED',
      'REJECTED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'UtilityBillExtractionMethod'
  ) THEN
    CREATE TYPE "UtilityBillExtractionMethod" AS ENUM (
      'PDF_TEXT',
      'OCR_SPACE',
      'HEURISTIC',
      'GEMINI_FALLBACK'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'UtilityBillUtilityType'
  ) THEN
    CREATE TYPE "UtilityBillUtilityType" AS ENUM (
      'ELECTRIC',
      'GAS',
      'WATER'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "utility_bill_uploads" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "source_artifact_id" TEXT,
  "status" "UtilityBillUploadStatus" NOT NULL DEFAULT 'QUEUED',
  "extraction_method" "UtilityBillExtractionMethod",
  "original_file_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size_bytes" INTEGER NOT NULL,
  "storage_bucket" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "raw_text" TEXT,
  "raw_ocr_json" JSONB NOT NULL DEFAULT '{}',
  "raw_heuristic_json" JSONB NOT NULL DEFAULT '{}',
  "raw_gemini_json" JSONB NOT NULL DEFAULT '{}',
  "latest_error_code" TEXT,
  "latest_error_message" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "processed_at" TIMESTAMP(3),
  "confirmed_at" TIMESTAMP(3),
  "created_by_type" "ActorType" NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "utility_bill_uploads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "utility_bill_candidates" (
  "id" TEXT NOT NULL,
  "upload_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "building_id" TEXT NOT NULL,
  "utility_type" "UtilityBillUtilityType" NOT NULL,
  "unit" "EnergyUnit" NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "consumption" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION,
  "extraction_method" "UtilityBillExtractionMethod" NOT NULL,
  "source_page" INTEGER,
  "source_snippet" TEXT,
  "raw_result_json" JSONB NOT NULL DEFAULT '{}',
  "status" "UtilityBillCandidateStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "confirmed_reading_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "utility_bill_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "utility_bill_uploads_source_artifact_id_key"
  ON "utility_bill_uploads"("source_artifact_id");

CREATE INDEX "utility_bill_uploads_organization_id_building_id_created_idx"
  ON "utility_bill_uploads"("organization_id", "building_id", "created_at" DESC);

CREATE INDEX "utility_bill_uploads_organization_id_building_id_status_up_idx"
  ON "utility_bill_uploads"("organization_id", "building_id", "status", "updated_at" DESC);

CREATE INDEX "utility_bill_candidates_upload_id_status_created_at_idx"
  ON "utility_bill_candidates"("upload_id", "status", "created_at" ASC);

CREATE INDEX "utility_bill_candidates_organization_id_building_id_crea_idx"
  ON "utility_bill_candidates"("organization_id", "building_id", "created_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'utility_bill_uploads_organization_id_fkey'
  ) THEN
    ALTER TABLE "utility_bill_uploads"
      ADD CONSTRAINT "utility_bill_uploads_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'utility_bill_uploads_building_id_organization_id_fkey'
  ) THEN
    ALTER TABLE "utility_bill_uploads"
      ADD CONSTRAINT "utility_bill_uploads_building_id_organization_id_fkey"
      FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'utility_bill_uploads_source_artifact_id_fkey'
  ) THEN
    ALTER TABLE "utility_bill_uploads"
      ADD CONSTRAINT "utility_bill_uploads_source_artifact_id_fkey"
      FOREIGN KEY ("source_artifact_id") REFERENCES "source_artifacts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'utility_bill_candidates_upload_id_fkey'
  ) THEN
    ALTER TABLE "utility_bill_candidates"
      ADD CONSTRAINT "utility_bill_candidates_upload_id_fkey"
      FOREIGN KEY ("upload_id") REFERENCES "utility_bill_uploads"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'utility_bill_candidates_organization_id_fkey'
  ) THEN
    ALTER TABLE "utility_bill_candidates"
      ADD CONSTRAINT "utility_bill_candidates_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'utility_bill_candidates_building_id_organization_id_fkey'
  ) THEN
    ALTER TABLE "utility_bill_candidates"
      ADD CONSTRAINT "utility_bill_candidates_building_id_organization_id_fkey"
      FOREIGN KEY ("building_id", "organization_id") REFERENCES "buildings"("id", "organization_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
