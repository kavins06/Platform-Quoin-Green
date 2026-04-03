import type {
  ActorType,
  CanonicalSourceSystem,
  EnergySource,
  EnergyUnit,
  MeterType,
  Prisma,
  SourceReconciliationConflictType,
  SourceReconciliationStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import { NotFoundError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";

const SOURCE_PRIORITY: CanonicalSourceSystem[] = [
  "MANUAL",
  "GREEN_BUTTON",
  "PORTFOLIO_MANAGER",
  "CSV_UPLOAD",
];

const MISMATCH_THRESHOLD_RATIO = 0.05;

type ReadingRecord = {
  id: string;
  source: EnergySource;
  meterId: string | null;
  meterType: MeterType;
  unit: EnergyUnit;
  periodStart: Date;
  periodEnd: Date;
  consumptionKbtu: number;
  ingestedAt: Date;
  rawPayload: unknown;
};

type ReconciliationConflictSeverity = "BLOCKING" | "WARNING";
type ReconciliationRecordState = "AVAILABLE" | "INCOMPLETE" | "UNAVAILABLE";

export interface ReconciliationConflictSummary {
  code: SourceReconciliationConflictType;
  severity: ReconciliationConflictSeverity;
  message: string;
  sourceSystems: CanonicalSourceSystem[];
  meterId: string | null;
  meterName: string | null;
}

export interface ReconciliationSourceRecordSummary {
  sourceSystem: CanonicalSourceSystem;
  state: ReconciliationRecordState;
  linkedRecordId: string | null;
  externalRecordId: string | null;
  readingCount: number;
  coverageMonthCount: number;
  coverageMonths: string[];
  totalConsumptionKbtu: number | null;
  latestIngestedAt: string | null;
  details: Record<string, unknown>;
}

export interface MeterSourceReconciliationSummary {
  meterId: string;
  meterName: string;
  meterType: MeterType;
  unit: EnergyUnit;
  status: SourceReconciliationStatus;
  canonicalSource: CanonicalSourceSystem | null;
  coverageMonthCount: number;
  sourceRecords: ReconciliationSourceRecordSummary[];
  conflicts: ReconciliationConflictSummary[];
  chosenValues: {
    selectionRule: "SOURCE_PRIORITY";
    canonicalUnit: EnergyUnit;
    selectionReason: string | null;
  };
  lastReconciledAt: string | null;
}

export interface BuildingSourceReconciliationOverview {
  id: string | null;
  status: SourceReconciliationStatus | null;
  canonicalSource: CanonicalSourceSystem | null;
  referenceYear: number | null;
  conflictCount: number;
  incompleteCount: number;
  lastReconciledAt: string | null;
}

export interface BuildingSourceReconciliationSummary
  extends BuildingSourceReconciliationOverview {
  sourceRecords: ReconciliationSourceRecordSummary[];
  conflicts: ReconciliationConflictSummary[];
  chosenValues: {
    selectionRule: "SOURCE_PRIORITY";
    selectionReason: string | null;
    coverageSummary: {
      totalReadings: number;
      sourcesPresent: CanonicalSourceSystem[];
    };
  };
  meters: MeterSourceReconciliationSummary[];
}

type ComputedBuildingSourceReconciliationSummary = {
  status: SourceReconciliationStatus;
  canonicalSource: CanonicalSourceSystem | null;
  referenceYear: number;
  conflictCount: number;
  incompleteCount: number;
  sourceRecords: ReconciliationSourceRecordSummary[];
  conflicts: ReconciliationConflictSummary[];
  chosenValues: BuildingSourceReconciliationSummary["chosenValues"];
  meters: MeterSourceReconciliationSummary[];
};

type PersistedBuildingRow = {
  id: string;
  status: SourceReconciliationStatus;
  canonicalSource: CanonicalSourceSystem | null;
  referenceYear: number | null;
  conflictCount: number;
  incompleteCount: number;
  sourceRecordsJson: unknown;
  conflictsJson: unknown;
  chosenValuesJson: unknown;
  lastReconciledAt: Date;
};

type PersistedMeterRow = {
  meterId: string;
  meter: {
    id: string;
    name: string;
    meterType: MeterType;
    unit: EnergyUnit;
  };
  status: SourceReconciliationStatus;
  canonicalSource: CanonicalSourceSystem | null;
  sourceRecordsJson: unknown;
  conflictsJson: unknown;
  chosenValuesJson: unknown;
  lastReconciledAt: Date;
};

function defaultReferenceYear(now = new Date()) {
  return now.getUTCFullYear() - 1;
}

function startOfUtcYear(year: number) {
  return new Date(Date.UTC(year, 0, 1));
}

function startOfNextUtcYear(year: number) {
  return new Date(Date.UTC(year + 1, 0, 1));
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function canonicalSourceForEnergySource(source: EnergySource): CanonicalSourceSystem {
  switch (source) {
    case "ESPM_SYNC":
      return "PORTFOLIO_MANAGER";
    case "GREEN_BUTTON":
      return "GREEN_BUTTON";
    case "MANUAL":
      return "MANUAL";
    default:
      return "CSV_UPLOAD";
  }
}

function sortMonths(values: string[]) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function percentageDelta(left: number, right: number) {
  const baseline = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / baseline;
}

function chooseCanonicalSource(
  availableSources: CanonicalSourceSystem[],
): CanonicalSourceSystem | null {
  for (const source of SOURCE_PRIORITY) {
    if (availableSources.includes(source)) {
      return source;
    }
  }

  return null;
}

function sourceSelectionReason(source: CanonicalSourceSystem | null) {
  if (!source) {
    return null;
  }

  switch (source) {
    case "MANUAL":
      return "Manual corrections override all other imported source readings.";
    case "GREEN_BUTTON":
      return "Green Button is preferred over Portfolio Manager and uploaded utility data when both are available.";
    case "PORTFOLIO_MANAGER":
      return "Portfolio Manager is preferred over CSV uploads when Green Button data is not available.";
    case "CSV_UPLOAD":
      return "CSV uploads are used when no higher-priority governed source is available.";
  }
}

function summarizeReadingSources(readings: ReadingRecord[]) {
  const bySource = new Map<
    CanonicalSourceSystem,
    {
      readingCount: number;
      coverageMonths: Set<string>;
      totalConsumptionKbtu: number;
      latestIngestedAt: Date | null;
      externalRecordId: string | null;
    }
  >();

  for (const reading of readings) {
    const sourceSystem = canonicalSourceForEnergySource(reading.source);
    const existing =
      bySource.get(sourceSystem) ??
      {
        readingCount: 0,
        coverageMonths: new Set<string>(),
        totalConsumptionKbtu: 0,
        latestIngestedAt: null,
        externalRecordId: null,
      };

    existing.readingCount += 1;
    existing.coverageMonths.add(monthKey(reading.periodStart));
    existing.totalConsumptionKbtu += reading.consumptionKbtu;
    if (!existing.latestIngestedAt || reading.ingestedAt > existing.latestIngestedAt) {
      existing.latestIngestedAt = reading.ingestedAt;
    }

    const payload = toRecord(reading.rawPayload);
    if (sourceSystem === "PORTFOLIO_MANAGER" && existing.externalRecordId == null) {
      const espmMeterId = payload.espmMeterId;
      if (espmMeterId != null) {
        existing.externalRecordId = String(espmMeterId);
      }
    }

    if (sourceSystem === "GREEN_BUTTON" && existing.externalRecordId == null) {
      const subscriptionId = payload.subscriptionId;
      if (subscriptionId != null) {
        existing.externalRecordId = String(subscriptionId);
      }
    }

    bySource.set(sourceSystem, existing);
  }

  return bySource;
}

function meterLooksGreenButtonLinked(name: string) {
  return name === "Green Button Electric" || name === "Green Button Gas";
}

function buildMeterSummary(input: {
  meter: {
    id: string;
    name: string;
    meterType: MeterType;
    unit: EnergyUnit;
    espmMeterId: bigint | null;
  };
  readings: ReadingRecord[];
  referenceYear: number;
}): MeterSourceReconciliationSummary {
  const readingSources = summarizeReadingSources(input.readings);
  const sourceRecords: ReconciliationSourceRecordSummary[] = [];

  const allSourceSystems: CanonicalSourceSystem[] = [
    "MANUAL",
    "GREEN_BUTTON",
    "PORTFOLIO_MANAGER",
    "CSV_UPLOAD",
  ];

  for (const sourceSystem of allSourceSystems) {
    const sourceSummary = readingSources.get(sourceSystem);
    const hasPortfolioManagerLink =
      sourceSystem === "PORTFOLIO_MANAGER" && input.meter.espmMeterId != null;
    const hasGreenButtonLink =
      sourceSystem === "GREEN_BUTTON" && meterLooksGreenButtonLinked(input.meter.name);
    const state: ReconciliationRecordState = sourceSummary
      ? "AVAILABLE"
      : hasPortfolioManagerLink || hasGreenButtonLink
        ? "INCOMPLETE"
        : "UNAVAILABLE";

    sourceRecords.push({
      sourceSystem,
      state,
      linkedRecordId:
        sourceSystem === "PORTFOLIO_MANAGER" && input.meter.espmMeterId != null
          ? input.meter.id
          : sourceSystem === "GREEN_BUTTON" && hasGreenButtonLink
            ? input.meter.id
            : sourceSummary
              ? input.meter.id
              : null,
      externalRecordId:
        sourceSystem === "PORTFOLIO_MANAGER" && input.meter.espmMeterId != null
          ? input.meter.espmMeterId.toString()
          : sourceSummary?.externalRecordId ?? null,
      readingCount: sourceSummary?.readingCount ?? 0,
      coverageMonthCount: sourceSummary?.coverageMonths.size ?? 0,
      coverageMonths: sortMonths(Array.from(sourceSummary?.coverageMonths ?? [])),
      totalConsumptionKbtu: sourceSummary ? sourceSummary.totalConsumptionKbtu : null,
      latestIngestedAt: toIso(sourceSummary?.latestIngestedAt),
      details: {
        referenceYear: input.referenceYear,
        meterName: input.meter.name,
      },
    });
  }

  const availableSources = sourceRecords
    .filter((record) => record.state === "AVAILABLE")
    .map((record) => record.sourceSystem);
  const canonicalSource = chooseCanonicalSource(availableSources);
  const conflicts: ReconciliationConflictSummary[] = [];

  const comparableSources = sourceRecords.filter(
    (record) =>
      record.state === "AVAILABLE" &&
      record.totalConsumptionKbtu != null &&
      record.sourceSystem !== "MANUAL",
  );

  for (let index = 0; index < comparableSources.length; index += 1) {
    for (let innerIndex = index + 1; innerIndex < comparableSources.length; innerIndex += 1) {
      const left = comparableSources[index]!;
      const right = comparableSources[innerIndex]!;
      if (
        left.coverageMonthCount === 0 ||
        !arraysEqual(left.coverageMonths, right.coverageMonths)
      ) {
        continue;
      }

      const delta = percentageDelta(
        left.totalConsumptionKbtu ?? 0,
        right.totalConsumptionKbtu ?? 0,
      );
      if (delta <= MISMATCH_THRESHOLD_RATIO) {
        continue;
      }

      conflicts.push({
        code: "CONSUMPTION_TOTAL_MISMATCH",
        severity: "BLOCKING",
        message: `Meter totals for ${input.meter.name} differ materially between ${left.sourceSystem.replaceAll("_", " ").toLowerCase()} and ${right.sourceSystem.replaceAll("_", " ").toLowerCase()} for ${input.referenceYear}.`,
        sourceSystems: [left.sourceSystem, right.sourceSystem],
        meterId: input.meter.id,
        meterName: input.meter.name,
      });
    }
  }

  const incompleteLinkage = sourceRecords.some((record) => record.state === "INCOMPLETE");
  if (availableSources.length === 0 || incompleteLinkage) {
    conflicts.push({
      code: "METER_LINKAGE_INCOMPLETE",
      severity: "WARNING",
      message:
        availableSources.length === 0
          ? `No governed source readings were available for meter ${input.meter.name} in ${input.referenceYear}.`
          : `Meter ${input.meter.name} has a source linkage without current-year governed readings.`,
      sourceSystems: sourceRecords
        .filter((record) => record.state !== "UNAVAILABLE")
        .map((record) => record.sourceSystem),
      meterId: input.meter.id,
      meterName: input.meter.name,
    });
  }

  const status: SourceReconciliationStatus =
    conflicts.some((conflict) => conflict.severity === "BLOCKING")
      ? "CONFLICTED"
      : conflicts.length > 0
        ? "INCOMPLETE"
        : "CLEAN";

  return {
    meterId: input.meter.id,
    meterName: input.meter.name,
    meterType: input.meter.meterType,
    unit: input.meter.unit,
    status,
    canonicalSource,
    coverageMonthCount: Math.max(
      ...sourceRecords.map((record) => record.coverageMonthCount),
      0,
    ),
    sourceRecords,
    conflicts,
    chosenValues: {
      selectionRule: "SOURCE_PRIORITY",
      canonicalUnit: input.meter.unit,
      selectionReason: sourceSelectionReason(canonicalSource),
    },
    lastReconciledAt: null,
  };
}

function buildBuildingSummary(input: {
  building: {
    id: string;
    name: string;
    address: string;
    espmPropertyId: bigint | null;
    espmShareStatus: string;
    greenButtonStatus: string;
    dataIngestionMethod: string;
    doeeBuildingId: string | null;
  };
  referenceYear: number;
  syncState: {
    id: string;
    status: string;
    lastSuccessfulSyncAt: Date | null;
    lastAttemptedSyncAt: Date | null;
  } | null;
  greenButtonConnection: {
    id: string;
    status: string;
    subscriptionId: string | null;
    resourceUri: string | null;
    connectedAt: Date;
    updatedAt: Date;
  } | null;
  buildingReadings: ReadingRecord[];
  meterSummaries: MeterSourceReconciliationSummary[];
}): ComputedBuildingSourceReconciliationSummary {
  const readingSources = summarizeReadingSources(input.buildingReadings);
  const sourceRecords: ReconciliationSourceRecordSummary[] = [];
  const conflicts: ReconciliationConflictSummary[] = [];

  const portfolioManagerSummary = readingSources.get("PORTFOLIO_MANAGER");
  sourceRecords.push({
    sourceSystem: "PORTFOLIO_MANAGER",
    state:
      input.building.espmPropertyId && input.building.espmShareStatus === "LINKED"
        ? "AVAILABLE"
        : input.building.espmPropertyId || input.syncState
          ? "INCOMPLETE"
          : "UNAVAILABLE",
    linkedRecordId: input.syncState?.id ?? null,
    externalRecordId: input.building.espmPropertyId?.toString() ?? null,
    readingCount: portfolioManagerSummary?.readingCount ?? 0,
    coverageMonthCount: portfolioManagerSummary?.coverageMonths.size ?? 0,
    coverageMonths: sortMonths(Array.from(portfolioManagerSummary?.coverageMonths ?? [])),
    totalConsumptionKbtu: portfolioManagerSummary?.totalConsumptionKbtu ?? null,
    latestIngestedAt: toIso(portfolioManagerSummary?.latestIngestedAt),
    details: {
      shareStatus: input.building.espmShareStatus,
      syncStatus: input.syncState?.status ?? null,
      lastSuccessfulSyncAt: toIso(input.syncState?.lastSuccessfulSyncAt),
      lastAttemptedSyncAt: toIso(input.syncState?.lastAttemptedSyncAt),
    },
  });

  if (input.building.espmPropertyId && input.building.espmShareStatus !== "LINKED") {
    conflicts.push({
      code: "BUILDING_LINKAGE_INCOMPLETE",
      severity: "WARNING",
      message: "Portfolio Manager linkage exists but the building is not in a linked sharing state.",
      sourceSystems: ["PORTFOLIO_MANAGER"],
      meterId: null,
      meterName: null,
    });
  }

  if (input.syncState?.status === "FAILED") {
    conflicts.push({
      code: "BUILDING_LINKAGE_INCOMPLETE",
      severity: "WARNING",
      message: "Portfolio Manager sync has failed and the canonical source state may be stale.",
      sourceSystems: ["PORTFOLIO_MANAGER"],
      meterId: null,
      meterName: null,
    });
  }

  const greenButtonSummary = readingSources.get("GREEN_BUTTON");
  sourceRecords.push({
    sourceSystem: "GREEN_BUTTON",
    state:
      input.greenButtonConnection && input.building.greenButtonStatus === "ACTIVE"
        ? "AVAILABLE"
        : input.greenButtonConnection || input.building.greenButtonStatus !== "NONE"
          ? "INCOMPLETE"
          : "UNAVAILABLE",
    linkedRecordId: input.greenButtonConnection?.id ?? null,
    externalRecordId: input.greenButtonConnection?.subscriptionId ?? null,
    readingCount: greenButtonSummary?.readingCount ?? 0,
    coverageMonthCount: greenButtonSummary?.coverageMonths.size ?? 0,
    coverageMonths: sortMonths(Array.from(greenButtonSummary?.coverageMonths ?? [])),
    totalConsumptionKbtu: greenButtonSummary?.totalConsumptionKbtu ?? null,
    latestIngestedAt: toIso(greenButtonSummary?.latestIngestedAt),
    details: {
      connectionStatus: input.greenButtonConnection?.status ?? null,
      buildingStatus: input.building.greenButtonStatus,
      resourceUriPresent: Boolean(input.greenButtonConnection?.resourceUri),
      connectedAt: toIso(input.greenButtonConnection?.connectedAt),
      updatedAt: toIso(input.greenButtonConnection?.updatedAt),
    },
  });

  if (
    Boolean(input.greenButtonConnection) !==
    (input.building.greenButtonStatus === "ACTIVE")
  ) {
    conflicts.push({
      code: "GREEN_BUTTON_LINKAGE_INCOMPLETE",
      severity: "WARNING",
      message:
        "Green Button building status and connection state do not currently match.",
      sourceSystems: ["GREEN_BUTTON"],
      meterId: null,
      meterName: null,
    });
  }

  const csvSummary = readingSources.get("CSV_UPLOAD");
  sourceRecords.push({
    sourceSystem: "CSV_UPLOAD",
    state: csvSummary ? "AVAILABLE" : "UNAVAILABLE",
    linkedRecordId: null,
    externalRecordId: null,
    readingCount: csvSummary?.readingCount ?? 0,
    coverageMonthCount: csvSummary?.coverageMonths.size ?? 0,
    coverageMonths: sortMonths(Array.from(csvSummary?.coverageMonths ?? [])),
    totalConsumptionKbtu: csvSummary?.totalConsumptionKbtu ?? null,
    latestIngestedAt: toIso(csvSummary?.latestIngestedAt),
    details: {
      dataIngestionMethod: input.building.dataIngestionMethod,
    },
  });

  const manualSummary = readingSources.get("MANUAL");
  sourceRecords.push({
    sourceSystem: "MANUAL",
    state: manualSummary ? "AVAILABLE" : "UNAVAILABLE",
    linkedRecordId: null,
    externalRecordId: null,
    readingCount: manualSummary?.readingCount ?? 0,
    coverageMonthCount: manualSummary?.coverageMonths.size ?? 0,
    coverageMonths: sortMonths(Array.from(manualSummary?.coverageMonths ?? [])),
    totalConsumptionKbtu: manualSummary?.totalConsumptionKbtu ?? null,
    latestIngestedAt: toIso(manualSummary?.latestIngestedAt),
    details: {},
  });

  for (const meterSummary of input.meterSummaries) {
    conflicts.push(...meterSummary.conflicts);
  }

  const availableSources = sourceRecords
    .filter((record) => record.state === "AVAILABLE" && record.readingCount > 0)
    .map((record) => record.sourceSystem);
  const canonicalSource = chooseCanonicalSource(availableSources);

  const comparableSourceRecords = sourceRecords.filter(
    (record) =>
      record.state === "AVAILABLE" &&
      record.totalConsumptionKbtu != null &&
      record.sourceSystem !== "MANUAL",
  );

  for (let index = 0; index < comparableSourceRecords.length; index += 1) {
    for (
      let innerIndex = index + 1;
      innerIndex < comparableSourceRecords.length;
      innerIndex += 1
    ) {
      const left = comparableSourceRecords[index]!;
      const right = comparableSourceRecords[innerIndex]!;
      if (
        left.coverageMonthCount === 0 ||
        !arraysEqual(left.coverageMonths, right.coverageMonths)
      ) {
        continue;
      }

      const delta = percentageDelta(
        left.totalConsumptionKbtu ?? 0,
        right.totalConsumptionKbtu ?? 0,
      );
      if (delta <= MISMATCH_THRESHOLD_RATIO) {
        continue;
      }

      conflicts.push({
        code: "CONSUMPTION_TOTAL_MISMATCH",
        severity: "BLOCKING",
        message: `Building source totals differ materially between ${left.sourceSystem.replaceAll("_", " ").toLowerCase()} and ${right.sourceSystem.replaceAll("_", " ").toLowerCase()} for ${input.referenceYear}.`,
        sourceSystems: [left.sourceSystem, right.sourceSystem],
        meterId: null,
        meterName: null,
      });
    }
  }

  if (availableSources.length === 0) {
    conflicts.push({
      code: "BUILDING_LINKAGE_INCOMPLETE",
      severity: "WARNING",
      message: `No governed source readings were available for ${input.referenceYear}.`,
      sourceSystems: sourceRecords
        .filter((record) => record.state !== "UNAVAILABLE")
        .map((record) => record.sourceSystem),
      meterId: null,
      meterName: null,
    });
  }

  const blockingCount = conflicts.filter((conflict) => conflict.severity === "BLOCKING").length;
  const incompleteCount = conflicts.length - blockingCount;
  const status: SourceReconciliationStatus =
    blockingCount > 0 ? "CONFLICTED" : incompleteCount > 0 ? "INCOMPLETE" : "CLEAN";

  return {
    status,
    canonicalSource,
    referenceYear: input.referenceYear,
    conflictCount: blockingCount,
    incompleteCount,
    sourceRecords,
    conflicts,
    chosenValues: {
      selectionRule: "SOURCE_PRIORITY",
      selectionReason: sourceSelectionReason(canonicalSource),
      coverageSummary: {
        totalReadings: input.buildingReadings.length,
        sourcesPresent: availableSources,
      },
    },
    meters: input.meterSummaries,
  };
}

function hydrateMeterSummary(row: PersistedMeterRow): MeterSourceReconciliationSummary {
  const chosenValues = toRecord(row.chosenValuesJson);

  return {
    meterId: row.meter.id,
    meterName: row.meter.name,
    meterType: row.meter.meterType,
    unit: row.meter.unit,
    status: row.status,
    canonicalSource: row.canonicalSource,
    coverageMonthCount:
      typeof chosenValues.coverageMonthCount === "number" ? chosenValues.coverageMonthCount : 0,
    sourceRecords: toArray<ReconciliationSourceRecordSummary>(row.sourceRecordsJson),
    conflicts: toArray<ReconciliationConflictSummary>(row.conflictsJson),
    chosenValues: {
      selectionRule: "SOURCE_PRIORITY",
      canonicalUnit:
        (chosenValues.canonicalUnit as EnergyUnit | undefined) ?? row.meter.unit,
      selectionReason:
        typeof chosenValues.selectionReason === "string"
          ? chosenValues.selectionReason
          : null,
    },
    lastReconciledAt: row.lastReconciledAt.toISOString(),
  };
}

function hydrateBuildingSummary(
  row: PersistedBuildingRow,
  meters: PersistedMeterRow[],
): BuildingSourceReconciliationSummary {
  const chosenValues = toRecord(row.chosenValuesJson);
  const coverageSummary = toRecord(chosenValues.coverageSummary);

  return {
    id: row.id,
    status: row.status,
    canonicalSource: row.canonicalSource,
    referenceYear: row.referenceYear,
    conflictCount: row.conflictCount,
    incompleteCount: row.incompleteCount,
    lastReconciledAt: row.lastReconciledAt.toISOString(),
    sourceRecords: toArray<ReconciliationSourceRecordSummary>(row.sourceRecordsJson),
    conflicts: toArray<ReconciliationConflictSummary>(row.conflictsJson),
    chosenValues: {
      selectionRule: "SOURCE_PRIORITY",
      selectionReason:
        typeof chosenValues.selectionReason === "string"
          ? chosenValues.selectionReason
          : null,
      coverageSummary: {
        totalReadings:
          typeof coverageSummary.totalReadings === "number"
            ? coverageSummary.totalReadings
            : 0,
        sourcesPresent: toArray<CanonicalSourceSystem>(coverageSummary.sourcesPresent),
      },
    },
    meters: meters.map(hydrateMeterSummary),
  };
}

function toOverview(
  summary: BuildingSourceReconciliationSummary | null,
): BuildingSourceReconciliationOverview {
  return {
    id: summary?.id ?? null,
    status: summary?.status ?? null,
    canonicalSource: summary?.canonicalSource ?? null,
    referenceYear: summary?.referenceYear ?? null,
    conflictCount: summary?.conflictCount ?? 0,
    incompleteCount: summary?.incompleteCount ?? 0,
    lastReconciledAt: summary?.lastReconciledAt ?? null,
  };
}

async function resolveReferenceYear(params: {
  organizationId: string;
  buildingId: string;
  referenceYear?: number;
  now?: Date;
}) {
  if (params.referenceYear != null) {
    return params.referenceYear;
  }

  const [benchmarkSubmission, latestReading] = await Promise.all([
    prisma.benchmarkSubmission.findFirst({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
      },
      orderBy: [{ reportingYear: "desc" }, { updatedAt: "desc" }],
      select: { reportingYear: true },
    }),
    prisma.energyReading.findFirst({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        archivedAt: null,
      },
      orderBy: [{ periodStart: "desc" }, { ingestedAt: "desc" }],
      select: { periodStart: true },
    }),
  ]);

  if (benchmarkSubmission?.reportingYear != null) {
    return benchmarkSubmission.reportingYear;
  }

  if (latestReading?.periodStart) {
    return latestReading.periodStart.getUTCFullYear();
  }

  return defaultReferenceYear(params.now);
}

export async function refreshBuildingSourceReconciliation(params: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  referenceYear?: number;
  now?: Date;
}): Promise<BuildingSourceReconciliationSummary> {
  const now = params.now ?? new Date();
  const logger = createLogger({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    requestId: params.requestId ?? null,
    procedure: "sourceReconciliation.refresh",
  });

  const referenceYear = await resolveReferenceYear({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    referenceYear: params.referenceYear,
    now,
  });
  const periodStart = startOfUtcYear(referenceYear);
  const periodEnd = startOfNextUtcYear(referenceYear);

  const [building, syncState, greenButtonConnection, meters, readings, existingRow] =
    await Promise.all([
      prisma.building.findFirst({
        where: {
          id: params.buildingId,
          organizationId: params.organizationId,
        },
        select: {
          id: true,
          name: true,
          address: true,
          espmPropertyId: true,
          espmShareStatus: true,
          greenButtonStatus: true,
          dataIngestionMethod: true,
          doeeBuildingId: true,
        },
      }),
      prisma.portfolioManagerSyncState.findUnique({
        where: { buildingId: params.buildingId },
        select: {
          id: true,
          status: true,
          lastSuccessfulSyncAt: true,
          lastAttemptedSyncAt: true,
        },
      }),
      prisma.greenButtonConnection.findUnique({
        where: { buildingId: params.buildingId },
        select: {
          id: true,
          status: true,
          subscriptionId: true,
          resourceUri: true,
          connectedAt: true,
          updatedAt: true,
        },
      }),
      prisma.meter.findMany({
        where: {
          organizationId: params.organizationId,
          buildingId: params.buildingId,
        },
        orderBy: [{ meterType: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          meterType: true,
          unit: true,
          espmMeterId: true,
        },
      }),
      prisma.energyReading.findMany({
        where: {
          organizationId: params.organizationId,
          buildingId: params.buildingId,
          archivedAt: null,
          periodStart: {
            gte: periodStart,
            lt: periodEnd,
          },
        },
        orderBy: [{ periodStart: "asc" }, { ingestedAt: "desc" }],
        select: {
          id: true,
          source: true,
          meterId: true,
          meterType: true,
          unit: true,
          periodStart: true,
          periodEnd: true,
          consumptionKbtu: true,
          ingestedAt: true,
          rawPayload: true,
        },
      }),
      prisma.buildingSourceReconciliation.findUnique({
        where: { buildingId: params.buildingId },
        select: {
          id: true,
          status: true,
          canonicalSource: true,
          conflictCount: true,
          incompleteCount: true,
          lastReconciledAt: true,
        },
      }),
    ]);

  if (!building) {
    throw new NotFoundError("Building not found");
  }

  const readingsByMeterId = new Map<string, ReadingRecord[]>();
  for (const reading of readings as ReadingRecord[]) {
    if (!reading.meterId) {
      continue;
    }
    const existing = readingsByMeterId.get(reading.meterId) ?? [];
    existing.push(reading);
    readingsByMeterId.set(reading.meterId, existing);
  }

  const meterSummaries = meters.map((meter) =>
    buildMeterSummary({
      meter,
      readings: readingsByMeterId.get(meter.id) ?? [],
      referenceYear,
    }),
  );

  const summaryWithoutPersistence = buildBuildingSummary({
    building,
    referenceYear,
    syncState,
    greenButtonConnection,
    buildingReadings: readings as ReadingRecord[],
    meterSummaries,
  });

  const persisted = await prisma.$transaction(async (tx) => {
    const buildingRow = await tx.buildingSourceReconciliation.upsert({
      where: {
        buildingId: params.buildingId,
      },
      create: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        status: summaryWithoutPersistence.status,
        canonicalSource: summaryWithoutPersistence.canonicalSource,
        referenceYear,
        conflictCount: summaryWithoutPersistence.conflictCount,
        incompleteCount: summaryWithoutPersistence.incompleteCount,
        sourceRecordsJson: toJson(summaryWithoutPersistence.sourceRecords),
        conflictsJson: toJson(summaryWithoutPersistence.conflicts),
        chosenValuesJson: toJson(summaryWithoutPersistence.chosenValues),
        lastReconciledAt: now,
        reconciledByType: params.actorType,
        reconciledById: params.actorId ?? null,
      },
      update: {
        status: summaryWithoutPersistence.status,
        canonicalSource: summaryWithoutPersistence.canonicalSource,
        referenceYear,
        conflictCount: summaryWithoutPersistence.conflictCount,
        incompleteCount: summaryWithoutPersistence.incompleteCount,
        sourceRecordsJson: toJson(summaryWithoutPersistence.sourceRecords),
        conflictsJson: toJson(summaryWithoutPersistence.conflicts),
        chosenValuesJson: toJson(summaryWithoutPersistence.chosenValues),
        lastReconciledAt: now,
        reconciledByType: params.actorType,
        reconciledById: params.actorId ?? null,
      },
      select: {
        id: true,
        status: true,
        canonicalSource: true,
        referenceYear: true,
        conflictCount: true,
        incompleteCount: true,
        sourceRecordsJson: true,
        conflictsJson: true,
        chosenValuesJson: true,
        lastReconciledAt: true,
      },
    });

    for (const meterSummary of meterSummaries) {
      const meter = meters.find((candidate) => candidate.id === meterSummary.meterId);
      if (!meter) {
        continue;
      }

      await tx.meterSourceReconciliation.upsert({
        where: {
          meterId: meterSummary.meterId,
        },
        create: {
          organizationId: params.organizationId,
          buildingId: params.buildingId,
          meterId: meterSummary.meterId,
          buildingSourceReconciliationId: buildingRow.id,
          status: meterSummary.status,
          canonicalSource: meterSummary.canonicalSource,
          conflictCount: meterSummary.conflicts.filter(
            (conflict) => conflict.severity === "BLOCKING",
          ).length,
          sourceRecordsJson: toJson(meterSummary.sourceRecords),
          conflictsJson: toJson(meterSummary.conflicts),
          chosenValuesJson: toJson({
            ...meterSummary.chosenValues,
            coverageMonthCount: meterSummary.coverageMonthCount,
          }),
          lastReconciledAt: now,
          reconciledByType: params.actorType,
          reconciledById: params.actorId ?? null,
        },
        update: {
          buildingSourceReconciliationId: buildingRow.id,
          status: meterSummary.status,
          canonicalSource: meterSummary.canonicalSource,
          conflictCount: meterSummary.conflicts.filter(
            (conflict) => conflict.severity === "BLOCKING",
          ).length,
          sourceRecordsJson: toJson(meterSummary.sourceRecords),
          conflictsJson: toJson(meterSummary.conflicts),
          chosenValuesJson: toJson({
            ...meterSummary.chosenValues,
            coverageMonthCount: meterSummary.coverageMonthCount,
          }),
          lastReconciledAt: now,
          reconciledByType: params.actorType,
          reconciledById: params.actorId ?? null,
        },
      });
    }

    await tx.meterSourceReconciliation.deleteMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        meterId: {
          notIn: meters.map((meter) => meter.id),
        },
      },
    });

    const meterRows = await tx.meterSourceReconciliation.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
      },
      orderBy: [{ meter: { meterType: "asc" } }, { meter: { name: "asc" } }],
      select: {
        meterId: true,
        meter: {
          select: {
            id: true,
            name: true,
            meterType: true,
            unit: true,
          },
        },
        status: true,
        canonicalSource: true,
        sourceRecordsJson: true,
        conflictsJson: true,
        chosenValuesJson: true,
        lastReconciledAt: true,
      },
    });

    return hydrateBuildingSummary(buildingRow, meterRows);
  });

  await createAuditLog({
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    requestId: params.requestId ?? null,
    action: "source_reconciliation.refreshed",
    inputSnapshot: {
      referenceYear,
    },
    outputSnapshot: {
      status: persisted.status,
      canonicalSource: persisted.canonicalSource,
      conflictCount: persisted.conflictCount,
      incompleteCount: persisted.incompleteCount,
      meterCount: persisted.meters.length,
    },
  }).catch((error) => {
    logger.error("Source reconciliation audit persistence failed", {
      error,
    });
    return null;
  });

  const materiallyChanged =
    existingRow == null ||
    existingRow.status !== persisted.status ||
    existingRow.canonicalSource !== persisted.canonicalSource ||
    existingRow.conflictCount !== persisted.conflictCount ||
    existingRow.incompleteCount !== persisted.incompleteCount;

  if (materiallyChanged) {
    await createAuditLog({
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      requestId: params.requestId ?? null,
      action: "source_reconciliation.changed",
      inputSnapshot: {
        previousStatus: existingRow?.status ?? null,
        previousCanonicalSource: existingRow?.canonicalSource ?? null,
        previousConflictCount: existingRow?.conflictCount ?? 0,
        previousIncompleteCount: existingRow?.incompleteCount ?? 0,
      },
      outputSnapshot: {
        nextStatus: persisted.status,
        nextCanonicalSource: persisted.canonicalSource,
        nextConflictCount: persisted.conflictCount,
        nextIncompleteCount: persisted.incompleteCount,
      },
    }).catch((error) => {
      logger.error("Source reconciliation change audit persistence failed", {
        error,
      });
      return null;
    });
  }

  return persisted;
}

export async function getBuildingSourceReconciliationSummary(params: {
  organizationId: string;
  buildingId: string;
  referenceYear?: number;
  refreshIfMissing?: boolean;
}) {
  const building = await prisma.building.findFirst({
    where: {
      id: params.buildingId,
      organizationId: params.organizationId,
    },
    select: { id: true },
  });

  if (!building) {
    throw new NotFoundError("Building not found");
  }

  const buildingRow = await prisma.buildingSourceReconciliation.findUnique({
    where: {
      buildingId: params.buildingId,
    },
    select: {
      id: true,
      status: true,
      canonicalSource: true,
      referenceYear: true,
      conflictCount: true,
      incompleteCount: true,
      sourceRecordsJson: true,
      conflictsJson: true,
      chosenValuesJson: true,
      lastReconciledAt: true,
    },
  });

  if (!buildingRow && params.refreshIfMissing !== false) {
    return refreshBuildingSourceReconciliation({
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      actorType: "SYSTEM",
      actorId: null,
      requestId: null,
      referenceYear: params.referenceYear,
    });
  }

  if (
    buildingRow &&
    params.referenceYear != null &&
    buildingRow.referenceYear !== params.referenceYear
  ) {
    return refreshBuildingSourceReconciliation({
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      actorType: "SYSTEM",
      actorId: null,
      requestId: null,
      referenceYear: params.referenceYear,
    });
  }

  if (!buildingRow) {
    return null;
  }

  const meterRows = await prisma.meterSourceReconciliation.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    },
    orderBy: [{ meter: { meterType: "asc" } }, { meter: { name: "asc" } }],
    select: {
      meterId: true,
      meter: {
        select: {
          id: true,
          name: true,
          meterType: true,
          unit: true,
        },
      },
      status: true,
      canonicalSource: true,
      sourceRecordsJson: true,
      conflictsJson: true,
      chosenValuesJson: true,
      lastReconciledAt: true,
    },
  });

  return hydrateBuildingSummary(buildingRow, meterRows);
}

export async function listBuildingSourceReconciliationOverviews(params: {
  organizationId: string;
  buildingIds: string[];
}) {
  const buildingIds = Array.from(new Set(params.buildingIds)).filter(Boolean);

  if (buildingIds.length === 0) {
    return new Map<string, BuildingSourceReconciliationOverview>();
  }

  const rows = await prisma.buildingSourceReconciliation.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: {
        in: buildingIds,
      },
    },
    select: {
      id: true,
      buildingId: true,
      status: true,
      canonicalSource: true,
      referenceYear: true,
      conflictCount: true,
      incompleteCount: true,
      lastReconciledAt: true,
    },
  });

  const byBuildingId = new Map<string, BuildingSourceReconciliationOverview>();
  for (const row of rows) {
    byBuildingId.set(row.buildingId, {
      id: row.id,
      status: row.status,
      canonicalSource: row.canonicalSource,
      referenceYear: row.referenceYear,
      conflictCount: row.conflictCount,
      incompleteCount: row.incompleteCount,
      lastReconciledAt: row.lastReconciledAt.toISOString(),
    });
  }

  for (const buildingId of buildingIds) {
    if (!byBuildingId.has(buildingId)) {
      byBuildingId.set(buildingId, toOverview(null));
    }
  }

  return byBuildingId;
}

export function toBuildingSourceReconciliationOverview(
  summary: BuildingSourceReconciliationSummary | null,
) {
  return toOverview(summary);
}
