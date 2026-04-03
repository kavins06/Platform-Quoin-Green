import type {
  ActorType,
  BenchmarkSubmissionStatus,
  EspmShareStatus,
  MeterType,
  Prisma,
} from "@/generated/prisma/client";
import type { ESPM, PropertyMetrics } from "@/server/integrations/espm";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import {
  buildSyncPhaseDetails,
  createNonRetryableIntegrationError,
  createRetryableIntegrationError,
  NotFoundError,
  toAppError,
} from "@/server/lib/errors";
import {
  createJob,
  markCompleted,
  markDead,
  markFailed,
  markRunning,
} from "@/server/lib/jobs";
import { createLogger, type StructuredLogger } from "@/server/lib/logger";
import { getConversionFactor } from "@/server/pipelines/data-ingestion/normalizer";
import { buildSnapshotData } from "@/server/pipelines/data-ingestion/snapshot";
import {
  classifyPortfolioManagerError,
  parsePortfolioManagerConsumptionReadings,
  parsePortfolioManagerMeterDetail,
  parsePortfolioManagerMeterIds,
  parsePortfolioManagerProperty,
  summarizePortfolioManagerSyncState,
  type PortfolioManagerPropertySnapshot,
  type PortfolioManagerMeterSnapshot,
  type PortfolioManagerSyncErrorDetail,
  type PortfolioManagerSyncStep,
  type PortfolioManagerSyncStepStatus,
} from "./portfolio-manager-support";
import {
  evaluateAndUpsertBenchmarkSubmission,
  type BenchmarkReadinessResult,
} from "./benchmarking";
import { refreshSourceReconciliationDataIssues } from "./data-issues";

// Legacy benchmarking compatibility layer only. The current Portfolio Manager
// connection, setup, import, and push workflow lives in src/server/portfolio-manager/*.

const PM_SYNC_SYSTEM = "ENERGY_STAR_PORTFOLIO_MANAGER";
const PM_STALE_DAYS = 30;

type PortfolioManagerSyncClient = Pick<
  ESPM,
  "property" | "meter" | "consumption" | "metrics"
>;
type PortfolioManagerSyncStatus =
  | "IDLE"
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "FAILED";

interface PortfolioManagerQaFinding {
  code:
    | "MISSING_REQUIRED_METERS"
    | "STALE_PM_DATA"
    | "PROPERTY_LINKAGE_MISSING"
    | "PROPERTY_LINKAGE_MISMATCH"
    | "MISSING_PM_SHARING_STATE"
    | "MISSING_COVERAGE"
    | "OVERLAPPING_PERIODS";
  status: "PASS" | "FAIL";
  severity: "INFO" | "ERROR";
  message: string;
  metadata?: Record<string, unknown>;
}

interface PortfolioManagerQaPayload {
  evaluatedAt: string;
  reportingYear: number;
  status: "READY" | "ATTENTION";
  findings: PortfolioManagerQaFinding[];
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getDefaultReportingYear(now = new Date()) {
  return now.getUTCFullYear() - 1;
}

function addUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizePeriodKey(
  meterId: string | null,
  meterType: MeterType,
  start: Date,
  end: Date,
) {
  return `${meterId ?? meterType}:${start.toISOString()}:${end.toISOString()}`;
}

function createInitialStepStatuses(
  propertyStatus: PortfolioManagerSyncStepStatus = "PENDING",
): Record<Exclude<PortfolioManagerSyncStep, "sync">, PortfolioManagerSyncStepStatus> {
  return {
    property: propertyStatus,
    meters: "PENDING",
    consumption: "PENDING",
    metrics: "PENDING",
    benchmarking: "PENDING",
  };
}

function toSyncErrorRecord(error: PortfolioManagerSyncErrorDetail) {
  return {
    step: error.step,
    message: error.message,
    retryable: error.retryable,
    errorCode: error.errorCode,
    statusCode: error.statusCode,
  };
}

function buildSyncErrorMetadata(input: {
  warnings: string[];
  errors: PortfolioManagerSyncErrorDetail[];
  failedStep?: PortfolioManagerSyncStep | null;
  message?: string | null;
  retryable?: boolean;
  errorCode?: string | null;
}) {
  const primary = input.errors[0] ?? null;
  return {
    message:
      primary?.message ?? input.message ?? (input.warnings[0] ?? null),
    failedStep: primary?.step ?? input.failedStep ?? null,
    retryable: primary?.retryable ?? input.retryable ?? false,
    errorCode: primary?.errorCode ?? input.errorCode ?? null,
    warnings: input.warnings,
    errors: input.errors.map(toSyncErrorRecord),
  };
}

function toPortfolioManagerJobError(detail: PortfolioManagerSyncErrorDetail) {
  const details = buildSyncPhaseDetails(detail.step, {
    errorCode: detail.errorCode,
    statusCode: detail.statusCode,
  });

  if (detail.retryable) {
    return createRetryableIntegrationError(
      PM_SYNC_SYSTEM,
      detail.message,
      {
        httpStatus: detail.statusCode ?? 503,
        details,
      },
    );
  }

  return createNonRetryableIntegrationError(
    PM_SYNC_SYSTEM,
    detail.message,
    {
      httpStatus: detail.statusCode ?? 502,
      details,
    },
  );
}

function logPortfolioManagerSyncError(
  logger: StructuredLogger,
  detail: PortfolioManagerSyncErrorDetail,
  error: unknown,
  message: string,
) {
  const level = detail.retryable ? "error" : "warn";
  logger[level](message, {
    error,
    syncPhase: detail.step,
    retryable: detail.retryable,
    errorCode: detail.errorCode,
    statusCode: detail.statusCode,
  });
}

function resolveFinalSyncStatus(
  stepStatuses: Record<Exclude<PortfolioManagerSyncStep, "sync">, PortfolioManagerSyncStepStatus>,
): PortfolioManagerSyncStatus {
  const statuses = Object.values(stepStatuses);
  const hasFailures = statuses.some((status) => status === "FAILED");
  const hasPartials = statuses.some((status) => status === "PARTIAL");
  const hasSuccessLike = statuses.some(
    (status) => status === "SUCCEEDED" || status === "PARTIAL",
  );

  if (hasFailures) {
    return hasSuccessLike ? "PARTIAL" : "FAILED";
  }

  if (hasPartials) {
    return "PARTIAL";
  }

  return "SUCCEEDED";
}

function determineScoreEligibility(
  metrics: PropertyMetrics | null,
  reasonsForNoScore: string[],
  currentValue: boolean | null,
) {
  if (metrics?.score != null) {
    return true;
  }

  const explicitlyIneligible = reasonsForNoScore.some((reason) =>
    /not eligible|cannot receive|ineligible/i.test(reason),
  );

  if (explicitlyIneligible) {
    return false;
  }

  return currentValue;
}

function hasUsableMetrics(metrics: PropertyMetrics | null) {
  if (!metrics) {
    return false;
  }

  return [
    metrics.score,
    metrics.siteTotal,
    metrics.sourceTotal,
    metrics.siteIntensity,
    metrics.sourceIntensity,
    metrics.weatherNormalizedSiteIntensity,
    metrics.weatherNormalizedSourceIntensity,
  ].some((value) => value != null);
}

function buildQaPayload(input: {
  reportingYear: number;
  building: {
    espmPropertyId: bigint | number | null;
    espmShareStatus: EspmShareStatus;
  };
  property: PortfolioManagerPropertySnapshot | null;
  activeLinkedMeters: number;
  lastSuccessfulSyncAt: Date | null;
  readiness: BenchmarkReadinessResult | null;
  evaluatedAt: Date;
}): PortfolioManagerQaPayload {
  const findings: PortfolioManagerQaFinding[] = [];

  if (!input.building.espmPropertyId) {
    findings.push({
      code: "PROPERTY_LINKAGE_MISSING",
      status: "FAIL",
      severity: "ERROR",
      message: "Portfolio Manager property linkage is missing.",
    });
  } else {
    findings.push({
      code: "PROPERTY_LINKAGE_MISSING",
      status: "PASS",
      severity: "INFO",
      message: "Portfolio Manager property linkage is present.",
      metadata: {
        espmPropertyId: String(input.building.espmPropertyId),
      },
    });
  }

  if (
    input.property?.propertyId != null &&
    input.building.espmPropertyId != null &&
    String(input.property.propertyId) !== String(input.building.espmPropertyId)
  ) {
    findings.push({
      code: "PROPERTY_LINKAGE_MISMATCH",
      status: "FAIL",
      severity: "ERROR",
      message: "Portfolio Manager returned a property ID that does not match the linked building.",
      metadata: {
        linkedPropertyId: String(input.building.espmPropertyId),
        returnedPropertyId: String(input.property.propertyId),
      },
    });
  } else {
    findings.push({
      code: "PROPERTY_LINKAGE_MISMATCH",
      status: "PASS",
      severity: "INFO",
      message: "Portfolio Manager property linkage matches the linked building.",
    });
  }

  if (input.building.espmShareStatus !== "LINKED") {
    findings.push({
      code: "MISSING_PM_SHARING_STATE",
      status: "FAIL",
      severity: "ERROR",
      message: "Portfolio Manager sharing state is not linked.",
      metadata: {
        espmShareStatus: input.building.espmShareStatus,
      },
    });
  } else {
    findings.push({
      code: "MISSING_PM_SHARING_STATE",
      status: "PASS",
      severity: "INFO",
      message: "Portfolio Manager sharing state is linked.",
    });
  }

  if (input.activeLinkedMeters < 1) {
    findings.push({
      code: "MISSING_REQUIRED_METERS",
      status: "FAIL",
      severity: "ERROR",
      message: "No active linked Portfolio Manager meters were found for the building.",
    });
  } else {
    findings.push({
      code: "MISSING_REQUIRED_METERS",
      status: "PASS",
      severity: "INFO",
      message: "At least one active linked Portfolio Manager meter is present.",
      metadata: {
        activeLinkedMeters: input.activeLinkedMeters,
      },
    });
  }

  const staleCutoff = addUtcDays(input.evaluatedAt, -PM_STALE_DAYS);
  if (!input.lastSuccessfulSyncAt || input.lastSuccessfulSyncAt < staleCutoff) {
    findings.push({
      code: "STALE_PM_DATA",
      status: "FAIL",
      severity: "ERROR",
      message: "Portfolio Manager sync data is stale.",
      metadata: {
        lastSuccessfulSyncAt: input.lastSuccessfulSyncAt?.toISOString() ?? null,
        freshnessDays: PM_STALE_DAYS,
      },
    });
  } else {
    findings.push({
      code: "STALE_PM_DATA",
      status: "PASS",
      severity: "INFO",
      message: "Portfolio Manager sync data is fresh enough for benchmarking automation.",
      metadata: {
        lastSuccessfulSyncAt: input.lastSuccessfulSyncAt.toISOString(),
        freshnessDays: PM_STALE_DAYS,
      },
    });
  }

  const readinessFinding = (code: string) =>
    input.readiness?.findings.find((finding) => finding.code === code) ?? null;

  const missingCoverage =
    readinessFinding("MISSING_COVERAGE") ??
    (input.readiness?.summary.coverageComplete === false
      ? {
          status: "FAIL" as const,
          message: "Utility data does not fully cover the reporting year without gaps.",
          metadata: {
            missingCoverageStreams: input.readiness.summary.missingCoverageStreams,
          },
        }
      : null);
  findings.push({
    code: "MISSING_COVERAGE",
    status: missingCoverage?.status === "FAIL" ? "FAIL" : "PASS",
    severity: missingCoverage?.status === "FAIL" ? "ERROR" : "INFO",
    message:
      missingCoverage?.message ??
      "Reporting-year utility coverage has not yet been evaluated.",
    metadata: missingCoverage?.metadata,
  });

  const overlappingBills =
    readinessFinding("OVERLAPPING_BILLS") ??
    ((input.readiness?.summary.overlapStreams.length ?? 0) > 0
      ? {
          status: "FAIL" as const,
          message: "Overlapping billing periods were detected in utility data.",
          metadata: {
            overlapStreams: input.readiness?.summary.overlapStreams ?? [],
          },
        }
      : null);
  findings.push({
    code: "OVERLAPPING_PERIODS",
    status: overlappingBills?.status === "FAIL" ? "FAIL" : "PASS",
    severity: overlappingBills?.status === "FAIL" ? "ERROR" : "INFO",
    message:
      overlappingBills?.message ??
      "Billing-period overlap has not yet been evaluated.",
    metadata: overlappingBills?.metadata,
  });

  return {
    evaluatedAt: input.evaluatedAt.toISOString(),
    reportingYear: input.reportingYear,
    status: findings.some((finding) => finding.status === "FAIL")
      ? "ATTENTION"
      : "READY",
    findings,
  };
}

async function persistSyncState(input: {
  organizationId: string;
  buildingId: string;
  status: PortfolioManagerSyncStatus;
  lastAttemptedSyncAt: Date;
  lastSuccessfulSyncAt?: Date | null;
  lastFailedSyncAt?: Date | null;
  attemptCount?: number;
  retryCount?: number;
  latestJobId?: string | null;
  latestErrorCode?: string | null;
  latestErrorMessage?: string | null;
  lastErrorMetadata?: Record<string, unknown>;
  sourceMetadata?: Record<string, unknown>;
  syncMetadata?: Record<string, unknown>;
  qaPayload?: PortfolioManagerQaPayload | Record<string, unknown>;
}) {
  return prisma.portfolioManagerSyncState.upsert({
    where: {
      buildingId: input.buildingId,
    },
    create: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      status: input.status,
      lastAttemptedSyncAt: input.lastAttemptedSyncAt,
      lastSuccessfulSyncAt: input.lastSuccessfulSyncAt ?? null,
      lastFailedSyncAt: input.lastFailedSyncAt ?? null,
      attemptCount: input.attemptCount ?? 0,
      retryCount: input.retryCount ?? 0,
      latestJobId: input.latestJobId ?? null,
      latestErrorCode: input.latestErrorCode ?? null,
      latestErrorMessage: input.latestErrorMessage ?? null,
      lastErrorMetadata: toJson(input.lastErrorMetadata ?? {}),
      sourceMetadata: toJson(input.sourceMetadata ?? {}),
      syncMetadata: toJson(input.syncMetadata ?? {}),
      qaPayload: toJson(input.qaPayload ?? {}),
    },
    update: {
      status: input.status,
      lastAttemptedSyncAt: input.lastAttemptedSyncAt,
      lastSuccessfulSyncAt: input.lastSuccessfulSyncAt ?? undefined,
      lastFailedSyncAt: input.lastFailedSyncAt ?? undefined,
      attemptCount: input.attemptCount ?? undefined,
      retryCount: input.retryCount ?? undefined,
      latestJobId: input.latestJobId ?? undefined,
      latestErrorCode: input.latestErrorCode ?? undefined,
      latestErrorMessage: input.latestErrorMessage ?? undefined,
      lastErrorMetadata: toJson(input.lastErrorMetadata ?? {}),
      sourceMetadata: toJson(input.sourceMetadata ?? {}),
      syncMetadata: toJson(input.syncMetadata ?? {}),
      qaPayload: toJson(input.qaPayload ?? {}),
    },
  });
}

export async function syncPortfolioManagerForBuildingReliable(params: {
  organizationId: string;
  buildingId: string;
  reportingYear?: number;
  espmClient: PortfolioManagerSyncClient;
  producedByType: ActorType;
  producedById?: string | null;
  requestId?: string | null;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const reportingYear = params.reportingYear ?? getDefaultReportingYear(now);
  const job = await createJob({
    type: "PORTFOLIO_MANAGER_SYNC",
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    maxAttempts: 3,
  });
  const runningJob = await markRunning(job.id);
  const logger = createLogger({
    requestId: params.requestId ?? null,
    jobId: job.id,
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    userId: params.producedById ?? null,
    procedure: "portfolioManager.sync",
  });
  const writeAudit = (input: {
    action: string;
    inputSnapshot?: Record<string, unknown>;
    outputSnapshot?: Record<string, unknown>;
    errorCode?: string | null;
  }) =>
    createAuditLog({
      actorType: params.producedByType,
      actorId: params.producedById ?? null,
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      requestId: params.requestId ?? null,
      action: input.action,
      inputSnapshot: input.inputSnapshot,
      outputSnapshot: input.outputSnapshot,
      errorCode: input.errorCode ?? null,
    }).catch((error) => {
      logger.error("Portfolio Manager audit log persistence failed", {
        error,
        auditAction: input.action,
      });
      return null;
    });
  const writePhaseAudit = (input: {
    action: string;
    phase: PortfolioManagerSyncStep;
    inputSnapshot?: Record<string, unknown>;
    outputSnapshot?: Record<string, unknown>;
    errorCode?: string | null;
  }) =>
    writeAudit({
      action: input.action,
      inputSnapshot: {
        reportingYear,
        syncPhase: input.phase,
        jobId: job.id,
        ...(input.inputSnapshot ?? {}),
      },
      outputSnapshot: input.outputSnapshot,
      errorCode: input.errorCode ?? null,
    });

  const completeOperationalJob = async (input: {
    status: PortfolioManagerSyncStatus;
    stepStatuses: Record<Exclude<PortfolioManagerSyncStep, "sync">, PortfolioManagerSyncStepStatus>;
    readingsCreated: number;
    readingsUpdated: number;
    readingsSkipped: number;
    snapshotId: string | null;
    benchmarkSubmissionId: string | null;
  }) => {
    try {
      await markCompleted(job.id);
      await writeAudit({
        action: "portfolio_manager.sync.completed",
        inputSnapshot: {
          reportingYear,
        },
        outputSnapshot: {
          status: input.status,
          stepStatuses: input.stepStatuses,
          readingsCreated: input.readingsCreated,
          readingsUpdated: input.readingsUpdated,
          readingsSkipped: input.readingsSkipped,
          snapshotId: input.snapshotId,
          benchmarkSubmissionId: input.benchmarkSubmissionId,
        },
      });
    } catch (error) {
      logger.error("Portfolio Manager job completion persistence failed", {
        error,
      });
    }
  };

  const failOperationalJob = async (error: unknown, input: {
    status: PortfolioManagerSyncStatus;
    stepStatuses: Record<Exclude<PortfolioManagerSyncStep, "sync">, PortfolioManagerSyncStepStatus>;
    readingsCreated: number;
    readingsUpdated: number;
    readingsSkipped: number;
    snapshotId: string | null;
    benchmarkSubmissionId: string | null;
  }) => {
    const appError = toAppError(error);
    try {
      if (appError.retryable) {
        await markFailed(job.id, appError.message);
        await writeAudit({
          action: "portfolio_manager.sync.retry_scheduled",
          inputSnapshot: {
            reportingYear,
            jobId: job.id,
          },
          outputSnapshot: {
            retryable: true,
          },
          errorCode: appError.code,
        });
      } else {
        await markDead(job.id, appError.message);
        await writeAudit({
          action: "portfolio_manager.sync.dead_lettered",
          inputSnapshot: {
            reportingYear,
            jobId: job.id,
          },
          outputSnapshot: {
            retryable: false,
          },
          errorCode: appError.code,
        });
      }

      await writeAudit({
        action: "portfolio_manager.sync.failed",
        inputSnapshot: {
          reportingYear,
        },
        outputSnapshot: {
          status: input.status,
          stepStatuses: input.stepStatuses,
          readingsCreated: input.readingsCreated,
          readingsUpdated: input.readingsUpdated,
          readingsSkipped: input.readingsSkipped,
          snapshotId: input.snapshotId,
          benchmarkSubmissionId: input.benchmarkSubmissionId,
          retryable: appError.retryable,
        },
        errorCode: appError.code,
      });
    } catch (jobError) {
      logger.error("Portfolio Manager job failure persistence failed", {
        error: jobError,
        originalError: appError,
      });
    }
  };

  await writeAudit({
    action: "portfolio_manager.sync.started",
    inputSnapshot: {
      reportingYear,
      jobId: job.id,
    },
  });
  await writeAudit({
    action: "portfolio_manager.sync.running",
    inputSnapshot: {
      reportingYear,
      jobId: job.id,
    },
  });
  await persistSyncState({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    status: "RUNNING",
    lastAttemptedSyncAt: now,
    attemptCount: runningJob.attempts,
    retryCount: Math.max(runningJob.attempts - 1, 0),
    latestJobId: job.id,
    sourceMetadata: {
      system: PM_SYNC_SYSTEM,
      reportingYear,
    },
    syncMetadata: {
      reportingYear,
      stepStatuses: createInitialStepStatuses("RUNNING"),
      runtimeStatus: "RUNNING",
    },
  });
  let building;
  let existingSubmission;
  let previousSyncState;

  try {
    [building, existingSubmission, previousSyncState] = await Promise.all([
      prisma.building.findFirst({
        where: {
          id: params.buildingId,
          organizationId: params.organizationId,
        },
        select: {
          id: true,
          organizationId: true,
          name: true,
          address: true,
          grossSquareFeet: true,
          yearBuilt: true,
          doeeBuildingId: true,
          bepsTargetScore: true,
          targetEui: true,
          espmPropertyId: true,
          espmShareStatus: true,
          isEnergyStarScoreEligible: true,
        },
      }),
      prisma.benchmarkSubmission.findUnique({
        where: {
          buildingId_reportingYear: {
            buildingId: params.buildingId,
            reportingYear,
          },
        },
        select: {
          status: true,
          submissionPayload: true,
        },
      }),
      prisma.portfolioManagerSyncState.findUnique({
        where: { buildingId: params.buildingId },
        select: { lastSuccessfulSyncAt: true },
      }),
    ]);
  } catch (error) {
    await failOperationalJob(error, {
      status: "FAILED",
      stepStatuses: createInitialStepStatuses("FAILED"),
      readingsCreated: 0,
      readingsUpdated: 0,
      readingsSkipped: 0,
      snapshotId: null,
      benchmarkSubmissionId: null,
    });
    throw error;
  }

  if (!building) {
    const error = new NotFoundError("Building not found for Portfolio Manager sync");
    await failOperationalJob(error, {
      status: "FAILED",
      stepStatuses: createInitialStepStatuses("FAILED"),
      readingsCreated: 0,
      readingsUpdated: 0,
      readingsSkipped: 0,
      snapshotId: null,
      benchmarkSubmissionId: null,
    });
    throw error;
  }

  logger.info("Portfolio Manager sync started", {
    reportingYear,
    propertyId: building.espmPropertyId ? Number(building.espmPropertyId) : null,
  });

  const previousLastSuccessfulSyncAt =
    previousSyncState?.lastSuccessfulSyncAt ?? null;
  const stepStatuses = createInitialStepStatuses("RUNNING");
  const stepErrors: PortfolioManagerSyncErrorDetail[] = [];
  const warnings: string[] = [];
  let propertySnapshot: PortfolioManagerPropertySnapshot | null = null;
  const meterSnapshots: PortfolioManagerMeterSnapshot[] = [];
  let metricsSummary: PropertyMetrics | null = null;
  let readiness: BenchmarkReadinessResult | null = null;
  let benchmarkSubmission: {
    id: string;
    status: BenchmarkSubmissionStatus;
    complianceRunId: string | null;
  } | null = null;
  let snapshotId: string | null = null;
  let activeLinkedMeters = 0;
  let readingsCreated = 0;
  let readingsUpdated = 0;
  let readingsSkipped = 0;

  const propertyId = building.espmPropertyId
    ? Number(building.espmPropertyId)
    : null;

  await persistSyncState({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    status: "RUNNING",
    lastAttemptedSyncAt: now,
    lastSuccessfulSyncAt: previousLastSuccessfulSyncAt,
    attemptCount: runningJob.attempts,
    retryCount: Math.max(runningJob.attempts - 1, 0),
    latestJobId: job.id,
    lastErrorMetadata: {},
    sourceMetadata: {
      system: PM_SYNC_SYSTEM,
      reportingYear,
      propertyId,
    },
    syncMetadata: {
      reportingYear,
      stepStatuses,
      readingsCreated: 0,
      readingsUpdated: 0,
      readingsSkipped: 0,
      activeLinkedMeters: 0,
      snapshotId: null,
      benchmarkSubmissionId: null,
      runtimeStatus: "RUNNING",
    },
  });

  if (!propertyId) {
    stepErrors.push({
      step: "property",
      message: "Portfolio Manager property linkage is missing.",
      retryable: false,
      errorCode: "PROPERTY_LINKAGE_MISSING",
      statusCode: null,
    });
    stepStatuses.property = "FAILED";
    stepStatuses.meters = "SKIPPED";
    stepStatuses.consumption = "SKIPPED";
    stepStatuses.metrics = "SKIPPED";
    stepStatuses.benchmarking = "SKIPPED";
    logger.warn("Portfolio Manager sync blocked before property step", {
      reportingYear,
      syncPhase: "property",
      errorCode: "PROPERTY_LINKAGE_MISSING",
      retryable: false,
    });

    const syncState = await persistSyncState({
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      status: "FAILED",
      lastAttemptedSyncAt: now,
      lastSuccessfulSyncAt: previousLastSuccessfulSyncAt,
      lastFailedSyncAt: now,
      attemptCount: runningJob.attempts,
      retryCount: Math.max(runningJob.attempts - 1, 0),
      latestJobId: job.id,
      latestErrorCode: "PROPERTY_LINKAGE_MISSING",
      latestErrorMessage: "Portfolio Manager property linkage is missing.",
      lastErrorMetadata: buildSyncErrorMetadata({
        warnings,
        errors: stepErrors,
        failedStep: "property",
        message: "Portfolio Manager property linkage is missing.",
        retryable: false,
        errorCode: "PROPERTY_LINKAGE_MISSING",
      }),
      sourceMetadata: {
        system: PM_SYNC_SYSTEM,
        reportingYear,
        propertyId: null,
      },
      syncMetadata: {
        reportingYear,
        stepStatuses,
        readingsCreated,
        readingsUpdated,
        readingsSkipped,
        activeLinkedMeters,
        snapshotId,
        benchmarkSubmissionId: null,
        runtimeStatus: "FAILED",
      },
      qaPayload: buildQaPayload({
        reportingYear,
        building,
        property: null,
        activeLinkedMeters,
        lastSuccessfulSyncAt: previousLastSuccessfulSyncAt,
        readiness,
        evaluatedAt: now,
      }),
    });

    await failOperationalJob(
      toPortfolioManagerJobError(stepErrors[0]!),
      {
        status: "FAILED",
        stepStatuses,
        readingsCreated,
        readingsUpdated,
        readingsSkipped,
        snapshotId,
        benchmarkSubmissionId: null,
      },
    );

    logger.info("Portfolio Manager sync completed", {
      reportingYear,
      status: "FAILED",
      readingsCreated,
      readingsUpdated,
      readingsSkipped,
      snapshotId,
    });

    return {
      syncState: {
        ...syncState,
        diagnostics: summarizePortfolioManagerSyncState(syncState),
      },
      property: null,
      meters: [],
      metrics: null,
      readiness: null,
      benchmarkSubmission: null,
    };
  }

    try {
      try {
        await writePhaseAudit({
          action: "portfolio_manager.sync.external_request.started",
          phase: "property",
          inputSnapshot: {
            propertyId,
          },
        });
        const propertyResponse = await params.espmClient.property.getProperty(propertyId);
        propertySnapshot = parsePortfolioManagerProperty(propertyResponse, propertyId);

      const buildingUpdate: Record<string, unknown> = {};
      if (
        propertySnapshot.grossFloorArea != null &&
        propertySnapshot.grossFloorArea > 0 &&
        Math.round(propertySnapshot.grossFloorArea) !== building.grossSquareFeet
      ) {
        buildingUpdate["grossSquareFeet"] = Math.round(propertySnapshot.grossFloorArea);
      }
      if (
        propertySnapshot.yearBuilt != null &&
        propertySnapshot.yearBuilt > 0 &&
        propertySnapshot.yearBuilt !== building.yearBuilt
      ) {
        buildingUpdate["yearBuilt"] = propertySnapshot.yearBuilt;
      }

      if (Object.keys(buildingUpdate).length > 0) {
        await prisma.building.update({
          where: { id: building.id },
          data: buildingUpdate,
        });
      }

      stepStatuses.property = "SUCCEEDED";
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.succeeded",
        phase: "property",
        inputSnapshot: {
          propertyId,
        },
        outputSnapshot: {
          propertyId: propertySnapshot.propertyId,
        },
      });
    } catch (error) {
      const detail = classifyPortfolioManagerError(error, "property");
      stepErrors.push(detail);
      logPortfolioManagerSyncError(
        logger,
        detail,
        error,
        "Portfolio Manager property step failed",
      );
      stepStatuses.property = "FAILED";
      stepStatuses.meters = "SKIPPED";
      stepStatuses.consumption = "SKIPPED";
      stepStatuses.metrics = "SKIPPED";
      stepStatuses.benchmarking = "SKIPPED";
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.failed",
        phase: "property",
        inputSnapshot: {
          propertyId,
        },
        outputSnapshot: {
          retryable: detail.retryable,
        },
        errorCode: detail.errorCode,
      });
      throw error;
    }

    try {
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.started",
        phase: "meters",
        inputSnapshot: {
          propertyId,
        },
      });
      const meterIds = parsePortfolioManagerMeterIds(
        await params.espmClient.meter.listMeters(propertyId),
      );
      let meterFailures = 0;

      for (const meterId of meterIds) {
        try {
          const meter = parsePortfolioManagerMeterDetail(
            await params.espmClient.meter.getMeter(meterId),
            meterId,
          );
          meterSnapshots.push(meter);

          const existingMeter = await prisma.meter.findFirst({
            where: {
              buildingId: building.id,
              organizationId: params.organizationId,
              espmMeterId: BigInt(meter.meterId),
            },
            select: { id: true },
          });

          if (existingMeter) {
            await prisma.meter.update({
              where: { id: existingMeter.id },
              data: {
                meterType: meter.meterType,
                name: meter.name,
                unit: meter.unit,
                isActive: meter.inUse,
              },
            });
          } else {
            await prisma.meter.create({
              data: {
                buildingId: building.id,
                organizationId: params.organizationId,
                espmMeterId: BigInt(meter.meterId),
                meterType: meter.meterType,
                name: meter.name,
                unit: meter.unit,
                isActive: meter.inUse,
              },
            });
          }
        } catch (error) {
          meterFailures += 1;
          const detail = classifyPortfolioManagerError(error, "meters");
          stepErrors.push(detail);
          logPortfolioManagerSyncError(
            logger,
            detail,
            error,
            "Portfolio Manager meter refresh failed",
          );
          warnings.push(`Meter ${meterId} refresh failed: ${detail.message}`);
        }
      }

      activeLinkedMeters = meterSnapshots.filter((meter) => meter.inUse).length;
      if (meterFailures > 0) {
        stepStatuses.meters = meterSnapshots.length > 0 ? "PARTIAL" : "FAILED";
      } else {
        stepStatuses.meters = "SUCCEEDED";
      }
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.succeeded",
        phase: "meters",
        inputSnapshot: {
          propertyId,
        },
        outputSnapshot: {
          meterCount: meterSnapshots.length,
          activeLinkedMeters,
          partialFailures: meterFailures,
        },
      });
    } catch (error) {
      const detail = classifyPortfolioManagerError(error, "meters");
      stepErrors.push(detail);
      logPortfolioManagerSyncError(
        logger,
        detail,
        error,
        "Portfolio Manager meter step failed",
      );
      warnings.push(`Meter refresh failed: ${detail.message}`);
      stepStatuses.meters = "FAILED";
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.failed",
        phase: "meters",
        inputSnapshot: {
          propertyId,
        },
        outputSnapshot: {
          retryable: detail.retryable,
        },
        errorCode: detail.errorCode,
      });
    }

    try {
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.started",
        phase: "consumption",
        inputSnapshot: {
          propertyId,
        },
      });
      const periodStart = new Date(Date.UTC(reportingYear, 0, 1));
      const periodEnd = new Date(Date.UTC(reportingYear, 11, 31));
      const localMeters = await prisma.meter.findMany({
        where: {
          buildingId: building.id,
          organizationId: params.organizationId,
          espmMeterId: { not: null },
        },
        select: {
          id: true,
          espmMeterId: true,
          meterType: true,
          unit: true,
          name: true,
        },
      });

      const existingReadings = await prisma.energyReading.findMany({
        where: {
          buildingId: building.id,
          organizationId: params.organizationId,
          periodStart: { gte: periodStart },
          periodEnd: { lte: periodEnd },
        },
        select: {
          id: true,
          meterId: true,
          meterType: true,
          periodStart: true,
          periodEnd: true,
          source: true,
        },
      });

      const existingByKey = new Map(
        existingReadings.map((reading) => [
          normalizePeriodKey(
            reading.meterId,
            reading.meterType,
            reading.periodStart,
            reading.periodEnd,
          ),
          reading,
        ]),
      );

      let meterFailures = 0;
      let malformedRows = 0;
      let unsupportedUnitSkips = 0;

      for (const meter of localMeters) {
        const espmMeterId = meter.espmMeterId ? Number(meter.espmMeterId) : null;
        if (!espmMeterId) {
          continue;
        }

        try {
          const consumptionResult = parsePortfolioManagerConsumptionReadings(
            await params.espmClient.consumption.getConsumptionData(espmMeterId, {
              startDate: periodStart.toISOString().slice(0, 10),
              endDate: periodEnd.toISOString().slice(0, 10),
            }),
          );

          malformedRows += consumptionResult.malformedRowCount;
          if (consumptionResult.malformedRowCount > 0) {
            warnings.push(
              `${meter.name}: skipped ${consumptionResult.malformedRowCount} malformed Portfolio Manager reading(s).`,
            );
          }

          for (const row of consumptionResult.readings) {
            const factor = getConversionFactor(meter.unit);
            const key = normalizePeriodKey(
              meter.id,
              meter.meterType,
              row.periodStart,
              row.periodEnd,
            );
            const existing = existingByKey.get(key);

            if (factor == null) {
              unsupportedUnitSkips += 1;
              warnings.push(
                `Skipped ESPM reading for meter ${meter.id}: unsupported unit ${meter.unit}.`,
              );
              continue;
            }

            const payload = {
              sourceSystem: PM_SYNC_SYSTEM,
              espmMeterId,
              meterName: meter.name,
              estimatedValue: row.estimatedValue,
              syncedAt: now.toISOString(),
            };

            if (existing?.source === "ESPM_SYNC") {
              await prisma.energyReading.update({
                where: { id: existing.id },
                data: {
                  consumption: row.usage,
                  consumptionKbtu: row.usage * factor,
                  cost: row.cost,
                  rawPayload: toJson(payload),
                },
              });
              readingsUpdated += 1;
              continue;
            }

            if (existing) {
              readingsSkipped += 1;
              continue;
            }

            await prisma.energyReading.create({
              data: {
                buildingId: building.id,
                organizationId: params.organizationId,
                source: "ESPM_SYNC",
                meterType: meter.meterType,
                meterId: meter.id,
                periodStart: row.periodStart,
                periodEnd: row.periodEnd,
                consumption: row.usage,
                unit: meter.unit,
                consumptionKbtu: row.usage * factor,
                cost: row.cost,
                isVerified: true,
                rawPayload: toJson(payload),
              },
            });
            readingsCreated += 1;
          }
        } catch (error) {
          meterFailures += 1;
          const detail = classifyPortfolioManagerError(error, "consumption");
          stepErrors.push(detail);
          logPortfolioManagerSyncError(
            logger,
            detail,
            error,
            "Portfolio Manager consumption refresh failed",
          );
          warnings.push(`Consumption refresh failed for ${meter.name}: ${detail.message}`);
        }
      }

      if (meterFailures > 0) {
        stepStatuses.consumption =
          localMeters.length - meterFailures > 0 ? "PARTIAL" : "FAILED";
      } else if (malformedRows > 0 || unsupportedUnitSkips > 0) {
        stepStatuses.consumption = "PARTIAL";
      } else {
        stepStatuses.consumption = "SUCCEEDED";
      }
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.succeeded",
        phase: "consumption",
        inputSnapshot: {
          propertyId,
        },
        outputSnapshot: {
          readingsCreated,
          readingsUpdated,
          readingsSkipped,
          malformedRows,
          unsupportedUnitSkips,
        },
      });
    } catch (error) {
      const detail = classifyPortfolioManagerError(error, "consumption");
      stepErrors.push(detail);
      logPortfolioManagerSyncError(
        logger,
        detail,
        error,
        "Portfolio Manager consumption step failed",
      );
      warnings.push(`Consumption refresh failed: ${detail.message}`);
      stepStatuses.consumption = "FAILED";
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.failed",
        phase: "consumption",
        inputSnapshot: {
          propertyId,
        },
        outputSnapshot: {
          retryable: detail.retryable,
        },
        errorCode: detail.errorCode,
      });
    }

    try {
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.started",
        phase: "metrics",
        inputSnapshot: {
          propertyId,
        },
      });
      metricsSummary = await params.espmClient.metrics.getLatestAvailablePropertyMetrics(
        propertyId,
        reportingYear,
        12,
      );

      let metricsWarnings = 0;
      let reasonsForNoScore: string[] = [];

      try {
        reasonsForNoScore = await params.espmClient.metrics.getReasonsForNoScore(
          propertyId,
        );
      } catch (error) {
        const detail = classifyPortfolioManagerError(error, "metrics");
        logPortfolioManagerSyncError(
          logger,
          detail,
          error,
          "Portfolio Manager no-score reasons refresh failed",
        );
        warnings.push(
          `Unable to refresh Portfolio Manager no-score reasons: ${detail.message}`,
        );
        metricsWarnings += 1;
      }

      const nextScoreEligibility = determineScoreEligibility(
        metricsSummary,
        reasonsForNoScore,
        building.isEnergyStarScoreEligible,
      );

      if (nextScoreEligibility !== building.isEnergyStarScoreEligible) {
        await prisma.building.update({
          where: { id: building.id },
          data: { isEnergyStarScoreEligible: nextScoreEligibility },
        });
      }

      if (!hasUsableMetrics(metricsSummary)) {
        warnings.push(
          "Portfolio Manager returned no usable property metrics for the latest available period.",
        );
        metricsWarnings += 1;
      } else if (
        metricsSummary.siteIntensity == null ||
        metricsSummary.sourceIntensity == null
      ) {
        warnings.push(
          "Portfolio Manager metrics are partial; site and source EUI are required before Quoin can refresh the compliance snapshot.",
        );
        metricsWarnings += 1;
      } else {
        const snapshotData = buildSnapshotData({
          buildingId: building.id,
          organizationId: params.organizationId,
          grossSquareFeet:
            propertySnapshot?.grossFloorArea != null
              ? Math.round(propertySnapshot.grossFloorArea)
              : building.grossSquareFeet,
          bepsTargetScore: building.bepsTargetScore,
          energyStarScore: metricsSummary.score,
          siteEui: metricsSummary.siteIntensity,
          sourceEui: metricsSummary.sourceIntensity,
          weatherNormalizedSiteEui:
            metricsSummary.weatherNormalizedSiteIntensity,
          weatherNormalizedSourceEui:
            metricsSummary.weatherNormalizedSourceIntensity,
          dataQualityScore: undefined,
        });

        const snapshot = await prisma.complianceSnapshot.create({
          data: {
            buildingId: building.id,
            organizationId: params.organizationId,
            snapshotDate: now,
            triggerType: "ESPM_SYNC",
            energyStarScore: snapshotData.energyStarScore,
            siteEui: snapshotData.siteEui,
            sourceEui: snapshotData.sourceEui,
            weatherNormalizedSiteEui: snapshotData.weatherNormalizedSiteEui,
            weatherNormalizedSourceEui: snapshotData.weatherNormalizedSourceEui,
            complianceStatus: snapshotData.complianceStatus,
            complianceGap: snapshotData.complianceGap,
            estimatedPenalty: snapshotData.estimatedPenalty,
            dataQualityScore: null,
            targetScore: building.bepsTargetScore,
            targetEui: building.targetEui,
            penaltyInputsJson: toJson({
              sourceSystem: PM_SYNC_SYSTEM,
              reportingYear,
              scoreEligibility: nextScoreEligibility,
            }),
          },
          select: { id: true },
        });

        snapshotId = snapshot.id;
      }

      stepStatuses.metrics = metricsWarnings > 0 ? "PARTIAL" : "SUCCEEDED";
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.succeeded",
        phase: "metrics",
        inputSnapshot: {
          propertyId,
        },
        outputSnapshot: {
          score: metricsSummary?.score ?? null,
          siteIntensity: metricsSummary?.siteIntensity ?? null,
          sourceIntensity: metricsSummary?.sourceIntensity ?? null,
          metricsWarnings,
        },
      });
    } catch (error) {
      const detail = classifyPortfolioManagerError(error, "metrics");
      stepErrors.push(detail);
      logPortfolioManagerSyncError(
        logger,
        detail,
        error,
        "Portfolio Manager metrics step failed",
      );
      warnings.push(`Metrics refresh failed: ${detail.message}`);
      stepStatuses.metrics = "FAILED";
      await writePhaseAudit({
        action: "portfolio_manager.sync.external_request.failed",
        phase: "metrics",
        inputSnapshot: {
          propertyId,
        },
        outputSnapshot: {
          retryable: detail.retryable,
        },
        errorCode: detail.errorCode,
      });
    }

    try {
      const submissionContext =
        toRecord(existingSubmission?.submissionPayload)["benchmarkingContext"];
      const autopilot = await evaluateAndUpsertBenchmarkSubmission({
        organizationId: params.organizationId,
        buildingId: building.id,
        reportingYear,
        submissionContext: {
          gfaCorrectionRequired:
            toRecord(submissionContext)["gfaCorrectionRequired"] === true,
        },
        explicitStatus:
          (existingSubmission?.status as BenchmarkSubmissionStatus | null | undefined) ??
          null,
        producedByType: params.producedByType,
        producedById: params.producedById ?? null,
        requestId: params.requestId ?? null,
        additionalSubmissionPayload: {
          autopilot: {
            sourceSystem: PM_SYNC_SYSTEM,
            syncedAt: now.toISOString(),
          },
        },
      });

      readiness = autopilot.readiness;
      benchmarkSubmission = {
        id: autopilot.benchmarkSubmission.id,
        status: autopilot.benchmarkSubmission.status,
        complianceRunId: autopilot.benchmarkSubmission.complianceRunId,
      };
      stepStatuses.benchmarking = "SUCCEEDED";
    } catch (error) {
      const detail = classifyPortfolioManagerError(error, "benchmarking");
      stepErrors.push(detail);
      logPortfolioManagerSyncError(
        logger,
        detail,
        error,
        "Portfolio Manager benchmarking autopilot failed",
      );
      warnings.push(`Benchmarking autopilot failed: ${detail.message}`);
      stepStatuses.benchmarking = "FAILED";
    }

    const finalStatus = resolveFinalSyncStatus(stepStatuses);
    const lastSuccessfulSyncAt =
      finalStatus === "SUCCEEDED" ? now : previousLastSuccessfulSyncAt;
    const syncState = await persistSyncState({
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      status: finalStatus,
      lastAttemptedSyncAt: now,
      lastSuccessfulSyncAt,
      lastFailedSyncAt:
        finalStatus === "FAILED" || finalStatus === "PARTIAL" ? now : null,
      attemptCount: runningJob.attempts,
      retryCount: stepErrors.some((detail) => detail.retryable)
        ? Math.max(runningJob.attempts - 1, 0)
        : 0,
      latestJobId: job.id,
      latestErrorCode: stepErrors[0]?.errorCode ?? null,
      latestErrorMessage: stepErrors[0]?.message ?? warnings[0] ?? null,
      lastErrorMetadata: buildSyncErrorMetadata({
        warnings,
        errors: stepErrors,
        failedStep:
          (Object.entries(stepStatuses).find(
            ([, status]) => status === "FAILED" || status === "PARTIAL",
          )?.[0] as PortfolioManagerSyncStep | undefined) ?? null,
        message: warnings[0] ?? null,
      }),
      sourceMetadata: {
        system: PM_SYNC_SYSTEM,
        property: propertySnapshot,
        metrics: metricsSummary,
      },
      syncMetadata: {
        reportingYear,
        stepStatuses,
        readingsCreated,
        readingsUpdated,
        readingsSkipped,
        activeLinkedMeters,
        snapshotId,
        benchmarkSubmissionId: benchmarkSubmission?.id ?? null,
        runtimeStatus:
          finalStatus === "FAILED"
            ? "FAILED"
            : finalStatus === "PARTIAL" &&
                stepErrors.some((detail) => detail.retryable)
              ? "RETRYING"
              : "SUCCEEDED",
      },
      qaPayload: buildQaPayload({
        reportingYear,
        building,
        property: propertySnapshot,
        activeLinkedMeters,
        lastSuccessfulSyncAt,
        readiness,
        evaluatedAt: now,
      }),
    });

    try {
      await refreshSourceReconciliationDataIssues({
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        actorType: params.producedByType,
        actorId: params.producedById ?? null,
        requestId: params.requestId ?? null,
      });
    } catch (reconciliationError) {
      logger.warn("Portfolio Manager reconciliation refresh failed", {
        error: reconciliationError,
      });
    }

    await completeOperationalJob({
      status: finalStatus,
      stepStatuses,
      readingsCreated,
      readingsUpdated,
      readingsSkipped,
      snapshotId,
      benchmarkSubmissionId: benchmarkSubmission?.id ?? null,
    });

    return {
      syncState: {
        ...syncState,
        diagnostics: summarizePortfolioManagerSyncState(syncState),
      },
      property: propertySnapshot,
      meters: meterSnapshots,
      metrics: metricsSummary,
      readiness,
      benchmarkSubmission,
    };
  } catch (error) {
    const detail = classifyPortfolioManagerError(error, "sync");
    logPortfolioManagerSyncError(
      logger,
      detail,
      error,
      "Portfolio Manager sync failed",
    );
    if (
      !stepErrors.some(
        (existing) =>
          existing.step === detail.step &&
          existing.message === detail.message &&
          existing.errorCode === detail.errorCode,
      )
    ) {
      stepErrors.push(detail);
    }

    const lastSuccessfulSyncAt = previousLastSuccessfulSyncAt;
    const syncState = await persistSyncState({
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      status: "FAILED",
      lastAttemptedSyncAt: now,
      lastSuccessfulSyncAt,
      lastFailedSyncAt: now,
      attemptCount: runningJob.attempts,
      retryCount: detail.retryable ? Math.max(runningJob.attempts - 1, 0) : 0,
      latestJobId: job.id,
      latestErrorCode: detail.errorCode ?? null,
      latestErrorMessage: detail.message,
      lastErrorMetadata: buildSyncErrorMetadata({
        warnings,
        errors: stepErrors,
        failedStep:
          (Object.entries(stepStatuses).find(
            ([, status]) => status === "FAILED" || status === "PARTIAL",
          )?.[0] as PortfolioManagerSyncStep | undefined) ?? null,
        message: warnings[0] ?? null,
      }),
      sourceMetadata: {
        system: PM_SYNC_SYSTEM,
        property: propertySnapshot,
        metrics: metricsSummary,
      },
      syncMetadata: {
        reportingYear,
        stepStatuses,
        readingsCreated,
        readingsUpdated,
        readingsSkipped,
        activeLinkedMeters,
        snapshotId,
        benchmarkSubmissionId: benchmarkSubmission?.id ?? null,
        runtimeStatus: detail.retryable ? "RETRYING" : "FAILED",
      },
      qaPayload: buildQaPayload({
        reportingYear,
        building,
        property: propertySnapshot,
        activeLinkedMeters,
        lastSuccessfulSyncAt,
        readiness,
        evaluatedAt: now,
      }),
    });

    try {
      await refreshSourceReconciliationDataIssues({
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        actorType: params.producedByType,
        actorId: params.producedById ?? null,
        requestId: params.requestId ?? null,
      });
    } catch (reconciliationError) {
      logger.warn("Portfolio Manager reconciliation refresh failed", {
        error: reconciliationError,
      });
    }

    logger.error("Portfolio Manager sync persisted failed state", {
      reportingYear,
      status: "FAILED",
      readingsCreated,
      readingsUpdated,
      readingsSkipped,
      syncPhase: detail.step,
      errorCode: detail.errorCode,
      retryable: detail.retryable,
    });

    await failOperationalJob(
      toPortfolioManagerJobError(detail),
      {
        status: "FAILED",
        stepStatuses,
        readingsCreated,
        readingsUpdated,
        readingsSkipped,
        snapshotId,
        benchmarkSubmissionId: benchmarkSubmission?.id ?? null,
      },
    );

    return {
      syncState: {
        ...syncState,
        diagnostics: summarizePortfolioManagerSyncState(syncState),
      },
      property: propertySnapshot,
      meters: meterSnapshots,
      metrics: metricsSummary,
      readiness,
      benchmarkSubmission,
    };
  }
}
