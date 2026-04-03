ALTER TYPE "FilingRecordEventAction" ADD VALUE IF NOT EXISTS 'PACKET_GENERATED';
ALTER TYPE "FilingRecordEventAction" ADD VALUE IF NOT EXISTS 'PACKET_FINALIZED';

ALTER TABLE "filing_packets"
ADD COLUMN "finalized_at" TIMESTAMP(3),
ADD COLUMN "finalized_by_type" "ActorType",
ADD COLUMN "finalized_by_id" TEXT;
