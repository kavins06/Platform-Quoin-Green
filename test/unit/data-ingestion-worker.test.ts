import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetryableIntegrationError } from "@/server/lib/errors";
import { buildCsvUploadIngestionEnvelope } from "@/server/pipelines/data-ingestion/envelope";

const mocks = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => null),
  createJob: vi.fn(
    async (input: {
      organizationId?: string | null;
      buildingId?: string | null;
      maxAttempts?: number;
    }) => ({
      id: "operational_job_1",
      status: "QUEUED",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      organizationId: input.organizationId ?? null,
      buildingId: input.buildingId ?? null,
    }),
  ),
  markRunning: vi.fn(async () => ({
    id: "operational_job_1",
    status: "RUNNING",
    attempts: 1,
    maxAttempts: 3,
  })),
  markFailed: vi.fn(async () => null),
  markDead: vi.fn(async () => null),
  markCompleted: vi.fn(async () => null),
  getTenantClient: vi.fn(() => ({})),
  runIngestionPipeline: vi.fn(),
  processGreenButtonNotificationEnvelope: vi.fn(),
  refreshBuildingIssuesAfterDataChange: vi.fn(async () => null),
  markGreenButtonIngestionRunning: vi.fn(async () => null),
  markGreenButtonIngestionSucceeded: vi.fn(async () => null),
  markGreenButtonIngestionFailed: vi.fn(async () => null),
}));

vi.mock("@/server/lib/audit-log", () => ({
  createAuditLog: mocks.createAuditLog,
}));

vi.mock("@/server/lib/jobs", () => ({
  JOB_STATUS: {
    QUEUED: "QUEUED",
    RUNNING: "RUNNING",
    FAILED: "FAILED",
    COMPLETED: "COMPLETED",
    DEAD: "DEAD",
  },
  createJob: mocks.createJob,
  markRunning: mocks.markRunning,
  markFailed: mocks.markFailed,
  markDead: mocks.markDead,
  markCompleted: mocks.markCompleted,
}));

vi.mock("@/server/lib/db", () => ({
  getTenantClient: mocks.getTenantClient,
}));

vi.mock("@/server/pipelines/data-ingestion/logic", () => ({
  runIngestionPipeline: mocks.runIngestionPipeline,
}));

vi.mock("@/server/pipelines/data-ingestion/green-button", () => ({
  processGreenButtonNotificationEnvelope: mocks.processGreenButtonNotificationEnvelope,
}));

vi.mock("@/server/compliance/data-issues", () => ({
  refreshBuildingIssuesAfterDataChange: mocks.refreshBuildingIssuesAfterDataChange,
}));

vi.mock("@/server/compliance/integration-runtime", () => ({
  markGreenButtonIngestionRunning: mocks.markGreenButtonIngestionRunning,
  markGreenButtonIngestionSucceeded: mocks.markGreenButtonIngestionSucceeded,
  markGreenButtonIngestionFailed: mocks.markGreenButtonIngestionFailed,
}));

vi.mock("@/server/integrations/espm", () => ({
  createESPMClient: vi.fn(() => ({})),
}));

describe("data ingestion worker contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dead-letters unsupported payload versions without leaving a dangling job", async () => {
    const { processDataIngestionQueueJob } = await import("@/server/pipelines/data-ingestion/worker");

    await expect(
      processDataIngestionQueueJob({
        id: "queue_1",
        data: {
          payloadVersion: 2,
          requestId: "req_1",
          organizationId: "org_1",
          buildingId: "building_1",
          jobType: "CSV_UPLOAD_PIPELINE",
        },
        opts: { attempts: 3 },
      } as never),
    ).rejects.toMatchObject({
      name: "UnrecoverableError",
    });

    expect(mocks.markDead).toHaveBeenCalledWith(
      "operational_job_1",
      "Unsupported ingestion payload version.",
    );
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "data_ingestion.worker.dead_lettered",
      }),
    );
  });

  it("marks retryable worker failures as failed and records retry scheduling", async () => {
    const { processDataIngestionQueueJob } = await import("@/server/pipelines/data-ingestion/worker");
    mocks.runIngestionPipeline.mockRejectedValueOnce(
      new RetryableIntegrationError("Temporary upstream outage", {
        service: "ENERGY_STAR_PORTFOLIO_MANAGER",
      }),
    );

    const envelope = buildCsvUploadIngestionEnvelope({
      requestId: "req_1",
      organizationId: "org_1",
      buildingId: "building_1",
      uploadBatchId: "batch_1",
      triggerType: "CSV_UPLOAD",
    });

    await expect(
      processDataIngestionQueueJob({
        id: "queue_1",
        data: envelope,
        opts: { attempts: 3 },
      } as never),
    ).rejects.toBeInstanceOf(RetryableIntegrationError);

    expect(mocks.markFailed).toHaveBeenCalledWith(
      "operational_job_1",
      "Temporary upstream outage",
    );
    expect(mocks.markDead).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "data_ingestion.worker.retry_scheduled",
      }),
    );
  });

  it("refreshes readiness and issue state after a successful CSV ingestion job", async () => {
    const { processDataIngestionQueueJob } = await import("@/server/pipelines/data-ingestion/worker");
    mocks.runIngestionPipeline.mockResolvedValueOnce({
      success: true,
      summary: "Imported annual utility data",
      snapshotId: "snapshot_1",
      pipelineRunId: "pipeline_run_1",
      errors: [],
    });

    const envelope = buildCsvUploadIngestionEnvelope({
      requestId: "req_2",
      organizationId: "org_1",
      buildingId: "building_1",
      uploadBatchId: "batch_2",
      triggerType: "CSV_UPLOAD",
    });

    await processDataIngestionQueueJob({
      id: "queue_2",
      data: envelope,
      opts: { attempts: 3 },
    } as never);

    expect(mocks.refreshBuildingIssuesAfterDataChange).toHaveBeenCalledWith({
      organizationId: "org_1",
      buildingId: "building_1",
      actorType: "SYSTEM",
      actorId: null,
      requestId: "req_2",
    });
    expect(mocks.markCompleted).toHaveBeenCalledWith("operational_job_1");
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "data_ingestion.worker.completed",
      }),
    );
  });

  it("persists Green Button runtime state across worker success and retryable failure", async () => {
    const { processDataIngestionQueueJob } = await import("@/server/pipelines/data-ingestion/worker");
    const { buildGreenButtonNotificationEnvelope } = await import(
      "@/server/pipelines/data-ingestion/envelope"
    );

    mocks.processGreenButtonNotificationEnvelope.mockResolvedValueOnce({
      uploadBatchId: "gb_batch_1",
      importedCount: 12,
      updatedCount: 0,
      pipelineResult: {
        success: true,
        summary: "Imported Green Button data",
        snapshotId: "snapshot_1",
        pipelineRunId: "pipeline_1",
        errors: [],
      },
    });

    const successEnvelope = buildGreenButtonNotificationEnvelope({
      requestId: "req_gb_success",
      organizationId: "org_1",
      buildingId: "building_1",
      connectionId: "connection_1",
      notificationUri: "https://utility.test/espi/Batch/Subscription/abc",
      subscriptionId: "abc",
      resourceUri: "https://utility.test/espi",
    });

    await processDataIngestionQueueJob({
      id: "queue_gb_success",
      data: successEnvelope,
      opts: { attempts: 3 },
    } as never);

    expect(mocks.markGreenButtonIngestionRunning).toHaveBeenCalledWith({
      connectionId: "connection_1",
      jobId: "operational_job_1",
    });
    expect(mocks.markGreenButtonIngestionSucceeded).toHaveBeenCalledWith({
      connectionId: "connection_1",
      jobId: "operational_job_1",
    });

    mocks.processGreenButtonNotificationEnvelope.mockRejectedValueOnce(
      new RetryableIntegrationError("Green Button upstream timeout", {
        service: "GREEN_BUTTON",
      }),
    );

    const failureEnvelope = buildGreenButtonNotificationEnvelope({
      requestId: "req_gb_failure",
      organizationId: "org_1",
      buildingId: "building_1",
      connectionId: "connection_1",
      notificationUri: "https://utility.test/espi/Batch/Subscription/xyz",
      subscriptionId: "xyz",
      resourceUri: "https://utility.test/espi",
    });

    await expect(
      processDataIngestionQueueJob({
        id: "queue_gb_failure",
        data: failureEnvelope,
        opts: { attempts: 3 },
      } as never),
    ).rejects.toBeInstanceOf(RetryableIntegrationError);

    expect(mocks.markGreenButtonIngestionFailed).toHaveBeenCalledWith({
      connectionId: "connection_1",
      jobId: "operational_job_1",
      errorCode: "RETRYABLE_INTEGRATION_ERROR",
      errorMessage: "Green Button upstream timeout",
      retryScheduled: true,
    });
  });
});
