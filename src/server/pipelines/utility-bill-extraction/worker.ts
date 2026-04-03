import { UnrecoverableError, type Job as QueueJob } from "bullmq";
import { z } from "zod";
import { createWorker, QUEUES } from "@/server/lib/queue";
import { createLogger } from "@/server/lib/logger";
import { processUtilityBillUpload } from "@/server/utility-bills/service";

const utilityBillJobSchema = z.object({
  uploadId: z.string().min(1),
  organizationId: z.string().min(1),
  buildingId: z.string().min(1),
  requestId: z.string().nullable().optional(),
});

export async function processUtilityBillExtractionJob(job: QueueJob) {
  const parsed = utilityBillJobSchema.safeParse(job.data);

  if (!parsed.success) {
    throw new UnrecoverableError("Invalid utility bill extraction job payload.");
  }

  const logger = createLogger({
    requestId: parsed.data.requestId ?? null,
    organizationId: parsed.data.organizationId,
    buildingId: parsed.data.buildingId,
    jobId: String(job.id ?? ""),
    procedure: "utilityBills.worker",
  });

  try {
    await processUtilityBillUpload({
      uploadId: parsed.data.uploadId,
      requestId: parsed.data.requestId ?? null,
    });
  } catch (error) {
    logger.error("Utility bill extraction job failed", { error, uploadId: parsed.data.uploadId });
    throw error instanceof Error ? error : new Error("Utility bill extraction failed.");
  }
}

export function startUtilityBillExtractionWorker() {
  const worker = createWorker(
    QUEUES.UTILITY_BILL_EXTRACTION,
    async (job) => processUtilityBillExtractionJob(job),
    2,
  );

  worker.on("failed", (job, err) => {
    const parsed = utilityBillJobSchema.safeParse(job?.data);
    createLogger({
      requestId: parsed.success ? parsed.data.requestId ?? null : null,
      organizationId: parsed.success ? parsed.data.organizationId : null,
      buildingId: parsed.success ? parsed.data.buildingId : null,
      jobId: String(job?.id ?? ""),
      procedure: "utilityBills.worker",
    }).error("Utility bill extraction queue job failed", {
      error: err,
    });
  });

  worker.on("error", (err) => {
    createLogger({
      procedure: "utilityBills.worker",
    }).error("Utility bill extraction worker process error", {
      error: err,
    });
  });

  return worker;
}
