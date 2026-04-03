import { Queue, Worker, type Processor, type JobsOptions } from "bullmq";
import { env } from "./config";

function getConnectionOpts() {
  const parsed = new URL(env.REDIS_URL);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname ? Number(parsed.pathname.replace("/", "")) || 0 : 0,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null as null,
  };
}

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 60_000, // 1m → 5m → 15m
  },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export function createQueue(name: string, opts?: JobsOptions): Queue {
  return new Queue(name, {
    connection: getConnectionOpts(),
    defaultJobOptions: { ...defaultJobOptions, ...opts },
  });
}

export async function withQueue<T>(
  name: string,
  fn: (queue: Queue) => Promise<T>,
  opts?: JobsOptions,
): Promise<T> {
  const queue = createQueue(name, opts);

  try {
    return await fn(queue);
  } finally {
    await queue.close().catch(() => null);
  }
}

export function createWorker(
  name: string,
  processor: Processor,
  concurrency = 1,
): Worker {
  return new Worker(name, processor, {
    connection: getConnectionOpts(),
    concurrency,
  });
}

/** Queue names — single source of truth */
export const QUEUES = {
  DATA_INGESTION: "data-ingestion",
  UTILITY_BILL_EXTRACTION: "utility-bill-extraction",
  PORTFOLIO_MANAGER_PROVISIONING: "portfolio-manager-provisioning",
  PORTFOLIO_MANAGER_IMPORT: "portfolio-manager-import",
  PORTFOLIO_MANAGER_PROVIDER_SYNC: "portfolio-manager-provider-sync",
  PORTFOLIO_MANAGER_SETUP: "portfolio-manager-setup",
  PORTFOLIO_MANAGER_METER_SETUP: "portfolio-manager-meter-setup",
  PORTFOLIO_MANAGER_USAGE: "portfolio-manager-usage",
  ESPM_SYNC: "espm-sync",
  PATHWAY_ANALYSIS: "pathway-analysis",
  CAPITAL_STRUCTURING: "capital-structuring",
  DRIFT_DETECTION: "drift-detection",
  AI_ANALYSIS: "ai-analysis",
  NOTIFICATIONS: "notifications",
  REPORT_GENERATOR: "report-generator",
} as const;
