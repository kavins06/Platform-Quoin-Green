import { UnrecoverableError, type Job as QueueJob } from "bullmq";
import { createWorker, QUEUES } from "@/server/lib/queue";
import { createAuditLog } from "@/server/lib/audit-log";
import { createLogger } from "@/server/lib/logger";
import { markCompleted, markDead, markFailed, markRunning } from "@/server/lib/jobs";
import { toAppError } from "@/server/lib/errors";
import {
  enqueuePendingPortfolioManagerProviderSyncPoll,
  getPortfolioManagerProviderSyncPollIntervalMs,
  isProviderSyncRetryable,
  markPortfolioManagerProviderSyncFailed,
  runPortfolioManagerProviderSync,
} from "@/server/portfolio-manager/provider-share";
import {
  parsePortfolioManagerProviderSyncEnvelope,
  peekPortfolioManagerProviderSyncEnvelopeContext,
} from "./envelope";

export async function processPortfolioManagerProviderSyncQueueJob(job: QueueJob) {
  const envelopeHint = peekPortfolioManagerProviderSyncEnvelopeContext(job.data);
  const logger = createLogger({
    requestId: envelopeHint.requestId,
    organizationId: envelopeHint.organizationId,
    jobId: envelopeHint.operationalJobId,
    procedure: "portfolioManagerProviderSync.worker",
  });

  const writeAudit = (input: {
    action: string;
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
      },
      outputSnapshot: input.outputSnapshot,
      errorCode: input.errorCode ?? null,
    }).catch((auditError) => {
      logger.error("Portfolio Manager provider sync audit log persistence failed", {
        error: auditError,
        auditAction: input.action,
      });
      return null;
    });

  await writeAudit({
    action: "portfolio_manager_provider_sync.worker.received",
    outputSnapshot: {
      payloadVersion: envelopeHint.payloadVersion,
      jobType: envelopeHint.jobType,
    },
  });

  let envelope;
  try {
    envelope = parsePortfolioManagerProviderSyncEnvelope(job.data);
  } catch (error) {
    const appError = toAppError(error);
    if (envelopeHint.operationalJobId) {
      await markDead(envelopeHint.operationalJobId, appError.message);
    }
    await writeAudit({
      action: "portfolio_manager_provider_sync.worker.dead_lettered",
      errorCode: appError.code,
    });
    throw new UnrecoverableError(appError.message);
  }

  const runningJob = await markRunning(envelope.operationalJobId);

  try {
    const result = await runPortfolioManagerProviderSync({
      organizationId: envelope.organizationId,
      operationalJobId: envelope.operationalJobId,
    });

    await markCompleted(runningJob.id);
    await writeAudit({
      action: "portfolio_manager_provider_sync.worker.completed",
      outputSnapshot: {
        acceptedConnection: result.acceptedConnection,
        acceptedPropertyCount: result.acceptedPropertyCount,
        acceptedMeterCount: result.acceptedMeterCount,
        syncedPropertyCount: result.syncedPropertyCount,
        failedPropertyCount: result.failedPropertyCount,
      },
    });

    logger.info("Portfolio Manager provider sync job completed", {
      acceptedConnection: result.acceptedConnection,
      acceptedPropertyCount: result.acceptedPropertyCount,
      acceptedMeterCount: result.acceptedMeterCount,
      syncedPropertyCount: result.syncedPropertyCount,
      failedPropertyCount: result.failedPropertyCount,
    });
    return result;
  } catch (error) {
    const appError = toAppError(error);
    const retryable =
      isProviderSyncRetryable(error) &&
      runningJob.attempts < runningJob.maxAttempts;

    await markPortfolioManagerProviderSyncFailed({
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
        ? "portfolio_manager_provider_sync.worker.failed"
        : "portfolio_manager_provider_sync.worker.dead_lettered",
      errorCode: appError.code,
      outputSnapshot: {
        retryable,
        message: appError.message,
      },
    });

    logger.warn("Portfolio Manager provider sync job failed", {
      error: appError,
      retryable,
    });

    if (retryable) {
      throw error;
    }

    throw new UnrecoverableError(appError.message);
  }
}

export function startPortfolioManagerProviderSyncWorker() {
  return createWorker(
    QUEUES.PORTFOLIO_MANAGER_PROVIDER_SYNC,
    processPortfolioManagerProviderSyncQueueJob,
    1,
  );
}

export function startPortfolioManagerProviderSyncPollingLoop() {
  const logger = createLogger({
    component: "portfolio-manager-provider-sync-poller",
  });

  const tick = () => {
    void enqueuePendingPortfolioManagerProviderSyncPoll()
      .then((result) => {
        if (result.enqueuedCount > 0) {
          logger.info("Portfolio Manager provider sync poller enqueued jobs", result);
        }
      })
      .catch((error) => {
        logger.warn("Portfolio Manager provider sync poller failed", { error });
      });
  };

  tick();
  return setInterval(tick, getPortfolioManagerProviderSyncPollIntervalMs());
}
