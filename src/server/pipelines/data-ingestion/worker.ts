import { UnrecoverableError, type Job as QueueJob } from "bullmq";
import { createWorker, QUEUES } from "@/server/lib/queue";
import { createAuditLog } from "@/server/lib/audit-log";
import { getTenantClient } from "@/server/lib/db";
import {
  ContractValidationError,
  toAppError,
  ValidationError,
  WorkflowStateError,
} from "@/server/lib/errors";
import {
  createJob,
  JOB_STATUS,
  markCompleted,
  markDead,
  markFailed,
  markRunning,
} from "@/server/lib/jobs";
import { createLogger } from "@/server/lib/logger";
import { refreshBuildingIssuesAfterDataChange } from "@/server/compliance/data-issues";
import { runIngestionPipeline } from "./logic";
import {
  INGESTION_JOB_TYPE,
  parseIngestionEnvelope,
  peekIngestionEnvelopeContext,
  type IngestionEnvelope,
} from "./envelope";
import { processGreenButtonNotificationEnvelope } from "./green-button";
import {
  markGreenButtonIngestionFailed,
  markGreenButtonIngestionRunning,
  markGreenButtonIngestionSucceeded,
} from "@/server/compliance/integration-runtime";
import { resolvePortfolioManagerClientForOrganization } from "@/server/portfolio-manager/existing-account";
import type { ESPM } from "@/server/integrations/espm";

function shouldRetryJob(error: ReturnType<typeof toAppError>, attemptsMade: number, maxAttempts: number) {
  return error.retryable && attemptsMade < maxAttempts;
}

function queueErrorForWorker(error: ReturnType<typeof toAppError>) {
  if (error.retryable) {
    return error;
  }

  return new UnrecoverableError(error.message);
}

export async function processDataIngestionQueueJob(job: QueueJob) {
  const envelopeHint = peekIngestionEnvelopeContext(job.data);
  const operationalJob = await createJob({
    type:
      typeof envelopeHint.jobType === "string"
        ? `DATA_INGESTION_${envelopeHint.jobType}`
        : "DATA_INGESTION_WORKER",
    organizationId: envelopeHint.organizationId,
    buildingId: envelopeHint.buildingId,
    maxAttempts:
      typeof job.opts.attempts === "number" ? job.opts.attempts : 3,
  });
  const runningJob = await markRunning(operationalJob.id);
  const logger = createLogger({
    requestId: envelopeHint.requestId,
    jobId: operationalJob.id,
    organizationId: envelopeHint.organizationId,
    buildingId: envelopeHint.buildingId,
    procedure: "dataIngestion.worker",
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
        workerJobId: operationalJob.id,
        ...(input.inputSnapshot ?? {}),
      },
      outputSnapshot: input.outputSnapshot,
      errorCode: input.errorCode ?? null,
    }).catch((auditError) => {
      logger.error("Data ingestion audit log persistence failed", {
        error: auditError,
        auditAction: input.action,
      });
      return null;
    });

  await writeAudit({
    action: "data_ingestion.worker.received",
    inputSnapshot: {
      payloadVersion: envelopeHint.payloadVersion,
      jobType: envelopeHint.jobType,
    },
  });

  let envelope: IngestionEnvelope;
  try {
    envelope = parseIngestionEnvelope(job.data);
  } catch (error) {
    const appError = toAppError(error);
    await markDead(runningJob.id, appError.message);
    await writeAudit({
      action: "data_ingestion.worker.dead_lettered",
      outputSnapshot: {
        retryable: false,
        payloadVersion: envelopeHint.payloadVersion,
        jobType: envelopeHint.jobType,
      },
      errorCode: appError.code,
    });
    logger.warn("Rejected ingestion payload contract", {
      error: appError,
      payloadVersion: envelopeHint.payloadVersion,
      jobType: envelopeHint.jobType,
    });
    throw new UnrecoverableError(appError.message);
  }

  const scopedLogger = logger.child({
    requestId: envelope.requestId,
    organizationId: envelope.organizationId,
    buildingId: envelope.buildingId,
  });
  const tenantDb = getTenantClient(envelope.organizationId);
  let finalizedStatus: (typeof JOB_STATUS)[keyof typeof JOB_STATUS] | null = null;

  await writeAudit({
    action: "data_ingestion.worker.running",
    inputSnapshot: {
      jobType: envelope.jobType,
      payloadVersion: envelope.payloadVersion,
      sourceSystem: envelope.sourceSystem,
    },
  });

  try {
    let result:
      | Awaited<ReturnType<typeof runIngestionPipeline>>
      | Awaited<ReturnType<typeof processGreenButtonNotificationEnvelope>>;
    let completionOutput: Record<string, unknown>;

    if (envelope.jobType === INGESTION_JOB_TYPE.CSV_UPLOAD_PIPELINE) {
      let espmClient: ESPM | undefined;
      try {
        espmClient = await resolvePortfolioManagerClientForOrganization({
          organizationId: envelope.organizationId,
        });
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw error;
        }
      }
      result = await runIngestionPipeline({
        buildingId: envelope.buildingId,
        organizationId: envelope.organizationId,
        uploadBatchId: envelope.payload.uploadBatchId,
        triggerType: envelope.payload.triggerType,
        tenantDb,
        espmClient,
      });

      if (!result.success) {
        throw new WorkflowStateError(result.summary, {
          details: {
            errors: result.errors,
            uploadBatchId: envelope.payload.uploadBatchId,
          },
        });
      }

      completionOutput = {
        summary: result.summary,
        snapshotId: result.snapshotId,
        pipelineRunId: result.pipelineRunId,
      };
    } else if (envelope.jobType === INGESTION_JOB_TYPE.GREEN_BUTTON_NOTIFICATION) {
      await markGreenButtonIngestionRunning({
        connectionId: envelope.payload.connectionId,
        jobId: operationalJob.id,
      });
      result = await processGreenButtonNotificationEnvelope({
        envelope,
        tenantDb,
        logger: scopedLogger.child({
          sourceSystem: envelope.sourceSystem,
        }),
        writeAudit,
      });

      if (
        result.pipelineResult &&
        result.pipelineResult.success === false
      ) {
        throw new WorkflowStateError(result.pipelineResult.summary, {
          details: {
            errors: result.pipelineResult.errors,
            uploadBatchId: result.uploadBatchId,
          },
        });
      }

      completionOutput = {
        uploadBatchId: result.uploadBatchId,
        importedCount: result.importedCount,
        updatedCount: result.updatedCount,
        pipelineSummary: result.pipelineResult?.summary ?? null,
        pipelineRunId: result.pipelineResult?.pipelineRunId ?? null,
      };
      await markGreenButtonIngestionSucceeded({
        connectionId: envelope.payload.connectionId,
        jobId: operationalJob.id,
      });
    } else {
      throw new ContractValidationError("Unsupported ingestion job type.", {
        details: {
          jobType: (envelope as { jobType: string }).jobType,
        },
      });
    }

    try {
      await refreshBuildingIssuesAfterDataChange({
        organizationId: envelope.organizationId,
        buildingId: envelope.buildingId,
        actorType: "SYSTEM",
        actorId: null,
        requestId: envelope.requestId,
      });
    } catch (refreshError) {
      scopedLogger.warn("Post-ingestion issue refresh failed", {
        error: refreshError,
        jobType: envelope.jobType,
      });
    }

    await markCompleted(runningJob.id);
    finalizedStatus = JOB_STATUS.COMPLETED;
    await writeAudit({
      action: "data_ingestion.worker.completed",
      inputSnapshot: {
        jobType: envelope.jobType,
      },
      outputSnapshot: completionOutput,
    });

    scopedLogger.info("Data ingestion job completed", {
      jobType: envelope.jobType,
    });
    return result;
  } catch (error) {
    const appError = toAppError(error);
    const retryable = shouldRetryJob(
      appError,
      runningJob.attempts,
      runningJob.maxAttempts,
    );

    if (envelope.jobType === INGESTION_JOB_TYPE.GREEN_BUTTON_NOTIFICATION) {
      try {
        await markGreenButtonIngestionFailed({
          connectionId: envelope.payload.connectionId,
          jobId: operationalJob.id,
          errorCode: appError.code,
          errorMessage: appError.message,
          retryScheduled: retryable,
        });
      } catch (runtimeError) {
        scopedLogger.warn("Green Button runtime state persistence failed", {
          error: runtimeError,
        });
      }
    }

    if (!finalizedStatus) {
      if (retryable) {
        await markFailed(runningJob.id, appError.message);
        finalizedStatus = JOB_STATUS.FAILED;
        await writeAudit({
          action: "data_ingestion.worker.retry_scheduled",
          inputSnapshot: {
            jobType: envelope.jobType,
          },
          outputSnapshot: {
            retryable: true,
            attempts: runningJob.attempts,
            maxAttempts: runningJob.maxAttempts,
          },
          errorCode: appError.code,
        });
      } else {
        await markDead(runningJob.id, appError.message);
        finalizedStatus = JOB_STATUS.DEAD;
        await writeAudit({
          action: "data_ingestion.worker.dead_lettered",
          inputSnapshot: {
            jobType: envelope.jobType,
          },
          outputSnapshot: {
            retryable: false,
            attempts: runningJob.attempts,
            maxAttempts: runningJob.maxAttempts,
          },
          errorCode: appError.code,
        });
      }
    }

    scopedLogger.error("Data ingestion worker execution failed", {
      error: appError,
      retryable,
      jobType: envelope.jobType,
    });
    throw queueErrorForWorker(appError);
  }
}

export function startDataIngestionWorker() {
  const worker = createWorker(
    QUEUES.DATA_INGESTION,
    async (job) => processDataIngestionQueueJob(job),
    3,
  );

  worker.on("failed", (job, err) => {
    const context = peekIngestionEnvelopeContext(job?.data);
    createLogger({
      requestId: context.requestId,
      jobId: String(job?.id ?? ""),
      organizationId: context.organizationId,
      buildingId: context.buildingId,
      procedure: "dataIngestion.worker",
    }).error("Data ingestion queue job failed", {
      error: err,
      queueState:
        err instanceof UnrecoverableError ? "UNRECOVERABLE" : "RETRYABLE",
    });
  });

  worker.on("error", (err) => {
    createLogger({
      procedure: "dataIngestion.worker",
    }).error("Data ingestion worker process error", {
      error: err,
    });
  });

  return worker;
}
