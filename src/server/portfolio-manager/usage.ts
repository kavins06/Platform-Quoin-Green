import type { Prisma, PrismaClient } from "@/generated/prisma";
import {
  PortfolioManagerCoverageStatus,
  PortfolioManagerMetricsStatus,
  PortfolioManagerSetupComponentStatus,
  PortfolioManagerSetupStatus,
  PortfolioManagerUsageDirection,
  PortfolioManagerUsageStatus,
  type ActorType,
  type CanonicalSourceSystem,
  type EnergyReading,
  type Meter,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import { ValidationError, WorkflowStateError, toAppError } from "@/server/lib/errors";
import { createJob, JOB_STATUS, markCompleted, markDead, markRunning } from "@/server/lib/jobs";
import { QUEUES, withQueue } from "@/server/lib/queue";
import type { ESPM, PropertyMetrics } from "@/server/integrations/espm";
import { resolvePortfolioManagerClientForOrganization } from "@/server/portfolio-manager/existing-account";
import { parsePortfolioManagerConsumptionReadings } from "@/server/compliance/portfolio-manager-support";
import {
  getBuildingSourceReconciliationSummary,
  type MeterSourceReconciliationSummary,
} from "@/server/compliance/source-reconciliation";
import { loadRemotePropertyMeterSnapshot } from "@/server/portfolio-manager/remote-meter-state";
import {
  buildPortfolioManagerUsageEnvelope,
  PM_USAGE_JOB_TYPE,
} from "@/server/pipelines/portfolio-manager-usage/envelope";
import {
  classifyPortfolioManagerUnitCompatibility,
  convertLocalUsageToRemoteUsage,
  convertRemoteUsageToLocalUsage,
} from "@/server/portfolio-manager/unit-catalog";
import { getPmRuntimeHealth } from "@/server/lib/runtime-health";
import { buildSnapshotData } from "@/server/pipelines/data-ingestion/snapshot";
import { withAdvisoryTransactionLock } from "@/server/lib/transaction-lock";
import { mapWithConcurrency } from "@/server/lib/async";
import {
  collapseDisplayEnergyReadings,
  dedupeEnergyReadings,
} from "@/server/lib/energy-readings";

const PORTFOLIO_MANAGER_USAGE_PUSH_JOB_TYPE = "PORTFOLIO_MANAGER_USAGE_PUSH";
const PORTFOLIO_MANAGER_USAGE_IMPORT_JOB_TYPE = "PORTFOLIO_MANAGER_USAGE_IMPORT";

type UsageStateRecord = Awaited<
  ReturnType<typeof prisma.portfolioManagerUsageState.findUnique>
>;

type SetupStateRecord = Awaited<
  ReturnType<typeof prisma.portfolioManagerSetupState.findUnique>
>;

type BuildingRecord = {
  id: string;
  organizationId: string;
  name: string;
  grossSquareFeet: number;
  bepsTargetScore: number;
  targetEui: number | null;
  espmPropertyId: bigint | null;
  espmShareStatus: string | null;
};

type MeterRecord = Pick<
  Meter,
  | "id"
  | "name"
  | "meterType"
  | "unit"
  | "isActive"
  | "espmMeterId"
  | "espmMeterTypeRaw"
  | "espmMeterUnitOfMeasureRaw"
  | "createdAt"
>;

type LocalReadingRecord = Pick<
  EnergyReading,
  | "id"
  | "meterId"
  | "meterType"
  | "periodStart"
  | "periodEnd"
  | "consumption"
  | "unit"
  | "cost"
  | "source"
  | "ingestedAt"
  | "consumptionKbtu"
  | "rawPayload"
  | "archivedAt"
>;

type UsageContext = {
  building: BuildingRecord;
  setupState: SetupStateRecord;
  usageState: UsageStateRecord;
  activeMeters: MeterRecord[];
};

type CoverageSummary = {
  reportingYear: number;
  status: "NO_USABLE_DATA" | "PARTIAL_COVERAGE" | "READY_FOR_METRICS" | "NEEDS_ATTENTION";
  totalLinkedMeters: number;
  metersWithUsableData: number;
  totalPeriods: number;
  missingCoverageMeters: Array<{
    meterId: string;
    meterName: string;
    coveredMonths: number[];
    missingMonths: number[];
  }>;
  overlappingMeters: Array<{
    meterId: string;
    meterName: string;
  }>;
  summaryLine: string;
};

type MetricsRefreshResult = {
  status: PortfolioManagerMetricsStatus;
  metrics: PropertyMetrics | null;
  reasonsForNoScore: string[];
  scoreEligibility: boolean | null;
  refreshedAt: string | null;
};

type SnapshotRefreshResult = {
  status: "SUCCEEDED" | "SKIPPED";
  snapshotId: string | null;
  snapshotDate: string | null;
  message: string;
};

type UsageRunResult = {
  direction: PortfolioManagerUsageDirection;
  reportingYear: number;
  usageStatus: PortfolioManagerUsageStatus;
  coverageStatus: PortfolioManagerCoverageStatus;
  metricsStatus: PortfolioManagerMetricsStatus;
  resultSummary: Record<string, unknown>;
  coverageSummary: CoverageSummary;
  metricsSummary: MetricsRefreshResult | null;
  snapshotSummary: SnapshotRefreshResult | null;
};

type PushReadinessStatus = "READY" | "READY_WITH_WARNINGS" | "BLOCKED";

type PushReadiness = {
  status: PushReadinessStatus;
  reportingYear: number;
  canPush: boolean;
  summaryLine: string;
  blockers: string[];
  warnings: string[];
  pushableMeterCount: number;
  pushableReadingCount: number;
  reconciliationStatus: string | null;
  coverageSummary: CoverageSummary | null;
  meterRows: PushReviewMeterRow[];
};

type ValidatedLinkedMeter = MeterRecord & {
  remoteRawType: string;
  remoteRawUnitOfMeasure: string;
};

type SkippedMeterDetail = {
  meterId: string;
  rawPmType: string | null;
  category:
    | "MISSING_SHARE_ACCESS"
    | "PROVIDER_UNSUPPORTED_METER_TYPE"
    | "QUOIN_UNSUPPORTED_METER_NORMALIZATION"
    | "TEMPORARY_REMOTE_ERROR";
  message: string;
};

type PushReviewMeterRow = {
  meterId: string;
  meterName: string;
  meterType: Meter["meterType"];
  localUnit: Meter["unit"];
  espmMeterId: string | null;
  rawPmType: string | null;
  rawPmUnitOfMeasure: string | null;
  canonicalSource: CanonicalSourceSystem | null;
  reconciliationStatus: MeterSourceReconciliationSummary["status"] | "MISSING";
  readingCount: number;
  firstPeriodStart: Date | null;
  lastPeriodEnd: Date | null;
  blockers: string[];
  warnings: string[];
  reviewNote: string;
  includedInPush: boolean;
};

type PreparedPushReviewMeterRow = Omit<
  PushReviewMeterRow,
  "readingCount" | "firstPeriodStart" | "lastPeriodEnd" | "includedInPush" | "reviewNote"
> & {
  candidateReadings: LocalReadingRecord[];
};

type LinkedMeterValidationState = {
  meterId: string;
  blockers: string[];
  warnings: string[];
  remoteRawType: string | null;
  remoteRawUnitOfMeasure: string | null;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizePeriodKey(start: Date, end: Date) {
  return `${start.toISOString()}|${end.toISOString()}`;
}

function remotePeriodKey(start: string, end: string) {
  return `${start}|${end}`;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function pushUniqueMessage(messages: string[], message: string | null | undefined) {
  if (!message || messages.includes(message)) {
    return;
  }

  messages.push(message);
}

function reportingYearBounds(reportingYear: number) {
  return {
    start: new Date(Date.UTC(reportingYear, 0, 1)),
    end: new Date(Date.UTC(reportingYear, 11, 31, 23, 59, 59, 999)),
  };
}

function defaultReportingYear(now = new Date()) {
  return now.getUTCFullYear() - 1;
}

function approximatelyEqual(left: number | null | undefined, right: number | null | undefined) {
  if (left == null || right == null) {
    return left == null && right == null;
  }

  return Math.abs(left - right) <= 1e-6;
}

function canonicalSourceForEnergyReadingSource(
  source: LocalReadingRecord["source"],
): CanonicalSourceSystem {
  switch (source) {
    case "ESPM_SYNC":
      return "PORTFOLIO_MANAGER";
    case "GREEN_BUTTON":
      return "GREEN_BUTTON";
    case "MANUAL":
      return "MANUAL";
    case "BILL_UPLOAD":
      return "CSV_UPLOAD";
    default:
      return "CSV_UPLOAD";
  }
}

function dedupeLatestReadings(readings: LocalReadingRecord[]) {
  const latestByPeriod = new Map<string, LocalReadingRecord>();

  for (const reading of readings) {
    const key = normalizePeriodKey(reading.periodStart, reading.periodEnd);
    const current = latestByPeriod.get(key);
    if (!current) {
      latestByPeriod.set(key, reading);
      continue;
    }

    const readingTime = reading.ingestedAt.getTime();
    const currentTime = current.ingestedAt.getTime();
    if (readingTime > currentTime) {
      latestByPeriod.set(key, reading);
      continue;
    }

    if (readingTime === currentTime && reading.id.localeCompare(current.id) > 0) {
      latestByPeriod.set(key, reading);
    }
  }

  return Array.from(latestByPeriod.values()).sort((left, right) => {
    const startDelta = left.periodStart.getTime() - right.periodStart.getTime();
    if (startDelta !== 0) {
      return startDelta;
    }

    return left.periodEnd.getTime() - right.periodEnd.getTime();
  });
}

function buildLatestExistingReadingsByKey(readings: LocalReadingRecord[]) {
  const latestByKey = new Map<string, LocalReadingRecord>();

  for (const reading of readings) {
    const key = `${reading.meterId}:${normalizePeriodKey(reading.periodStart, reading.periodEnd)}`;
    if (!latestByKey.has(key)) {
      latestByKey.set(key, reading);
    }
  }

  return latestByKey;
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

function determineScoreEligibility(
  metrics: PropertyMetrics | null,
  reasonsForNoScore: string[],
) {
  if (metrics?.score != null) {
    return true;
  }

  if (
    reasonsForNoScore.some((reason) => /not eligible|cannot receive|ineligible/i.test(reason))
  ) {
    return false;
  }

  return null;
}

async function loadUsageContext(input: {
  organizationId: string;
  buildingId: string;
  db?: PrismaClient;
}): Promise<UsageContext> {
  const db = input.db ?? prisma;
  const [building, setupState, usageState, meters] = await Promise.all([
    db.building.findUnique({
      where: { id: input.buildingId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        grossSquareFeet: true,
        bepsTargetScore: true,
        targetEui: true,
        espmPropertyId: true,
        espmShareStatus: true,
      },
    }),
    db.portfolioManagerSetupState.findUnique({
      where: { buildingId: input.buildingId },
    }),
    db.portfolioManagerUsageState.findUnique({
      where: { buildingId: input.buildingId },
    }),
    db.meter.findMany({
      where: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        isActive: true,
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        meterType: true,
        unit: true,
        isActive: true,
        espmMeterId: true,
        espmMeterTypeRaw: true,
        espmMeterUnitOfMeasureRaw: true,
        createdAt: true,
      },
    }),
  ]);

  if (!building) {
    throw new ValidationError("Building not found for Portfolio Manager usage.");
  }

  if (building.organizationId !== input.organizationId) {
    throw new ValidationError("Building is not accessible in this organization.");
  }

  return {
    building,
    setupState,
    usageState,
    activeMeters: meters,
  };
}

async function createComplianceSnapshotFromMetrics(input: {
  building: BuildingRecord;
  reportingYear: number;
  metricsResult: MetricsRefreshResult;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const metrics = input.metricsResult.metrics;

  if (metrics?.siteIntensity == null || metrics.sourceIntensity == null) {
    return null;
  }

  const snapshotData = buildSnapshotData({
    buildingId: input.building.id,
    organizationId: input.building.organizationId,
    grossSquareFeet: input.building.grossSquareFeet,
    bepsTargetScore: input.building.bepsTargetScore,
    energyStarScore: metrics.score ?? null,
    siteEui: metrics.siteIntensity,
    sourceEui: metrics.sourceIntensity,
    weatherNormalizedSiteEui: metrics.weatherNormalizedSiteIntensity ?? null,
    weatherNormalizedSourceEui: metrics.weatherNormalizedSourceIntensity ?? null,
  });

  return db.complianceSnapshot.create({
    data: {
      buildingId: input.building.id,
      organizationId: input.building.organizationId,
      snapshotDate: new Date(),
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
      targetScore: input.building.bepsTargetScore,
      targetEui: input.building.targetEui,
      penaltyInputsJson: {
        sourceSystem: "ENERGY_STAR_PORTFOLIO_MANAGER",
        reportingYear: input.reportingYear,
      },
    },
    select: {
      id: true,
    },
  });
}

function assertUsagePreconditions(context: UsageContext) {
  const [firstBlocker] = getUsagePreconditionBlockers(context);
  if (firstBlocker) {
    throw new ValidationError(firstBlocker);
  }
}

function getUsagePreconditionBlockers(context: UsageContext) {
  const blockers: string[] = [];

  if (context.building.espmPropertyId == null || context.building.espmShareStatus !== "LINKED") {
    blockers.push("Portfolio Manager usage is available after PM linkage.");
  }

  if ((context.setupState?.propertyUsesStatus ?? "NOT_STARTED") !== "APPLIED") {
    blockers.push("Apply Portfolio Manager property uses before usage.");
  }

  if ((context.setupState?.metersStatus ?? "NOT_STARTED") !== "APPLIED") {
    blockers.push("Apply Portfolio Manager meter setup before usage.");
  }

  if ((context.setupState?.associationsStatus ?? "NOT_STARTED") !== "APPLIED") {
    blockers.push("Apply Portfolio Manager meter associations before usage.");
  }

  if (context.activeMeters.length === 0) {
    blockers.push("At least one active linked local meter is required for usage.");
  }

  if (context.activeMeters.some((meter) => meter.espmMeterId == null)) {
    blockers.push("All active local meters must be linked to PM before usage.");
  }

  return blockers;
}

async function fetchAllRemoteConsumptionPages(input: {
  espmClient: ESPM;
  meterId: number;
  startDate?: string;
  endDate?: string;
}) {
  const MAX_CONSUMPTION_PAGES = 240;
  let page = 1;
  let malformedRowCount = 0;
  let rawRowCount = 0;
  const readings: ReturnType<typeof parsePortfolioManagerConsumptionReadings>["readings"] = [];

  while (true) {
    if (page > MAX_CONSUMPTION_PAGES) {
      throw new Error(
        `Portfolio Manager consumption pagination exceeded ${MAX_CONSUMPTION_PAGES} pages for meter ${input.meterId}.`,
      );
    }

    const parsed = parsePortfolioManagerConsumptionReadings(
      await input.espmClient.consumption.getConsumptionData(input.meterId, {
        page,
        ...(input.startDate ? { startDate: input.startDate } : {}),
        ...(input.endDate ? { endDate: input.endDate } : {}),
      }),
    );

    readings.push(...parsed.readings);
    malformedRowCount += parsed.malformedRowCount;
    rawRowCount += parsed.rawRowCount;

    if (parsed.rawRowCount < 120 || parsed.rawRowCount === 0) {
      break;
    }

    page += 1;
  }

  return {
    readings,
    malformedRowCount,
    rawRowCount,
  };
}

async function validateLinkedMetersAgainstRemoteState(input: {
  organizationId: string;
  propertyId: number;
  meters: MeterRecord[];
  espmClient: ESPM;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const skippedMeters: SkippedMeterDetail[] = [];
  const validationByMeterId = new Map<string, LinkedMeterValidationState>();
  for (const meter of input.meters.filter((item) => item.espmMeterId != null)) {
    validationByMeterId.set(meter.id, {
      meterId: meter.id,
      blockers: [],
      warnings: [],
      remoteRawType: meter.espmMeterTypeRaw ?? null,
      remoteRawUnitOfMeasure: meter.espmMeterUnitOfMeasureRaw ?? null,
    });
  }
  const snapshot = await loadRemotePropertyMeterSnapshot({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    espmClient: input.espmClient,
    db,
  });

  if (!snapshot.remoteMeterAccess.canProceed) {
    const accessBlocker =
      snapshot.remoteMeterAccess.warning ??
      "Portfolio Manager meter access is incomplete. Share at least one supported property meter before continuing.";
    blockers.push(accessBlocker);
    for (const entry of Array.from(validationByMeterId.values())) {
      pushUniqueMessage(entry.blockers, accessBlocker);
    }
    return {
      blockers,
      warnings,
      skippedMeters,
      partialReasonSummary: snapshot.remoteMeterAccess.partialReasonSummary,
      linkedMeters: [] as ValidatedLinkedMeter[],
      validationByMeterId,
    };
  }

  for (const inaccessibleMeter of snapshot.remoteMeterAccess.inaccessibleMeters) {
    skippedMeters.push({
      meterId: inaccessibleMeter.meterId,
      rawPmType: null,
      category: inaccessibleMeter.category,
      message: inaccessibleMeter.message,
    });
  }
  if (snapshot.remoteMeterAccess.warning) {
    warnings.push(snapshot.remoteMeterAccess.warning);
  }

  if (!snapshot.associationAccess.canProceed) {
    const associationBlocker =
      snapshot.associationAccess.warning ??
      "Quoin could not validate this property's Portfolio Manager meter associations. Re-apply PM associations after association access is restored.";
    blockers.push(associationBlocker);
    for (const entry of Array.from(validationByMeterId.values())) {
      pushUniqueMessage(entry.blockers, associationBlocker);
    }
    return {
      blockers,
      warnings,
      skippedMeters,
      partialReasonSummary: snapshot.remoteMeterAccess.partialReasonSummary,
      linkedMeters: [] as ValidatedLinkedMeter[],
      validationByMeterId,
    };
  }

  const remoteById = new Map(snapshot.meters.map((meter) => [String(meter.meterId), meter]));
  const linkedMeters: ValidatedLinkedMeter[] = [];

  for (const meter of input.meters.filter((item) => item.espmMeterId != null)) {
    const remoteId = meter.espmMeterId!.toString();
    const meterValidation = validationByMeterId.get(meter.id)!;
    const remoteMeter = remoteById.get(remoteId);
    if (!remoteMeter) {
      const blocker = `Linked PM meter ${remoteId} for ${meter.name} is no longer visible in Portfolio Manager. Re-apply PM meter setup before usage.`;
      blockers.push(blocker);
      pushUniqueMessage(meterValidation.blockers, blocker);
      continue;
    }

    meterValidation.remoteRawType = remoteMeter.rawType ?? null;
    meterValidation.remoteRawUnitOfMeasure = remoteMeter.rawUnitOfMeasure ?? null;

    if (!snapshot.associatedMeterIds.has(Number(remoteId))) {
      const blocker = `PM association drift detected for linked meter ${meter.name}. Re-apply PM associations before usage.`;
      blockers.push(blocker);
      pushUniqueMessage(meterValidation.blockers, blocker);
      continue;
    }

    const compatibility = classifyPortfolioManagerUnitCompatibility({
      localMeterType: meter.meterType,
      localUnit: meter.unit,
      rawRemoteType: remoteMeter.rawType,
      rawRemoteUnitOfMeasure: remoteMeter.rawUnitOfMeasure,
    });
    if (compatibility.status === "UNSUPPORTED") {
      const blocker =
        compatibility.reason ??
        `Linked PM meter ${remoteId} for ${meter.name} uses an unsupported unit mapping.`;
      blockers.push(blocker);
      pushUniqueMessage(meterValidation.blockers, blocker);
      skippedMeters.push({
        meterId: remoteId,
        rawPmType: remoteMeter.rawType ?? null,
        category: "QUOIN_UNSUPPORTED_METER_NORMALIZATION",
        message: blocker,
      });
      continue;
    }

    if (
      meter.espmMeterTypeRaw !== remoteMeter.rawType ||
      meter.espmMeterUnitOfMeasureRaw !== remoteMeter.rawUnitOfMeasure
    ) {
      await db.meter.update({
        where: { id: meter.id },
        data: {
          espmMeterTypeRaw: remoteMeter.rawType,
          espmMeterUnitOfMeasureRaw: remoteMeter.rawUnitOfMeasure,
        },
      });
    }

    linkedMeters.push({
      ...meter,
      remoteRawType: remoteMeter.rawType ?? "",
      remoteRawUnitOfMeasure: remoteMeter.rawUnitOfMeasure ?? "",
    });
  }

  return {
    blockers,
    warnings,
    skippedMeters,
    partialReasonSummary: snapshot.remoteMeterAccess.partialReasonSummary,
    linkedMeters,
    validationByMeterId,
  };
}

async function syncSetupCoverageState(input: {
  organizationId: string;
  buildingId: string;
  coverageStatus: PortfolioManagerCoverageStatus;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const setupState = await db.portfolioManagerSetupState.findUnique({
    where: { buildingId: input.buildingId },
  });
  if (!setupState) {
    return null;
  }

  let nextCoverageStatus: PortfolioManagerSetupComponentStatus =
    PortfolioManagerSetupComponentStatus.NOT_STARTED;
  if (input.coverageStatus === "READY_FOR_METRICS") {
    nextCoverageStatus = PortfolioManagerSetupComponentStatus.APPLIED;
  } else if (
    input.coverageStatus === "NO_USABLE_DATA" ||
    input.coverageStatus === "PARTIAL_COVERAGE"
  ) {
    nextCoverageStatus = PortfolioManagerSetupComponentStatus.INPUT_REQUIRED;
  } else if (input.coverageStatus === "NEEDS_ATTENTION") {
    nextCoverageStatus = PortfolioManagerSetupComponentStatus.NEEDS_ATTENTION;
  }

  let overallStatus: PortfolioManagerSetupStatus = PortfolioManagerSetupStatus.NOT_STARTED;
  if (
    setupState.propertyUsesStatus === "NEEDS_ATTENTION" ||
    setupState.metersStatus === "NEEDS_ATTENTION" ||
    setupState.associationsStatus === "NEEDS_ATTENTION" ||
    nextCoverageStatus === "NEEDS_ATTENTION"
  ) {
    overallStatus = PortfolioManagerSetupStatus.NEEDS_ATTENTION;
  } else if (
    setupState.propertyUsesStatus === "APPLIED" &&
    setupState.metersStatus === "APPLIED" &&
    setupState.associationsStatus === "APPLIED" &&
    nextCoverageStatus === "APPLIED"
  ) {
    overallStatus = PortfolioManagerSetupStatus.APPLIED;
  } else if (
    setupState.propertyUsesStatus === "READY_TO_APPLY" ||
    setupState.metersStatus === "READY_TO_APPLY" ||
    setupState.associationsStatus === "READY_TO_APPLY"
  ) {
    overallStatus = PortfolioManagerSetupStatus.READY_TO_APPLY;
  } else if (
    setupState.propertyUsesStatus === "INPUT_REQUIRED" ||
    setupState.metersStatus === "INPUT_REQUIRED" ||
    setupState.associationsStatus === "INPUT_REQUIRED" ||
    nextCoverageStatus === "INPUT_REQUIRED"
  ) {
    overallStatus = PortfolioManagerSetupStatus.INPUT_REQUIRED;
  }

  return db.portfolioManagerSetupState.update({
    where: { buildingId: input.buildingId },
    data: {
      status: overallStatus,
      usageCoverageStatus: nextCoverageStatus,
    },
  });
}

async function updateUsageStateRunning(input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  reportingYear: number;
  direction: PortfolioManagerUsageDirection;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  return db.portfolioManagerUsageState.upsert({
    where: { buildingId: input.buildingId },
    create: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      overallStatus: "RUNNING",
      usageStatus: "RUNNING",
      metricsStatus: "NOT_STARTED",
      coverageStatus: "NOT_STARTED",
      lastRunDirection: input.direction,
      reportingYear: input.reportingYear,
      latestJobId: input.operationalJobId,
      attemptCount: 1,
      latestErrorCode: null,
      latestErrorMessage: null,
      lastAttemptedAt: new Date(),
    },
    update: {
      overallStatus: "RUNNING",
      usageStatus: "RUNNING",
      metricsStatus: "NOT_STARTED",
      coverageStatus: "NOT_STARTED",
      lastRunDirection: input.direction,
      reportingYear: input.reportingYear,
      latestJobId: input.operationalJobId,
      attemptCount: { increment: 1 },
      latestErrorCode: null,
      latestErrorMessage: null,
      lastAttemptedAt: new Date(),
    },
  });
}

function coverageStatusToSetupSummaryLine(status: PortfolioManagerCoverageStatus) {
  switch (status) {
    case "READY_FOR_METRICS":
      return "Usage coverage is ready for Portfolio Manager metrics.";
    case "PARTIAL_COVERAGE":
      return "Usage coverage is partial. Complete more monthly data before metrics refresh.";
    case "NO_USABLE_DATA":
      return "No usable local monthly data is available yet.";
    case "NEEDS_ATTENTION":
      return "Usage data needs manual review before metrics refresh.";
    default:
      return "Usage has not run yet.";
  }
}

function buildUsageSummaryLine(input: {
  coverageStatus: PortfolioManagerCoverageStatus;
  metricsStatus: PortfolioManagerMetricsStatus;
  latestErrorMessage?: string | null;
}) {
  if (input.latestErrorMessage) {
    return input.latestErrorMessage;
  }

  if (input.metricsStatus === "RUNNING" || input.metricsStatus === "QUEUED") {
    return "Refreshing Portfolio Manager metrics.";
  }

  if (input.metricsStatus === "SUCCEEDED") {
    return "Usage and Portfolio Manager metrics are ready for benchmark operations.";
  }

  return coverageStatusToSetupSummaryLine(input.coverageStatus);
}

function deriveUsageSummaryState(input: {
  overallStatus: PortfolioManagerUsageStatus;
  coverageStatus: PortfolioManagerCoverageStatus;
  metricsStatus: PortfolioManagerMetricsStatus;
}) {
  if (
    input.overallStatus === "FAILED" ||
    input.coverageStatus === "NEEDS_ATTENTION" ||
    input.metricsStatus === "FAILED"
  ) {
    return "NEEDS_ATTENTION" as const;
  }

  if (input.metricsStatus === "SUCCEEDED") {
    return "BENCHMARK_READY" as const;
  }

  if (input.coverageStatus === "READY_FOR_METRICS") {
    return "READY_FOR_NEXT_STEP" as const;
  }

  return "SETUP_INCOMPLETE" as const;
}

function deriveOverallUsageStatus(input: {
  usageStatus: PortfolioManagerUsageStatus;
  metricsStatus: PortfolioManagerMetricsStatus;
  coverageStatus: PortfolioManagerCoverageStatus;
}) {
  if (
    input.usageStatus === "FAILED" ||
    input.metricsStatus === "FAILED" ||
    input.coverageStatus === "NEEDS_ATTENTION"
  ) {
    return PortfolioManagerUsageStatus.FAILED;
  }

  if (input.metricsStatus === "SUCCEEDED") {
    return PortfolioManagerUsageStatus.SUCCEEDED;
  }

  if (
    input.usageStatus === "PARTIAL" ||
    input.coverageStatus === "NO_USABLE_DATA" ||
    input.coverageStatus === "PARTIAL_COVERAGE" ||
    input.metricsStatus === "PARTIAL" ||
    input.metricsStatus === "SKIPPED"
  ) {
    return PortfolioManagerUsageStatus.PARTIAL;
  }

  return input.usageStatus;
}

async function loadCanonicalLinkedReadings(input: {
  organizationId: string;
  buildingId: string;
  activeMeters: MeterRecord[];
  reportingYear?: number;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const meterIds = input.activeMeters.map((meter) => meter.id);
  const bounds =
    input.reportingYear != null ? reportingYearBounds(input.reportingYear) : null;
  const readings = await db.energyReading.findMany({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      meterId: { in: meterIds },
      archivedAt: null,
      ...(bounds
        ? {
            periodEnd: {
              gte: bounds.start,
              lte: bounds.end,
            },
          }
        : {}),
    },
    orderBy: [{ periodStart: "asc" }, { ingestedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      meterId: true,
      meterType: true,
      periodStart: true,
      periodEnd: true,
      consumption: true,
      unit: true,
      cost: true,
      source: true,
      ingestedAt: true,
      consumptionKbtu: true,
      rawPayload: true,
      archivedAt: true,
    },
  });

  const byMeterId = new Map<string, LocalReadingRecord[]>();
  for (const reading of readings) {
    if (!reading.meterId) {
      continue;
    }
    const current = byMeterId.get(reading.meterId) ?? [];
    current.push(reading);
    byMeterId.set(reading.meterId, current);
  }

  const dedupedByMeterId = new Map<string, LocalReadingRecord[]>();
  for (const meter of input.activeMeters) {
    dedupedByMeterId.set(
      meter.id,
      collapseDisplayEnergyReadings(dedupeEnergyReadings(byMeterId.get(meter.id) ?? [])),
    );
  }

  return dedupedByMeterId;
}

function evaluateCoverageSummary(input: {
  activeMeters: MeterRecord[];
  dedupedReadingsByMeterId: Map<string, LocalReadingRecord[]>;
  reportingYear: number;
}): CoverageSummary {
  const missingCoverageMeters: CoverageSummary["missingCoverageMeters"] = [];
  const overlappingMeters: CoverageSummary["overlappingMeters"] = [];
  let metersWithUsableData = 0;
  let totalPeriods = 0;

  for (const meter of input.activeMeters) {
    const readings = input.dedupedReadingsByMeterId.get(meter.id) ?? [];
    totalPeriods += readings.length;
    if (readings.length === 0) {
      missingCoverageMeters.push({
        meterId: meter.id,
        meterName: meter.name,
        coveredMonths: [],
        missingMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });
      continue;
    }

    let hasOverlap = false;
    const coveredMonths = new Set<number>();
    for (let index = 0; index < readings.length; index += 1) {
      const reading = readings[index]!;
      coveredMonths.add(reading.periodEnd.getUTCMonth() + 1);
      const previous = index > 0 ? readings[index - 1] : null;
      if (previous && reading.periodStart.getTime() < previous.periodEnd.getTime()) {
        hasOverlap = true;
      }
    }

    if (hasOverlap) {
      overlappingMeters.push({
        meterId: meter.id,
        meterName: meter.name,
      });
    }

    if (coveredMonths.size === 12 && !hasOverlap) {
      metersWithUsableData += 1;
      continue;
    }

    const monthList = Array.from(coveredMonths).sort((left, right) => left - right);
    const missingMonths = Array.from({ length: 12 }, (_, index) => index + 1).filter(
      (month) => !coveredMonths.has(month),
    );
    missingCoverageMeters.push({
      meterId: meter.id,
      meterName: meter.name,
      coveredMonths: monthList,
      missingMonths,
    });
  }

  if (overlappingMeters.length > 0) {
    return {
      reportingYear: input.reportingYear,
      status: "NEEDS_ATTENTION",
      totalLinkedMeters: input.activeMeters.length,
      metersWithUsableData,
      totalPeriods,
      missingCoverageMeters,
      overlappingMeters,
      summaryLine: "Usage data has overlapping billing periods and needs review.",
    };
  }

  if (metersWithUsableData === 0) {
    const hasAnyPeriods = totalPeriods > 0;
    return {
      reportingYear: input.reportingYear,
      status: hasAnyPeriods ? "PARTIAL_COVERAGE" : "NO_USABLE_DATA",
      totalLinkedMeters: input.activeMeters.length,
      metersWithUsableData,
      totalPeriods,
      missingCoverageMeters,
      overlappingMeters,
      summaryLine: hasAnyPeriods
        ? "Usage coverage is partial. Complete more monthly data before metrics refresh."
        : "No usable local monthly data is available yet.",
    };
  }

  if (metersWithUsableData < input.activeMeters.length) {
    return {
      reportingYear: input.reportingYear,
      status: "PARTIAL_COVERAGE",
      totalLinkedMeters: input.activeMeters.length,
      metersWithUsableData,
      totalPeriods,
      missingCoverageMeters,
      overlappingMeters,
      summaryLine: "Usage coverage is partial. Complete more monthly data before metrics refresh.",
    };
  }

  return {
    reportingYear: input.reportingYear,
    status: "READY_FOR_METRICS",
    totalLinkedMeters: input.activeMeters.length,
    metersWithUsableData,
    totalPeriods,
    missingCoverageMeters,
    overlappingMeters,
    summaryLine: "Usage coverage is ready for Portfolio Manager metrics.",
  };
}

async function refreshMetricsIfReady(input: {
  espmClient: ESPM;
  propertyId: number;
  reportingYear: number;
  coverageSummary: CoverageSummary;
}) {
  if (input.coverageSummary.status !== "READY_FOR_METRICS") {
    return {
      status: PortfolioManagerMetricsStatus.SKIPPED,
      metrics: null,
      reasonsForNoScore: [],
      scoreEligibility: null,
      refreshedAt: null,
    } satisfies MetricsRefreshResult;
  }

  const metrics = await input.espmClient.metrics.getLatestAvailablePropertyMetrics(
    input.propertyId,
    input.reportingYear,
    12,
  );
  const reasonsForNoScore = await input.espmClient.metrics.getReasonsForNoScore(
    input.propertyId,
  );
  const hasMetrics = hasUsableMetrics(metrics);

  return {
    status: hasMetrics
      ? PortfolioManagerMetricsStatus.SUCCEEDED
      : PortfolioManagerMetricsStatus.PARTIAL,
    metrics,
    reasonsForNoScore,
    scoreEligibility: determineScoreEligibility(metrics, reasonsForNoScore),
    refreshedAt: new Date().toISOString(),
  } satisfies MetricsRefreshResult;
}

function serializeMetricsRefreshResult(input: MetricsRefreshResult): Prisma.InputJsonObject {
  return {
    status: input.status,
    metrics: input.metrics
      ? {
          propertyId: input.metrics.propertyId,
          year: input.metrics.year,
          month: input.metrics.month,
          score: input.metrics.score,
          siteTotal: input.metrics.siteTotal,
          sourceTotal: input.metrics.sourceTotal,
          siteIntensity: input.metrics.siteIntensity,
          sourceIntensity: input.metrics.sourceIntensity,
          weatherNormalizedSiteIntensity: input.metrics.weatherNormalizedSiteIntensity,
          weatherNormalizedSourceIntensity: input.metrics.weatherNormalizedSourceIntensity,
          directGHGEmissions: input.metrics.directGHGEmissions,
          medianScore: input.metrics.medianScore,
        }
      : null,
    reasonsForNoScore: input.reasonsForNoScore,
    scoreEligibility: input.scoreEligibility,
    refreshedAt: input.refreshedAt,
  };
}

async function getExistingRemotePeriods(input: {
  espmClient: ESPM;
  meterId: number;
  startDate?: string;
  endDate?: string;
}) {
  const parsed = await fetchAllRemoteConsumptionPages({
    espmClient: input.espmClient,
    meterId: input.meterId,
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
  });

  return new Map(
    parsed.readings.map((reading) => [
      remotePeriodKey(formatDate(reading.periodStart), formatDate(reading.periodEnd)),
      {
        id: reading.id ?? 0,
        usage: reading.usage,
        cost: reading.cost,
      },
    ]),
  );
}

async function archiveEnergyReadings(input: {
  readingIds: string[];
  archivedReason: string;
  operationalJobId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  if (input.readingIds.length === 0) {
    return 0;
  }

  const result = await db.energyReading.updateMany({
    where: {
      id: { in: input.readingIds },
      archivedAt: null,
    },
    data: {
      archivedAt: new Date(),
      archivedReason: input.archivedReason,
      archivedByOperationalJobId: input.operationalJobId,
    },
  });

  return result.count;
}

async function runUsagePush(input: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
  activeMeters: MeterRecord[];
  espmClient: ESPM;
  operationalJobId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const usageContext = await loadUsageContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const remoteValidation = await validateLinkedMetersAgainstRemoteState({
    organizationId: input.organizationId,
    propertyId: Number(usageContext.building.espmPropertyId),
    meters: input.activeMeters.filter((meter) => meter.espmMeterId != null),
    espmClient: input.espmClient,
    db,
  });
  if (remoteValidation.blockers.length > 0) {
    throw new ValidationError(remoteValidation.blockers[0] ?? "Portfolio Manager usage is blocked.");
  }
  const activeMeters = remoteValidation.linkedMeters;
  const meterIds = activeMeters.map((meter) => meter.id);
  const reconciliation = await getBuildingSourceReconciliationSummary({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    referenceYear: input.reportingYear,
  });
  const meterSummariesById = new Map<string, MeterSourceReconciliationSummary>();
  for (const meterSummary of reconciliation?.meters ?? []) {
    meterSummariesById.set(meterSummary.meterId, meterSummary);
  }
  const readings = await db.energyReading.findMany({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      meterId: { in: meterIds },
      archivedAt: null,
    },
    orderBy: [{ periodStart: "asc" }, { ingestedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      meterId: true,
      meterType: true,
      periodStart: true,
      periodEnd: true,
      consumption: true,
      unit: true,
      cost: true,
      source: true,
      ingestedAt: true,
      consumptionKbtu: true,
      rawPayload: true,
      archivedAt: true,
    },
  });

  const readingsByMeterId = new Map<string, LocalReadingRecord[]>();
  for (const reading of readings) {
    if (!reading.meterId) {
      continue;
    }
    const current = readingsByMeterId.get(reading.meterId) ?? [];
    current.push(reading);
    readingsByMeterId.set(reading.meterId, current);
  }

  let metersWithReadings = 0;
  let readingsPrepared = 0;
  let readingsPushed = 0;
  let readingsUpdated = 0;
  let readingsDeleted = 0;
  let readingsSkippedExisting = 0;
  const pushWarnings: string[] = [];

  for (const meter of activeMeters) {
    const meterSummary = meterSummariesById.get(meter.id);
    if (!meterSummary) {
      throw new ValidationError(`Source reconciliation is missing for linked meter ${meter.name}.`);
    }
    if (meterSummary.status === "CONFLICTED") {
      throw new ValidationError(
        `Source reconciliation is conflicted for linked meter ${meter.name}.`,
      );
    }

    const meterReadings = selectLocalReadingsForPush(readingsByMeterId.get(meter.id) ?? []);
    const unsupportedPushReason = getUnsupportedPushReason({
      meter: {
        name: meter.name,
        remoteRawType: meter.remoteRawType,
        remoteRawUnitOfMeasure: meter.remoteRawUnitOfMeasure,
      },
      readings: meterReadings,
    });
    if (unsupportedPushReason) {
      throw new ValidationError(
        unsupportedPushReason ??
          `Linked meter ${meter.name} cannot be pushed because the PM unit mapping is unsupported.`,
      );
    }
    metersWithReadings += 1;
    readingsPrepared += meterReadings.length;
    const remotePeriods = await getExistingRemotePeriods({
      espmClient: input.espmClient,
      meterId: Number(meter.espmMeterId),
    });
    const localPeriodKeys = new Set<string>();

    const entriesToCreate: Array<{
      startDate: string;
      endDate: string;
      usage: number;
      cost?: number;
    }> = [];
    const entriesToUpdate: Array<{
      id: number;
      startDate: string;
      endDate: string;
      usage: number;
      cost?: number;
    }> = [];
    const entriesToDelete: number[] = [];

    for (const reading of meterReadings) {
      const startDate = formatDate(reading.periodStart);
      const endDate = formatDate(reading.periodEnd);
      const key = remotePeriodKey(startDate, endDate);
      localPeriodKeys.add(key);
      const existing = remotePeriods.get(key);
      const desiredCost = reading.cost ?? existing?.cost ?? undefined;
      const converted = convertLocalUsageToRemoteUsage({
        localMeterType: reading.meterType,
        localUnit: reading.unit,
        rawRemoteType: meter.remoteRawType,
        rawRemoteUnitOfMeasure: meter.remoteRawUnitOfMeasure,
        localUsage: reading.consumption,
      });
      if (!converted.ok) {
        throw new ValidationError(
          converted.reason ??
            `Linked meter ${meter.name} cannot be pushed because the PM unit mapping is unsupported.`,
        );
      }

      if (!existing || existing.id === 0) {
        entriesToCreate.push({
          startDate,
          endDate,
          usage: converted.remoteUsage,
          ...(desiredCost !== undefined ? { cost: desiredCost } : {}),
        });
        continue;
      }

      const usageMatches =
        existing.usage != null && approximatelyEqual(existing.usage, converted.remoteUsage);
      const costMatches =
        desiredCost === undefined ? existing.cost == null : existing.cost === desiredCost;

      if (usageMatches && costMatches) {
        readingsSkippedExisting += 1;
        continue;
      }

      entriesToUpdate.push({
        id: existing.id,
        startDate,
        endDate,
        usage: converted.remoteUsage,
        ...(desiredCost !== undefined ? { cost: desiredCost } : {}),
      });
    }

    for (const [key, existing] of Array.from(remotePeriods.entries())) {
      if (!localPeriodKeys.has(key) && existing.id > 0) {
        entriesToDelete.push(existing.id);
      }
    }

    for (let index = 0; index < entriesToCreate.length; index += 120) {
      await input.espmClient.consumption.pushConsumptionData(
        Number(meter.espmMeterId),
        entriesToCreate.slice(index, index + 120),
      );
    }

    for (const entry of entriesToUpdate) {
      await input.espmClient.consumption.updateConsumptionData(entry.id, entry);
    }

    for (const consumptionDataId of entriesToDelete) {
      await input.espmClient.consumption.deleteConsumptionData(consumptionDataId);
    }

    readingsPushed += entriesToCreate.length;
    readingsUpdated += entriesToUpdate.length;
    readingsDeleted += entriesToDelete.length;
  }

  const coverageSummary = evaluateCoverageSummary({
    activeMeters,
    dedupedReadingsByMeterId: await loadCanonicalLinkedReadings({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      activeMeters,
      reportingYear: input.reportingYear,
      db,
    }),
    reportingYear: input.reportingYear,
  });

  return {
    usageStatus:
      metersWithReadings === 0 ||
      metersWithReadings < activeMeters.length ||
      remoteValidation.skippedMeters.length > 0 ||
      remoteValidation.warnings.length > 0
        ? PortfolioManagerUsageStatus.PARTIAL
        : PortfolioManagerUsageStatus.SUCCEEDED,
    resultSummary: {
      direction: "PUSH_LOCAL_TO_PM",
      linkedMeterCount: activeMeters.length,
      metersWithReadings,
      readingsPrepared,
      readingsPushed,
      readingsUpdated,
      readingsDeleted,
      readingsSkippedExisting,
      skippedMeterCount: remoteValidation.skippedMeters.length,
      skippedMeters: remoteValidation.skippedMeters,
      partialReasonSummary:
        pushWarnings[0] ??
        remoteValidation.partialReasonSummary ??
        remoteValidation.warnings[0] ??
        null,
      pushWarnings,
    },
    coverageSummary,
  };
}

async function runUsageImport(input: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
  activeMeters: MeterRecord[];
  espmClient: ESPM;
  operationalJobId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const usageContext = await loadUsageContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const remoteSnapshot = await loadRemotePropertyMeterSnapshot({
    organizationId: input.organizationId,
    propertyId: Number(usageContext.building.espmPropertyId),
    espmClient: input.espmClient,
    db,
  });
  if (remoteSnapshot.remoteMeterAccess.canProceed) {
    const visibleRemoteIds = new Set(remoteSnapshot.meters.map((meter) => String(meter.meterId)));
    const inaccessibleMeterIds = new Set(remoteSnapshot.remoteMeterAccess.inaccessibleMeterIds);
    const staleMeterIds = input.activeMeters
      .filter(
        (meter) =>
          meter.espmMeterId != null &&
          !visibleRemoteIds.has(meter.espmMeterId.toString()) &&
          !inaccessibleMeterIds.has(meter.espmMeterId.toString()),
      )
      .map((meter) => meter.id);

    if (staleMeterIds.length > 0) {
      await db.meter.updateMany({
        where: {
          id: { in: staleMeterIds },
          organizationId: input.organizationId,
        },
        data: {
          isActive: false,
        },
      });
    }
  }

  const remoteValidation = await validateLinkedMetersAgainstRemoteState({
    organizationId: input.organizationId,
    propertyId: Number(usageContext.building.espmPropertyId),
    meters: input.activeMeters
      .filter((meter) => meter.espmMeterId != null)
      .filter(
        (meter) =>
          remoteSnapshot.remoteMeterAccess.canProceed === false ||
          remoteSnapshot.meters.some(
            (remoteMeter) => remoteMeter.meterId.toString() === meter.espmMeterId?.toString(),
          ) ||
          remoteSnapshot.remoteMeterAccess.inaccessibleMeterIds.includes(
            meter.espmMeterId?.toString() ?? "",
          ),
      ),
    espmClient: input.espmClient,
    db,
  });
  if (remoteValidation.blockers.length > 0) {
    throw new ValidationError(remoteValidation.blockers[0] ?? "Portfolio Manager usage is blocked.");
  }
  const activeMeters = remoteValidation.linkedMeters;
  const existingReadings = await db.energyReading.findMany({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      meterId: { in: activeMeters.map((meter) => meter.id) },
      archivedAt: null,
    },
    select: {
      id: true,
      meterId: true,
      meterType: true,
      periodStart: true,
      periodEnd: true,
      source: true,
      consumption: true,
      unit: true,
      cost: true,
      ingestedAt: true,
      consumptionKbtu: true,
      rawPayload: true,
      archivedAt: true,
    },
    orderBy: [{ periodStart: "asc" }, { ingestedAt: "desc" }, { id: "desc" }],
  });

  const existingByKey = new Map<string, LocalReadingRecord[]>();
  for (const reading of existingReadings) {
    const key = `${reading.meterId}:${normalizePeriodKey(reading.periodStart, reading.periodEnd)}`;
    const current = existingByKey.get(key) ?? [];
    current.push(reading);
    existingByKey.set(key, current);
  }

  let metersWithReadings = 0;
  let readingsCreated = 0;
  let readingsUpdated = 0;
  let readingsArchived = 0;
  let malformedRows = 0;
  let unsupportedUnitSkips = 0;
  const localReadingIdsToArchive = new Set(
    existingReadings
      .filter((reading) => reading.source !== "ESPM_SYNC")
      .map((reading) => reading.id),
  );
  const syncedEspmReadingIdsSeen = new Set<string>();

  const remoteConsumptionByMeter = await mapWithConcurrency(activeMeters, 3, async (meter) => {
    const parsed = await fetchAllRemoteConsumptionPages({
      espmClient: input.espmClient,
      meterId: Number(meter.espmMeterId),
    });
    return {
      meter,
      parsed,
    };
  });

  for (const { meter, parsed } of remoteConsumptionByMeter) {
    malformedRows += parsed.malformedRowCount;
    if (parsed.readings.length > 0) {
      metersWithReadings += 1;
    }

    for (const row of parsed.readings) {
      const converted = convertRemoteUsageToLocalUsage({
        localMeterType: meter.meterType,
        localUnit: meter.unit,
        rawRemoteType: meter.remoteRawType,
        rawRemoteUnitOfMeasure: meter.remoteRawUnitOfMeasure,
        remoteUsage: row.usage,
      });
      if (!converted.ok) {
        unsupportedUnitSkips += 1;
        continue;
      }
      const key = `${meter.id}:${normalizePeriodKey(row.periodStart, row.periodEnd)}`;
      const existingRows = existingByKey.get(key) ?? [];
      const existingEspm = existingRows.find((reading) => reading.source === "ESPM_SYNC") ?? null;
      const payload = {
        sourceSystem: "ENERGY_STAR_PORTFOLIO_MANAGER",
        espmMeterId: Number(meter.espmMeterId),
        meterName: meter.name,
        estimatedValue: row.estimatedValue,
        remoteMeterType: meter.remoteRawType,
        remoteUnitOfMeasure: meter.remoteRawUnitOfMeasure,
        remoteUsage: row.usage,
        localConsumption: converted.localConsumption,
        syncedAt: new Date().toISOString(),
      };

      if (existingEspm) {
        await db.energyReading.update({
          where: { id: existingEspm.id },
          data: {
            consumption: converted.localConsumption,
            unit: meter.unit,
            consumptionKbtu: converted.consumptionKbtu,
            cost: row.cost,
            rawPayload: payload,
            archivedAt: null,
            archivedReason: null,
            archivedByOperationalJobId: null,
          },
        });
        syncedEspmReadingIdsSeen.add(existingEspm.id);
        readingsUpdated += 1;
        continue;
      }

      await db.energyReading.create({
        data: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          source: "ESPM_SYNC",
          meterType: meter.meterType,
          meterId: meter.id,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          consumption: converted.localConsumption,
          unit: meter.unit,
          consumptionKbtu: converted.consumptionKbtu,
          cost: row.cost,
          isVerified: true,
          rawPayload: payload,
        },
      });
      readingsCreated += 1;
    }
  }

  const staleEspmReadingIds = existingReadings
    .filter((reading) => reading.source === "ESPM_SYNC")
    .filter((reading) => !syncedEspmReadingIdsSeen.has(reading.id))
    .map((reading) => reading.id);

  readingsArchived += await archiveEnergyReadings({
    readingIds: Array.from(localReadingIdsToArchive),
    archivedReason: "PM_SYNC_OVERWRITE",
    operationalJobId: input.operationalJobId,
    db,
  });
  readingsArchived += await archiveEnergyReadings({
    readingIds: staleEspmReadingIds,
    archivedReason: "PM_SYNC_REPLACED",
    operationalJobId: input.operationalJobId,
    db,
  });

  const coverageSummary = evaluateCoverageSummary({
    activeMeters,
    dedupedReadingsByMeterId: await loadCanonicalLinkedReadings({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      activeMeters,
      reportingYear: input.reportingYear,
      db,
    }),
    reportingYear: input.reportingYear,
  });

  return {
    usageStatus:
      malformedRows > 0 ||
      unsupportedUnitSkips > 0 ||
      remoteValidation.skippedMeters.length > 0 ||
      remoteValidation.warnings.length > 0
        ? PortfolioManagerUsageStatus.PARTIAL
        : metersWithReadings === 0
          ? PortfolioManagerUsageStatus.PARTIAL
          : PortfolioManagerUsageStatus.SUCCEEDED,
    resultSummary: {
      direction: "IMPORT_PM_TO_LOCAL",
      linkedMeterCount: activeMeters.length,
      metersWithReadings,
      readingsCreated,
      readingsUpdated,
      readingsArchived,
      malformedRows,
      unsupportedUnitSkips,
      skippedMeterCount: remoteValidation.skippedMeters.length,
      skippedMeters: remoteValidation.skippedMeters,
      partialReasonSummary:
        remoteValidation.partialReasonSummary ??
        remoteValidation.warnings[0] ??
        null,
    },
    coverageSummary,
  };
}

async function loadLocalPushCandidateReadings(input: {
  organizationId: string;
  buildingId: string;
  meters: MeterRecord[];
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const meterIds = input.meters.map((meter) => meter.id);
  const readings = await db.energyReading.findMany({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      meterId: { in: meterIds },
      archivedAt: null,
    },
    orderBy: [{ periodStart: "asc" }, { ingestedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      meterId: true,
      meterType: true,
      periodStart: true,
      periodEnd: true,
      consumption: true,
      unit: true,
      cost: true,
      source: true,
      ingestedAt: true,
      consumptionKbtu: true,
      rawPayload: true,
      archivedAt: true,
    },
  });

  const grouped = new Map<string, LocalReadingRecord[]>();
  for (const reading of readings) {
    if (!reading.meterId) {
      continue;
    }
    const current = grouped.get(reading.meterId) ?? [];
    current.push(reading);
    grouped.set(reading.meterId, current);
  }

  const deduped = new Map<string, LocalReadingRecord[]>();
  for (const meter of input.meters) {
    deduped.set(
      meter.id,
      collapseDisplayEnergyReadings(dedupeEnergyReadings(grouped.get(meter.id) ?? [])),
    );
  }

  return deduped;
}

function buildPushReviewNote(input: {
  includedInPush: boolean;
  blockers: string[];
  warnings: string[];
  readingCount: number;
  firstPeriodStart: Date | null;
  lastPeriodEnd: Date | null;
}) {
  if (input.blockers.length > 0) {
    return input.blockers[0]!;
  }

  if (input.includedInPush && input.readingCount > 0) {
    const periodRange =
      input.firstPeriodStart && input.lastPeriodEnd
        ? ` (${formatDate(input.firstPeriodStart)} to ${formatDate(input.lastPeriodEnd)})`
        : "";
    return `Quoin will mirror ${input.readingCount} active reading${input.readingCount === 1 ? "" : "s"}${periodRange}.`;
  }

  if (input.includedInPush) {
    return "Quoin will remove Portfolio Manager usage for this linked meter because no active Quoin readings remain.";
  }

  if (input.warnings.length > 0) {
    return input.warnings[0]!;
  }

  return "No active Quoin readings are available for this linked meter.";
}

function finalizePushReviewRow(
  row: PreparedPushReviewMeterRow,
): PushReviewMeterRow {
  const includedInPush = row.blockers.length === 0;
  const firstPeriodStart = includedInPush ? row.candidateReadings[0]?.periodStart ?? null : null;
  const lastPeriodEnd = includedInPush
    ? row.candidateReadings[row.candidateReadings.length - 1]?.periodEnd ?? null
    : null;
  const readingCount = includedInPush ? row.candidateReadings.length : 0;

  return {
    meterId: row.meterId,
    meterName: row.meterName,
    meterType: row.meterType,
    localUnit: row.localUnit,
    espmMeterId: row.espmMeterId,
    rawPmType: row.rawPmType,
    rawPmUnitOfMeasure: row.rawPmUnitOfMeasure,
    canonicalSource: row.canonicalSource,
    reconciliationStatus: row.reconciliationStatus,
    readingCount,
    firstPeriodStart,
    lastPeriodEnd,
    blockers: row.blockers,
    warnings: row.warnings,
    includedInPush,
    reviewNote: buildPushReviewNote({
      includedInPush,
      blockers: row.blockers,
      warnings: row.warnings,
      readingCount,
      firstPeriodStart,
      lastPeriodEnd,
    }),
  };
}

function buildPushReadinessSummaryLine(input: {
  blockers: string[];
  warnings: string[];
  pushableReadingCount: number;
  pushableMeterCount: number;
}) {
  if (input.blockers.length > 0) {
    return input.blockers[0]!;
  }

  if (input.warnings.length > 0) {
    return input.warnings[0]!;
  }

  if (input.pushableReadingCount === 0) {
    return `Quoin will remove Portfolio Manager usage for ${input.pushableMeterCount} linked meter${input.pushableMeterCount === 1 ? "" : "s"} because no active Quoin readings remain.`;
  }

  return `Quoin is ready to mirror ${input.pushableReadingCount} active reading${input.pushableReadingCount === 1 ? "" : "s"} across ${input.pushableMeterCount} linked meter${input.pushableMeterCount === 1 ? "" : "s"} to Portfolio Manager.`;
}

function selectLocalReadingsForPush(candidateReadings: LocalReadingRecord[]) {
  return collapseDisplayEnergyReadings(dedupeEnergyReadings(candidateReadings));
}

function getUnsupportedPushReason(input: {
  meter: {
    name: string;
    remoteRawType: string | null;
    remoteRawUnitOfMeasure: string | null;
  };
  readings: LocalReadingRecord[];
}) {
  for (const reading of input.readings) {
    const converted = convertLocalUsageToRemoteUsage({
      localMeterType: reading.meterType,
      localUnit: reading.unit,
      rawRemoteType: input.meter.remoteRawType,
      rawRemoteUnitOfMeasure: input.meter.remoteRawUnitOfMeasure,
      localUsage: reading.consumption,
    });

    if (!converted.ok) {
      return converted.reason ?? `Linked meter ${input.meter.name} cannot be pushed from Quoin.`;
    }
  }

  return null;
}

async function buildPushReadiness(input: {
  organizationId: string;
  buildingId: string;
  context: UsageContext;
  reportingYear: number;
  espmClient?: ESPM;
  runtimeWarning?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const blockers = getUsagePreconditionBlockers(input.context);
  const warnings: string[] = [];
  if (input.runtimeWarning) {
    warnings.push(input.runtimeWarning);
  }

  const linkedMeters = input.context.activeMeters.filter((meter) => meter.espmMeterId != null);
  let validatedLinkedMeters: ValidatedLinkedMeter[] = [];
  let validationByMeterId = new Map<string, LinkedMeterValidationState>();
  if (
    blockers.length === 0 &&
    input.context.building.espmPropertyId != null &&
    input.context.building.espmShareStatus === "LINKED"
  ) {
    const espmClient =
      input.espmClient ??
      (await resolvePortfolioManagerClientForOrganization({
        organizationId: input.organizationId,
        db,
      }));
    const remoteValidation = await validateLinkedMetersAgainstRemoteState({
      organizationId: input.organizationId,
      propertyId: Number(input.context.building.espmPropertyId),
      meters: linkedMeters,
      espmClient,
      db,
    });
    blockers.push(...remoteValidation.blockers);
    warnings.push(...remoteValidation.warnings);
    validatedLinkedMeters = remoteValidation.linkedMeters;
    validationByMeterId = remoteValidation.validationByMeterId;
  }

  const coverageSummary =
    linkedMeters.length > 0
      ? evaluateCoverageSummary({
          activeMeters: linkedMeters,
          dedupedReadingsByMeterId: await loadCanonicalLinkedReadings({
            organizationId: input.organizationId,
            buildingId: input.buildingId,
            activeMeters: linkedMeters,
            reportingYear: input.reportingYear,
            db,
          }),
          reportingYear: input.reportingYear,
        })
      : null;

  const reconciliation = await getBuildingSourceReconciliationSummary({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    referenceYear: input.reportingYear,
  });

  if (!reconciliation) {
    blockers.push("Source reconciliation must be available before pushing usage to Portfolio Manager.");
  } else {
    if (reconciliation.status === "CONFLICTED") {
      blockers.push(
        "Source reconciliation is conflicted for this reporting year. Resolve local source conflicts before pushing to Portfolio Manager.",
      );
    } else if (reconciliation.status === "INCOMPLETE") {
      warnings.push(
        "Source reconciliation is still incomplete for this reporting year. Review warnings before pushing to Portfolio Manager.",
      );
    }
  }

  const meterSummariesById = new Map<string, MeterSourceReconciliationSummary>();
  for (const meterSummary of reconciliation?.meters ?? []) {
    meterSummariesById.set(meterSummary.meterId, meterSummary);
  }

  const pushCandidateReadings = await loadLocalPushCandidateReadings({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    meters: validatedLinkedMeters.length > 0 ? validatedLinkedMeters : linkedMeters,
    db,
  });

  const preliminaryMeterRows: PreparedPushReviewMeterRow[] = [];
  for (const meter of linkedMeters) {
    const validation = validationByMeterId.get(meter.id);
    const meterBlockers = [...(validation?.blockers ?? [])];
    const meterWarnings = [...(validation?.warnings ?? [])];
    const meterSummary = meterSummariesById.get(meter.id);
    if (!meterSummary) {
      pushUniqueMessage(
        meterBlockers,
        `Source reconciliation is missing for linked meter ${meter.name}.`,
      );
      preliminaryMeterRows.push({
        meterId: meter.id,
        meterName: meter.name,
        meterType: meter.meterType,
        localUnit: meter.unit,
        espmMeterId: meter.espmMeterId?.toString() ?? null,
        rawPmType: validation?.remoteRawType ?? meter.espmMeterTypeRaw ?? null,
        rawPmUnitOfMeasure:
          validation?.remoteRawUnitOfMeasure ?? meter.espmMeterUnitOfMeasureRaw ?? null,
        canonicalSource: null,
        reconciliationStatus: "MISSING",
        blockers: meterBlockers,
        warnings: meterWarnings,
        candidateReadings: [],
      });
      continue;
    }

    if (meterSummary.status === "CONFLICTED") {
      pushUniqueMessage(
        meterBlockers,
        `Source reconciliation is conflicted for linked meter ${meter.name}.`,
      );
    } else if (meterSummary.status === "INCOMPLETE") {
      pushUniqueMessage(
        meterWarnings,
        `Linked meter ${meter.name} still has incomplete source reconciliation detail.`,
      );
    }

    let pushable = selectLocalReadingsForPush(pushCandidateReadings.get(meter.id) ?? []);
    const unsupportedPushReason =
      pushable.length > 0
        ? getUnsupportedPushReason({
            meter: {
              name: meter.name,
              remoteRawType: validation?.remoteRawType ?? meter.espmMeterTypeRaw ?? null,
              remoteRawUnitOfMeasure:
                validation?.remoteRawUnitOfMeasure ?? meter.espmMeterUnitOfMeasureRaw ?? null,
            },
            readings: pushable,
          })
        : null;
    if (unsupportedPushReason) {
      pushUniqueMessage(
        meterBlockers,
        `Linked meter ${meter.name} cannot be pushed. ${unsupportedPushReason}`,
      );
    }

    if (pushable.length > 0 && meterSummary.canonicalSource == null) {
      pushUniqueMessage(
        meterWarnings,
        `Linked meter ${meter.name} does not have a reconciled canonical local source yet. Quoin will push the latest local readings anyway.`,
      );
    } else if (pushable.length > 0 && meterSummary.canonicalSource === "PORTFOLIO_MANAGER") {
      pushUniqueMessage(
        meterWarnings,
        `Linked meter ${meter.name} still reconciles to Portfolio Manager data, but Quoin will push the latest local readings for this meter.`,
      );
    }

    preliminaryMeterRows.push({
      meterId: meter.id,
      meterName: meter.name,
      meterType: meter.meterType,
      localUnit: meter.unit,
      espmMeterId: meter.espmMeterId?.toString() ?? null,
      rawPmType: validation?.remoteRawType ?? meter.espmMeterTypeRaw ?? null,
      rawPmUnitOfMeasure:
        validation?.remoteRawUnitOfMeasure ?? meter.espmMeterUnitOfMeasureRaw ?? null,
      canonicalSource: meterSummary.canonicalSource,
      reconciliationStatus: meterSummary.status,
      blockers: meterBlockers,
      warnings: meterWarnings,
      candidateReadings: pushable,
    });
  }

  const provisionalPushableReadingsByMeterId = new Map<string, LocalReadingRecord[]>();
  for (const meterRow of preliminaryMeterRows) {
    provisionalPushableReadingsByMeterId.set(
      meterRow.meterId,
      meterRow.blockers.length === 0 ? meterRow.candidateReadings : [],
    );
  }

  const provisionalPushCoverageSummary =
    linkedMeters.length > 0
      ? evaluateCoverageSummary({
          activeMeters: linkedMeters,
          dedupedReadingsByMeterId: provisionalPushableReadingsByMeterId,
          reportingYear: input.reportingYear,
        })
      : null;

  const missingCoverageMetersById = new Map(
    (provisionalPushCoverageSummary?.missingCoverageMeters ?? []).map((meter) => [
      meter.meterId,
      meter,
    ]),
  );
  const overlappingMeterIds = new Set(
    (provisionalPushCoverageSummary?.overlappingMeters ?? []).map((meter) => meter.meterId),
  );
  for (const meterRow of preliminaryMeterRows) {
    if (overlappingMeterIds.has(meterRow.meterId)) {
      pushUniqueMessage(
        meterRow.blockers,
        "Approved local usage still has overlapping billing periods and must be reviewed before push.",
      );
    }

    const missingCoverage = missingCoverageMetersById.get(meterRow.meterId);
    if (missingCoverage && meterRow.candidateReadings.length > 0) {
      pushUniqueMessage(
        meterRow.warnings,
        `Approved local usage for ${meterRow.meterName} covers ${missingCoverage.coveredMonths.length} of 12 months in ${input.reportingYear}.`,
      );
    }
  }

  const meterRows = preliminaryMeterRows.map(finalizePushReviewRow);
  const pushableReadingsByMeterId = new Map<string, LocalReadingRecord[]>();
  for (const meterRow of preliminaryMeterRows) {
    const finalizedRow = meterRows.find((row) => row.meterId === meterRow.meterId);
    pushableReadingsByMeterId.set(
      meterRow.meterId,
      finalizedRow?.includedInPush ? meterRow.candidateReadings : [],
    );
  }

  const pushCoverageSummary =
    linkedMeters.length > 0
      ? evaluateCoverageSummary({
          activeMeters: linkedMeters,
          dedupedReadingsByMeterId: pushableReadingsByMeterId,
          reportingYear: input.reportingYear,
        })
      : null;

  if (pushCoverageSummary?.status === "NEEDS_ATTENTION") {
    blockers.push("Approved local usage still has overlapping billing periods and must be reviewed before push.");
  } else if (
    pushCoverageSummary?.status === "PARTIAL_COVERAGE" ||
    (pushCoverageSummary?.status === "NO_USABLE_DATA" &&
      (pushCoverageSummary.totalPeriods ?? 0) > 0)
  ) {
    warnings.push("Approved local usage only covers part of the reporting year. Push can proceed with partial coverage.");
  }

  let pushableMeterCount = 0;
  let pushableReadingCount = 0;
  for (const meterRow of meterRows) {
    if (meterRow.includedInPush) {
      pushableMeterCount += 1;
      pushableReadingCount += meterRow.readingCount;
    }
  }

  for (const meterRow of meterRows) {
    for (const blocker of meterRow.blockers) {
      pushUniqueMessage(blockers, blocker);
    }
    for (const warning of meterRow.warnings) {
      pushUniqueMessage(warnings, warning);
    }
  }

  const uniqueBlockers = Array.from(new Set(blockers));
  const uniqueWarnings = Array.from(new Set(warnings)).filter(
    (warning) => !uniqueBlockers.includes(warning),
  );
  const canPush = uniqueBlockers.length === 0;

  return {
    status: canPush
      ? uniqueWarnings.length > 0
        ? "READY_WITH_WARNINGS"
        : "READY"
      : "BLOCKED",
    reportingYear: input.reportingYear,
    canPush,
    summaryLine: buildPushReadinessSummaryLine({
      blockers: uniqueBlockers,
      warnings: uniqueWarnings,
      pushableReadingCount,
      pushableMeterCount,
    }),
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    pushableMeterCount,
    pushableReadingCount,
    reconciliationStatus: reconciliation?.status ?? null,
    coverageSummary: pushCoverageSummary ?? coverageSummary,
    meterRows,
  } satisfies PushReadiness;
}

function toClientUsageState(input: {
  building: BuildingRecord;
  activeMeters: MeterRecord[];
  setupState: SetupStateRecord;
  usageState: UsageStateRecord;
  pushReadiness: PushReadiness;
  importCanProceed: boolean;
  importSummaryLine: string | null;
}) {
  const overallStatus =
    input.usageState?.overallStatus ?? PortfolioManagerUsageStatus.NOT_STARTED;
  const usageStatus =
    input.usageState?.usageStatus ?? PortfolioManagerUsageStatus.NOT_STARTED;
  const metricsStatus =
    input.usageState?.metricsStatus ?? PortfolioManagerMetricsStatus.NOT_STARTED;
  const coverageStatus =
    input.usageState?.coverageStatus ?? PortfolioManagerCoverageStatus.NOT_STARTED;

  const propertyUsesApplied =
    (input.setupState?.propertyUsesStatus ?? "NOT_STARTED") === "APPLIED";
  const metersApplied = (input.setupState?.metersStatus ?? "NOT_STARTED") === "APPLIED";
  const associationsApplied =
    (input.setupState?.associationsStatus ?? "NOT_STARTED") === "APPLIED";
  const hasLinkedProperty =
    input.building.espmPropertyId != null && input.building.espmShareStatus === "LINKED";
  const hasActiveMeters = input.activeMeters.length > 0;
  const allActiveMetersLinked =
    hasActiveMeters && input.activeMeters.every((meter) => meter.espmMeterId != null);
  const prerequisitesReady =
    hasLinkedProperty &&
    propertyUsesApplied &&
    metersApplied &&
    associationsApplied &&
    hasActiveMeters &&
    allActiveMetersLinked;
  const prerequisiteSummaryLine = !hasLinkedProperty
    ? "Portfolio Manager usage is available after PM linkage."
    : !propertyUsesApplied
      ? "Apply Portfolio Manager property uses before usage."
      : !metersApplied
        ? "Apply Portfolio Manager meter setup before usage."
        : !associationsApplied
          ? "Apply Portfolio Manager meter associations before usage."
          : !hasActiveMeters
            ? "At least one active linked local meter is required for usage."
            : !allActiveMetersLinked
              ? "All active local meters must be linked to PM before usage."
              : null;

  const resultSummary = toRecord(input.usageState?.lastUsageResultJson);
  const coverageSummary = toRecord(input.usageState?.coverageSummaryJson);
  const latestMetrics = toRecord(input.usageState?.latestMetricsJson);

  return {
    overallStatus,
    usageStatus,
    metricsStatus,
    coverageStatus,
    lastRunDirection: input.usageState?.lastRunDirection ?? null,
    reportingYear: input.usageState?.reportingYear ?? defaultReportingYear(),
    latestJobId: input.usageState?.latestJobId ?? null,
    latestErrorCode: input.usageState?.latestErrorCode ?? null,
    latestErrorMessage: input.usageState?.latestErrorMessage ?? null,
    summaryState: deriveUsageSummaryState({
      overallStatus,
      coverageStatus,
      metricsStatus,
    }),
    summaryLine: buildUsageSummaryLine({
      coverageStatus,
      metricsStatus,
      latestErrorMessage: input.usageState?.latestErrorMessage ?? null,
    }),
    canPush: input.pushReadiness.canPush,
    canImport: prerequisitesReady && input.importCanProceed,
    lastUsageAppliedAt: input.usageState?.lastUsageAppliedAt ?? null,
    lastMetricsRefreshedAt: input.usageState?.lastMetricsRefreshedAt ?? null,
    lastAttemptedAt: input.usageState?.lastAttemptedAt ?? null,
    lastFailedAt: input.usageState?.lastFailedAt ?? null,
    resultSummary: Object.keys(resultSummary).length > 0 ? resultSummary : null,
    coverageSummary: Object.keys(coverageSummary).length > 0 ? coverageSummary : null,
    latestMetrics: Object.keys(latestMetrics).length > 0 ? latestMetrics : null,
    ...(prerequisiteSummaryLine || input.importSummaryLine
      ? {
          summaryState: "SETUP_INCOMPLETE" as const,
          summaryLine: prerequisiteSummaryLine ?? input.importSummaryLine,
        }
      : {}),
  };
}

export async function getPortfolioManagerUsageStatusForBuilding(input: {
  organizationId: string;
  buildingId: string;
  db?: PrismaClient;
}) {
  const context = await loadUsageContext(input);
  const reportingYear = context.usageState?.reportingYear ?? defaultReportingYear();
  const db = input.db ?? prisma;
  const runtimeHealth = await getPmRuntimeHealth({
    latestJobId: context.usageState?.latestJobId ?? null,
    active:
      context.usageState?.overallStatus === "QUEUED" ||
      context.usageState?.overallStatus === "RUNNING",
    db,
  });
  let importCanProceed = true;
  let importSummaryLine: string | null = null;
  const preconditionBlockers = getUsagePreconditionBlockers(context);
  if (
    preconditionBlockers.length === 0 &&
    context.building.espmPropertyId != null &&
    context.building.espmShareStatus === "LINKED"
  ) {
    const espmClient = await resolvePortfolioManagerClientForOrganization({
      organizationId: input.organizationId,
      db,
    });
    const remoteValidation = await validateLinkedMetersAgainstRemoteState({
      organizationId: input.organizationId,
      propertyId: Number(context.building.espmPropertyId),
      meters: context.activeMeters.filter((meter) => meter.espmMeterId != null),
      espmClient,
      db,
    });
    if (remoteValidation.blockers.length > 0) {
      importCanProceed = false;
      importSummaryLine = remoteValidation.blockers[0] ?? null;
    } else if (remoteValidation.partialReasonSummary || remoteValidation.warnings.length > 0) {
      importSummaryLine =
        remoteValidation.partialReasonSummary ?? remoteValidation.warnings[0] ?? null;
    }
  }
  const pushReadiness = await buildPushReadiness({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    context,
    reportingYear,
    db,
    runtimeWarning: runtimeHealth.warning,
  });

  return {
    building: {
      id: context.building.id,
      espmPropertyId: context.building.espmPropertyId?.toString() ?? null,
      espmShareStatus: context.building.espmShareStatus,
    },
    setupState: {
      propertyUsesStatus:
        context.setupState?.propertyUsesStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED,
      metersStatus:
        context.setupState?.metersStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED,
      associationsStatus:
        context.setupState?.associationsStatus ??
        PortfolioManagerSetupComponentStatus.NOT_STARTED,
      usageCoverageStatus:
        context.setupState?.usageCoverageStatus ??
        PortfolioManagerSetupComponentStatus.NOT_STARTED,
    },
    usageState: toClientUsageState({
      building: context.building,
      activeMeters: context.activeMeters,
      setupState: context.setupState,
      usageState: context.usageState,
      pushReadiness,
      importCanProceed,
      importSummaryLine,
    }),
    pushReadiness,
    runtimeHealth,
  };
}

async function enqueueUsageJob(input: {
  organizationId: string;
  buildingId: string;
  direction: PortfolioManagerUsageDirection;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  reportingYear?: number;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const context = await loadUsageContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const reportingYear = input.reportingYear ?? defaultReportingYear();
  if (input.direction === "PUSH_LOCAL_TO_PM") {
    const pushReadiness = await buildPushReadiness({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      context,
      reportingYear,
      db,
    });
    if (!pushReadiness.canPush) {
      throw new ValidationError(pushReadiness.blockers[0] ?? pushReadiness.summaryLine);
    }
  } else {
    assertUsagePreconditions(context);
    const espmClient = await resolvePortfolioManagerClientForOrganization({
      organizationId: input.organizationId,
      db,
    });
    const remoteValidation = await validateLinkedMetersAgainstRemoteState({
      organizationId: input.organizationId,
      propertyId: Number(context.building.espmPropertyId),
      meters: context.activeMeters.filter((meter) => meter.espmMeterId != null),
      espmClient,
      db,
    });
    if (remoteValidation.blockers.length > 0) {
      throw new ValidationError(remoteValidation.blockers[0] ?? "Portfolio Manager usage is blocked.");
    }
  }

  const { job, now } = await withAdvisoryTransactionLock(
    db,
    `pm-usage:${input.organizationId}:${input.buildingId}`,
    async (tx) => {
      const existingState = await tx.portfolioManagerUsageState.findUnique({
        where: { buildingId: input.buildingId },
        select: {
          overallStatus: true,
        },
      });

      if (
        existingState?.overallStatus === "QUEUED" ||
        existingState?.overallStatus === "RUNNING"
      ) {
        throw new WorkflowStateError("Portfolio Manager usage is already queued or running.");
      }

      const queuedJob = await createJob(
        {
          type:
            input.direction === "PUSH_LOCAL_TO_PM"
              ? PORTFOLIO_MANAGER_USAGE_PUSH_JOB_TYPE
              : PORTFOLIO_MANAGER_USAGE_IMPORT_JOB_TYPE,
          status: JOB_STATUS.QUEUED,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          maxAttempts: 3,
        },
        tx,
      );
      const queuedAt = new Date();

      await tx.portfolioManagerUsageState.upsert({
        where: { buildingId: input.buildingId },
        create: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          overallStatus: "QUEUED",
          usageStatus: "QUEUED",
          metricsStatus: "NOT_STARTED",
          coverageStatus: "NOT_STARTED",
          lastRunDirection: input.direction,
          reportingYear,
          latestJobId: queuedJob.id,
          latestErrorCode: null,
          latestErrorMessage: null,
          lastAttemptedAt: queuedAt,
        },
        update: {
          overallStatus: "QUEUED",
          usageStatus: "QUEUED",
          metricsStatus: "NOT_STARTED",
          coverageStatus: "NOT_STARTED",
          lastRunDirection: input.direction,
          reportingYear,
          latestJobId: queuedJob.id,
          latestErrorCode: null,
          latestErrorMessage: null,
          lastAttemptedAt: queuedAt,
        },
      });

      return {
        job: queuedJob,
        now: queuedAt,
      };
    },
  );

  const jobType =
    input.direction === "PUSH_LOCAL_TO_PM"
      ? PM_USAGE_JOB_TYPE.USAGE_PUSH_APPLY
      : PM_USAGE_JOB_TYPE.USAGE_IMPORT_APPLY;
  const envelope = buildPortfolioManagerUsageEnvelope({
    requestId: input.requestId,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    operationalJobId: job.id,
    reportingYear,
    direction: input.direction,
    jobType,
    triggeredAt: now,
  });
  const queueJobId =
    input.direction === "PUSH_LOCAL_TO_PM"
      ? `pm-usage-push-${job.id}`
      : `pm-usage-import-${job.id}`;
  try {
    await withQueue(QUEUES.PORTFOLIO_MANAGER_USAGE, async (queue) => {
      await queue.add("portfolio-manager-usage", envelope, {
        jobId: queueJobId,
      });
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager usage could not be queued.";
    await markPortfolioManagerUsageFailed({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      operationalJobId: job.id,
      errorCode: "PM_USAGE_QUEUE_FAILED",
      errorMessage: message,
      db,
    });
    await markDead(job.id, message, db).catch(() => null);
    throw error;
  }

  await createAuditLog({
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    requestId: envelope.requestId,
    action:
      input.direction === "PUSH_LOCAL_TO_PM"
        ? "portfolio_manager.usage_push.queued"
        : "portfolio_manager.usage_import.queued",
    outputSnapshot: {
      operationalJobId: job.id,
      queueJobId,
      reportingYear,
    },
  });

  return {
    queueName: QUEUES.PORTFOLIO_MANAGER_USAGE,
    queueJobId,
    operationalJobId: job.id,
  };
}

export async function enqueuePortfolioManagerUsagePush(input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  reportingYear?: number;
  db?: PrismaClient;
}) {
  return enqueueUsageJob({
    ...input,
    direction: PortfolioManagerUsageDirection.PUSH_LOCAL_TO_PM,
  });
}

async function runPortfolioManagerUsagePushInline(input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  reportingYear?: number;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const context = await loadUsageContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const reportingYear =
    input.reportingYear ?? context.usageState?.reportingYear ?? defaultReportingYear();

  if (
    (context.usageState?.overallStatus === "QUEUED" ||
      context.usageState?.overallStatus === "RUNNING") &&
    context.usageState.latestJobId
  ) {
    await markDead(
      context.usageState.latestJobId,
      "Recovered inline because the background Portfolio Manager worker was unavailable.",
      db,
    ).catch(() => null);
  }

  const job = await createJob(
    {
      type: PORTFOLIO_MANAGER_USAGE_PUSH_JOB_TYPE,
      status: JOB_STATUS.QUEUED,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      maxAttempts: 1,
    },
    db,
  );

  await markRunning(job.id, db);

  try {
    const result = await runPortfolioManagerUsageApply({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      operationalJobId: job.id,
      direction: PortfolioManagerUsageDirection.PUSH_LOCAL_TO_PM,
      reportingYear,
      db,
    });

    await markCompleted(job.id, db);
    await createAuditLog({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      requestId: input.requestId ?? null,
      action: "portfolio_manager.usage_push.inline_completed",
      outputSnapshot: {
        operationalJobId: job.id,
        reportingYear,
        usageStatus: result.usageStatus,
        coverageStatus: result.coverageStatus,
        metricsStatus: result.metricsStatus,
      },
    });

    return {
      mode: "inline" as const,
      operationalJobId: job.id,
      result,
    };
  } catch (error) {
    const appError = toAppError(error);
    await markPortfolioManagerUsageFailed({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      operationalJobId: job.id,
      errorCode: appError.code,
      errorMessage: appError.message,
      db,
    });
    await markDead(job.id, appError.message, db).catch(() => null);
    throw error;
  }
}

export async function requestPortfolioManagerUsagePush(input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  reportingYear?: number;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const context = await loadUsageContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const runtimeHealth = await getPmRuntimeHealth({
    latestJobId: context.usageState?.latestJobId ?? null,
    active:
      context.usageState?.overallStatus === "QUEUED" ||
      context.usageState?.overallStatus === "RUNNING",
    db,
  });
  const shouldRunInline =
    runtimeHealth.workerStatus !== "HEALTHY" || runtimeHealth.latestJob.stalled;

  if (!shouldRunInline) {
    const queued = await enqueuePortfolioManagerUsagePush(input);
    return {
      mode: "queued" as const,
      ...queued,
      warning: null,
    };
  }

  const inline = await runPortfolioManagerUsagePushInline({
    ...input,
    db,
  });

  return {
    ...inline,
    warning:
      runtimeHealth.workerStatus !== "HEALTHY"
        ? "Ran Portfolio Manager push directly because the background worker is unavailable."
        : runtimeHealth.latestJob.stalled
          ? "Recovered a stalled Portfolio Manager push and ran it directly."
          : null,
  };
}

export async function enqueuePortfolioManagerUsageImport(input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  reportingYear?: number;
  db?: PrismaClient;
}) {
  return enqueueUsageJob({
    ...input,
    direction: PortfolioManagerUsageDirection.IMPORT_PM_TO_LOCAL,
  });
}

export async function runPortfolioManagerUsageApply(input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  direction: PortfolioManagerUsageDirection;
  reportingYear?: number;
  espmClient?: ESPM;
  db?: PrismaClient;
}): Promise<UsageRunResult> {
  const db = input.db ?? prisma;
  const context = await loadUsageContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const reportingYear =
    input.reportingYear ?? context.usageState?.reportingYear ?? defaultReportingYear();
  const espmClient =
    input.espmClient ??
    (await resolvePortfolioManagerClientForOrganization({
      organizationId: input.organizationId,
      db,
    }));
  if (input.direction === "PUSH_LOCAL_TO_PM") {
    const pushReadiness = await buildPushReadiness({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      context,
      reportingYear,
      espmClient,
      db,
    });
    if (!pushReadiness.canPush) {
      throw new ValidationError(pushReadiness.blockers[0] ?? pushReadiness.summaryLine);
    }
  } else {
    assertUsagePreconditions(context);
    const remoteValidation = await validateLinkedMetersAgainstRemoteState({
      organizationId: input.organizationId,
      propertyId: Number(context.building.espmPropertyId),
      meters: context.activeMeters.filter((meter) => meter.espmMeterId != null),
      espmClient,
      db,
    });
    if (remoteValidation.blockers.length > 0) {
      throw new ValidationError(remoteValidation.blockers[0] ?? "Portfolio Manager usage is blocked.");
    }
  }

  await updateUsageStateRunning({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    operationalJobId: input.operationalJobId,
    direction: input.direction,
    reportingYear,
    db,
  });

  const initialUsageResult =
    input.direction === "PUSH_LOCAL_TO_PM"
      ? await runUsagePush({
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          reportingYear,
          activeMeters: context.activeMeters,
          espmClient,
          operationalJobId: input.operationalJobId,
          db,
        })
      : await runUsageImport({
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          reportingYear,
          activeMeters: context.activeMeters,
          espmClient,
          operationalJobId: input.operationalJobId,
          db,
        });

  const usageResult =
    input.direction === "PUSH_LOCAL_TO_PM"
      ? await (async () => {
          const readback = await runUsageImport({
            organizationId: input.organizationId,
            buildingId: input.buildingId,
            reportingYear,
            activeMeters: context.activeMeters,
            espmClient,
            operationalJobId: input.operationalJobId,
            db,
          });

          return {
            ...readback,
            direction: PortfolioManagerUsageDirection.PUSH_LOCAL_TO_PM,
            resultSummary: {
              ...(initialUsageResult.resultSummary ?? {}),
              postPushVerification: {
                usageStatus: readback.usageStatus,
                coverageStatus: readback.coverageSummary.status,
                importSummary: readback.resultSummary,
              },
            },
          };
        })()
      : initialUsageResult;

  const coverageStatus =
    usageResult.coverageSummary.status === "READY_FOR_METRICS"
      ? PortfolioManagerCoverageStatus.READY_FOR_METRICS
      : usageResult.coverageSummary.status === "PARTIAL_COVERAGE"
        ? PortfolioManagerCoverageStatus.PARTIAL_COVERAGE
        : usageResult.coverageSummary.status === "NO_USABLE_DATA"
          ? PortfolioManagerCoverageStatus.NO_USABLE_DATA
          : PortfolioManagerCoverageStatus.NEEDS_ATTENTION;
  const metricsResult = await refreshMetricsIfReady({
    espmClient,
    propertyId: Number(context.building.espmPropertyId),
    reportingYear,
    coverageSummary: usageResult.coverageSummary,
  });
  const createdSnapshot =
    input.direction === "IMPORT_PM_TO_LOCAL" || input.direction === "PUSH_LOCAL_TO_PM"
      ? await createComplianceSnapshotFromMetrics({
          building: context.building,
          reportingYear,
          metricsResult,
          db,
        })
      : null;
  const snapshotSummary: SnapshotRefreshResult | null =
    input.direction === "IMPORT_PM_TO_LOCAL" || input.direction === "PUSH_LOCAL_TO_PM"
      ? createdSnapshot
        ? {
            status: "SUCCEEDED",
            snapshotId: createdSnapshot.id,
            snapshotDate: new Date().toISOString(),
            message: "Benchmark snapshot refreshed from Portfolio Manager metrics.",
          }
        : {
            status: "SKIPPED",
            snapshotId: null,
            snapshotDate: null,
            message: "No usable Portfolio Manager metrics were available for a benchmark snapshot.",
          }
      : null;
  const overallStatus = deriveOverallUsageStatus({
    usageStatus: usageResult.usageStatus,
    coverageStatus,
    metricsStatus: metricsResult.status,
  });
  const metricsPayload = serializeMetricsRefreshResult(metricsResult);
  const now = new Date();

  await db.portfolioManagerUsageState.upsert({
    where: { buildingId: input.buildingId },
    create: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      overallStatus,
      usageStatus: usageResult.usageStatus,
      metricsStatus: metricsResult.status,
      coverageStatus,
      lastRunDirection: input.direction,
      reportingYear,
      latestJobId: input.operationalJobId,
      latestErrorCode: null,
      latestErrorMessage: null,
      lastUsageResultJson: usageResult.resultSummary,
      coverageSummaryJson: usageResult.coverageSummary,
      latestMetricsJson: metricsPayload,
      lastUsageAppliedAt: now,
      lastMetricsRefreshedAt:
        metricsResult.status === "SUCCEEDED" || metricsResult.status === "PARTIAL" ? now : null,
      lastAttemptedAt: now,
    },
    update: {
      overallStatus,
      usageStatus: usageResult.usageStatus,
      metricsStatus: metricsResult.status,
      coverageStatus,
      lastRunDirection: input.direction,
      reportingYear,
      latestJobId: input.operationalJobId,
      latestErrorCode: null,
      latestErrorMessage: null,
      lastUsageResultJson: usageResult.resultSummary,
      coverageSummaryJson: usageResult.coverageSummary,
      latestMetricsJson: metricsPayload,
      lastUsageAppliedAt: now,
      lastMetricsRefreshedAt:
        metricsResult.status === "SUCCEEDED" || metricsResult.status === "PARTIAL" ? now : null,
      lastAttemptedAt: now,
    },
  });

  await syncSetupCoverageState({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    coverageStatus,
    db,
  });

  return {
    direction: input.direction,
    reportingYear,
    usageStatus: usageResult.usageStatus,
    coverageStatus,
    metricsStatus: metricsResult.status,
    resultSummary: usageResult.resultSummary,
    coverageSummary: usageResult.coverageSummary,
    metricsSummary: metricsResult,
    snapshotSummary,
  };
}

export async function markPortfolioManagerUsageFailed(input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  errorCode: string;
  errorMessage: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  await db.portfolioManagerUsageState.upsert({
    where: { buildingId: input.buildingId },
    create: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      overallStatus: "FAILED",
      usageStatus: "FAILED",
      metricsStatus: "FAILED",
      coverageStatus: "NEEDS_ATTENTION",
      latestJobId: input.operationalJobId,
      latestErrorCode: input.errorCode,
      latestErrorMessage: input.errorMessage,
      lastFailedAt: new Date(),
      lastAttemptedAt: new Date(),
    },
    update: {
      overallStatus: "FAILED",
      usageStatus: "FAILED",
      metricsStatus: "FAILED",
      coverageStatus: "NEEDS_ATTENTION",
      latestJobId: input.operationalJobId,
      latestErrorCode: input.errorCode,
      latestErrorMessage: input.errorMessage,
      lastFailedAt: new Date(),
      lastAttemptedAt: new Date(),
    },
  });

  await syncSetupCoverageState({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    coverageStatus: PortfolioManagerCoverageStatus.NEEDS_ATTENTION,
    db,
  });
}
