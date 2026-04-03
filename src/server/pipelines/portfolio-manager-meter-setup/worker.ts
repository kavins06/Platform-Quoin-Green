import { UnrecoverableError, type Job as QueueJob } from "bullmq";
import { createWorker, QUEUES } from "@/server/lib/queue";
import { createAuditLog } from "@/server/lib/audit-log";
import { createLogger } from "@/server/lib/logger";
import { markCompleted, markDead, markFailed, markRunning } from "@/server/lib/jobs";
import { toAppError } from "@/server/lib/errors";
import {
  markPortfolioManagerMeterSetupFailed,
  runPortfolioManagerMeterAssociationsApply,
  runPortfolioManagerMeterSetupApply,
} from "@/server/portfolio-manager/meter-setup";
import {
  parsePortfolioManagerMeterSetupEnvelope,
  peekPortfolioManagerMeterSetupEnvelopeContext,
  PM_METER_SETUP_JOB_TYPE,
} from "./envelope";

function shouldRetryJob(
  error: ReturnType<typeof toAppError>,
  attemptsMade: number,
  maxAttempts: number,
) {
  return error.retryable && attemptsMade < maxAttempts;
}

export async function processPortfolioManagerMeterSetupQueueJob(job: QueueJob) {
  const envelopeHint = peekPortfolioManagerMeterSetupEnvelopeContext(job.data);
  const logger = createLogger({
    requestId: envelopeHint.requestId,
    organizationId: envelopeHint.organizationId,
    buildingId: envelopeHint.buildingId,
    jobId: envelopeHint.operationalJobId,
    procedure: "portfolioManagerMeterSetup.worker",
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
      },
      outputSnapshot: input.outputSnapshot,
      errorCode: input.errorCode ?? null,
    }).catch((auditError) => {
      logger.error("Portfolio Manager meter setup audit log persistence failed", {
        error: auditError,
        auditAction: input.action,
      });
      return null;
    });

  let envelope;
  try {
    envelope = parsePortfolioManagerMeterSetupEnvelope(job.data);
  } catch (error) {
    const appError = toAppError(error);
    if (envelopeHint.operationalJobId) {
      await markDead(envelopeHint.operationalJobId, appError.message);
    }
    await writeAudit({
      action: "portfolio_manager_meter_setup.worker.dead_lettered",
      errorCode: appError.code,
    });
    throw new UnrecoverableError(appError.message);
  }

  const runningJob = await markRunning(envelope.operationalJobId);
  await writeAudit({
    action: "portfolio_manager_meter_setup.worker.running",
  });

  try {
    const result =
      envelope.jobType === PM_METER_SETUP_JOB_TYPE.METER_ASSOCIATION_APPLY
        ? await runPortfolioManagerMeterAssociationsApply({
            organizationId: envelope.organizationId,
            buildingId: envelope.buildingId,
            operationalJobId: envelope.operationalJobId,
          })
        : await runPortfolioManagerMeterSetupApply({
            organizationId: envelope.organizationId,
            buildingId: envelope.buildingId,
            operationalJobId: envelope.operationalJobId,
          });

    await markCompleted(runningJob.id);
    const outputSnapshot =
      envelope.jobType === PM_METER_SETUP_JOB_TYPE.METER_ASSOCIATION_APPLY
        ? { associationCount: "associationCount" in result ? result.associationCount : 0 }
        : { meterCount: "meterCount" in result ? result.meterCount : 0 };
    await writeAudit({
      action: "portfolio_manager_meter_setup.worker.completed",
      outputSnapshot,
    });

    return result;
  } catch (error) {
    const appError = toAppError(error);
    const retryable = shouldRetryJob(appError, runningJob.attempts, runningJob.maxAttempts);

    await markPortfolioManagerMeterSetupFailed({
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
        ? "portfolio_manager_meter_setup.worker.failed"
        : "portfolio_manager_meter_setup.worker.dead_lettered",
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

export function startPortfolioManagerMeterSetupWorker() {
  return createWorker(
    QUEUES.PORTFOLIO_MANAGER_METER_SETUP,
    processPortfolioManagerMeterSetupQueueJob,
    1,
  );
}
