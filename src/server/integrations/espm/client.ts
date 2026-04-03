import pThrottle from "p-throttle";
import { createLogger } from "@/server/lib/logger";
import { espmParser } from "./xml-config";
import {
  ESPMAccessError,
  ESPMAuthError,
  ESPMError,
  ESPMNotFoundError,
  ESPMRateLimitError,
  ESPMValidationError,
} from "./errors";

export interface ESPMClientConfig {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class ESPMClient {
  private readonly config: Required<ESPMClientConfig>;
  private readonly authHeader: string;
  private readonly logger = createLogger({
    integration: "ENERGY_STAR_PORTFOLIO_MANAGER",
  });
  private readonly throttledFetch: (
    ...args: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch>;

  constructor(config: ESPMClientConfig) {
    this.config = {
      timeoutMs: 30_000,
      maxRetries: 3,
      ...config,
    };

    this.authHeader =
      "Basic " +
      Buffer.from(
        `${this.config.username}:${this.config.password}`,
      ).toString("base64");

    const throttle = pThrottle({ limit: 3, interval: 1000 });
    this.throttledFetch = throttle(
      (...args: Parameters<typeof fetch>) => fetch(...args),
    );
  }

  async get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, undefined, headers);
  }

  async post<T>(
    path: string,
    body: string,
    headers?: Record<string, string>,
  ): Promise<T> {
    return this.request<T>("POST", path, body, headers);
  }

  async put<T>(
    path: string,
    body: string,
    headers?: Record<string, string>,
  ): Promise<T> {
    return this.request<T>("PUT", path, body, headers);
  }

  async delete<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>("DELETE", path, undefined, headers);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs,
        );

        const response = await this.throttledFetch(url, {
          method,
          headers: {
            Authorization: this.authHeader,
            "Content-Type": "application/xml",
            Accept: "application/xml",
            ...extraHeaders,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const responseText = await response.text();
        const durationMs = Date.now() - startTime;

        this.logger.info("ESPM request completed", {
          method,
          path,
          statusCode: response.status,
          durationMs,
          attempt: attempt + 1,
        });

        if (!response.ok) {
          const error = this.mapError(response.status, responseText);

          if (
            (response.status === 429 || response.status >= 500) &&
            attempt < this.config.maxRetries
          ) {
            const delay =
              Math.min(1000 * Math.pow(2, attempt), 30_000) +
              Math.random() * 1000;
            this.logger.warn("Retrying ESPM request after service failure", {
              method,
              path,
              statusCode: response.status,
              delayMs: Math.round(delay),
              attempt: attempt + 1,
            });
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          throw error;
        }

        return espmParser.parse(responseText) as T;
      } catch (err) {
        if (err instanceof ESPMError) throw err;
        if (attempt < this.config.maxRetries) {
          const delay =
            Math.min(1000 * Math.pow(2, attempt), 30_000) +
            Math.random() * 1000;
          this.logger.warn("Retrying ESPM request after network error", {
            method,
            path,
            delayMs: Math.round(delay),
            attempt: attempt + 1,
            error: err,
          });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new ESPMError(`Network error: ${err}`, 0, "NETWORK_ERROR");
      }
    }

    throw new ESPMError("Max retries exceeded", 0, "MAX_RETRIES");
  }

  private mapError(status: number, responseText: string): ESPMError {
    switch (status) {
      case 401:
        return new ESPMAuthError("Invalid ESPM credentials", responseText);
      case 403:
        return new ESPMAccessError(
          "Portfolio Manager denied access to this resource",
          responseText,
        );
      case 404:
        return new ESPMNotFoundError("ESPM resource not found", responseText);
      case 429:
        return new ESPMRateLimitError(responseText);
      case 400:
        return new ESPMValidationError(
          this.extractErrorMessage(responseText),
          responseText,
        );
      default:
        return new ESPMError(
          `ESPM error ${status}`,
          status,
          undefined,
          responseText,
        );
    }
  }

  private extractErrorMessage(responseText: string): string {
    try {
      const parsed = espmParser.parse(responseText) as {
        errors?: { error?: { errorDescription: string }[] };
      };
      const errors = parsed?.errors?.error;
      if (Array.isArray(errors) && errors.length > 0) {
        return errors.map((e) => e.errorDescription).join("; ");
      }
    } catch {
      /* ignore parse error */
    }
    return "ESPM validation error";
  }
}
