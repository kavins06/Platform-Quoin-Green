import { UnrecoverableError, type Job as QueueJob } from "bullmq";
import { createWorker, QUEUES } from "@/server/lib/queue";
import { createAuditLog } from "@/server/lib/audit-log";
import { createLogger } from "@/server/lib/logger";
import { markCompleted, markDead, markFailed, markRunning } from "@/server/lib/jobs";
import { toAppError } from "@/server/lib/errors";
import {
  markPortfolioManagerSetupFailed,
  runPortfolioManagerSetupApply,
} from "@/server/portfolio-manager/setup";
import {
  parsePortfolioManagerSetupEnvelope,
  peekPortfolioManagerSetupEnvelopeContext,
} from "./envelope";

function shouldRetryJob(
  error: ReturnType<typeof toAppError>,
  attemptsMade: number,
  maxAttempts: number,
) {
  return error.retryable && attemptsMade < maxAttempts;
}

export async function processPortfolioManagerSetupQueueJob(job: QueueJob) {
  const envelopeHint = peekPortfolioManagerSetupEnvelopeContext(job.data);
  const logger = createLogger({
    requestId: envelopeHint.requestId,
    organizationId: envelopeHint.organizationId,
    buildingId: envelopeHint.buildingId,
    jobId: envelopeHint.operationalJobId,
    procedure: "portfolioManagerSetup.worker",
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
      buildingId: envelopeHint.buildingId,
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
      logger.error("Portfolio Manager setup audit log persistence failed", {
        error: auditError,
        auditAction: input.action,
      });
      return null;
    });

  await writeAudit({
    action: "portfolio_manager_setup.worker.received",
    inputSnapshot: {
      payloadVersion: envelopeHint.payloadVersion,
      jobType: envelopeHint.jobType,
    },
  });

  let envelope;
  try {
    envelope = parsePortfolioManagerSetupEnvelope(job.data);
  } catch (error) {
    const appError = toAppError(error);
    if (envelopeHint.operationalJobId) {
      await markDead(envelopeHint.operationalJobId, appError.message);
    }
    await writeAudit({
      action: "portfolio_manager_setup.worker.dead_lettered",
      errorCode: appError.code,
    });
    throw new UnrecoverableError(appError.message);
  }

  const runningJob = await markRunning(envelope.operationalJobId);
  await writeAudit({
    action: "portfolio_manager_setup.worker.running",
  });

  try {
    const result = await runPortfolioManagerSetupApply({
      organizationId: envelope.organizationId,
      buildingId: envelope.buildingId,
      operationalJobId: envelope.operationalJobId,
    });

    await markCompleted(runningJob.id);
    await writeAudit({
      action: "portfolio_manager_setup.worker.completed",
      outputSnapshot: {
        propertyUseCount: result.propertyUseCount,
      },
    });

    logger.info("Portfolio Manager setup job completed", {
      propertyUseCount: result.propertyUseCount,
    });
    return result;
  } catch (error) {
    const appError = toAppError(error);
    const retryable = shouldRetryJob(appError, runningJob.attempts, runningJob.maxAttempts);

    await markPortfolioManagerSetupFailed({
      organizationId: envelope.organizationId,
      buildingId: envelope.buildingId,
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
        ? "portfolio_manager_setup.worker.failed"
        : "portfolio_manager_setup.worker.dead_lettered",
      errorCode: appError.code,
      outputSnapshot: {
        retryable,
        message: appError.message,
      },
    });

    logger.warn("Portfolio Manager setup job failed", {
      error: appError,
      retryable,
    });

    if (retryable) {
      throw error;
    }

    throw new UnrecoverableError(appError.message);
  }
}

export function startPortfolioManagerSetupWorker() {
  return createWorker(
    QUEUES.PORTFOLIO_MANAGER_SETUP,
    processPortfolioManagerSetupQueueJob,
    1,
  );
}
