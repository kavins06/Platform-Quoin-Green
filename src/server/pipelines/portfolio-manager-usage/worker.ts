import { UnrecoverableError, type Job as QueueJob } from "bullmq";
import { createWorker, QUEUES } from "@/server/lib/queue";
import { createAuditLog } from "@/server/lib/audit-log";
import { createLogger } from "@/server/lib/logger";
import { markCompleted, markDead, markFailed, markRunning } from "@/server/lib/jobs";
import { toAppError } from "@/server/lib/errors";
import {
  markPortfolioManagerUsageFailed,
  runPortfolioManagerUsageApply,
} from "@/server/portfolio-manager/usage";
import {
  parsePortfolioManagerUsageEnvelope,
  peekPortfolioManagerUsageEnvelopeContext,
} from "./envelope";

function shouldRetryJob(
  error: ReturnType<typeof toAppError>,
  attemptsMade: number,
  maxAttempts: number,
) {
  return error.retryable && attemptsMade < maxAttempts;
}

export async function processPortfolioManagerUsageQueueJob(job: QueueJob) {
  const envelopeHint = peekPortfolioManagerUsageEnvelopeContext(job.data);
  const logger = createLogger({
    requestId: envelopeHint.requestId,
    organizationId: envelopeHint.organizationId,
    buildingId: envelopeHint.buildingId,
    jobId: envelopeHint.operationalJobId,
    procedure: "portfolioManagerUsage.worker",
  });
  const writeAudit = (input: {
    action: string;
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
        jobType: envelopeHint.jobType,
        direction: envelopeHint.direction,
        reportingYear: envelopeHint.reportingYear,
      },
      outputSnapshot: input.outputSnapshot,
      errorCode: input.errorCode ?? null,
    }).catch((auditError) => {
      logger.error("Portfolio Manager usage audit log persistence failed", {
        error: auditError,
        auditAction: input.action,
      });
      return null;
    });

  let envelope;
  try {
    envelope = parsePortfolioManagerUsageEnvelope(job.data);
  } catch (error) {
    const appError = toAppError(error);
    if (envelopeHint.operationalJobId) {
      await markDead(envelopeHint.operationalJobId, appError.message);
    }
    await writeAudit({
      action: "portfolio_manager_usage.worker.dead_lettered",
      errorCode: appError.code,
    });
    throw new UnrecoverableError(appError.message);
  }

  const runningJob = await markRunning(envelope.operationalJobId);
  await writeAudit({
    action: "portfolio_manager_usage.worker.running",
  });

  try {
    const result = await runPortfolioManagerUsageApply({
      organizationId: envelope.organizationId,
      buildingId: envelope.buildingId,
      operationalJobId: envelope.operationalJobId,
      direction: envelope.direction,
      reportingYear: envelope.reportingYear,
    });

    await markCompleted(runningJob.id);
    await writeAudit({
      action: "portfolio_manager_usage.worker.completed",
      outputSnapshot: {
        direction: result.direction,
        reportingYear: result.reportingYear,
        usageStatus: result.usageStatus,
        coverageStatus: result.coverageStatus,
        metricsStatus: result.metricsStatus,
      },
    });

    return result;
  } catch (error) {
    const appError = toAppError(error);
    const retryable = shouldRetryJob(appError, runningJob.attempts, runningJob.maxAttempts);

    await markPortfolioManagerUsageFailed({
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
        ? "portfolio_manager_usage.worker.failed"
        : "portfolio_manager_usage.worker.dead_lettered",
      errorCode: appError.code,
      outputSnapshot: {
        retryable,
        message: appError.message,
      },
    });

    if (retryable) {
      throw error;
    }

    throw new UnrecoverableError(appError.message);
  }
}

export function startPortfolioManagerUsageWorker() {
  return createWorker(
    QUEUES.PORTFOLIO_MANAGER_USAGE,
    processPortfolioManagerUsageQueueJob,
    1,
  );
}
