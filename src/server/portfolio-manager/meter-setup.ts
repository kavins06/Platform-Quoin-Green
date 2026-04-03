import type { PrismaClient } from "@/generated/prisma";
import {
  EnergyUnit,
  MeterType,
  PortfolioManagerManagementMode,
  PortfolioManagerMeterLinkStrategy,
  PortfolioManagerSetupComponentStatus,
  PortfolioManagerSetupStatus,
  type ActorType,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import { ValidationError, WorkflowStateError } from "@/server/lib/errors";
import { createJob, JOB_STATUS, markDead } from "@/server/lib/jobs";
import { QUEUES, withQueue } from "@/server/lib/queue";
import type { ESPM } from "@/server/integrations/espm";
import { resolvePortfolioManagerClientForOrganization } from "@/server/portfolio-manager/existing-account";
import {
  buildPortfolioManagerMeterSetupEnvelope,
  PM_METER_SETUP_JOB_TYPE,
} from "@/server/pipelines/portfolio-manager-meter-setup/envelope";
import {
  loadRemotePropertyMeterSnapshot,
  type RemoteMeterAccessSummary,
  type RemoteMeterRecord,
} from "@/server/portfolio-manager/remote-meter-state";
import {
  derivePortfolioManagerOverallSetupStatus,
  derivePortfolioManagerSetupSummary,
} from "@/server/portfolio-manager/setup-summary";
import {
  classifyPortfolioManagerUnitCompatibility,
  defaultRawMeterTypeForMeterType,
  getPortfolioManagerMeterCreationDefinition,
} from "@/server/portfolio-manager/unit-catalog";
import { withAdvisoryTransactionLock } from "@/server/lib/transaction-lock";

const PORTFOLIO_MANAGER_METER_SETUP_JOB_TYPE = "PORTFOLIO_MANAGER_METER_SETUP";
const PORTFOLIO_MANAGER_METER_ASSOCIATION_JOB_TYPE =
  "PORTFOLIO_MANAGER_METER_ASSOCIATION";

type SetupStateRecord = Awaited<
  ReturnType<typeof prisma.portfolioManagerSetupState.findUnique>
>;

type MeterRecord = Awaited<
  ReturnType<typeof prisma.meter.findMany>
>[number];

type MeterLinkStateRecord = Awaited<
  ReturnType<typeof prisma.portfolioManagerMeterLinkState.findMany>
>[number];

type MeterSetupContext = {
  building: {
    id: string;
    organizationId: string;
    name: string;
    propertyType: "OFFICE" | "MULTIFAMILY" | "MIXED_USE" | "OTHER";
    grossSquareFeet: number;
    espmPropertyId: bigint | null;
    espmShareStatus: string | null;
  };
  managementMode: PortfolioManagerManagementMode | null;
  setupState: SetupStateRecord;
  meters: MeterRecord[];
  meterLinkStates: MeterLinkStateRecord[];
};

type EvaluatedMeterComponents = {
  metersStatus: PortfolioManagerSetupComponentStatus;
  associationsStatus: PortfolioManagerSetupComponentStatus;
  missingInputCodes: string[];
};

type LocalMeterStrategyInput = {
  meterId: string;
  strategy: "LINK_EXISTING_REMOTE" | "CREATE_REMOTE";
  selectedRemoteMeterId?: string | null;
};

type MeterSetupSnapshot = {
  managementMode: PortfolioManagerManagementMode | null;
  setupState: {
    status: PortfolioManagerSetupStatus;
    propertyUsesStatus: PortfolioManagerSetupComponentStatus;
    metersStatus: PortfolioManagerSetupComponentStatus;
    associationsStatus: PortfolioManagerSetupComponentStatus;
    usageCoverageStatus: PortfolioManagerSetupComponentStatus;
    latestJobId: string | null;
    latestErrorCode: string | null;
    latestErrorMessage: string | null;
    summaryState:
      | "SETUP_INCOMPLETE"
      | "READY_FOR_NEXT_STEP"
      | "NEEDS_ATTENTION"
      | "BENCHMARK_READY";
    summaryLine: string;
    canApplyMeters: boolean;
    canApplyAssociations: boolean;
  };
  localMeters: Array<{
    id: string;
    name: string;
    meterType: MeterType;
    unit: EnergyUnit;
    isActive: boolean;
    espmMeterId: string | null;
    strategy: PortfolioManagerMeterLinkStrategy | null;
    selectedRemoteMeterId: string | null;
    suggestedRemoteMeterId: string | null;
    meterStatus: PortfolioManagerSetupComponentStatus;
    associationStatus: PortfolioManagerSetupComponentStatus;
    latestErrorMessage: string | null;
    canCreateRemote: boolean;
    createBlockedReason: string | null;
  }>;
  remoteMeters: Array<{
    meterId: string;
    name: string;
    meterType: MeterType;
    unit: EnergyUnit;
    inUse: boolean;
    alreadyLinkedLocally: boolean;
    linkedLocalMeterId: string | null;
    alreadyAssociated: boolean;
    canImport: boolean;
    importBlockedReason: string | null;
    suggestedForLocalMeterId: string | null;
    rawType: string | null;
    rawUnitOfMeasure: string | null;
    unitCompatibilityStatus: "EXACT" | "SUPPORTED_CONVERSION" | "UNSUPPORTED";
    unitCompatibilityReason: string | null;
    compatibleLocalMeterIds: string[];
  }>;
  remoteMeterAccess: RemoteMeterAccessSummary;
};

function toStringId(value: bigint | number | string | null | undefined) {
  if (value == null) {
    return null;
  }

  return String(value);
}

function normalizeMeterName(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractCreatedEntityId(response: unknown) {
  const record =
    response && typeof response === "object" && !Array.isArray(response)
      ? (response as Record<string, unknown>)
      : null;
  const nested =
    record?.response && typeof record.response === "object"
      ? (record.response as Record<string, unknown>)
      : null;
  const candidate = nested?.id;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate === "string" && candidate.trim()) {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function supportsManagedMeterCreation(meterType: MeterType, unit: EnergyUnit) {
  return (
    defaultRawMeterTypeForMeterType(meterType) != null &&
    getPortfolioManagerMeterCreationDefinition({ meterType, unit }) != null
  );
}

async function loadSetupContext(input: {
  organizationId: string;
  buildingId: string;
  db?: PrismaClient;
}): Promise<MeterSetupContext> {
  const db = input.db ?? prisma;
  const [building, management, setupState, meters, meterLinkStates] = await Promise.all([
    db.building.findUnique({
      where: { id: input.buildingId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        propertyType: true,
        grossSquareFeet: true,
        espmPropertyId: true,
        espmShareStatus: true,
      },
    }),
    db.portfolioManagerManagement.findUnique({
      where: { organizationId: input.organizationId },
      select: { managementMode: true },
    }),
    db.portfolioManagerSetupState.findUnique({
      where: { buildingId: input.buildingId },
    }),
    db.meter.findMany({
      where: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
      },
      orderBy: [{ createdAt: "asc" }],
    }),
    db.portfolioManagerMeterLinkState.findMany({
      where: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
  ]);

  if (!building) {
    throw new ValidationError("Building not found for Portfolio Manager meter setup.");
  }

  if (building.organizationId !== input.organizationId) {
    throw new ValidationError("Building is not accessible in this organization.");
  }

  return {
    building,
    managementMode: management?.managementMode ?? null,
    setupState,
    meters,
    meterLinkStates,
  };
}

function isCompatibleMeterMapping(input: {
  localMeter: Pick<MeterRecord, "meterType" | "unit" | "name">;
  remoteMeter: Pick<RemoteMeterRecord, "meterType" | "name" | "rawType" | "rawUnitOfMeasure">;
}) {
  const compatibility = classifyPortfolioManagerUnitCompatibility({
    localMeterType: input.localMeter.meterType,
    localUnit: input.localMeter.unit,
    rawRemoteType: input.remoteMeter.rawType,
    rawRemoteUnitOfMeasure: input.remoteMeter.rawUnitOfMeasure,
  });

  return (
    compatibility.status !== "UNSUPPORTED" &&
    normalizeMeterName(input.localMeter.name) === normalizeMeterName(input.remoteMeter.name)
  );
}

function getSafeSuggestion(input: {
  localMeter: MeterRecord;
  remoteMeters: RemoteMeterRecord[];
  linkedRemoteMeterIds: Set<string>;
}) {
  const candidates = input.remoteMeters.filter(
    (remoteMeter) =>
      !input.linkedRemoteMeterIds.has(String(remoteMeter.meterId)) &&
      isCompatibleMeterMapping({
        localMeter: input.localMeter,
        remoteMeter,
      }),
  );

  return candidates.length === 1 ? String(candidates[0]!.meterId) : null;
}

function getRemoteMeterImportAssessment(remoteMeter: RemoteMeterRecord) {
  const compatibility = classifyPortfolioManagerUnitCompatibility({
    localMeterType: remoteMeter.meterType,
    localUnit: remoteMeter.unit,
    rawRemoteType: remoteMeter.rawType,
    rawRemoteUnitOfMeasure: remoteMeter.rawUnitOfMeasure,
  });

  return {
    canImport: compatibility.status !== "UNSUPPORTED",
    blockedReason:
      compatibility.status === "UNSUPPORTED"
        ? compatibility.reason ?? "This PM meter unit is not supported for safe import in Quoin."
        : null,
    compatibilityStatus: compatibility.status,
    compatibilityReason: compatibility.reason,
  };
}

function getCreateBlockedReason(input: {
  managementMode: PortfolioManagerManagementMode | null;
  meter: MeterRecord;
}) {
  if (input.managementMode !== "QUOIN_MANAGED") {
    return "Remote meter creation is only available for Quoin-managed PM buildings.";
  }

  if (input.meter.meterType === "STEAM") {
    return "Steam meter creation needs manual PM review in this phase.";
  }

  if (input.meter.meterType === "OTHER") {
    return "Unsupported meter type needs manual PM review.";
  }

  if (!supportsManagedMeterCreation(input.meter.meterType, input.meter.unit)) {
    return "Meter unit is not supported for safe PM creation in this phase.";
  }

  return null;
}

function sourceMatchesCanonicalSource(
  source: "GREEN_BUTTON" | "CSV_UPLOAD" | "BILL_UPLOAD" | "ESPM_SYNC" | "MANUAL",
  canonicalSource: "PORTFOLIO_MANAGER" | "GREEN_BUTTON" | "CSV_UPLOAD" | "MANUAL",
) {
  switch (canonicalSource) {
    case "PORTFOLIO_MANAGER":
      return source === "ESPM_SYNC";
    case "GREEN_BUTTON":
      return source === "GREEN_BUTTON";
    case "MANUAL":
      return source === "MANUAL";
    default:
      return source === "CSV_UPLOAD" || source === "BILL_UPLOAD";
  }
}

async function getFirstBillDateForMeter(input: {
  organizationId: string;
  meter: MeterRecord;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const reconciliation = await db.meterSourceReconciliation.findUnique({
    where: { meterId: input.meter.id },
    select: {
      canonicalSource: true,
    },
  });

  if (reconciliation?.canonicalSource && reconciliation.canonicalSource !== "PORTFOLIO_MANAGER") {
    const canonicalReading = await db.energyReading.findFirst({
      where: {
        organizationId: input.organizationId,
        meterId: input.meter.id,
        source: {
          in: ["GREEN_BUTTON", "CSV_UPLOAD", "BILL_UPLOAD", "MANUAL", "ESPM_SYNC"],
        },
      },
      orderBy: [{ periodStart: "asc" }, { ingestedAt: "asc" }, { id: "asc" }],
      select: {
        periodStart: true,
        source: true,
      },
    });

    if (
      canonicalReading &&
      sourceMatchesCanonicalSource(canonicalReading.source, reconciliation.canonicalSource)
    ) {
      return canonicalReading.periodStart.toISOString().slice(0, 10);
    }

    const canonicalMatching = await db.energyReading.findFirst({
      where: {
        organizationId: input.organizationId,
        meterId: input.meter.id,
        source:
          reconciliation.canonicalSource === "CSV_UPLOAD"
            ? { in: ["CSV_UPLOAD", "BILL_UPLOAD"] }
            : reconciliation.canonicalSource === "GREEN_BUTTON"
              ? "GREEN_BUTTON"
              : reconciliation.canonicalSource === "MANUAL"
                ? "MANUAL"
                : "ESPM_SYNC",
      },
      orderBy: [{ periodStart: "asc" }, { ingestedAt: "asc" }, { id: "asc" }],
      select: { periodStart: true },
    });

    if (canonicalMatching) {
      return canonicalMatching.periodStart.toISOString().slice(0, 10);
    }
  }

  const earliestLocalReading = await db.energyReading.findFirst({
    where: {
      organizationId: input.organizationId,
      meterId: input.meter.id,
      source: { not: "ESPM_SYNC" },
    },
    orderBy: [{ periodStart: "asc" }, { ingestedAt: "asc" }, { id: "asc" }],
    select: { periodStart: true },
  });

  if (earliestLocalReading) {
    return earliestLocalReading.periodStart.toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

function evaluatePortfolioManagerMeterComponents(input: {
  building: MeterSetupContext["building"];
  propertyUsesStatus: PortfolioManagerSetupComponentStatus;
  setupState: SetupStateRecord;
  meters: MeterRecord[];
  meterLinkStates: MeterLinkStateRecord[];
  remoteMeterAccess?: RemoteMeterAccessSummary | null;
}): EvaluatedMeterComponents {
  if (input.building.espmPropertyId == null || input.building.espmShareStatus !== "LINKED") {
    return {
      metersStatus: PortfolioManagerSetupComponentStatus.NOT_STARTED,
      associationsStatus: PortfolioManagerSetupComponentStatus.NOT_STARTED,
      missingInputCodes: ["PM_LINKAGE_REQUIRED"],
    };
  }

  if (input.propertyUsesStatus !== "APPLIED") {
    return {
      metersStatus: PortfolioManagerSetupComponentStatus.NOT_STARTED,
      associationsStatus: PortfolioManagerSetupComponentStatus.NOT_STARTED,
      missingInputCodes: ["PM_PROPERTY_USES_REQUIRED"],
    };
  }

  if (input.remoteMeterAccess && !input.remoteMeterAccess.canProceed) {
    return {
      metersStatus: PortfolioManagerSetupComponentStatus.NEEDS_ATTENTION,
      associationsStatus: PortfolioManagerSetupComponentStatus.NOT_STARTED,
      missingInputCodes: ["PM_METER_REMOTE_ACCESS_INCOMPLETE"],
    };
  }

  const activeMeters = input.meters.filter((meter) => meter.isActive);
  const linkByMeterId = new Map(input.meterLinkStates.map((item) => [item.meterId, item]));
  const missingInputCodes: string[] = [];

  if (activeMeters.length === 0) {
    missingInputCodes.push("PM_METER_SETUP_REQUIRED");
    return {
      metersStatus: PortfolioManagerSetupComponentStatus.INPUT_REQUIRED,
      associationsStatus: PortfolioManagerSetupComponentStatus.NOT_STARTED,
      missingInputCodes,
    };
  }

  const remoteUsageCounts = new Map<string, number>();
  let unresolvedMeterSetup = false;
  let needsAttention = false;

  for (const meter of activeMeters) {
    if (meter.espmMeterId != null) {
      const key = meter.espmMeterId.toString();
      remoteUsageCounts.set(key, (remoteUsageCounts.get(key) ?? 0) + 1);
    }

    const linkState = linkByMeterId.get(meter.id);
    if (linkState?.meterStatus === "NEEDS_ATTENTION") {
      needsAttention = true;
    }

    if (meter.espmMeterId == null) {
      if (!linkState) {
        unresolvedMeterSetup = true;
      } else if (
        linkState.strategy === "CREATE_REMOTE" ||
        linkState.strategy === "LINK_EXISTING_REMOTE" ||
        linkState.strategy === "IMPORT_REMOTE_AS_LOCAL"
      ) {
        if (
          linkState.strategy === "LINK_EXISTING_REMOTE" &&
          linkState.selectedRemoteMeterId == null
        ) {
          unresolvedMeterSetup = true;
        }
      } else {
        unresolvedMeterSetup = true;
      }
    }
  }

  if (Array.from(remoteUsageCounts.values()).some((count) => count > 1)) {
    needsAttention = true;
    missingInputCodes.push("PM_METER_REMOTE_CONFLICT");
  }

  const allMetersLinked = activeMeters.every((meter) => meter.espmMeterId != null);
  const anyAssociationAttention = activeMeters.some((meter) => {
    const linkState = linkByMeterId.get(meter.id);
    return linkState?.associationStatus === "NEEDS_ATTENTION";
  });

  const allAssociationsApplied =
    allMetersLinked &&
    activeMeters.every((meter) => {
      const linkState = linkByMeterId.get(meter.id);
      return linkState?.associationStatus === "APPLIED";
    });

  if (needsAttention) {
    if (!missingInputCodes.includes("PM_METER_REMOTE_CONFLICT")) {
      missingInputCodes.push("PM_METER_REMOTE_CONFLICT");
    }
    return {
      metersStatus: PortfolioManagerSetupComponentStatus.NEEDS_ATTENTION,
      associationsStatus: anyAssociationAttention
        ? PortfolioManagerSetupComponentStatus.NEEDS_ATTENTION
        : allMetersLinked
          ? PortfolioManagerSetupComponentStatus.READY_TO_APPLY
          : PortfolioManagerSetupComponentStatus.NOT_STARTED,
      missingInputCodes,
    };
  }

  if (!allMetersLinked) {
    return {
      metersStatus: unresolvedMeterSetup
        ? PortfolioManagerSetupComponentStatus.INPUT_REQUIRED
        : PortfolioManagerSetupComponentStatus.READY_TO_APPLY,
      associationsStatus: PortfolioManagerSetupComponentStatus.NOT_STARTED,
      missingInputCodes:
        unresolvedMeterSetup && !missingInputCodes.includes("PM_METER_SETUP_REQUIRED")
          ? [...missingInputCodes, "PM_METER_SETUP_REQUIRED"]
          : missingInputCodes,
    };
  }

  if (anyAssociationAttention) {
    return {
      metersStatus: PortfolioManagerSetupComponentStatus.APPLIED,
      associationsStatus: PortfolioManagerSetupComponentStatus.NEEDS_ATTENTION,
      missingInputCodes: [...missingInputCodes, "PM_METER_REMOTE_CONFLICT"],
    };
  }

  return {
    metersStatus: PortfolioManagerSetupComponentStatus.APPLIED,
    associationsStatus: allAssociationsApplied
      ? PortfolioManagerSetupComponentStatus.APPLIED
      : PortfolioManagerSetupComponentStatus.READY_TO_APPLY,
    missingInputCodes:
      allAssociationsApplied
        ? missingInputCodes
        : [...missingInputCodes, "PM_METER_ASSOCIATIONS_REQUIRED"],
  };
}

async function syncSetupStateFromMeterState(input: {
  organizationId: string;
  buildingId: string;
  remoteMeterAccess?: RemoteMeterAccessSummary | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const propertyUsesStatus =
    context.setupState?.propertyUsesStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED;
  const usageCoverageStatus =
    context.setupState?.usageCoverageStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED;
  const evaluated = evaluatePortfolioManagerMeterComponents({
    building: context.building,
    propertyUsesStatus,
    setupState: context.setupState,
    meters: context.meters,
    meterLinkStates: context.meterLinkStates,
    remoteMeterAccess: input.remoteMeterAccess ?? null,
  });
  const latestErrorMessage =
    input.remoteMeterAccess?.warning != null
      ? null
      : context.setupState?.latestErrorMessage ?? null;
  const latestErrorCode =
    input.remoteMeterAccess?.warning != null
      ? null
      : context.setupState?.latestErrorCode ?? null;
  const status =
    latestErrorMessage ||
    evaluated.metersStatus === "NEEDS_ATTENTION" ||
    evaluated.associationsStatus === "NEEDS_ATTENTION"
      ? PortfolioManagerSetupStatus.NEEDS_ATTENTION
      : derivePortfolioManagerOverallSetupStatus({
          propertyUsesStatus,
          metersStatus: evaluated.metersStatus,
          associationsStatus: evaluated.associationsStatus,
          usageCoverageStatus,
        });
  const summary = derivePortfolioManagerSetupSummary({
    status,
    propertyUsesStatus,
    metersStatus: evaluated.metersStatus,
    associationsStatus: evaluated.associationsStatus,
    usageCoverageStatus,
    missingInputCodes: evaluated.missingInputCodes,
    latestErrorMessage,
  });

  await db.portfolioManagerSetupState.upsert({
    where: { buildingId: input.buildingId },
    create: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      status,
      propertyUsesStatus,
      metersStatus: evaluated.metersStatus,
      associationsStatus: evaluated.associationsStatus,
      usageCoverageStatus,
      latestJobId: context.setupState?.latestJobId ?? null,
      attemptCount: context.setupState?.attemptCount ?? 0,
      latestErrorCode,
      latestErrorMessage,
      missingInputCodesJson: evaluated.missingInputCodes,
      lastAppliedAt: context.setupState?.lastAppliedAt ?? null,
      lastAttemptedAt: context.setupState?.lastAttemptedAt ?? null,
      lastFailedAt: context.setupState?.lastFailedAt ?? null,
    },
    update: {
      status,
      propertyUsesStatus,
      metersStatus: evaluated.metersStatus,
      associationsStatus: evaluated.associationsStatus,
      usageCoverageStatus,
      missingInputCodesJson: evaluated.missingInputCodes,
      latestErrorMessage,
      latestErrorCode: status === "NEEDS_ATTENTION" ? latestErrorCode : null,
    },
  });

  return {
    status,
    propertyUsesStatus,
    metersStatus: evaluated.metersStatus,
    associationsStatus: evaluated.associationsStatus,
    usageCoverageStatus,
    missingInputCodes: evaluated.missingInputCodes,
    latestErrorMessage,
    summaryState: summary.summaryState,
    summaryLine: summary.summaryLine,
  };
}

export async function getPortfolioManagerMeterComponentStateForBuilding(input: {
  organizationId: string;
  buildingId: string;
  db?: PrismaClient;
}) {
  const context = await loadSetupContext(input);
  return evaluatePortfolioManagerMeterComponents({
    building: context.building,
    propertyUsesStatus:
      context.setupState?.propertyUsesStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED,
    setupState: context.setupState,
    meters: context.meters,
    meterLinkStates: context.meterLinkStates,
  });
}

export async function getPortfolioManagerMeterSetupForBuilding(input: {
  organizationId: string;
  buildingId: string;
  espmClient?: ESPM;
  db?: PrismaClient;
}): Promise<MeterSetupSnapshot> {
  const db = input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const activeLinkedProperty =
    context.building.espmPropertyId != null && context.building.espmShareStatus === "LINKED";
  const currentSetup = await syncSetupStateFromMeterState({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    remoteMeterAccess: null,
    db,
  });
  const linkByMeterId = new Map(context.meterLinkStates.map((item) => [item.meterId, item]));

  let remoteMeters: RemoteMeterRecord[] = [];
  let remoteMeterAccess: RemoteMeterAccessSummary = {
    status: "FULL_ACCESS",
    inaccessibleCount: 0,
    inaccessibleMeterIds: [],
    inaccessibleMeters: [],
    warning: null,
    canProceed: true,
    partialReasonSummary: null,
  };
  let associatedMeterIds = new Set<number>();

  if (activeLinkedProperty && context.building.espmPropertyId != null) {
    const remote = await loadRemotePropertyMeterSnapshot({
      organizationId: input.organizationId,
      propertyId: Number(context.building.espmPropertyId),
      espmClient: input.espmClient,
      db,
    });
    remoteMeters = remote.meters;
    remoteMeterAccess = remote.remoteMeterAccess;
    associatedMeterIds = remote.associatedMeterIds;
  }

  const currentSetupWithAccess = await syncSetupStateFromMeterState({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    remoteMeterAccess,
    db,
  });

  const linkedRemoteMeterIds = new Set(
    context.meters
      .map((meter) => meter.espmMeterId?.toString())
      .filter((value): value is string => value != null),
  );

  const localMeters = context.meters.map((meter) => {
    const linkState = linkByMeterId.get(meter.id);
    const suggestedRemoteMeterId =
      meter.espmMeterId == null
        ? getSafeSuggestion({
            localMeter: meter,
            remoteMeters,
            linkedRemoteMeterIds,
          })
        : null;
    const createBlockedReason = getCreateBlockedReason({
      managementMode: context.managementMode,
      meter,
    });

    return {
      id: meter.id,
      name: meter.name,
      meterType: meter.meterType,
      unit: meter.unit,
      isActive: meter.isActive,
      espmMeterId: toStringId(meter.espmMeterId),
      strategy: linkState?.strategy ?? null,
      selectedRemoteMeterId: toStringId(linkState?.selectedRemoteMeterId ?? null),
      suggestedRemoteMeterId,
      meterStatus: linkState?.meterStatus ?? "NOT_STARTED",
      associationStatus: linkState?.associationStatus ?? "NOT_STARTED",
      latestErrorMessage: linkState?.latestErrorMessage ?? null,
      canCreateRemote: createBlockedReason == null,
      createBlockedReason,
    };
  });

  const remoteRows = remoteMeters.map((remoteMeter) => {
    const importAssessment = getRemoteMeterImportAssessment(remoteMeter);
    const linkedLocalMeter =
      context.meters.find(
        (meter) => meter.espmMeterId?.toString() === String(remoteMeter.meterId),
      ) ?? null;
    const suggestedForLocal =
      linkedLocalMeter == null
        ? context.meters.find(
            (meter) =>
              meter.espmMeterId == null &&
              getSafeSuggestion({
                localMeter: meter,
                remoteMeters,
                linkedRemoteMeterIds,
              }) === String(remoteMeter.meterId),
          ) ?? null
        : null;
    const compatibleLocalMeterIds = context.meters
      .filter((meter) =>
        classifyPortfolioManagerUnitCompatibility({
          localMeterType: meter.meterType,
          localUnit: meter.unit,
          rawRemoteType: remoteMeter.rawType,
          rawRemoteUnitOfMeasure: remoteMeter.rawUnitOfMeasure,
        }).status !== "UNSUPPORTED",
      )
      .map((meter) => meter.id);
    const canImport = importAssessment.canImport && linkedLocalMeter == null;

    return {
      meterId: String(remoteMeter.meterId),
      name: remoteMeter.name,
      meterType: remoteMeter.meterType,
      unit: remoteMeter.unit,
      inUse: remoteMeter.inUse,
      alreadyLinkedLocally: linkedLocalMeter != null,
      linkedLocalMeterId: linkedLocalMeter?.id ?? null,
      alreadyAssociated: associatedMeterIds.has(remoteMeter.meterId),
      canImport,
      importBlockedReason: canImport
        ? null
        : linkedLocalMeter != null
          ? "Already linked to a local Quoin meter."
          : importAssessment.blockedReason,
      suggestedForLocalMeterId: suggestedForLocal?.id ?? null,
      rawType: remoteMeter.rawType,
      rawUnitOfMeasure: remoteMeter.rawUnitOfMeasure,
      unitCompatibilityStatus: importAssessment.compatibilityStatus,
      unitCompatibilityReason: importAssessment.compatibilityReason,
      compatibleLocalMeterIds,
    };
  });

  return {
    managementMode: context.managementMode,
    setupState: {
      status: currentSetupWithAccess.status,
      propertyUsesStatus: currentSetupWithAccess.propertyUsesStatus,
      metersStatus: currentSetupWithAccess.metersStatus,
      associationsStatus: currentSetupWithAccess.associationsStatus,
      usageCoverageStatus: currentSetupWithAccess.usageCoverageStatus,
      latestJobId: context.setupState?.latestJobId ?? null,
      latestErrorCode: context.setupState?.latestErrorCode ?? null,
      latestErrorMessage: currentSetupWithAccess.latestErrorMessage,
      summaryState: currentSetupWithAccess.summaryState,
      summaryLine: currentSetupWithAccess.summaryLine,
      canApplyMeters:
        remoteMeterAccess.canProceed &&
        currentSetupWithAccess.metersStatus === "READY_TO_APPLY",
      canApplyAssociations:
        remoteMeterAccess.canProceed &&
        currentSetupWithAccess.associationsStatus === "READY_TO_APPLY",
    },
    localMeters,
    remoteMeters: remoteRows,
    remoteMeterAccess,
  };
}

function assertRemoteMeterAccessCanProceed(remoteMeterAccess: RemoteMeterAccessSummary) {
  if (remoteMeterAccess.canProceed) {
    return;
  }

  throw new ValidationError(
    remoteMeterAccess.warning ??
      "Portfolio Manager meter access is incomplete. Share the supported property meters Quoin should import before continuing.",
  );
}

export async function savePortfolioManagerMeterSetup(input: {
  organizationId: string;
  buildingId: string;
  localMeterStrategies: LocalMeterStrategyInput[];
  importRemoteMeterIds: string[];
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  espmClient?: ESPM;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  if (context.building.espmPropertyId == null || context.building.espmShareStatus !== "LINKED") {
    throw new ValidationError("Portfolio Manager meter setup requires a linked PM property.");
  }

  if (
    (context.setupState?.propertyUsesStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED) !==
    "APPLIED"
  ) {
    throw new ValidationError("Apply Portfolio Manager property uses before configuring meters.");
  }

  const remoteLoad = await loadRemotePropertyMeterSnapshot({
    organizationId: input.organizationId,
    propertyId: Number(context.building.espmPropertyId),
    espmClient: input.espmClient,
    db,
  });
  assertRemoteMeterAccessCanProceed(remoteLoad.remoteMeterAccess);
  const remoteMeters = remoteLoad.meters;
  const remoteById = new Map(remoteMeters.map((meter) => [String(meter.meterId), meter]));
  const localById = new Map(context.meters.map((meter) => [meter.id, meter]));

  const desiredRemoteIds = new Set<string>();
  const upserts: Array<{
    meterId: string;
    strategy: PortfolioManagerMeterLinkStrategy;
    selectedRemoteMeterId: bigint | null;
  }> = [];

  for (const strategy of input.localMeterStrategies) {
    const localMeter = localById.get(strategy.meterId);
    if (!localMeter) {
      throw new ValidationError("A selected local meter was not found.");
    }

    if (strategy.strategy === "CREATE_REMOTE") {
      const blockedReason = getCreateBlockedReason({
        managementMode: context.managementMode,
        meter: localMeter,
      });
      if (blockedReason) {
        throw new ValidationError(blockedReason);
      }

      upserts.push({
        meterId: localMeter.id,
        strategy: "CREATE_REMOTE",
        selectedRemoteMeterId: null,
      });
      continue;
    }

    if (!strategy.selectedRemoteMeterId) {
      throw new ValidationError("Select a remote PM meter before saving this mapping.");
    }

    const remoteMeter = remoteById.get(strategy.selectedRemoteMeterId);
    if (!remoteMeter) {
      throw new ValidationError("The selected remote PM meter was not found.");
    }
    const compatibility = classifyPortfolioManagerUnitCompatibility({
      localMeterType: localMeter.meterType,
      localUnit: localMeter.unit,
      rawRemoteType: remoteMeter.rawType,
      rawRemoteUnitOfMeasure: remoteMeter.rawUnitOfMeasure,
    });
    if (
      compatibility.status === "UNSUPPORTED" ||
      !isCompatibleMeterMapping({ localMeter, remoteMeter })
    ) {
      throw new ValidationError(
        compatibility.reason ?? "The selected PM meter is not a safe match for the local meter.",
      );
    }
    if (desiredRemoteIds.has(strategy.selectedRemoteMeterId)) {
      throw new ValidationError("The same PM meter cannot be linked to multiple local meters.");
    }
    desiredRemoteIds.add(strategy.selectedRemoteMeterId);

    upserts.push({
      meterId: localMeter.id,
      strategy: "LINK_EXISTING_REMOTE",
      selectedRemoteMeterId: BigInt(strategy.selectedRemoteMeterId),
    });
  }

  if (input.importRemoteMeterIds.length > 0 && context.managementMode === "QUOIN_MANAGED") {
    throw new ValidationError("Remote meter import is not available for Quoin-managed PM orgs.");
  }

  for (const remoteMeterId of input.importRemoteMeterIds) {
    const remoteMeter = remoteById.get(remoteMeterId);
    if (!remoteMeter) {
      throw new ValidationError("A selected remote PM meter was not found.");
    }
    const importAssessment = getRemoteMeterImportAssessment(remoteMeter);
    if (!importAssessment.canImport) {
      throw new ValidationError(
        importAssessment.blockedReason ??
          "That remote PM meter is not supported for safe import in Quoin.",
      );
    }
    if (
      context.meters.some(
        (meter) => meter.espmMeterId?.toString() === remoteMeterId,
      )
    ) {
      continue;
    }
  }

  await db.$transaction(async (tx) => {
    const desiredLocalMeterIds = new Set(upserts.map((item) => item.meterId));

    await tx.portfolioManagerMeterLinkState.deleteMany({
      where: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        strategy: "IMPORT_REMOTE_AS_LOCAL",
        meter: {
          espmMeterId: null,
          energyReadings: {
            none: {},
          },
        },
        NOT: {
          selectedRemoteMeterId: {
            in: input.importRemoteMeterIds.map((meterId) => BigInt(meterId)),
          },
        },
      },
    });

    for (const meter of context.meters) {
      if (!desiredLocalMeterIds.has(meter.id) && meter.espmMeterId == null) {
        await tx.portfolioManagerMeterLinkState.deleteMany({
          where: { meterId: meter.id },
        });
      }
    }

    for (const upsert of upserts) {
      await tx.portfolioManagerMeterLinkState.upsert({
        where: { meterId: upsert.meterId },
        create: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          meterId: upsert.meterId,
          strategy: upsert.strategy,
          selectedRemoteMeterId: upsert.selectedRemoteMeterId,
          meterStatus: "READY_TO_APPLY",
          associationStatus: "NOT_STARTED",
        },
        update: {
          strategy: upsert.strategy,
          selectedRemoteMeterId: upsert.selectedRemoteMeterId,
          meterStatus: "READY_TO_APPLY",
          associationStatus: "NOT_STARTED",
          latestErrorCode: null,
          latestErrorMessage: null,
        },
      });
    }

    for (const remoteMeterId of input.importRemoteMeterIds) {
      const remoteMeter = remoteById.get(remoteMeterId)!;
      const existingImported =
        context.meters.find((meter) => meter.espmMeterId?.toString() === remoteMeterId) ?? null;
      const meterId = existingImported?.id
        ? (
            await tx.meter.update({
              where: { id: existingImported.id },
              data: {
                espmMeterTypeRaw: remoteMeter.rawType,
                espmMeterUnitOfMeasureRaw: remoteMeter.rawUnitOfMeasure,
              },
              select: { id: true },
            })
          ).id
        : (
            await tx.meter.create({
              data: {
                organizationId: input.organizationId,
                buildingId: input.buildingId,
                meterType: remoteMeter.meterType,
                name: remoteMeter.name,
                unit: remoteMeter.unit,
                espmMeterId: BigInt(remoteMeterId),
                espmMeterTypeRaw: remoteMeter.rawType,
                espmMeterUnitOfMeasureRaw: remoteMeter.rawUnitOfMeasure,
                isActive: true,
              },
              select: { id: true },
            })
          ).id;

      await tx.portfolioManagerMeterLinkState.upsert({
        where: { meterId },
        create: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          meterId,
          strategy: "IMPORT_REMOTE_AS_LOCAL",
          selectedRemoteMeterId: BigInt(remoteMeterId),
          meterStatus: "APPLIED",
          associationStatus: "NOT_STARTED",
        },
        update: {
          strategy: "IMPORT_REMOTE_AS_LOCAL",
          selectedRemoteMeterId: BigInt(remoteMeterId),
          meterStatus: "APPLIED",
          associationStatus: "NOT_STARTED",
          latestErrorCode: null,
          latestErrorMessage: null,
        },
      });
    }
  });

  await syncSetupStateFromMeterState({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  await createAuditLog({
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    requestId: input.requestId ?? null,
    action: "portfolio_manager.meter_setup.saved",
    outputSnapshot: {
      localMeterStrategies: input.localMeterStrategies.length,
      importRemoteMeterCount: input.importRemoteMeterIds.length,
    },
  });

  return getPortfolioManagerMeterSetupForBuilding({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    espmClient: input.espmClient,
    db,
  });
}

export async function enqueuePortfolioManagerMeterSetupApply(input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const setup = await syncSetupStateFromMeterState({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  if (context.building.espmPropertyId != null && context.building.espmShareStatus === "LINKED") {
    const remoteLoad = await loadRemotePropertyMeterSnapshot({
      organizationId: input.organizationId,
      propertyId: Number(context.building.espmPropertyId),
      db,
    });
    const reconciledSetup = await syncSetupStateFromMeterState({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      remoteMeterAccess: remoteLoad.remoteMeterAccess,
      db,
    });
    assertRemoteMeterAccessCanProceed(remoteLoad.remoteMeterAccess);
    if (reconciledSetup.metersStatus !== "READY_TO_APPLY") {
      throw new ValidationError(reconciledSetup.summaryLine);
    }
  }

  if (setup.metersStatus !== "READY_TO_APPLY") {
    throw new ValidationError(setup.summaryLine);
  }

  const { job, now } = await withAdvisoryTransactionLock(
    db,
    `pm-meter-setup:${input.organizationId}:${input.buildingId}`,
    async (tx) => {
      const existingState = await tx.portfolioManagerSetupState.findUnique({
        where: { buildingId: input.buildingId },
        select: {
          status: true,
          latestJobId: true,
        },
      });

      if (
        (existingState?.status === "APPLY_QUEUED" ||
          existingState?.status === "APPLY_RUNNING") &&
        (existingState?.latestJobId ?? "").length > 0
      ) {
        throw new WorkflowStateError("Portfolio Manager meter setup is already queued or running.");
      }

      const queuedJob = await createJob(
        {
          type: PORTFOLIO_MANAGER_METER_SETUP_JOB_TYPE,
          status: JOB_STATUS.QUEUED,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          maxAttempts: 3,
        },
        tx,
      );
      const queuedAt = new Date();

      await tx.portfolioManagerSetupState.update({
        where: { buildingId: input.buildingId },
        data: {
          status: "APPLY_QUEUED",
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

  const envelope = buildPortfolioManagerMeterSetupEnvelope({
    requestId: input.requestId,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    operationalJobId: job.id,
    jobType: PM_METER_SETUP_JOB_TYPE.METER_SETUP_APPLY,
    triggeredAt: now,
  });
  const queueJobId = `pm-meter-setup-${job.id}`;
  try {
    await withQueue(QUEUES.PORTFOLIO_MANAGER_METER_SETUP, async (queue) => {
      await queue.add("portfolio-manager-meter-setup", envelope, {
        jobId: queueJobId,
      });
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager meter setup could not be queued.";
    await markPortfolioManagerMeterSetupFailed({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      operationalJobId: job.id,
      errorCode: "PM_METER_SETUP_QUEUE_FAILED",
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
    action: "portfolio_manager.meter_setup.queued",
    outputSnapshot: {
      operationalJobId: job.id,
      queueJobId,
    },
  });

  return {
    queueName: QUEUES.PORTFOLIO_MANAGER_METER_SETUP,
    queueJobId,
    operationalJobId: job.id,
  };
}

export async function enqueuePortfolioManagerMeterAssociationsApply(input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const setup = await syncSetupStateFromMeterState({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const context = await loadSetupContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  if (context.building.espmPropertyId != null && context.building.espmShareStatus === "LINKED") {
    const remoteLoad = await loadRemotePropertyMeterSnapshot({
      organizationId: input.organizationId,
      propertyId: Number(context.building.espmPropertyId),
      db,
    });
    const reconciledSetup = await syncSetupStateFromMeterState({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      remoteMeterAccess: remoteLoad.remoteMeterAccess,
      db,
    });
    assertRemoteMeterAccessCanProceed(remoteLoad.remoteMeterAccess);
    if (reconciledSetup.associationsStatus !== "READY_TO_APPLY") {
      throw new ValidationError(reconciledSetup.summaryLine);
    }
  }

  if (setup.associationsStatus !== "READY_TO_APPLY") {
    throw new ValidationError(setup.summaryLine);
  }

  const { job, now } = await withAdvisoryTransactionLock(
    db,
    `pm-meter-association:${input.organizationId}:${input.buildingId}`,
    async (tx) => {
      const existingState = await tx.portfolioManagerSetupState.findUnique({
        where: { buildingId: input.buildingId },
        select: {
          status: true,
          latestJobId: true,
        },
      });

      if (
        (existingState?.status === "APPLY_QUEUED" ||
          existingState?.status === "APPLY_RUNNING") &&
        (existingState?.latestJobId ?? "").length > 0
      ) {
        throw new WorkflowStateError(
          "Portfolio Manager meter associations are already queued or running.",
        );
      }

      const queuedJob = await createJob(
        {
          type: PORTFOLIO_MANAGER_METER_ASSOCIATION_JOB_TYPE,
          status: JOB_STATUS.QUEUED,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          maxAttempts: 3,
        },
        tx,
      );
      const queuedAt = new Date();

      await tx.portfolioManagerSetupState.update({
        where: { buildingId: input.buildingId },
        data: {
          status: "APPLY_QUEUED",
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

  const envelope = buildPortfolioManagerMeterSetupEnvelope({
    requestId: input.requestId,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    operationalJobId: job.id,
    jobType: PM_METER_SETUP_JOB_TYPE.METER_ASSOCIATION_APPLY,
    triggeredAt: now,
  });
  const queueJobId = `pm-meter-association-${job.id}`;
  try {
    await withQueue(QUEUES.PORTFOLIO_MANAGER_METER_SETUP, async (queue) => {
      await queue.add("portfolio-manager-meter-association", envelope, {
        jobId: queueJobId,
      });
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager meter associations could not be queued.";
    await markPortfolioManagerMeterSetupFailed({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      operationalJobId: job.id,
      errorCode: "PM_METER_ASSOCIATION_QUEUE_FAILED",
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
    action: "portfolio_manager.meter_associations.queued",
    outputSnapshot: {
      operationalJobId: job.id,
      queueJobId,
    },
  });

  return {
    queueName: QUEUES.PORTFOLIO_MANAGER_METER_SETUP,
    queueJobId,
    operationalJobId: job.id,
  };
}

export async function runPortfolioManagerMeterSetupApply(input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  espmClient?: ESPM;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  if (context.building.espmPropertyId == null || context.building.espmShareStatus !== "LINKED") {
    throw new ValidationError("Portfolio Manager meter setup requires a linked PM property.");
  }

  if (
    (context.setupState?.propertyUsesStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED) !==
    "APPLIED"
  ) {
    throw new ValidationError("Apply Portfolio Manager property uses before configuring meters.");
  }

  const espmClient =
    input.espmClient ??
    (await resolvePortfolioManagerClientForOrganization({
      organizationId: input.organizationId,
      db,
    }));

  await db.portfolioManagerSetupState.update({
    where: { buildingId: input.buildingId },
    data: {
      status: "APPLY_RUNNING",
      latestJobId: input.operationalJobId,
      latestErrorCode: null,
      latestErrorMessage: null,
      attemptCount: { increment: 1 },
      lastAttemptedAt: new Date(),
    },
  });

  const remote = await loadRemotePropertyMeterSnapshot({
    organizationId: input.organizationId,
    propertyId: Number(context.building.espmPropertyId),
    espmClient,
    db,
  });
  assertRemoteMeterAccessCanProceed(remote.remoteMeterAccess);
  const remoteById = new Map(remote.meters.map((meter) => [String(meter.meterId), meter]));
  const activeMeters = context.meters.filter((meter) => meter.isActive);
  const linkByMeterId = new Map(context.meterLinkStates.map((item) => [item.meterId, item]));
  const remoteUsageCounts = new Map<string, number>();

  for (const meter of activeMeters) {
    const remoteId = meter.espmMeterId?.toString();
    if (remoteId) {
      remoteUsageCounts.set(remoteId, (remoteUsageCounts.get(remoteId) ?? 0) + 1);
    }
  }

  if (Array.from(remoteUsageCounts.values()).some((count) => count > 1)) {
    throw new ValidationError("A PM meter is linked to multiple local meters and needs review.");
  }

  for (const meter of activeMeters) {
    if (meter.espmMeterId != null) {
      const existingRemote = remoteById.get(meter.espmMeterId.toString());
      if (!existingRemote) {
        throw new ValidationError("An expected PM meter link no longer exists remotely.");
      }
      await db.portfolioManagerMeterLinkState.upsert({
        where: { meterId: meter.id },
        create: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          meterId: meter.id,
          strategy: "LINK_EXISTING_REMOTE",
          selectedRemoteMeterId: meter.espmMeterId,
          meterStatus: "APPLIED",
          associationStatus: linkByMeterId.get(meter.id)?.associationStatus ?? "NOT_STARTED",
          latestJobId: input.operationalJobId,
          lastMeterAppliedAt: new Date(),
        },
        update: {
          meterStatus: "APPLIED",
          latestJobId: input.operationalJobId,
          latestErrorCode: null,
          latestErrorMessage: null,
          lastMeterAppliedAt: new Date(),
        },
      });
      continue;
    }

    const linkState = linkByMeterId.get(meter.id);
    if (!linkState) {
      throw new ValidationError("Save a PM meter strategy before applying meter setup.");
    }

    if (linkState.strategy === "LINK_EXISTING_REMOTE") {
      const selectedId = linkState.selectedRemoteMeterId?.toString();
      if (!selectedId) {
        throw new ValidationError("A selected PM meter is required before linking.");
      }
      const remoteMeter = remoteById.get(selectedId);
      const compatibility =
        remoteMeter == null
          ? null
          : classifyPortfolioManagerUnitCompatibility({
              localMeterType: meter.meterType,
              localUnit: meter.unit,
              rawRemoteType: remoteMeter.rawType,
              rawRemoteUnitOfMeasure: remoteMeter.rawUnitOfMeasure,
            });
      if (
        !remoteMeter ||
        compatibility == null ||
        compatibility.status === "UNSUPPORTED" ||
        !isCompatibleMeterMapping({ localMeter: meter, remoteMeter })
      ) {
        throw new ValidationError(
          compatibility?.reason ?? "The selected PM meter is no longer a safe match.",
        );
      }
      await db.$transaction(async (tx) => {
        await tx.meter.update({
          where: { id: meter.id },
          data: {
            espmMeterId: BigInt(selectedId),
            espmMeterTypeRaw: remoteMeter.rawType,
            espmMeterUnitOfMeasureRaw: remoteMeter.rawUnitOfMeasure,
          },
        });
        await tx.portfolioManagerMeterLinkState.update({
          where: { meterId: meter.id },
          data: {
            meterStatus: "APPLIED",
            latestJobId: input.operationalJobId,
            latestErrorCode: null,
            latestErrorMessage: null,
            lastMeterAppliedAt: new Date(),
          },
        });
      });
      continue;
    }

    if (linkState.strategy === "CREATE_REMOTE") {
      const creation = getPortfolioManagerMeterCreationDefinition({
        meterType: meter.meterType,
        unit: meter.unit,
      });
      if (!creation) {
        throw new ValidationError("That meter cannot be created safely in PM during this phase.");
      }
      const created = await remote.espmClient.meter.createMeter(
        Number(context.building.espmPropertyId),
        {
          type: creation.rawType,
          name: meter.name,
          unitOfMeasure: creation.rawUnitOfMeasure,
          metered: true,
          firstBillDate: await getFirstBillDateForMeter({
            organizationId: input.organizationId,
            meter,
            db,
          }),
          inUse: true,
        },
      );
      const createdMeterId = extractCreatedEntityId(created);
      if (!createdMeterId) {
        throw new ValidationError("PM meter creation did not return a meter id.");
      }
      await db.$transaction(async (tx) => {
        await tx.meter.update({
          where: { id: meter.id },
          data: {
            espmMeterId: BigInt(createdMeterId),
            espmMeterTypeRaw: creation.rawType,
            espmMeterUnitOfMeasureRaw: creation.rawUnitOfMeasure,
          },
        });
        await tx.portfolioManagerMeterLinkState.update({
          where: { meterId: meter.id },
          data: {
            selectedRemoteMeterId: BigInt(createdMeterId),
            meterStatus: "APPLIED",
            latestJobId: input.operationalJobId,
            latestErrorCode: null,
            latestErrorMessage: null,
            lastMeterAppliedAt: new Date(),
          },
        });
      });
      continue;
    }

    if (linkState.strategy === "IMPORT_REMOTE_AS_LOCAL") {
      await db.portfolioManagerMeterLinkState.update({
        where: { meterId: meter.id },
        data: {
          meterStatus: "APPLIED",
          latestJobId: input.operationalJobId,
          latestErrorCode: null,
          latestErrorMessage: null,
          lastMeterAppliedAt: new Date(),
        },
      });
      continue;
    }
  }

  await syncSetupStateFromMeterState({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  return {
    buildingId: input.buildingId,
    meterCount: activeMeters.length,
  };
}

export async function runPortfolioManagerMeterAssociationsApply(input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  espmClient?: ESPM;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  if (context.building.espmPropertyId == null || context.building.espmShareStatus !== "LINKED") {
    throw new ValidationError("Portfolio Manager associations require a linked PM property.");
  }

  if (
    (context.setupState?.propertyUsesStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED) !==
    "APPLIED"
  ) {
    throw new ValidationError("Apply Portfolio Manager property uses before associations.");
  }

  const activeMeters = context.meters.filter((meter) => meter.isActive);
  if (activeMeters.some((meter) => meter.espmMeterId == null)) {
    throw new ValidationError("Apply PM meter setup before property-to-meter associations.");
  }

  const uniqueRemoteIds = new Set<string>();
  for (const meter of activeMeters) {
    const remoteId = meter.espmMeterId!.toString();
    if (uniqueRemoteIds.has(remoteId)) {
      throw new ValidationError("A PM meter is linked to multiple local meters and needs review.");
    }
    uniqueRemoteIds.add(remoteId);
  }

  const espmClient =
    input.espmClient ??
    (await resolvePortfolioManagerClientForOrganization({
      organizationId: input.organizationId,
      db,
    }));
  const remoteSnapshot = await loadRemotePropertyMeterSnapshot({
    organizationId: input.organizationId,
    propertyId: Number(context.building.espmPropertyId),
    espmClient,
    db,
  });
  const associatedMeterIds = remoteSnapshot.associatedMeterIds;

  for (const meter of activeMeters) {
    const remoteMeterId = Number(meter.espmMeterId);
    if (!associatedMeterIds.has(remoteMeterId)) {
      await espmClient.meter.associateMeterToProperty(
        Number(context.building.espmPropertyId),
        remoteMeterId,
      );
    }

    await db.portfolioManagerMeterLinkState.upsert({
      where: { meterId: meter.id },
      create: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        meterId: meter.id,
        strategy: "LINK_EXISTING_REMOTE",
        selectedRemoteMeterId: meter.espmMeterId,
        meterStatus: "APPLIED",
        associationStatus: "APPLIED",
        latestJobId: input.operationalJobId,
        lastAssociationAppliedAt: new Date(),
      },
      update: {
        associationStatus: "APPLIED",
        latestJobId: input.operationalJobId,
        latestErrorCode: null,
        latestErrorMessage: null,
        lastAssociationAppliedAt: new Date(),
      },
    });
  }

  await syncSetupStateFromMeterState({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  return {
    buildingId: input.buildingId,
    associationCount: activeMeters.length,
  };
}

export async function markPortfolioManagerMeterSetupFailed(input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  errorCode: string;
  errorMessage: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  await db.portfolioManagerSetupState.upsert({
    where: { buildingId: input.buildingId },
    create: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      status: "NEEDS_ATTENTION",
      propertyUsesStatus:
        context.setupState?.propertyUsesStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED,
      metersStatus: "NEEDS_ATTENTION",
      associationsStatus:
        context.setupState?.associationsStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED,
      usageCoverageStatus:
        context.setupState?.usageCoverageStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED,
      latestJobId: input.operationalJobId,
      latestErrorCode: input.errorCode,
      latestErrorMessage: input.errorMessage,
      missingInputCodesJson: ["PM_METER_REMOTE_CONFLICT"],
      lastFailedAt: new Date(),
      lastAttemptedAt: new Date(),
    },
    update: {
      status: "NEEDS_ATTENTION",
      metersStatus: "NEEDS_ATTENTION",
      latestJobId: input.operationalJobId,
      latestErrorCode: input.errorCode,
      latestErrorMessage: input.errorMessage,
      missingInputCodesJson: ["PM_METER_REMOTE_CONFLICT"],
      lastFailedAt: new Date(),
      lastAttemptedAt: new Date(),
    },
  });

  await db.portfolioManagerMeterLinkState.updateMany({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
    },
    data: {
      latestJobId: input.operationalJobId,
      latestErrorCode: input.errorCode,
      latestErrorMessage: input.errorMessage,
      lastFailedAt: new Date(),
    },
  });
}
