import type { Job } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { NotFoundError, WorkflowStateError } from "@/server/lib/errors";

interface JobClient {
  job: {
    create(args: {
      data: {
        type: string;
        status: string;
        organizationId: string | null;
        buildingId: string | null;
        maxAttempts: number;
      };
    }): Promise<Job>;
    findUnique(args: {
      where: { id: string };
      select: {
        id: true;
        status: true;
        attempts: true;
        maxAttempts: true;
      };
    }): Promise<Pick<Job, "id" | "status" | "attempts" | "maxAttempts"> | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<Job>;
  };
}

/**
 * QUEUED is the persisted "pending" state. Jobs must transition:
 * QUEUED -> RUNNING -> COMPLETED | FAILED | DEAD
 * FAILED -> RUNNING | DEAD
 */
export const JOB_STATUS = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
  DEAD: "DEAD",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  [JOB_STATUS.QUEUED]: [
    JOB_STATUS.RUNNING,
    JOB_STATUS.FAILED,
    JOB_STATUS.DEAD,
  ],
  [JOB_STATUS.RUNNING]: [
    JOB_STATUS.COMPLETED,
    JOB_STATUS.FAILED,
    JOB_STATUS.DEAD,
  ],
  [JOB_STATUS.FAILED]: [JOB_STATUS.RUNNING, JOB_STATUS.DEAD],
  [JOB_STATUS.COMPLETED]: [],
  [JOB_STATUS.DEAD]: [],
};

export interface CreateJobInput {
  type: string;
  status?: JobStatus;
  organizationId?: string | null;
  buildingId?: string | null;
  maxAttempts?: number;
}

type TransitionUpdateFactory = (
  job: Pick<Job, "id" | "status" | "attempts" | "maxAttempts">,
) => Record<string, unknown>;

async function loadJobForTransition(
  jobId: string,
  db: JobClient,
): Promise<Pick<Job, "id" | "status" | "attempts" | "maxAttempts">> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      attempts: true,
      maxAttempts: true,
    },
  });

  if (!job) {
    throw new NotFoundError(`Job ${jobId} not found`);
  }

  return job;
}

function assertTransitionAllowed(from: JobStatus, to: JobStatus) {
  if (ALLOWED_TRANSITIONS[from]?.includes(to)) {
    return;
  }

  throw new WorkflowStateError(
    `Invalid job transition from ${from} to ${to}.`,
    {
      details: {
        from,
        to,
        allowedTransitions: ALLOWED_TRANSITIONS[from] ?? [],
      },
    },
  );
}

async function transitionJob(
  jobId: string,
  to: JobStatus,
  buildUpdate: TransitionUpdateFactory,
  db: JobClient = prisma,
): Promise<Job> {
  const job = await loadJobForTransition(jobId, db);
  const from = job.status as JobStatus;
  assertTransitionAllowed(from, to);

  return db.job.update({
    where: { id: jobId },
    data: buildUpdate(job),
  });
}

export async function createJob(
  input: CreateJobInput,
  db: JobClient = prisma,
): Promise<Job> {
  return db.job.create({
    data: {
      type: input.type,
      status: input.status ?? JOB_STATUS.QUEUED,
      organizationId: input.organizationId ?? null,
      buildingId: input.buildingId ?? null,
      maxAttempts: input.maxAttempts ?? 3,
    },
  });
}

export async function markRunning(
  jobId: string,
  db: JobClient = prisma,
): Promise<Job> {
  return transitionJob(
    jobId,
    JOB_STATUS.RUNNING,
    () => ({
      status: JOB_STATUS.RUNNING,
      attempts: { increment: 1 },
      startedAt: new Date(),
      completedAt: null,
      lastError: null,
    }),
    db,
  );
}

export async function markFailed(
  jobId: string,
  lastError: string,
  db: JobClient = prisma,
): Promise<Job> {
  return transitionJob(
    jobId,
    JOB_STATUS.FAILED,
    () => ({
      status: JOB_STATUS.FAILED,
      lastError,
      completedAt: null,
    }),
    db,
  );
}

export async function markCompleted(
  jobId: string,
  db: JobClient = prisma,
): Promise<Job> {
  return transitionJob(
    jobId,
    JOB_STATUS.COMPLETED,
    () => ({
      status: JOB_STATUS.COMPLETED,
      lastError: null,
      completedAt: new Date(),
    }),
    db,
  );
}

export async function markDead(
  jobId: string,
  lastError: string,
  db: JobClient = prisma,
): Promise<Job> {
  return transitionJob(
    jobId,
    JOB_STATUS.DEAD,
    () => ({
      status: JOB_STATUS.DEAD,
      lastError,
      completedAt: new Date(),
    }),
    db,
  );
}

export function isTerminalJobStatus(status: JobStatus) {
  return status === JOB_STATUS.COMPLETED || status === JOB_STATUS.DEAD;
}
