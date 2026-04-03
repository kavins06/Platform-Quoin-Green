import { describe, expect, it, vi } from "vitest";
import {
  createJob,
  JOB_STATUS,
  type JobStatus,
  markCompleted,
  markDead,
  markFailed,
  markRunning,
} from "@/server/lib/jobs";
import { WorkflowStateError } from "@/server/lib/errors";

function createDb(status: JobStatus = JOB_STATUS.QUEUED, attempts = 0, maxAttempts = 3) {
  return {
    job: {
      create: vi.fn(async (args) => args),
      findUnique: vi.fn(async () => ({
        id: "job_1",
        status,
        attempts,
        maxAttempts,
      })),
      update: vi.fn(async (args) => args),
    },
  };
}

describe("job lifecycle helpers", () => {
  it("creates a queued job with default attempts", async () => {
    const db = createDb();

    await createJob(
      {
        type: "PORTFOLIO_MANAGER_SYNC",
        organizationId: "org_1",
        buildingId: "building_1",
      },
      db as unknown as Parameters<typeof createJob>[1],
    );

    expect(db.job.create).toHaveBeenCalledWith({
      data: {
        type: "PORTFOLIO_MANAGER_SYNC",
        status: JOB_STATUS.QUEUED,
        organizationId: "org_1",
        buildingId: "building_1",
        maxAttempts: 3,
      },
    });
  });

  it("marks jobs through running, failed, completed, and dead states", async () => {
    const queuedDb = createDb(JOB_STATUS.QUEUED, 0, 3);
    await markRunning(
      "job_1",
      queuedDb as unknown as Parameters<typeof markRunning>[1],
    );
    expect(queuedDb.job.update).toHaveBeenCalledWith({
      where: { id: "job_1" },
      data: {
        status: JOB_STATUS.RUNNING,
        attempts: { increment: 1 },
        startedAt: expect.any(Date),
        completedAt: null,
        lastError: null,
      },
    });

    const runningToFailedDb = createDb(JOB_STATUS.RUNNING, 1, 3);
    await markFailed(
      "job_1",
      "temporary failure",
      runningToFailedDb as unknown as Parameters<typeof markFailed>[2],
    );
    expect(runningToFailedDb.job.update).toHaveBeenCalledWith({
      where: { id: "job_1" },
      data: {
        status: JOB_STATUS.FAILED,
        lastError: "temporary failure",
        completedAt: null,
      },
    });

    const runningToCompletedDb = createDb(JOB_STATUS.RUNNING, 1, 3);
    await markCompleted(
      "job_1",
      runningToCompletedDb as unknown as Parameters<typeof markCompleted>[1],
    );
    expect(runningToCompletedDb.job.update).toHaveBeenCalledWith({
      where: { id: "job_1" },
      data: {
        status: JOB_STATUS.COMPLETED,
        lastError: null,
        completedAt: expect.any(Date),
      },
    });

    const failedToDeadDb = createDb(JOB_STATUS.FAILED, 3, 3);
    await markDead(
      "job_1",
      "permanent failure",
      failedToDeadDb as unknown as Parameters<typeof markDead>[2],
    );
    expect(failedToDeadDb.job.update).toHaveBeenCalledWith({
      where: { id: "job_1" },
      data: {
        status: JOB_STATUS.DEAD,
        lastError: "permanent failure",
        completedAt: expect.any(Date),
      },
    });
  });

  it("allows retry by transitioning failed jobs back to running", async () => {
    const db = createDb(JOB_STATUS.FAILED, 1, 3);

    await markRunning(
      "job_1",
      db as unknown as Parameters<typeof markRunning>[1],
    );

    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "job_1" },
      data: {
        status: JOB_STATUS.RUNNING,
        attempts: { increment: 1 },
        startedAt: expect.any(Date),
        completedAt: null,
        lastError: null,
      },
    });
  });

  it("rejects invalid transitions out of terminal states", async () => {
    const db = createDb(JOB_STATUS.COMPLETED, 1, 3);

    await expect(
      markFailed(
        "job_1",
        "should not happen",
        db as unknown as Parameters<typeof markFailed>[2],
      ),
    ).rejects.toBeInstanceOf(WorkflowStateError);

    expect(db.job.update).not.toHaveBeenCalled();
  });
});
