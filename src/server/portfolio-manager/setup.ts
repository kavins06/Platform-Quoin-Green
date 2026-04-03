import type { PrismaClient } from "@/generated/prisma";
import { Prisma } from "@/generated/prisma";
import {
  PortfolioManagerSetupComponentStatus,
  PortfolioManagerSetupStatus,
  type ActorType,
  type Building,
  type BuildingPropertyUseType,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import { createJob, JOB_STATUS, markDead } from "@/server/lib/jobs";
import { QUEUES, withQueue } from "@/server/lib/queue";
import { ValidationError, WorkflowStateError } from "@/server/lib/errors";
import { resolvePortfolioManagerClientForOrganization } from "@/server/portfolio-manager/existing-account";
import type { ESPM } from "@/server/integrations/espm";
import { getPortfolioManagerMeterComponentStateForBuilding } from "@/server/portfolio-manager/meter-setup";
import {
  derivePortfolioManagerOverallSetupStatus,
  derivePortfolioManagerSetupSummary,
  getPortfolioManagerSetupMissingInputMessage,
} from "@/server/portfolio-manager/setup-summary";
import { buildPortfolioManagerSetupEnvelope } from "@/server/pipelines/portfolio-manager-setup/envelope";
import { getPmRuntimeHealth } from "@/server/lib/runtime-health";
import {
  buildDefaultPropertyUsesFromCoarseType,
  evaluateBuildingProfile,
  toSerializablePropertyUseDetails,
} from "@/lib/buildings/property-use-profile";
import {
  findPropertyUseKeyByPrimaryFunction,
  type BuildingPropertyUseKey,
} from "@/lib/buildings/property-use-registry";
import { withAdvisoryTransactionLock } from "@/server/lib/transaction-lock";

const PORTFOLIO_MANAGER_SETUP_JOB_TYPE = "PORTFOLIO_MANAGER_PROPERTY_USE_SETUP";

type SetupStateRecord = Awaited<
  ReturnType<typeof prisma.portfolioManagerSetupState.findUnique>
>;

type PropertyUseInputRecord = Awaited<
  ReturnType<typeof prisma.buildingPropertyUse.findMany>
>[number];

type EvaluatedSetupState = {
  status: PortfolioManagerSetupStatus;
  propertyUsesStatus: PortfolioManagerSetupComponentStatus;
  metersStatus: PortfolioManagerSetupComponentStatus;
  associationsStatus: PortfolioManagerSetupComponentStatus;
  usageCoverageStatus: PortfolioManagerSetupComponentStatus;
  missingInputCodes: string[];
  summaryState:
    | "SETUP_INCOMPLETE"
    | "READY_FOR_NEXT_STEP"
    | "NEEDS_ATTENTION"
    | "BENCHMARK_READY";
  summaryLine: string;
  canApply: boolean;
  derivedPropertyType: Building["propertyType"];
  recommendedTargetScore: number;
};

type RemotePropertyUse = {
  propertyUseId: number;
  name: string | null;
  useKey: BuildingPropertyUseKey | null;
  grossSquareFeet: number | null;
  currentUseDetailsId: number | null;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  return value == null ? [] : [value as T];
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getNestedObject(value: unknown, key: string) {
  const record = toRecord(value);
  const nested = record[key];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }

  const first = toArray<Record<string, unknown>>(nested)[0];
  return first && typeof first === "object" ? first : null;
}

function toInputJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function extractCreatedEntityId(response: unknown) {
  const candidate =
    response &&
    typeof response === "object" &&
    "response" in response &&
    response.response &&
    typeof response.response === "object" &&
    "id" in response.response
      ? (response.response as { id?: number | string }).id
      : null;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate === "string" && candidate.trim().length > 0) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toProfilePropertyUses(
  propertyUses: Array<{
    id?: string | null;
    sortOrder: number;
    useKey: string;
    displayName: string;
    grossSquareFeet: number;
    details: Record<string, unknown>;
  }>,
) {
  return propertyUses.map((propertyUse) => ({
    ...propertyUse,
    useKey: propertyUse.useKey as BuildingPropertyUseKey,
  }));
}

function evaluateSetupInputs(input: {
  building: Pick<
    Building,
    | "propertyType"
    | "grossSquareFeet"
    | "yearBuilt"
    | "plannedConstructionCompletionYear"
    | "espmPropertyId"
    | "espmShareStatus"
  >;
  propertyUses: Array<{
    id?: string | null;
    sortOrder: number;
    useKey: string;
    displayName: string;
    grossSquareFeet: number;
    details: Record<string, unknown>;
  }>;
  latestErrorMessage?: string | null;
}): EvaluatedSetupState {
  const metersStatus = PortfolioManagerSetupComponentStatus.NOT_STARTED;
  const associationsStatus = PortfolioManagerSetupComponentStatus.NOT_STARTED;
  const usageCoverageStatus = PortfolioManagerSetupComponentStatus.NOT_STARTED;
  const profile = evaluateBuildingProfile({
    grossSquareFeet: input.building.grossSquareFeet,
    yearBuilt: input.building.yearBuilt,
    plannedConstructionCompletionYear: input.building.plannedConstructionCompletionYear,
    propertyUses: toProfilePropertyUses(input.propertyUses),
  });
  const missingInputCodes = new Set(profile.missingInputCodes);

  if (input.building.espmPropertyId == null || input.building.espmShareStatus !== "LINKED") {
    missingInputCodes.add("PM_LINKAGE_REQUIRED");
  }

  const propertyUsesStatus = profile.isComplete
    ? PortfolioManagerSetupComponentStatus.READY_TO_APPLY
    : PortfolioManagerSetupComponentStatus.INPUT_REQUIRED;
  const status =
    input.building.espmPropertyId != null && input.building.espmShareStatus === "LINKED"
      ? profile.isComplete
        ? PortfolioManagerSetupStatus.READY_TO_APPLY
        : PortfolioManagerSetupStatus.INPUT_REQUIRED
      : PortfolioManagerSetupStatus.NOT_STARTED;
  const uniqueCodes = Array.from(missingInputCodes);
  const summary = derivePortfolioManagerSetupSummary({
    status,
    propertyUsesStatus,
    metersStatus,
    associationsStatus,
    usageCoverageStatus,
    missingInputCodes: uniqueCodes,
    latestErrorMessage: input.latestErrorMessage ?? null,
  });

  return {
    status,
    propertyUsesStatus,
    metersStatus,
    associationsStatus,
    usageCoverageStatus,
    missingInputCodes: uniqueCodes,
    summaryState: summary.summaryState,
    summaryLine: summary.summaryLine,
    canApply:
      profile.isComplete &&
      input.building.espmPropertyId != null &&
      input.building.espmShareStatus === "LINKED",
    derivedPropertyType: profile.derivedPropertyType,
    recommendedTargetScore: profile.recommendedTargetScore,
  };
}

function deriveDefaultOfficeWorkers(grossSquareFeet: number) {
  return Math.max(1, Math.round(grossSquareFeet / 250));
}

function deriveDefaultOfficeComputers(grossSquareFeet: number) {
  return Math.max(1, Math.round(grossSquareFeet / 350));
}

function deriveDefaultResidentialUnits(grossSquareFeet: number) {
  return Math.max(1, Math.round(grossSquareFeet / 900));
}

function deriveDefaultBedrooms(totalResidentialUnits: number) {
  return Math.max(totalResidentialUnits, Math.round(totalResidentialUnits * 1.5));
}

function buildDefaultPropertyUseDetails(
  useKey: BuildingPropertyUseKey,
  grossSquareFeet: number,
) {
  switch (useKey) {
    case "OFFICE":
    case "BANK_BRANCH":
    case "FINANCIAL_OFFICE":
      return {
        weeklyOperatingHours: 55,
        workersOnMainShift: deriveDefaultOfficeWorkers(grossSquareFeet),
        numberOfComputers: deriveDefaultOfficeComputers(grossSquareFeet),
        percentThatCanBeCooled: "50% or more",
      };
    case "MULTIFAMILY_HOUSING": {
      const totalResidentialUnits = deriveDefaultResidentialUnits(grossSquareFeet);
      return {
        totalResidentialUnits,
        lowRiseUnits: totalResidentialUnits,
        midRiseUnits: 0,
        highRiseUnits: 0,
        totalBedrooms: deriveDefaultBedrooms(totalResidentialUnits),
      };
    }
    default:
      return {};
  }
}

export function buildDefaultPropertyUseInputs(
  building: Pick<Building, "name" | "propertyType" | "grossSquareFeet">,
) {
  return buildDefaultPropertyUsesFromCoarseType({
    buildingName: building.name,
    propertyType: building.propertyType,
    grossSquareFeet: building.grossSquareFeet,
  }).map((propertyUse, index) => ({
    id: null,
    sortOrder: index,
    useKey: propertyUse.useKey,
    displayName: propertyUse.displayName,
    grossSquareFeet: propertyUse.grossSquareFeet,
    details: {
      ...buildDefaultPropertyUseDetails(
        propertyUse.useKey,
        propertyUse.grossSquareFeet,
      ),
      ...propertyUse.details,
    },
    espmPropertyUseId: null,
    espmUseDetailsId: null,
  }));
}

export async function hasPersistedPortfolioManagerSetupInputs(input: {
  organizationId: string;
  buildingId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const count = await db.buildingPropertyUse.count({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
    },
  });

  return count > 0;
}

async function loadSetupContext(input: {
  organizationId: string;
  buildingId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const [building, management, setupState, usageState] = await Promise.all([
    db.building.findUnique({
      where: { id: input.buildingId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        propertyType: true,
        grossSquareFeet: true,
        occupancyRate: true,
        yearBuilt: true,
        plannedConstructionCompletionYear: true,
        espmPropertyId: true,
        espmShareStatus: true,
        propertyUses: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
    db.portfolioManagerManagement.findUnique({
      where: { organizationId: input.organizationId },
      select: {
        managementMode: true,
        status: true,
      },
    }),
    db.portfolioManagerSetupState.findUnique({
      where: { buildingId: input.buildingId },
    }),
    db.portfolioManagerUsageState.findUnique({
      where: { buildingId: input.buildingId },
    }),
  ]);

  if (!building) {
    throw new ValidationError("Building not found for Portfolio Manager setup.");
  }
  if (building.organizationId !== input.organizationId) {
    throw new ValidationError("Building is not accessible in this organization.");
  }

  return {
    building,
    management,
    setupState,
    usageState,
    propertyUses: building.propertyUses,
  };
}

function toClientPropertyUseInput(input: PropertyUseInputRecord) {
  return {
    id: input.id,
    sortOrder: input.sortOrder,
    useKey: input.useKey,
    displayName: input.displayName,
    grossSquareFeet: input.grossSquareFeet,
    details: toRecord(input.detailsJson),
    espmPropertyUseId: input.espmPropertyUseId?.toString() ?? null,
    espmUseDetailsId: input.espmUseDetailsId?.toString() ?? null,
  };
}

function toClientSetupState(
  setupState: SetupStateRecord,
  fallback: EvaluatedSetupState,
  usageState?: {
    metricsStatus?: string | null;
    coverageSummaryJson?: unknown;
  } | null,
) {
  const status = setupState?.status ?? fallback.status;
  const propertyUsesStatus = setupState?.propertyUsesStatus ?? fallback.propertyUsesStatus;
  const metersStatus = setupState?.metersStatus ?? fallback.metersStatus;
  const associationsStatus = setupState?.associationsStatus ?? fallback.associationsStatus;
  const usageCoverageStatus = setupState?.usageCoverageStatus ?? fallback.usageCoverageStatus;
  const missingInputCodes = Array.isArray(setupState?.missingInputCodesJson)
    ? setupState!.missingInputCodesJson.filter(
        (code): code is string => typeof code === "string" && code.trim().length > 0,
      )
    : fallback.missingInputCodes;
  const coverageSummary =
    usageState?.coverageSummaryJson &&
    typeof usageState.coverageSummaryJson === "object" &&
    !Array.isArray(usageState.coverageSummaryJson)
      ? (usageState.coverageSummaryJson as Record<string, unknown>)
      : null;
  const summary = derivePortfolioManagerSetupSummary({
    status,
    propertyUsesStatus,
    metersStatus,
    associationsStatus,
    usageCoverageStatus,
    usageCoverageDetail:
      typeof coverageSummary?.summaryLine === "string" ? coverageSummary.summaryLine : null,
    metricsStatus: usageState?.metricsStatus ?? null,
    missingInputCodes,
    latestErrorMessage: setupState?.latestErrorMessage ?? null,
  });

  return {
    status,
    propertyUsesStatus,
    metersStatus,
    associationsStatus,
    usageCoverageStatus,
    latestJobId: setupState?.latestJobId ?? null,
    attemptCount: setupState?.attemptCount ?? 0,
    latestErrorCode: setupState?.latestErrorCode ?? null,
    latestErrorMessage: setupState?.latestErrorMessage ?? null,
    missingInputCodes,
    lastAppliedAt: setupState?.lastAppliedAt ?? null,
    lastAttemptedAt: setupState?.lastAttemptedAt ?? null,
    lastFailedAt: setupState?.lastFailedAt ?? null,
    summaryState: summary.summaryState,
    summaryLine: summary.summaryLine,
    canApply:
      status === "READY_TO_APPLY" ||
      propertyUsesStatus === "READY_TO_APPLY" ||
      fallback.canApply,
  };
}

async function upsertEvaluatedSetupState(input: {
  organizationId: string;
  buildingId: string;
  existingSetupState: SetupStateRecord;
  evaluatedState: EvaluatedSetupState;
  db?: {
    portfolioManagerSetupState: PrismaClient["portfolioManagerSetupState"];
  };
}) {
  const db = input.db ?? prisma;
  const existingMetersStatus =
    input.existingSetupState?.metersStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED;
  const existingAssociationsStatus =
    input.existingSetupState?.associationsStatus ??
    PortfolioManagerSetupComponentStatus.NOT_STARTED;
  const existingUsageCoverageStatus =
    input.existingSetupState?.usageCoverageStatus ??
    PortfolioManagerSetupComponentStatus.NOT_STARTED;
  const status = derivePortfolioManagerOverallSetupStatus({
    propertyUsesStatus: input.evaluatedState.propertyUsesStatus,
    metersStatus: existingMetersStatus,
    associationsStatus: existingAssociationsStatus,
    usageCoverageStatus: existingUsageCoverageStatus,
  });

  return db.portfolioManagerSetupState.upsert({
    where: { buildingId: input.buildingId },
    create: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      status,
      propertyUsesStatus: input.evaluatedState.propertyUsesStatus,
      metersStatus: existingMetersStatus,
      associationsStatus: existingAssociationsStatus,
      usageCoverageStatus: existingUsageCoverageStatus,
      missingInputCodesJson: input.evaluatedState.missingInputCodes,
    },
    update: {
      status,
      propertyUsesStatus: input.evaluatedState.propertyUsesStatus,
      metersStatus: existingMetersStatus,
      associationsStatus: existingAssociationsStatus,
      usageCoverageStatus: existingUsageCoverageStatus,
      missingInputCodesJson: input.evaluatedState.missingInputCodes,
      latestErrorCode:
        status === "NEEDS_ATTENTION"
          ? input.existingSetupState?.latestErrorCode ?? null
          : null,
      latestErrorMessage:
        status === "NEEDS_ATTENTION"
          ? input.existingSetupState?.latestErrorMessage ?? null
          : null,
      lastAppliedAt:
        status === "APPLIED"
          ? input.existingSetupState?.lastAppliedAt ?? null
          : null,
    },
  });
}

function parsePropertyUseIds(raw: unknown) {
  const response = toRecord(toRecord(raw).response);
  const links = toArray<Record<string, unknown>>(response.link);
  const ids = new Set<number>();

  for (const link of links) {
    const directId = getNumber(link["@_id"] ?? link.id);
    if (directId != null) {
      ids.add(directId);
      continue;
    }

    const href = getString(link["@_link"] ?? link["@_href"] ?? link.href);
    const match = href?.match(/\/propertyUse\/(\d+)(?:\/|$)/);
    if (match) {
      ids.add(Number(match[1]));
    }
  }

  return Array.from(ids);
}

function parseRemotePropertyUse(raw: unknown, fallbackId: number): RemotePropertyUse {
  const propertyUse = getNestedObject(raw, "propertyUse") ?? toRecord(raw);
  const propertyUseId = getNumber(propertyUse["@_id"] ?? propertyUse.id) ?? fallbackId;
  const grossFloorArea = getNestedObject(propertyUse, "grossFloorArea");
  const currentUseDetails =
    getNestedObject(propertyUse, "currentUseDetails") ??
    getNestedObject(propertyUse, "useDetails");

  return {
    propertyUseId,
    name: getString(propertyUse.name),
    useKey: findPropertyUseKeyByPrimaryFunction(
      getString(propertyUse.type) ??
        getString(propertyUse.useType) ??
        getString(propertyUse.primaryFunction),
    ),
    grossSquareFeet: getNumber(grossFloorArea?.value ?? propertyUse.grossFloorArea),
    currentUseDetailsId: getNumber(
      currentUseDetails?.["@_id"] ?? currentUseDetails?.id ?? propertyUse.useDetailsId,
    ),
  };
}

async function loadRemotePropertyUses(input: {
  espmClient: ESPM;
  propertyId: number;
}) {
  const propertyUseIds = parsePropertyUseIds(
    await input.espmClient.property.listPropertyUses(input.propertyId),
  );

  return Promise.all(
    propertyUseIds.map(async (propertyUseId) =>
      parseRemotePropertyUse(
        await input.espmClient.property.getPropertyUse(propertyUseId),
        propertyUseId,
      ),
    ),
  );
}

function countByUseKey(useKeys: Array<BuildingPropertyUseKey | null>) {
  const counts = new Map<BuildingPropertyUseKey, number>();

  for (const useKey of useKeys) {
    if (!useKey) {
      continue;
    }
    counts.set(useKey, (counts.get(useKey) ?? 0) + 1);
  }

  return counts;
}

function ensureRemoteUsesAreSafeToApply(input: {
  localRows: PropertyUseInputRecord[];
  remoteUses: RemotePropertyUse[];
}) {
  if (input.remoteUses.length === 0) {
    return;
  }

  const hasMappedRemoteIds = input.localRows.some((row) => row.espmPropertyUseId != null);
  if (hasMappedRemoteIds) {
    const referencedIds = new Set(
      input.localRows
        .map((row) => row.espmPropertyUseId?.toString())
        .filter((value): value is string => value != null),
    );
    const unreferencedRemoteUses = input.remoteUses.filter(
      (remoteUse) => !referencedIds.has(String(remoteUse.propertyUseId)),
    );
    if (unreferencedRemoteUses.length > 0) {
      throw new ValidationError(
        getPortfolioManagerSetupMissingInputMessage("PM_SETUP_REMOTE_CONFLICT"),
      );
    }

    for (const localRow of input.localRows) {
      const matchedRemoteUse =
        localRow.espmPropertyUseId != null
          ? input.remoteUses.find(
              (remoteUse) => remoteUse.propertyUseId === Number(localRow.espmPropertyUseId),
            ) ?? null
          : null;
      if (
        matchedRemoteUse?.useKey != null &&
        matchedRemoteUse.useKey !== localRow.useKey
      ) {
        throw new ValidationError(
          getPortfolioManagerSetupMissingInputMessage("PM_SETUP_REMOTE_TYPE_CONFLICT"),
        );
      }
    }

    return;
  }

  if (input.localRows.length === 1 && input.remoteUses.length === 1) {
    const remoteUse = input.remoteUses[0]!;
    if (remoteUse.useKey == null || remoteUse.useKey === input.localRows[0]!.useKey) {
      return;
    }
  }

  if (
    input.remoteUses.every((remoteUse) => remoteUse.useKey != null) &&
    input.localRows.length === input.remoteUses.length
  ) {
    const localCounts = countByUseKey(
      input.localRows.map((row) => row.useKey as BuildingPropertyUseKey),
    );
    const remoteCounts = countByUseKey(input.remoteUses.map((remoteUse) => remoteUse.useKey));
    const sameShape =
      localCounts.size === remoteCounts.size &&
      Array.from(localCounts.entries()).every(
        ([useKey, count]) => remoteCounts.get(useKey) === count,
      );
    if (sameShape) {
      return;
    }
  }

  throw new ValidationError(
    getPortfolioManagerSetupMissingInputMessage("PM_SETUP_REMOTE_CONFLICT"),
  );
}

async function reconcilePropertyUse(input: {
  espmClient: ESPM;
  propertyId: number;
  remoteUses: RemotePropertyUse[];
  claimedRemoteIds: Set<number>;
  localRow: PropertyUseInputRecord;
  isSingleUseBuilding: boolean;
}) {
  let createdNewPropertyUse = false;
  let resolvedPropertyUseId = input.localRow.espmPropertyUseId
    ? Number(input.localRow.espmPropertyUseId)
    : null;
  let resolvedUseDetailsId = input.localRow.espmUseDetailsId
    ? Number(input.localRow.espmUseDetailsId)
    : null;

  const availableRemoteUses = input.remoteUses.filter(
    (remoteUse) =>
      !input.claimedRemoteIds.has(remoteUse.propertyUseId) ||
      remoteUse.propertyUseId === resolvedPropertyUseId,
  );

  let matchedRemoteUse =
    resolvedPropertyUseId != null
      ? availableRemoteUses.find(
          (remoteUse) => remoteUse.propertyUseId === resolvedPropertyUseId,
        ) ?? null
      : null;

  if (!matchedRemoteUse && input.isSingleUseBuilding && availableRemoteUses.length === 1) {
    matchedRemoteUse = availableRemoteUses[0]!;
    resolvedPropertyUseId = matchedRemoteUse.propertyUseId;
    resolvedUseDetailsId = matchedRemoteUse.currentUseDetailsId;
  }

  if (!matchedRemoteUse) {
    const sameTypeRemoteUses = availableRemoteUses.filter(
      (remoteUse) => remoteUse.useKey === input.localRow.useKey,
    );
    if (sameTypeRemoteUses.length === 1) {
      matchedRemoteUse = sameTypeRemoteUses[0]!;
      resolvedPropertyUseId = matchedRemoteUse.propertyUseId;
      resolvedUseDetailsId = matchedRemoteUse.currentUseDetailsId;
    }
  }

  if (matchedRemoteUse?.useKey && matchedRemoteUse.useKey !== input.localRow.useKey) {
    throw new ValidationError(
      getPortfolioManagerSetupMissingInputMessage("PM_SETUP_REMOTE_TYPE_CONFLICT"),
    );
  }

  if (!matchedRemoteUse) {
    const createdPropertyUse = await input.espmClient.property.createPropertyUse(
      input.propertyId,
      {
        name: input.localRow.displayName,
        useKey: input.localRow.useKey as BuildingPropertyUseKey,
        grossFloorArea: input.localRow.grossSquareFeet,
        details: toRecord(input.localRow.detailsJson),
      },
    );
    resolvedPropertyUseId = extractCreatedEntityId(createdPropertyUse);
    if (!resolvedPropertyUseId) {
      throw new ValidationError(
        "Portfolio Manager property-use creation did not return a property-use id.",
      );
    }
    createdNewPropertyUse = true;
    matchedRemoteUse = parseRemotePropertyUse(
      await input.espmClient.property.getPropertyUse(resolvedPropertyUseId),
      resolvedPropertyUseId,
    );
  }

  if (resolvedUseDetailsId == null) {
    resolvedUseDetailsId = matchedRemoteUse.currentUseDetailsId;
  }

  const detailsPayload = {
    useKey: input.localRow.useKey as BuildingPropertyUseKey,
    grossSquareFeet: input.localRow.grossSquareFeet,
    details: toRecord(input.localRow.detailsJson),
  };

  if (createdNewPropertyUse) {
    if (resolvedUseDetailsId == null) {
      if (resolvedPropertyUseId == null) {
        throw new ValidationError(
          "Portfolio Manager property-use setup is missing a remote property-use id.",
        );
      }

      const createdUseDetails = await input.espmClient.property.createUseDetails(
        resolvedPropertyUseId,
        detailsPayload,
      );
      resolvedUseDetailsId = extractCreatedEntityId(createdUseDetails);
      if (!resolvedUseDetailsId) {
        resolvedUseDetailsId = matchedRemoteUse.currentUseDetailsId;
      }
    }
  } else {
    if (resolvedUseDetailsId != null) {
      await input.espmClient.property.updateUseDetails(resolvedUseDetailsId, detailsPayload);
    } else {
      if (resolvedPropertyUseId == null) {
        throw new ValidationError(
          "Portfolio Manager property-use setup is missing a remote property-use id.",
        );
      }

      const createdUseDetails = await input.espmClient.property.createUseDetails(
        resolvedPropertyUseId,
        detailsPayload,
      );
      resolvedUseDetailsId = extractCreatedEntityId(createdUseDetails);
      if (!resolvedUseDetailsId) {
        resolvedUseDetailsId = matchedRemoteUse.currentUseDetailsId;
      }
    }
  }

  if (resolvedPropertyUseId == null) {
    throw new ValidationError(
      "Portfolio Manager property-use setup is missing a remote property-use id.",
    );
  }

  input.claimedRemoteIds.add(resolvedPropertyUseId);

  return {
    espmPropertyUseId: BigInt(resolvedPropertyUseId),
    espmUseDetailsId:
      resolvedUseDetailsId != null ? BigInt(resolvedUseDetailsId) : null,
  };
}

export async function getPortfolioManagerSetupSummaryForBuilding(_input: {
  organizationId: string;
  buildingId: string;
  db?: PrismaClient;
}) {
  const context = await loadSetupContext(_input);
  const meterComponents = await getPortfolioManagerMeterComponentStateForBuilding(_input);
  const evaluated = evaluateSetupInputs({
    building: context.building,
    propertyUses:
      context.propertyUses.length > 0
        ? context.propertyUses.map((propertyUse) => ({
            id: propertyUse.id,
            sortOrder: propertyUse.sortOrder,
            useKey: propertyUse.useKey,
            displayName: propertyUse.displayName,
            grossSquareFeet: propertyUse.grossSquareFeet,
            details: toRecord(propertyUse.detailsJson),
          }))
        : buildDefaultPropertyUseInputs(context.building),
    latestErrorMessage: context.setupState?.latestErrorMessage ?? null,
  });
  const mergedFallback = {
    ...evaluated,
    metersStatus: meterComponents.metersStatus,
    associationsStatus: meterComponents.associationsStatus,
    missingInputCodes: Array.from(
      new Set([...evaluated.missingInputCodes, ...meterComponents.missingInputCodes]),
    ),
    status: derivePortfolioManagerOverallSetupStatus({
      propertyUsesStatus: evaluated.propertyUsesStatus,
      metersStatus: meterComponents.metersStatus,
      associationsStatus: meterComponents.associationsStatus,
      usageCoverageStatus:
        context.setupState?.usageCoverageStatus ?? evaluated.usageCoverageStatus,
    }),
  };
  const summary = toClientSetupState(
    context.setupState
      ? {
          ...context.setupState,
          metersStatus: meterComponents.metersStatus,
          associationsStatus: meterComponents.associationsStatus,
        }
      : context.setupState,
    mergedFallback,
    context.usageState,
  );

  return {
    isLinked:
      context.building.espmPropertyId != null &&
      context.building.espmShareStatus === "LINKED",
    managementMode: context.management?.managementMode ?? null,
    ...summary,
  };
}

export async function getPortfolioManagerSetupForBuilding(_input: {
  organizationId: string;
  buildingId: string;
  db?: PrismaClient;
}) {
  const context = await loadSetupContext(_input);
  const meterComponents = await getPortfolioManagerMeterComponentStateForBuilding(_input);
  const propertyUses =
    context.propertyUses.length > 0
      ? context.propertyUses.map((propertyUse) => ({
          id: propertyUse.id,
          sortOrder: propertyUse.sortOrder,
          useKey: propertyUse.useKey,
          displayName: propertyUse.displayName,
          grossSquareFeet: propertyUse.grossSquareFeet,
          details: toRecord(propertyUse.detailsJson),
        }))
      : buildDefaultPropertyUseInputs(context.building);
  const evaluated = evaluateSetupInputs({
    building: context.building,
    propertyUses,
    latestErrorMessage: context.setupState?.latestErrorMessage ?? null,
  });
  const mergedFallback = {
    ...evaluated,
    metersStatus: meterComponents.metersStatus,
    associationsStatus: meterComponents.associationsStatus,
    missingInputCodes: Array.from(
      new Set([...evaluated.missingInputCodes, ...meterComponents.missingInputCodes]),
    ),
    status: derivePortfolioManagerOverallSetupStatus({
      propertyUsesStatus: evaluated.propertyUsesStatus,
      metersStatus: meterComponents.metersStatus,
      associationsStatus: meterComponents.associationsStatus,
      usageCoverageStatus:
        context.setupState?.usageCoverageStatus ?? evaluated.usageCoverageStatus,
    }),
  };
  const setupState = toClientSetupState(
    context.setupState
      ? {
          ...context.setupState,
          metersStatus: meterComponents.metersStatus,
          associationsStatus: meterComponents.associationsStatus,
        }
      : context.setupState,
    mergedFallback,
    context.usageState,
  );
  const runtimeHealth = await getPmRuntimeHealth({
    latestJobId: context.setupState?.latestJobId ?? null,
    active:
      context.setupState?.status === "APPLY_QUEUED" ||
      context.setupState?.status === "APPLY_RUNNING",
    db: _input.db ?? prisma,
  });

  return {
    building: {
      id: context.building.id,
      name: context.building.name,
      propertyType: context.building.propertyType,
      grossSquareFeet: context.building.grossSquareFeet,
      occupancyRate: context.building.occupancyRate,
      yearBuilt: context.building.yearBuilt,
      plannedConstructionCompletionYear:
        context.building.plannedConstructionCompletionYear,
      espmPropertyId: context.building.espmPropertyId?.toString() ?? null,
      espmShareStatus: context.building.espmShareStatus,
    },
    managementMode: context.management?.managementMode ?? null,
    setupState,
    runtimeHealth,
    propertyUses:
      context.propertyUses.length > 0
        ? context.propertyUses.map(toClientPropertyUseInput)
        : buildDefaultPropertyUseInputs(context.building),
  };
}

export async function savePortfolioManagerSetupInputs(_input: {
  organizationId: string;
  buildingId: string;
  propertyUses: Array<{
    id?: string | null;
    sortOrder: number;
    useKey: BuildingPropertyUseKey;
    displayName: string;
    grossSquareFeet: number;
    details?: Record<string, unknown>;
  }>;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = _input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: _input.organizationId,
    buildingId: _input.buildingId,
    db,
  });

  const existingById = new Map(context.propertyUses.map((item) => [item.id, item]));
  const normalizedRows = _input.propertyUses
    .map((row, index) => {
      const existing = row.id ? existingById.get(row.id) ?? null : null;
      return {
        id: existing?.id ?? row.id ?? null,
        organizationId: _input.organizationId,
        buildingId: _input.buildingId,
        sortOrder: row.sortOrder ?? index,
        useKey: row.useKey,
        displayName: row.displayName.trim(),
        grossSquareFeet: row.grossSquareFeet,
        details: toSerializablePropertyUseDetails(row.useKey, row.details ?? {}),
        espmPropertyUseId: existing?.espmPropertyUseId ?? null,
        espmUseDetailsId: existing?.espmUseDetailsId ?? null,
      };
    })
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((row, index) => ({
      ...row,
      sortOrder: index,
    }));

  const evaluated = evaluateSetupInputs({
    building: context.building,
    propertyUses: normalizedRows.map((row) => ({
      id: row.id,
      sortOrder: row.sortOrder,
      useKey: row.useKey,
      displayName: row.displayName,
      grossSquareFeet: row.grossSquareFeet,
      details: row.details,
    })),
  });

  await db.$transaction(async (tx) => {
    const keepIds = normalizedRows
      .map((row) => row.id)
      .filter((value): value is string => Boolean(value));

    await tx.buildingPropertyUse.deleteMany({
      where: {
        organizationId: _input.organizationId,
        buildingId: _input.buildingId,
        ...(keepIds.length > 0 ? { id: { notIn: keepIds } } : {}),
      },
    });

    for (const row of normalizedRows) {
      if (row.id && existingById.has(row.id)) {
        const existing = existingById.get(row.id)!;
        await tx.buildingPropertyUse.update({
          where: { id: row.id },
          data: {
            sortOrder: row.sortOrder,
            useKey: row.useKey,
            displayName: row.displayName,
            grossSquareFeet: row.grossSquareFeet,
            detailsJson: toInputJsonValue(row.details),
            espmPropertyUseId:
              existing.useKey === row.useKey ? existing.espmPropertyUseId : null,
            espmUseDetailsId:
              existing.useKey === row.useKey ? existing.espmUseDetailsId : null,
          },
        });
      } else {
        await tx.buildingPropertyUse.create({
          data: {
            organizationId: _input.organizationId,
            buildingId: _input.buildingId,
            sortOrder: row.sortOrder,
            useKey: row.useKey,
            displayName: row.displayName,
            grossSquareFeet: row.grossSquareFeet,
            detailsJson: toInputJsonValue(row.details),
          },
        });
      }
    }

    await tx.building.update({
      where: { id: _input.buildingId },
      data: {
        propertyType:
          normalizedRows.length > 0
            ? evaluated.derivedPropertyType
            : context.building.propertyType,
        bepsTargetScore:
          normalizedRows.length > 0
            ? evaluated.recommendedTargetScore
            : undefined,
      },
    });

    await upsertEvaluatedSetupState({
      organizationId: _input.organizationId,
      buildingId: _input.buildingId,
      existingSetupState: context.setupState,
      evaluatedState: evaluated,
      db: tx,
    });
  });

  await createAuditLog({
    actorType: _input.actorType,
    actorId: _input.actorId ?? null,
    organizationId: _input.organizationId,
    buildingId: _input.buildingId,
    requestId: _input.requestId ?? null,
    action: "portfolio_manager.setup.saved",
    outputSnapshot: {
      rowCount: normalizedRows.length,
      status: evaluated.status,
      missingInputCodes: evaluated.missingInputCodes,
    },
  });

  return getPortfolioManagerSetupForBuilding({
    organizationId: _input.organizationId,
    buildingId: _input.buildingId,
    db,
  });
}

export async function enqueuePortfolioManagerSetupApply(_input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = _input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: _input.organizationId,
    buildingId: _input.buildingId,
    db,
  });
  const evaluated = evaluateSetupInputs({
    building: context.building,
    propertyUses:
      context.propertyUses.length > 0
        ? context.propertyUses.map((propertyUse) => ({
            id: propertyUse.id,
            sortOrder: propertyUse.sortOrder,
            useKey: propertyUse.useKey,
            displayName: propertyUse.displayName,
            grossSquareFeet: propertyUse.grossSquareFeet,
            details: toRecord(propertyUse.detailsJson),
          }))
        : buildDefaultPropertyUseInputs(context.building),
    latestErrorMessage: context.setupState?.latestErrorMessage ?? null,
  });

  if (!evaluated.canApply) {
    throw new ValidationError(evaluated.summaryLine);
  }

  const { job, now } = await withAdvisoryTransactionLock(
    db,
    `pm-setup:${_input.organizationId}:${_input.buildingId}`,
    async (tx) => {
      const existingState = await tx.portfolioManagerSetupState.findUnique({
        where: { buildingId: _input.buildingId },
        select: {
          status: true,
        },
      });

      if (
        existingState?.status === "APPLY_QUEUED" ||
        existingState?.status === "APPLY_RUNNING"
      ) {
        throw new WorkflowStateError(
          "Portfolio Manager setup is already queued or running for this building.",
        );
      }

      const queuedJob = await createJob(
        {
          type: PORTFOLIO_MANAGER_SETUP_JOB_TYPE,
          status: JOB_STATUS.QUEUED,
          organizationId: _input.organizationId,
          buildingId: _input.buildingId,
          maxAttempts: 3,
        },
        tx,
      );
      const queuedAt = new Date();

      await tx.portfolioManagerSetupState.upsert({
        where: { buildingId: _input.buildingId },
        create: {
          organizationId: _input.organizationId,
          buildingId: _input.buildingId,
          status: "APPLY_QUEUED",
          propertyUsesStatus: evaluated.propertyUsesStatus,
          metersStatus: evaluated.metersStatus,
          associationsStatus: evaluated.associationsStatus,
          usageCoverageStatus: evaluated.usageCoverageStatus,
          latestJobId: queuedJob.id,
          latestErrorCode: null,
          latestErrorMessage: null,
          missingInputCodesJson: [],
          lastAttemptedAt: queuedAt,
        },
        update: {
          status: "APPLY_QUEUED",
          propertyUsesStatus: evaluated.propertyUsesStatus,
          metersStatus: evaluated.metersStatus,
          associationsStatus: evaluated.associationsStatus,
          usageCoverageStatus: evaluated.usageCoverageStatus,
          latestJobId: queuedJob.id,
          latestErrorCode: null,
          latestErrorMessage: null,
          missingInputCodesJson: [],
          lastAttemptedAt: queuedAt,
        },
      });

      return {
        job: queuedJob,
        now: queuedAt,
      };
    },
  );

  const envelope = buildPortfolioManagerSetupEnvelope({
    requestId: _input.requestId,
    organizationId: _input.organizationId,
    buildingId: _input.buildingId,
    operationalJobId: job.id,
    triggeredAt: now,
  });
  const queueJobId = `pm-setup-${job.id}`;
  try {
    await withQueue(QUEUES.PORTFOLIO_MANAGER_SETUP, async (queue) => {
      await queue.add("portfolio-manager-setup-apply", envelope, {
        jobId: queueJobId,
      });
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager setup could not be queued.";
    await markPortfolioManagerSetupFailed({
      organizationId: _input.organizationId,
      buildingId: _input.buildingId,
      operationalJobId: job.id,
      errorCode: "PM_SETUP_QUEUE_FAILED",
      errorMessage: message,
      db,
    });
    await markDead(job.id, message, db).catch(() => null);
    throw error;
  }

  await createAuditLog({
    actorType: _input.actorType,
    actorId: _input.actorId ?? null,
    organizationId: _input.organizationId,
    buildingId: _input.buildingId,
    requestId: envelope.requestId,
    action: "portfolio_manager.setup.queued",
    outputSnapshot: {
      operationalJobId: job.id,
      queueJobId,
    },
  });

  return {
    queueName: QUEUES.PORTFOLIO_MANAGER_SETUP,
    queueJobId,
    operationalJobId: job.id,
  };
}

export async function runPortfolioManagerSetupApply(_input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  espmClient?: ESPM;
  db?: PrismaClient;
}) {
  const db = _input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: _input.organizationId,
    buildingId: _input.buildingId,
    db,
  });
  const propertyUses =
    context.propertyUses.length > 0
      ? context.propertyUses
      : buildDefaultPropertyUseInputs(context.building);
  const evaluated = evaluateSetupInputs({
    building: context.building,
    propertyUses: propertyUses.map((propertyUse) => ({
      id: "id" in propertyUse ? propertyUse.id ?? null : null,
      sortOrder: propertyUse.sortOrder,
      useKey: propertyUse.useKey,
      displayName: propertyUse.displayName,
      grossSquareFeet: propertyUse.grossSquareFeet,
      details:
        "detailsJson" in propertyUse
          ? toRecord(propertyUse.detailsJson)
          : toRecord(propertyUse.details),
    })),
    latestErrorMessage: context.setupState?.latestErrorMessage ?? null,
  });

  if (!evaluated.canApply) {
    throw new ValidationError(evaluated.summaryLine);
  }

  if (context.building.espmPropertyId == null) {
    throw new ValidationError(
      "Portfolio Manager setup requires a linked Portfolio Manager property.",
    );
  }

  const espmClient =
    _input.espmClient ??
    (await resolvePortfolioManagerClientForOrganization({
      organizationId: _input.organizationId,
      db,
    }));

  await db.portfolioManagerSetupState.upsert({
    where: { buildingId: _input.buildingId },
    create: {
      organizationId: _input.organizationId,
      buildingId: _input.buildingId,
      status: "APPLY_RUNNING",
      propertyUsesStatus: evaluated.propertyUsesStatus,
      metersStatus: evaluated.metersStatus,
      associationsStatus: evaluated.associationsStatus,
      usageCoverageStatus: evaluated.usageCoverageStatus,
      latestJobId: _input.operationalJobId,
      attemptCount: 1,
      latestErrorCode: null,
      latestErrorMessage: null,
      missingInputCodesJson: [],
      lastAttemptedAt: new Date(),
    },
    update: {
      status: "APPLY_RUNNING",
      propertyUsesStatus: evaluated.propertyUsesStatus,
      metersStatus: evaluated.metersStatus,
      associationsStatus: evaluated.associationsStatus,
      usageCoverageStatus: evaluated.usageCoverageStatus,
      latestJobId: _input.operationalJobId,
      attemptCount: { increment: 1 },
      latestErrorCode: null,
      latestErrorMessage: null,
      missingInputCodesJson: [],
      lastAttemptedAt: new Date(),
    },
  });

  const remoteUses = await loadRemotePropertyUses({
    espmClient,
    propertyId: Number(context.building.espmPropertyId),
  });

  ensureRemoteUsesAreSafeToApply({
    localRows: context.propertyUses,
    remoteUses,
  });

  const updatedRows: Array<{
    id: string;
    espmPropertyUseId: bigint;
    espmUseDetailsId: bigint | null;
  }> = [];
  const claimedRemoteIds = new Set<number>();

  for (const row of context.propertyUses) {
    const resolvedIds = await reconcilePropertyUse({
      espmClient,
      propertyId: Number(context.building.espmPropertyId),
      remoteUses,
      claimedRemoteIds,
      localRow: row,
      isSingleUseBuilding: context.propertyUses.length === 1,
    });

    updatedRows.push({
      id: row.id,
      ...resolvedIds,
    });
  }

  await db.$transaction(async (tx) => {
    const nextMetersStatus =
      context.setupState?.metersStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED;
    const nextAssociationsStatus =
      context.setupState?.associationsStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED;
    const nextUsageCoverageStatus =
      context.setupState?.usageCoverageStatus ?? PortfolioManagerSetupComponentStatus.NOT_STARTED;
    const nextStatus = derivePortfolioManagerOverallSetupStatus({
      propertyUsesStatus: "APPLIED",
      metersStatus: nextMetersStatus,
      associationsStatus: nextAssociationsStatus,
      usageCoverageStatus: nextUsageCoverageStatus,
    });

    for (const row of updatedRows) {
      await tx.buildingPropertyUse.update({
        where: { id: row.id },
        data: {
          espmPropertyUseId: row.espmPropertyUseId,
          espmUseDetailsId: row.espmUseDetailsId,
        },
      });
    }

    await tx.portfolioManagerSetupState.upsert({
      where: { buildingId: _input.buildingId },
      create: {
        organizationId: _input.organizationId,
        buildingId: _input.buildingId,
        status: nextStatus,
        propertyUsesStatus: "APPLIED",
        metersStatus: nextMetersStatus,
        associationsStatus: nextAssociationsStatus,
        usageCoverageStatus: nextUsageCoverageStatus,
        latestJobId: _input.operationalJobId,
        latestErrorCode: null,
        latestErrorMessage: null,
        missingInputCodesJson: [],
        lastAppliedAt: new Date(),
        lastAttemptedAt: new Date(),
      },
      update: {
        status: nextStatus,
        propertyUsesStatus: "APPLIED",
        metersStatus: nextMetersStatus,
        associationsStatus: nextAssociationsStatus,
        usageCoverageStatus: nextUsageCoverageStatus,
        latestJobId: _input.operationalJobId,
        latestErrorCode: null,
        latestErrorMessage: null,
        missingInputCodesJson: [],
        lastAppliedAt: new Date(),
        lastAttemptedAt: new Date(),
      },
    });
  });

  return {
    buildingId: _input.buildingId,
    propertyUseCount: updatedRows.length,
  };
}

export async function markPortfolioManagerSetupFailed(_input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  errorCode: string;
  errorMessage: string;
  db?: PrismaClient;
}) {
  const db = _input.db ?? prisma;
  const context = await loadSetupContext({
    organizationId: _input.organizationId,
    buildingId: _input.buildingId,
    db,
  });
  const evaluated = evaluateSetupInputs({
    building: context.building,
    propertyUses:
      context.propertyUses.length > 0
        ? context.propertyUses.map((propertyUse) => ({
            id: propertyUse.id,
            sortOrder: propertyUse.sortOrder,
            useKey: propertyUse.useKey,
            displayName: propertyUse.displayName,
            grossSquareFeet: propertyUse.grossSquareFeet,
            details: toRecord(propertyUse.detailsJson),
          }))
        : buildDefaultPropertyUseInputs(context.building),
    latestErrorMessage: _input.errorMessage,
  });

  await db.portfolioManagerSetupState.upsert({
    where: { buildingId: _input.buildingId },
    create: {
      organizationId: _input.organizationId,
      buildingId: _input.buildingId,
      status: "NEEDS_ATTENTION",
      propertyUsesStatus:
        evaluated.propertyUsesStatus === "APPLIED"
          ? "NEEDS_ATTENTION"
          : evaluated.propertyUsesStatus,
      metersStatus: evaluated.metersStatus,
      associationsStatus: evaluated.associationsStatus,
      usageCoverageStatus: evaluated.usageCoverageStatus,
      latestJobId: _input.operationalJobId,
      latestErrorCode: _input.errorCode,
      latestErrorMessage: _input.errorMessage,
      missingInputCodesJson: Array.from(
        new Set([...evaluated.missingInputCodes, "PM_SETUP_REMOTE_CONFLICT"]),
      ),
      lastFailedAt: new Date(),
      lastAttemptedAt: new Date(),
    },
    update: {
      status: "NEEDS_ATTENTION",
      propertyUsesStatus:
        evaluated.propertyUsesStatus === "APPLIED"
          ? "NEEDS_ATTENTION"
          : evaluated.propertyUsesStatus,
      metersStatus: evaluated.metersStatus,
      associationsStatus: evaluated.associationsStatus,
      usageCoverageStatus: evaluated.usageCoverageStatus,
      latestJobId: _input.operationalJobId,
      latestErrorCode: _input.errorCode,
      latestErrorMessage: _input.errorMessage,
      missingInputCodesJson: Array.from(
        new Set([...evaluated.missingInputCodes, "PM_SETUP_REMOTE_CONFLICT"]),
      ),
      lastFailedAt: new Date(),
      lastAttemptedAt: new Date(),
    },
  });
}
