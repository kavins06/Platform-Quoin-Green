import { UnrecoverableError, type Job as QueueJob } from "bullmq";
import { createWorker, QUEUES } from "@/server/lib/queue";
import { createAuditLog } from "@/server/lib/audit-log";
import { createLogger } from "@/server/lib/logger";
import { markCompleted, markDead, markFailed, markRunning } from "@/server/lib/jobs";
import { toAppError } from "@/server/lib/errors";
import { createESPMClient } from "@/server/integrations/espm";
import {
  markPortfolioManagerProvisioningFailed,
  runPortfolioManagerProvisioning,
} from "@/server/portfolio-manager/managed-provisioning";
import {
  parsePortfolioManagerProvisioningEnvelope,
  peekPortfolioManagerProvisioningEnvelopeContext,
} from "./envelope";

function shouldRetryJob(error: ReturnType<typeof toAppError>, attemptsMade: number, maxAttempts: number) {
  return error.retryable && attemptsMade < maxAttempts;
}

export async function processPortfolioManagerProvisioningQueueJob(job: QueueJob) {
  const envelopeHint = peekPortfolioManagerProvisioningEnvelopeContext(job.data);
  const logger = createLogger({
    requestId: envelopeHint.requestId,
    organizationId: envelopeHint.organizationId,
    buildingId: envelopeHint.buildingId,
    jobId: envelopeHint.operationalJobId,
    procedure: "portfolioManagerProvisioning.worker",
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
      logger.error("Portfolio Manager provisioning audit log persistence failed", {
        error: auditError,
        auditAction: input.action,
      });
      return null;
    });

  await writeAudit({
    action: "portfolio_manager_provisioning.worker.received",
    inputSnapshot: {
      payloadVersion: envelopeHint.payloadVersion,
      jobType: envelopeHint.jobType,
    },
  });

  let envelope;
  try {
    envelope = parsePortfolioManagerProvisioningEnvelope(job.data);
  } catch (error) {
    const appError = toAppError(error);
    if (envelopeHint.operationalJobId) {
      await markDead(envelopeHint.operationalJobId, appError.message);
    }
    await writeAudit({
      action: "portfolio_manager_provisioning.worker.dead_lettered",
      errorCode: appError.code,
    });
    throw new UnrecoverableError(appError.message);
  }

  const runningJob = await markRunning(envelope.operationalJobId);
  await writeAudit({
    action: "portfolio_manager_provisioning.worker.running",
    inputSnapshot: {
      trigger: envelope.trigger,
    },
  });

  try {
    const result = await runPortfolioManagerProvisioning({
      organizationId: envelope.organizationId,
      buildingId: envelope.buildingId,
      operationalJobId: envelope.operationalJobId,
      espmClient: createESPMClient(),
    });

    await markCompleted(runningJob.id);
    await writeAudit({
      action: "portfolio_manager_provisioning.worker.completed",
      outputSnapshot: {
        customerId: result.customerId,
        propertyId: result.propertyId,
        primaryFunction: result.primaryFunction,
      },
    });

    logger.info("Portfolio Manager provisioning job completed", {
      customerId: result.customerId,
      propertyId: result.propertyId,
    });
    return result;
  } catch (error) {
    const appError = toAppError(error);
    const retryable = shouldRetryJob(appError, runningJob.attempts, runningJob.maxAttempts);

    await markPortfolioManagerProvisioningFailed({
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
        ? "portfolio_manager_provisioning.worker.failed"
        : "portfolio_manager_provisioning.worker.dead_lettered",
      errorCode: appError.code,
      outputSnapshot: {
        retryable,
        message: appError.message,
      },
    });

    logger.warn("Portfolio Manager provisioning job failed", {
      error: appError,
      retryable,
    });

    if (retryable) {
      throw error;
    }

    throw new UnrecoverableError(appError.message);
  }
}

export function startPortfolioManagerProvisioningWorker() {
  return createWorker(
    QUEUES.PORTFOLIO_MANAGER_PROVISIONING,
    processPortfolioManagerProvisioningQueueJob,
    1,
  );
}
