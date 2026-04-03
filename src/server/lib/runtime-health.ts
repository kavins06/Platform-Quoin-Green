import packageJson from "../../../package.json";
import type { PrismaClient } from "@/generated/prisma";
import { prisma } from "@/server/lib/db";
import { JOB_STATUS } from "@/server/lib/jobs";

const JOB_STALE_THRESHOLD_MS = 10 * 60_000;
const QUEUED_JOB_STALE_THRESHOLD_MS = 15 * 60_000;
const HEALTH_FAILURE_WINDOW_MS = 60 * 60_000;

const LOGICAL_QUEUE_TYPES = [
  {
    name: "data-ingestion",
    types: ["CSV_UPLOAD_PIPELINE", "GREEN_BUTTON_NOTIFICATION"],
  },
  {
    name: "utility-bill-extraction",
    types: ["UTILITY_BILL_EXTRACTION"],
  },
  {
    name: "portfolio-manager-provisioning",
    types: ["PORTFOLIO_MANAGER_PROPERTY_PROVISIONING"],
  },
  {
    name: "portfolio-manager-import",
    types: ["PORTFOLIO_MANAGER_EXISTING_ACCOUNT_IMPORT"],
  },
  {
    name: "portfolio-manager-provider-sync",
    types: ["PORTFOLIO_MANAGER_PROVIDER_SYNC"],
  },
  {
    name: "portfolio-manager-setup",
    types: ["PORTFOLIO_MANAGER_PROPERTY_USE_SETUP"],
  },
  {
    name: "portfolio-manager-meter-setup",
    types: [
      "PORTFOLIO_MANAGER_METER_SETUP",
      "PORTFOLIO_MANAGER_METER_ASSOCIATION_SETUP",
    ],
  },
  {
    name: "portfolio-manager-usage",
    types: [
      "PORTFOLIO_MANAGER_USAGE_IMPORT",
      "PORTFOLIO_MANAGER_USAGE_PUSH",
      "PORTFOLIO_MANAGER_FULL_PULL",
    ],
  },
] as const;

export type WorkerRuntimeHealth = {
  workerStatus: "HEALTHY" | "OFFLINE" | "UNAVAILABLE";
  lastHeartbeatAt: string | null;
  queuesHealthy: boolean;
  activeWorkers: string[];
};

export type JobRuntimeHealth = {
  latestJobId: string | null;
  latestJobStatus: string | null;
  latestJobStartedAt: string | null;
  latestJobCreatedAt: string | null;
  latestJobCompletedAt: string | null;
  latestJobError: string | null;
  stalled: boolean;
};

export type PmRuntimeHealth = WorkerRuntimeHealth & {
  latestJob: JobRuntimeHealth;
  warning: string | null;
};

export type QueueRuntimeHealth = {
  name: string;
  status: "HEALTHY" | "ATTENTION" | "UNAVAILABLE";
  waitingCount: number;
  activeCount: number;
  delayedCount: number;
  failedCount: number;
  completedCount: number;
};

export type PlatformRuntimeHealth = {
  status: "ok" | "degraded";
  timestamp: string;
  build: {
    version: string;
    commitSha: string | null;
    runtime: string;
  };
  services: {
    database: "ok" | "error";
    redis: "ok" | "error";
    worker: WorkerRuntimeHealth;
  };
  queues: {
    healthy: boolean;
    items: QueueRuntimeHealth[];
  };
  jobs: {
    queuedCount: number;
    runningCount: number;
    failedCount: number;
    deadCount: number;
    stalledCount: number;
    latestFailureClass: string | null;
  };
  integrations: {
    portfolioManagerFailures: number;
    greenButtonFailures: number;
    utilityBillFailures: number;
  };
};

export async function publishWorkerHeartbeat(workers: string[]) {
  return {
    updatedAt: new Date().toISOString(),
    workers,
  };
}

function getWorkerRuntimeHealth(): WorkerRuntimeHealth {
  return {
    workerStatus: "HEALTHY",
    lastHeartbeatAt: null,
    queuesHealthy: true,
    activeWorkers: ["workflow"],
  };
}

async function getJobRuntimeHealth(input: {
  latestJobId?: string | null;
  active: boolean;
  db?: PrismaClient;
}): Promise<JobRuntimeHealth> {
  if (!input.latestJobId) {
    return {
      latestJobId: null,
      latestJobStatus: null,
      latestJobStartedAt: null,
      latestJobCreatedAt: null,
      latestJobCompletedAt: null,
      latestJobError: null,
      stalled: false,
    };
  }

  const db = input.db ?? prisma;
  const job = await db.job.findUnique({
    where: { id: input.latestJobId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      lastError: true,
    },
  });

  if (!job) {
    return {
      latestJobId: input.latestJobId,
      latestJobStatus: null,
      latestJobStartedAt: null,
      latestJobCreatedAt: null,
      latestJobCompletedAt: null,
      latestJobError: null,
      stalled: input.active,
    };
  }

  const thresholdMs =
    job.status === JOB_STATUS.QUEUED
      ? QUEUED_JOB_STALE_THRESHOLD_MS
      : job.status === JOB_STATUS.RUNNING
        ? JOB_STALE_THRESHOLD_MS
        : null;
  const ageFrom = job.startedAt ?? job.createdAt;
  const stalled =
    input.active &&
    job.completedAt == null &&
    thresholdMs != null &&
    Date.now() - ageFrom.getTime() > thresholdMs;

  return {
    latestJobId: job.id,
    latestJobStatus: job.status,
    latestJobStartedAt: job.startedAt?.toISOString() ?? null,
    latestJobCreatedAt: job.createdAt.toISOString(),
    latestJobCompletedAt: job.completedAt?.toISOString() ?? null,
    latestJobError: job.lastError,
    stalled,
  };
}

export async function getPmRuntimeHealth(input: {
  latestJobId?: string | null;
  active: boolean;
  db?: PrismaClient;
}): Promise<PmRuntimeHealth> {
  const db = input.db ?? prisma;
  const [worker, latestJob] = await Promise.all([
    Promise.resolve(getWorkerRuntimeHealth()),
    getJobRuntimeHealth({
      latestJobId: input.latestJobId,
      active: input.active,
      db,
    }),
  ]);

  let warning: string | null = null;
  if (input.active && latestJob.stalled) {
    warning = "The latest Portfolio Manager job appears stalled and may need a retry.";
  } else if (latestJob.latestJobStatus === JOB_STATUS.FAILED || latestJob.latestJobStatus === JOB_STATUS.DEAD) {
    warning = latestJob.latestJobError ?? "The latest Portfolio Manager job failed.";
  }

  return {
    ...worker,
    latestJob,
    warning,
  };
}

async function getLogicalQueueRuntimeHealth(input: {
  groupedCounts: Array<{
    type: string;
    status: string;
    _count: { _all: number };
  }>;
  recentFailureCounts: Array<{
    type: string;
    status: string;
    _count: { _all: number };
  }>;
}): Promise<QueueRuntimeHealth[]> {
  const countByTypeStatus = new Map<string, number>();
  for (const item of input.groupedCounts) {
    countByTypeStatus.set(`${item.type}:${item.status}`, item._count._all);
  }

  const recentFailureCountByTypeStatus = new Map<string, number>();
  for (const item of input.recentFailureCounts) {
    recentFailureCountByTypeStatus.set(
      `${item.type}:${item.status}`,
      item._count._all,
    );
  }

  return LOGICAL_QUEUE_TYPES.map((queue) => {
    const waitingCount = queue.types.reduce(
      (sum, type) => sum + (countByTypeStatus.get(`${type}:${JOB_STATUS.QUEUED}`) ?? 0),
      0,
    );
    const activeCount = queue.types.reduce(
      (sum, type) => sum + (countByTypeStatus.get(`${type}:${JOB_STATUS.RUNNING}`) ?? 0),
      0,
    );
    const failedCount = queue.types.reduce(
      (sum, type) =>
        sum +
        (recentFailureCountByTypeStatus.get(`${type}:${JOB_STATUS.FAILED}`) ?? 0) +
        (recentFailureCountByTypeStatus.get(`${type}:${JOB_STATUS.DEAD}`) ?? 0),
      0,
    );
    const completedCount = queue.types.reduce(
      (sum, type) => sum + (countByTypeStatus.get(`${type}:${JOB_STATUS.COMPLETED}`) ?? 0),
      0,
    );

    return {
      name: queue.name,
      status: failedCount > 0 ? "ATTENTION" : "HEALTHY",
      waitingCount,
      activeCount,
      delayedCount: 0,
      failedCount,
      completedCount,
    } satisfies QueueRuntimeHealth;
  });
}

async function getReferencedLatestJobIds(db: PrismaClient) {
  const rows = await db.$queryRaw<Array<{ id: string | null }>>`
    select latest_job_id as id from portfolio_manager_management where latest_job_id is not null
    union
    select latest_job_id as id from portfolio_manager_import_states where latest_job_id is not null
    union
    select latest_job_id as id from portfolio_manager_provisioning_states where latest_job_id is not null
    union
    select latest_job_id as id from portfolio_manager_setup_states where latest_job_id is not null
    union
    select latest_job_id as id from portfolio_manager_meter_link_states where latest_job_id is not null
    union
    select latest_job_id as id from portfolio_manager_usage_states where latest_job_id is not null
    union
    select latest_job_id as id from portfolio_manager_sync_states where latest_job_id is not null
    union
    select latest_job_id as id from green_button_connections where latest_job_id is not null
  `;

  return rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function buildUnavailableRuntimeHealth(timestamp: string): PlatformRuntimeHealth {
  return {
    status: "degraded",
    timestamp,
    build: {
      version: packageJson.version,
      commitSha:
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.GITHUB_SHA ??
        process.env.APP_BUILD_SHA ??
        null,
      runtime: process.version,
    },
    services: {
      database: "error",
      redis: "ok",
      worker: {
        workerStatus: "UNAVAILABLE",
        lastHeartbeatAt: null,
        queuesHealthy: false,
        activeWorkers: [],
      },
    },
    queues: {
      healthy: false,
      items: [],
    },
    jobs: {
      queuedCount: 0,
      runningCount: 0,
      failedCount: 0,
      deadCount: 0,
      stalledCount: 0,
      latestFailureClass: null,
    },
    integrations: {
      portfolioManagerFailures: 0,
      greenButtonFailures: 0,
      utilityBillFailures: 0,
    },
  };
}

export async function getPlatformRuntimeHealth(input?: {
  db?: PrismaClient;
}): Promise<PlatformRuntimeHealth> {
  const db = input?.db ?? prisma;
  const timestamp = new Date().toISOString();
  try {
    await db.$queryRaw`SELECT 1`;
    const now = Date.now();
    const stalledRunningBefore = new Date(now - JOB_STALE_THRESHOLD_MS);
    const staleQueuedBefore = new Date(now - QUEUED_JOB_STALE_THRESHOLD_MS);
    const recentFailureAfter = new Date(now - HEALTH_FAILURE_WINDOW_MS);

    const [
      groupedJobCounts,
      recentFailureGroupedJobCounts,
      queuedCount,
      runningCount,
      failedCount,
      deadCount,
      latestJobIds,
      latestFailedJob,
      portfolioManagerFailures,
      greenButtonFailures,
      utilityBillFailures,
    ] = await Promise.all([
      db.job.groupBy({
        by: ["type", "status"],
        _count: {
          _all: true,
        },
      }),
      db.job.groupBy({
        by: ["type", "status"],
        where: {
          status: {
            in: [JOB_STATUS.FAILED, JOB_STATUS.DEAD],
          },
          OR: [
            { completedAt: { gte: recentFailureAfter } },
            { createdAt: { gte: recentFailureAfter } },
          ],
        },
        _count: {
          _all: true,
        },
      }),
      db.job.count({ where: { status: JOB_STATUS.QUEUED } }),
      db.job.count({ where: { status: JOB_STATUS.RUNNING } }),
      db.job.count({ where: { status: JOB_STATUS.FAILED } }),
      db.job.count({ where: { status: JOB_STATUS.DEAD } }),
      getReferencedLatestJobIds(db),
      db.job.findFirst({
        where: {
          status: {
            in: [JOB_STATUS.FAILED, JOB_STATUS.DEAD],
          },
          OR: [
            { completedAt: { gte: recentFailureAfter } },
            { createdAt: { gte: recentFailureAfter } },
          ],
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          type: true,
        },
      }),
      db.portfolioManagerImportState.count({
        where: {
          status: "FAILED",
        },
      }),
      db.greenButtonConnection.count({
        where: {
          status: "FAILED",
        },
      }),
      db.utilityBillUpload.count({
        where: {
          status: "FAILED",
        },
      }),
    ]);

    const queues = await getLogicalQueueRuntimeHealth({
      groupedCounts: groupedJobCounts,
      recentFailureCounts: recentFailureGroupedJobCounts,
    });
    const stalledWhere =
      latestJobIds.length > 0
        ? {
            id: { in: latestJobIds },
          }
        : undefined;
    const [stalledRunningCount, staleQueuedCount] = await Promise.all([
      db.job.count({
        where: {
          status: JOB_STATUS.RUNNING,
          startedAt: { lt: stalledRunningBefore },
          ...(stalledWhere ?? {}),
        },
      }),
      db.job.count({
        where: {
          status: JOB_STATUS.QUEUED,
          createdAt: { lt: staleQueuedBefore },
          ...(stalledWhere ?? {}),
        },
      }),
    ]);
    const worker = getWorkerRuntimeHealth();
    const queuesHealthy = queues.every((queue) => queue.status === "HEALTHY");
    const stalledCount = stalledRunningCount + staleQueuedCount;
    const status =
      queuesHealthy &&
      stalledCount === 0
        ? "ok"
        : "degraded";

    return {
      status,
      timestamp,
      build: {
        version: packageJson.version,
        commitSha:
          process.env.VERCEL_GIT_COMMIT_SHA ??
          process.env.GITHUB_SHA ??
          process.env.APP_BUILD_SHA ??
          null,
        runtime: process.version,
      },
      services: {
        database: "ok",
        redis: "ok",
        worker: {
          ...worker,
          queuesHealthy,
        },
      },
      queues: {
        healthy: queuesHealthy,
        items: queues,
      },
      jobs: {
        queuedCount,
        runningCount,
        failedCount,
        deadCount,
        stalledCount,
        latestFailureClass: latestFailedJob?.type ?? null,
      },
      integrations: {
        portfolioManagerFailures,
        greenButtonFailures,
        utilityBillFailures,
      },
    };
  } catch (error) {
    console.error("[runtime-health] failed to assemble health snapshot", error);
    return buildUnavailableRuntimeHealth(timestamp);
  }
}
