import packageJson from "../../../package.json";
import type { PrismaClient } from "@/generated/prisma";
import { prisma } from "@/server/lib/db";
import { createQueue, QUEUES } from "@/server/lib/queue";
import { getRedis, runRedisHealthCommand } from "@/server/lib/redis";

const WORKER_HEARTBEAT_KEY = "runtime:worker-heartbeat";
const WORKER_HEARTBEAT_TTL_SECONDS = 120;
const WORKER_STALE_THRESHOLD_MS = 90_000;
const JOB_STALE_THRESHOLD_MS = 10 * 60_000;
const QUEUED_JOB_STALE_THRESHOLD_MS = 15 * 60_000;

const ACTIVE_QUEUE_NAMES = [
  QUEUES.DATA_INGESTION,
  QUEUES.UTILITY_BILL_EXTRACTION,
  QUEUES.PORTFOLIO_MANAGER_PROVISIONING,
  QUEUES.PORTFOLIO_MANAGER_IMPORT,
  QUEUES.PORTFOLIO_MANAGER_SETUP,
  QUEUES.PORTFOLIO_MANAGER_METER_SETUP,
  QUEUES.PORTFOLIO_MANAGER_USAGE,
  QUEUES.PORTFOLIO_MANAGER_PROVIDER_SYNC,
] as const;

type WorkerHeartbeatPayload = {
  updatedAt: string;
  workers: string[];
};

function toHeartbeatPayload(value: unknown): WorkerHeartbeatPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
      ? record.updatedAt
      : null;
  const workers = Array.isArray(record.workers)
    ? record.workers
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];

  if (!updatedAt) {
    return null;
  }

  return {
    updatedAt,
    workers,
  };
}

export async function publishWorkerHeartbeat(workers: string[]) {
  const redis = getRedis();
  const payload: WorkerHeartbeatPayload = {
    updatedAt: new Date().toISOString(),
    workers,
  };

  await redis.set(
    WORKER_HEARTBEAT_KEY,
    JSON.stringify(payload),
    "EX",
    WORKER_HEARTBEAT_TTL_SECONDS,
  );

  return payload;
}

export type WorkerRuntimeHealth = {
  workerStatus: "HEALTHY" | "OFFLINE" | "UNAVAILABLE";
  lastHeartbeatAt: string | null;
  queuesHealthy: boolean;
  activeWorkers: string[];
};

export async function getWorkerRuntimeHealth(): Promise<WorkerRuntimeHealth> {
  try {
    const raw = await runRedisHealthCommand((redis) => redis.get(WORKER_HEARTBEAT_KEY));
    let heartbeat: WorkerHeartbeatPayload | null = null;
    if (raw) {
      try {
        heartbeat = toHeartbeatPayload(JSON.parse(raw));
      } catch {
        heartbeat = null;
      }
    }
    const lastHeartbeatAt = heartbeat?.updatedAt ?? null;
    const freshnessMs = lastHeartbeatAt
      ? Date.now() - new Date(lastHeartbeatAt).getTime()
      : Number.POSITIVE_INFINITY;

    return {
      workerStatus: freshnessMs <= WORKER_STALE_THRESHOLD_MS ? "HEALTHY" : "OFFLINE",
      lastHeartbeatAt,
      queuesHealthy: true,
      activeWorkers: heartbeat?.workers ?? [],
    };
  } catch {
    return {
      workerStatus: "UNAVAILABLE",
      lastHeartbeatAt: null,
      queuesHealthy: false,
      activeWorkers: [],
    };
  }
}

export type JobRuntimeHealth = {
  latestJobId: string | null;
  latestJobStatus: string | null;
  latestJobStartedAt: string | null;
  latestJobCreatedAt: string | null;
  latestJobCompletedAt: string | null;
  latestJobError: string | null;
  stalled: boolean;
};

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

  const ageFrom = job.startedAt ?? job.createdAt;
  const stalled =
    input.active &&
    job.completedAt == null &&
    Date.now() - ageFrom.getTime() > JOB_STALE_THRESHOLD_MS;

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

export type PmRuntimeHealth = WorkerRuntimeHealth & {
  latestJob: JobRuntimeHealth;
  warning: string | null;
};

export async function getPmRuntimeHealth(input: {
  latestJobId?: string | null;
  active: boolean;
  db?: PrismaClient;
}): Promise<PmRuntimeHealth> {
  const [worker, latestJob] = await Promise.all([
    getWorkerRuntimeHealth(),
    getJobRuntimeHealth(input),
  ]);

  let warning: string | null = null;
  if (input.active && worker.workerStatus !== "HEALTHY") {
    warning =
      worker.workerStatus === "UNAVAILABLE"
        ? "Background Portfolio Manager sync is unavailable right now."
        : "Background Portfolio Manager worker appears offline right now.";
  } else if (input.active && latestJob.stalled) {
    warning = "The latest PM job appears stalled and may need operator attention.";
  }

  return {
    ...worker,
    latestJob,
    warning,
  };
}

export type QueueRuntimeHealth = {
  name: string;
  status: "HEALTHY" | "ATTENTION" | "UNAVAILABLE";
  waitingCount: number;
  activeCount: number;
  delayedCount: number;
  failedCount: number;
  completedCount: number;
};

async function getQueueRuntimeHealth(name: string): Promise<QueueRuntimeHealth> {
  const queue = createQueue(name);

  try {
    const [waitingCount, activeCount, delayedCount, failedCount, completedCount] =
      await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getDelayedCount(),
        queue.getFailedCount(),
        queue.getCompletedCount(),
      ]);

    const status =
      failedCount > 0 || waitingCount > 100 || delayedCount > 100
        ? "ATTENTION"
        : "HEALTHY";

    return {
      name,
      status,
      waitingCount,
      activeCount,
      delayedCount,
      failedCount,
      completedCount,
    };
  } catch {
    return {
      name,
      status: "UNAVAILABLE",
      waitingCount: 0,
      activeCount: 0,
      delayedCount: 0,
      failedCount: 0,
      completedCount: 0,
    };
  } finally {
    await queue.close().catch(() => null);
  }
}

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

export async function getPlatformRuntimeHealth(input?: {
  db?: PrismaClient;
}): Promise<PlatformRuntimeHealth> {
  const db = input?.db ?? prisma;
  const timestamp = new Date().toISOString();
  let database: "ok" | "error" = "ok";
  let redis: "ok" | "error" = "ok";

  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = "error";
  }

  try {
    await runRedisHealthCommand((client) => client.ping());
  } catch {
    redis = "error";
  }

  const now = Date.now();
  const stalledRunningBefore = new Date(now - JOB_STALE_THRESHOLD_MS);
  const staleQueuedBefore = new Date(now - QUEUED_JOB_STALE_THRESHOLD_MS);

  const [
    worker,
    queues,
    queuedCount,
    runningCount,
    failedCount,
    deadCount,
    stalledRunningCount,
    staleQueuedCount,
    latestFailedJob,
    portfolioManagerFailures,
    greenButtonFailures,
    utilityBillFailures,
  ] = await Promise.all([
    getWorkerRuntimeHealth(),
    Promise.all(ACTIVE_QUEUE_NAMES.map((name) => getQueueRuntimeHealth(name))),
    db.job.count({ where: { status: "QUEUED" } }),
    db.job.count({ where: { status: "RUNNING" } }),
    db.job.count({ where: { status: "FAILED" } }),
    db.job.count({ where: { status: "DEAD" } }),
    db.job.count({
      where: {
        status: "RUNNING",
        startedAt: { lt: stalledRunningBefore },
      },
    }),
    db.job.count({
      where: {
        status: "QUEUED",
        createdAt: { lt: staleQueuedBefore },
      },
    }),
    db.job.findFirst({
      where: {
        status: {
          in: ["FAILED", "DEAD"],
        },
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

  const queuesHealthy = queues.every((queue) => queue.status === "HEALTHY");
  const stalledCount = stalledRunningCount + staleQueuedCount;
  const status =
    database === "ok" &&
    redis === "ok" &&
    worker.workerStatus === "HEALTHY" &&
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
      database,
      redis,
      worker,
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
}
