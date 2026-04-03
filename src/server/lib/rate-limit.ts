import { NextRequest, NextResponse } from "next/server";
import { runRedisHealthCommand } from "@/server/lib/redis";

export interface RateLimitResult {
  allowed: boolean;
  enforced: boolean;
  limit: number;
  remaining: number | null;
  retryAfterSeconds: number | null;
}

function normalizeClientKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "anonymous";
}

export function getRateLimitClientKey(
  request: NextRequest,
  tenantKey?: string | null,
) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip =
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";

  return normalizeClientKey(tenantKey ? `${tenantKey}:${ip}` : ip);
}

export async function applyRateLimit(input: {
  scope: string;
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / 1000 / input.windowSeconds);
  const redisKey = [
    "ratelimit",
    input.scope,
    normalizeClientKey(input.key),
    String(bucket),
  ].join(":");

  try {
    const result = await runRedisHealthCommand(async (redis) => {
      const multi = redis.multi();
      multi.incr(redisKey);
      multi.expire(redisKey, input.windowSeconds, "NX");
      multi.ttl(redisKey);
      const exec = await multi.exec();

      const count = Number(exec?.[0]?.[1] ?? 0);
      const ttlSeconds = Math.max(Number(exec?.[2]?.[1] ?? input.windowSeconds), 0);
      const allowed = count <= input.limit;
      return {
        allowed,
        enforced: true,
        limit: input.limit,
        remaining: allowed ? Math.max(input.limit - count, 0) : 0,
        retryAfterSeconds: allowed ? null : ttlSeconds || input.windowSeconds,
      } satisfies RateLimitResult;
    });

    return result;
  } catch {
    return {
      allowed: true,
      enforced: false,
      limit: input.limit,
      remaining: null,
      retryAfterSeconds: null,
    };
  }
}

export function withRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult,
) {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set(
    "X-RateLimit-Remaining",
    result.remaining == null ? "unknown" : String(result.remaining),
  );
  if (result.retryAfterSeconds != null) {
    response.headers.set("Retry-After", String(result.retryAfterSeconds));
  }
  return response;
}

export function createRateLimitExceededResponse(input: {
  message: string;
  result: RateLimitResult;
}) {
  return withRateLimitHeaders(
    NextResponse.json(
      {
        error: input.message,
        code: "RATE_LIMITED",
      },
      { status: 429 },
    ),
    input.result,
  );
}
