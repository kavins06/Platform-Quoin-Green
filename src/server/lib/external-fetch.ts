import { sleep } from "@/server/lib/async";

type FetchWithRetryInput = {
  url: string;
  init?: RequestInit;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOnStatuses?: number[];
};

function isRetryableStatus(status: number, retryOnStatuses: number[]) {
  return retryOnStatuses.includes(status) || status === 408 || status === 429 || status >= 500;
}

function calculateBackoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.max(50, Math.floor(exponential * 0.25)));
  return Math.min(maxDelayMs, exponential + jitter);
}

export async function fetchWithRetry(input: FetchWithRetryInput): Promise<Response> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const baseDelayMs = input.baseDelayMs ?? 500;
  const maxDelayMs = input.maxDelayMs ?? 5_000;
  const retryOnStatuses = input.retryOnStatuses ?? [];

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(input.url, {
        ...input.init,
        signal: controller.signal,
      });

      if (!isRetryableStatus(response.status, retryOnStatuses) || attempt >= maxAttempts) {
        return response;
      }

      lastError = new Error(`Retryable response status ${response.status}`);
    } catch (error) {
      lastError = error;

      const isAbortError =
        error instanceof DOMException
          ? error.name === "AbortError"
          : error instanceof Error && error.name === "AbortError";
      const isNetworkError =
        error instanceof TypeError ||
        (error instanceof Error &&
          /network|fetch failed|socket|econn|etimedout|timed out/i.test(error.message));

      if ((!isAbortError && !isNetworkError) || attempt >= maxAttempts) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxAttempts) {
      await sleep(calculateBackoffDelayMs(attempt, baseDelayMs, maxDelayMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("External request failed after all retry attempts.");
}
