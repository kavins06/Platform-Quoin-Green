import { TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
import { ZodError } from "zod";
import { BepsConfigurationError } from "@/server/compliance/beps/config";
import { ComplianceProvenanceError } from "@/server/compliance/provenance";
import {
  PortfolioManagerPayloadError,
  type PortfolioManagerSyncStep,
} from "@/server/compliance/portfolio-manager-support";
import {
  ESPMAccessError,
  ESPMAuthError,
  ESPMError,
  ESPMNotFoundError,
  ESPMRateLimitError,
  ESPMValidationError,
} from "@/server/integrations/espm/errors";
import { ServerConfigError } from "@/server/lib/config";
import { TenantAccessError } from "@/server/lib/tenant-access";

export interface AppErrorOptions {
  code: string;
  httpStatus?: number;
  retryable?: boolean;
  exposeMessage?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly exposeMessage: boolean;
  readonly details: Record<string, unknown>;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? 500;
    this.retryable = options.retryable ?? false;
    this.exposeMessage = options.exposeMessage ?? true;
    this.details = options.details ?? {};
  }
}

export class ConfigError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, "code"> = {}) {
    super(message, {
      code: "CONFIG_ERROR",
      httpStatus: options.httpStatus ?? 500,
      exposeMessage: options.exposeMessage ?? false,
      ...options,
    });
    this.name = "ConfigError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, "code"> = {}) {
    super(message, {
      code: "VALIDATION_ERROR",
      httpStatus: options.httpStatus ?? 400,
      ...options,
    });
    this.name = "ValidationError";
  }
}

export class ContractValidationError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, "code"> = {}) {
    super(message, {
      code: "CONTRACT_VALIDATION_ERROR",
      httpStatus: options.httpStatus ?? 400,
      ...options,
    });
    this.name = "ContractValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, "code"> = {}) {
    super(message, {
      code: "NOT_FOUND",
      httpStatus: options.httpStatus ?? 404,
      ...options,
    });
    this.name = "NotFoundError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, "code"> = {}) {
    super(message, {
      code: "AUTHORIZATION_ERROR",
      httpStatus: options.httpStatus ?? 401,
      ...options,
    });
    this.name = "AuthorizationError";
  }
}

export class TenantIsolationError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, "code"> = {}) {
    super(message, {
      code: "TENANT_ISOLATION_ERROR",
      httpStatus: options.httpStatus ?? 403,
      ...options,
    });
    this.name = "TenantIsolationError";
  }
}

export class IntegrationError extends AppError {
  readonly service: string | null;

  constructor(
    message: string,
    options: Omit<AppErrorOptions, "code"> & {
      code?: string;
      service?: string | null;
    } = {},
  ) {
    super(message, {
      code: options.code ?? "INTEGRATION_ERROR",
      httpStatus: options.httpStatus ?? 502,
      retryable: options.retryable ?? false,
      details: {
        service: options.service ?? null,
        ...(options.details ?? {}),
      },
      exposeMessage: options.exposeMessage ?? true,
      cause: options.cause,
    });
    this.name = "IntegrationError";
    this.service = options.service ?? null;
  }
}

export class ExternalServiceError extends IntegrationError {
  constructor(
    message: string,
    options: Omit<AppErrorOptions, "code"> & {
      service?: string | null;
      code?: string;
    } = {},
  ) {
    super(message, {
      code: options.code ?? "EXTERNAL_SERVICE_ERROR",
      service: options.service,
      httpStatus: options.httpStatus ?? 502,
      retryable: options.retryable,
      exposeMessage: options.exposeMessage,
      details: options.details,
      cause: options.cause,
    });
    this.name = "ExternalServiceError";
  }
}

export class RetryableIntegrationError extends ExternalServiceError {
  constructor(
    message: string,
    options: Omit<AppErrorOptions, "code" | "retryable"> & {
      service?: string | null;
      code?: string;
    } = {},
  ) {
    super(message, {
      code: options.code ?? "RETRYABLE_INTEGRATION_ERROR",
      service: options.service,
      retryable: true,
      httpStatus: options.httpStatus ?? 503,
      exposeMessage: options.exposeMessage,
      details: options.details,
      cause: options.cause,
    });
    this.name = "RetryableIntegrationError";
  }
}

export class NonRetryableIntegrationError extends ExternalServiceError {
  constructor(
    message: string,
    options: Omit<AppErrorOptions, "code" | "retryable"> & {
      service?: string | null;
      code?: string;
    } = {},
  ) {
    super(message, {
      code: options.code ?? "NON_RETRYABLE_INTEGRATION_ERROR",
      service: options.service,
      retryable: false,
      httpStatus: options.httpStatus ?? 502,
      exposeMessage: options.exposeMessage,
      details: options.details,
      cause: options.cause,
    });
    this.name = "NonRetryableIntegrationError";
  }
}

export class PacketRenderError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, "code"> = {}) {
    super(message, {
      code: "PACKET_RENDER_ERROR",
      httpStatus: options.httpStatus ?? 500,
      exposeMessage: options.exposeMessage ?? true,
      ...options,
    });
    this.name = "PacketRenderError";
  }
}

export class PacketExportError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, "code"> = {}) {
    super(message, {
      code: "PACKET_EXPORT_ERROR",
      httpStatus: options.httpStatus ?? 500,
      exposeMessage: options.exposeMessage ?? true,
      ...options,
    });
    this.name = "PacketExportError";
  }
}

export class WorkflowStateError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, "code"> = {}) {
    super(message, {
      code: "WORKFLOW_STATE_ERROR",
      httpStatus: options.httpStatus ?? 409,
      ...options,
    });
    this.name = "WorkflowStateError";
  }
}

export const DATA_QUALITY_ISSUE_TYPES = {
  MISSING_MONTHS: "MISSING_MONTHS",
  OVERLAPPING_PERIODS: "OVERLAPPING_PERIODS",
  INCOMPLETE_TWELVE_MONTH_COVERAGE: "INCOMPLETE_TWELVE_MONTH_COVERAGE",
  UNRESOLVED_REPORTING_YEAR: "UNRESOLVED_REPORTING_YEAR",
  NO_DIRECT_YEAR_READINGS: "NO_DIRECT_YEAR_READINGS",
} as const;

export type DataQualityIssueType =
  (typeof DATA_QUALITY_ISSUE_TYPES)[keyof typeof DATA_QUALITY_ISSUE_TYPES];

export class DataQualityError extends AppError {
  readonly issueType: DataQualityIssueType;

  constructor(
    issueType: DataQualityIssueType,
    message: string,
    options: Omit<AppErrorOptions, "code"> = {},
  ) {
    super(message, {
      code: "DATA_QUALITY_ERROR",
      httpStatus: options.httpStatus ?? 422,
      exposeMessage: options.exposeMessage ?? true,
      details: {
        issueType,
        ...(options.details ?? {}),
      },
      retryable: options.retryable ?? false,
      cause: options.cause,
    });
    this.name = "DataQualityError";
    this.issueType = issueType;
  }
}

function defaultPublicMessage(error: AppError) {
  if (error.exposeMessage) {
    return error.message;
  }

  switch (true) {
    case error instanceof ConfigError:
      return "Server configuration error.";
    case error instanceof RetryableIntegrationError:
      return "An external service is temporarily unavailable. Retry later.";
    case error instanceof PacketRenderError:
      return "Packet rendering failed.";
    case error instanceof PacketExportError:
      return "Packet export failed.";
    case error instanceof AuthorizationError:
      return "Unauthorized.";
    case error instanceof TenantIsolationError:
      return error.httpStatus === 404 ? "Not found." : "Forbidden.";
    default:
      return "Internal server error.";
  }
}

function httpStatusToTrpcCode(status: number): TRPC_ERROR_CODE_KEY {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 412) return "PRECONDITION_FAILED";
  if (status === 429) return "TOO_MANY_REQUESTS";
  if (status === 503 || status === 504) return "TIMEOUT";
  return "INTERNAL_SERVER_ERROR";
}

function detailsWithCause(
  details: Record<string, unknown>,
  error: Error,
): Record<string, unknown> {
  return {
    ...details,
    causeName: error.name,
  };
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof TRPCError) {
    if (error.cause) {
      return toAppError(error.cause);
    }

    return new AppError(error.message, {
      code: `TRPC_${error.code}`,
      httpStatus:
        error.code === "BAD_REQUEST"
          ? 400
          : error.code === "UNAUTHORIZED"
            ? 401
            : error.code === "FORBIDDEN"
              ? 403
              : error.code === "NOT_FOUND"
                ? 404
                : error.code === "CONFLICT"
                  ? 409
                  : error.code === "TOO_MANY_REQUESTS"
                    ? 429
                    : 500,
      exposeMessage: true,
      cause: error,
    });
  }

  if (error instanceof ZodError) {
    return new ValidationError("Invalid request payload.", {
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      cause: error,
    });
  }

  if (error instanceof ServerConfigError) {
    return new ConfigError(error.message, {
      details: detailsWithCause({}, error),
      cause: error,
    });
  }

  if (error instanceof TenantAccessError) {
    if (error.status === 401) {
      return new AuthorizationError(error.message, {
        httpStatus: 401,
        cause: error,
      });
    }

    return new TenantIsolationError(error.message, {
      httpStatus: error.status,
      cause: error,
    });
  }

  if (error instanceof PortfolioManagerPayloadError) {
    return new NonRetryableIntegrationError(error.message, {
      service: "ENERGY_STAR_PORTFOLIO_MANAGER",
      httpStatus: 502,
      details: {
        syncPhase: error.step,
      },
      cause: error,
    });
  }

  if (error instanceof ESPMRateLimitError) {
    return new RetryableIntegrationError(error.message, {
      service: "ENERGY_STAR_PORTFOLIO_MANAGER",
      httpStatus: 429,
      details: {
        statusCode: error.statusCode,
        errorCode: error.espmErrorCode,
      },
      cause: error,
    });
  }

  if (
    error instanceof ESPMAuthError ||
    error instanceof ESPMAccessError ||
    error instanceof ESPMNotFoundError ||
    error instanceof ESPMValidationError
  ) {
    return new NonRetryableIntegrationError(error.message, {
      service: "ENERGY_STAR_PORTFOLIO_MANAGER",
      httpStatus: error.statusCode || 502,
      details: {
        statusCode: error.statusCode,
        errorCode: error.espmErrorCode,
      },
      cause: error,
    });
  }

  if (error instanceof ESPMError) {
    const retryable =
      error.statusCode === 0 ||
      error.statusCode >= 500 ||
      error.espmErrorCode === "NETWORK_ERROR";

    const ErrorCtor = retryable
      ? RetryableIntegrationError
      : NonRetryableIntegrationError;

    return new ErrorCtor(error.message, {
      service: "ENERGY_STAR_PORTFOLIO_MANAGER",
      httpStatus:
        error.statusCode === 0 ? 503 : error.statusCode || 502,
      details: {
        statusCode: error.statusCode,
        errorCode: error.espmErrorCode,
      },
      cause: error,
    });
  }

  if (error instanceof ComplianceProvenanceError) {
    const message = error.message;
    if (/not found/i.test(message)) {
      return new NotFoundError(message, { cause: error });
    }

    return new WorkflowStateError(message, { cause: error });
  }

  if (error instanceof BepsConfigurationError) {
    return new WorkflowStateError(error.message, {
      details: {
        reasonCode: error.reasonCode,
      },
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new AppError(error.message, {
      code: "INTERNAL_ERROR",
      httpStatus: 500,
      retryable: false,
      exposeMessage: false,
      details: detailsWithCause({}, error),
      cause: error,
    });
  }

  return new AppError("Unexpected error", {
    code: "UNKNOWN_ERROR",
    httpStatus: 500,
    exposeMessage: false,
    details: {
      rawError: String(error),
    },
  });
}

export function toTrpcError(error: unknown) {
  const appError = toAppError(error);

  return new TRPCError({
    code: httpStatusToTrpcCode(appError.httpStatus),
    message: defaultPublicMessage(appError),
    cause: appError,
  });
}

export function toHttpErrorResponseBody(error: unknown, requestId?: string) {
  const appError = toAppError(error);

  return {
    status: appError.httpStatus,
    body: {
      error: defaultPublicMessage(appError),
      code: appError.code,
      retryable: appError.retryable,
      requestId: requestId ?? null,
    },
  };
}

export function getAppErrorLogLevel(
  error: AppError,
): "warn" | "error" {
  if (error.httpStatus >= 500 || error.retryable) {
    return "error";
  }

  return "warn";
}

export function createRetryableIntegrationError(
  service: string,
  message: string,
  input: {
    httpStatus?: number;
    details?: Record<string, unknown>;
    cause?: unknown;
  } = {},
) {
  return new RetryableIntegrationError(message, {
    service,
    httpStatus: input.httpStatus,
    details: input.details,
    cause: input.cause,
  });
}

export function createNonRetryableIntegrationError(
  service: string,
  message: string,
  input: {
    httpStatus?: number;
    details?: Record<string, unknown>;
    cause?: unknown;
  } = {},
) {
  return new NonRetryableIntegrationError(message, {
    service,
    httpStatus: input.httpStatus,
    details: input.details,
    cause: input.cause,
  });
}

export function buildSyncPhaseDetails(
  syncPhase: PortfolioManagerSyncStep,
  details?: Record<string, unknown>,
) {
  return {
    syncPhase,
    ...(details ?? {}),
  };
}
