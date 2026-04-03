import { UnrecoverableError, type Job as QueueJob } from "bullmq";
import { createWorker, QUEUES } from "@/server/lib/queue";
import { createAuditLog } from "@/server/lib/audit-log";
import { createLogger } from "@/server/lib/logger";
import { markCompleted, markDead, markFailed, markRunning } from "@/server/lib/jobs";
import { toAppError } from "@/server/lib/errors";
import {
  markExistingAccountImportFailed,
  runExistingAccountPropertyImport,
} from "@/server/portfolio-manager/existing-account";
import {
  parsePortfolioManagerImportEnvelope,
  peekPortfolioManagerImportEnvelopeContext,
} from "./envelope";

function shouldRetryJob(
  error: ReturnType<typeof toAppError>,
  attemptsMade: number,
  maxAttempts: number,
) {
  return error.retryable && attemptsMade < maxAttempts;
}

export async function processPortfolioManagerImportQueueJob(job: QueueJob) {
  const envelopeHint = peekPortfolioManagerImportEnvelopeContext(job.data);
  const logger = createLogger({
    requestId: envelopeHint.requestId,
    organizationId: envelopeHint.organizationId,
    jobId: envelopeHint.operationalJobId,
    procedure: "portfolioManagerImport.worker",
  });
  const writeAudit = (input: {
    action: string;
    inputSnapshot?: Record<string, unknown>;
    outputSnapshot?: Record<string, unknown>;
    errorCode?: string | null;
  }) =>
    createAuditLog({
      actorType: "SYSTEM",
      organizationId: envelopeHint.organizationId,
      requestId: envelopeHint.requestId,
      action: input.action,
      inputSnapshot: {
        queueJobId: String(job.id ?? ""),
        workerJobId: envelopeHint.operationalJobId,
        ...(input.inputSnapshot ?? {}),
      },
      outputSnapshot: input.outputSnapshot,
      errorCode: input.errorCode ?? null,
    }).catch((auditError) => {
      logger.error("Portfolio Manager import audit log persistence failed", {
        error: auditError,
        auditAction: input.action,
      });
      return null;
    });

  await writeAudit({
    action: "portfolio_manager_import.worker.received",
    inputSnapshot: {
      payloadVersion: envelopeHint.payloadVersion,
      jobType: envelopeHint.jobType,
      propertyIds: envelopeHint.propertyIds,
    },
  });

  let envelope;
  try {
    envelope = parsePortfolioManagerImportEnvelope(job.data);
  } catch (error) {
    const appError = toAppError(error);
    if (envelopeHint.operationalJobId) {
      await markDead(envelopeHint.operationalJobId, appError.message);
    }
    await writeAudit({
      action: "portfolio_manager_import.worker.dead_lettered",
      errorCode: appError.code,
    });
    throw new UnrecoverableError(appError.message);
  }

  const runningJob = await markRunning(envelope.operationalJobId);
  await writeAudit({
    action: "portfolio_manager_import.worker.running",
    inputSnapshot: {
      propertyCount: envelope.propertyIds.length,
    },
  });

  try {
    const result = await runExistingAccountPropertyImport({
      organizationId: envelope.organizationId,
      propertyIds: envelope.propertyIds,
      operationalJobId: envelope.operationalJobId,
    });

    await markCompleted(runningJob.id);
    await writeAudit({
      action: "portfolio_manager_import.worker.completed",
      outputSnapshot: {
        importedCount: result.importedCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
      },
    });

    logger.info("Portfolio Manager import job completed", {
      importedCount: result.importedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
    });
    return result;
  } catch (error) {
    const appError = toAppError(error);
    const retryable = shouldRetryJob(appError, runningJob.attempts, runningJob.maxAttempts);

    await markExistingAccountImportFailed({
      organizationId: envelope.organizationId,
      operationalJobId: envelope.operationalJobId,
      errorCode: appError.code,
      errorMessage: appError.message,
    });

    if (retryable) {
      await markFailed(runningJob.id, appError.message);
    } else {
      await markDead(runningJob.id, appError.message);
    }

    await writeAudit({
      action: retryable
        ? "portfolio_manager_import.worker.failed"
        : "portfolio_manager_import.worker.dead_lettered",
      errorCode: appError.code,
      outputSnapshot: {
        retryable,
        message: appError.message,
      },
    });

    logger.warn("Portfolio Manager import job failed", {
      error: appError,
      retryable,
    });

    if (retryable) {
      throw error;
    }

    throw new UnrecoverableError(appError.message);
  }
}

export function startPortfolioManagerImportWorker() {
  return createWorker(
    QUEUES.PORTFOLIO_MANAGER_IMPORT,
    processPortfolioManagerImportQueueJob,
    1,
  );
}
