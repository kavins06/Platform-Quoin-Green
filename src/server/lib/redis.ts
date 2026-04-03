import Redis from "ioredis";
import { env } from "./config";
import { createLogger } from "./logger";

let redis: Redis | null = null;
const logger = createLogger({ router: "redis" });
const REDIS_ERROR_LOG_INTERVAL_MS = 60_000;
let lastRedisErrorLogAt = 0;

function logRedisError(error: unknown) {
  const now = Date.now();
  if (now - lastRedisErrorLogAt < REDIS_ERROR_LOG_INTERVAL_MS) {
    return;
  }

  lastRedisErrorLogAt = now;
  logger.warn("Redis client error", {
    error,
  });
}

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
    });
    redis.on("error", logRedisError);
  }
  return redis;
}

function createRedisHealthClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    retryStrategy: () => null,
  });
  client.on("error", logRedisError);
  return client;
}

export async function runRedisHealthCommand<T>(
  command: (client: Redis) => Promise<T>,
): Promise<T> {
  const client = createRedisHealthClient();

  try {
    await client.connect();
    return await command(client);
  } finally {
    client.disconnect();
  }
}
