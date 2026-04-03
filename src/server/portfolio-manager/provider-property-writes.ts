import {
  PortfolioManagerManagement,
  Prisma,
  PrismaClient,
  PropertyType,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { ValidationError } from "@/server/lib/errors";
import { ESPMNotFoundError } from "@/server/integrations/espm";
import { resolvePortfolioManagerClientForOrganization } from "@/server/portfolio-manager/existing-account";
import { derivePrimaryFunctionFromUses, type BuildingPropertyUseKey } from "@/lib/buildings/property-use-registry";
import {
  parsePortfolioManagerMailingAddress,
  PORTFOLIO_MANAGER_MAILING_ADDRESS_ERROR,
} from "@/lib/buildings/portfolio-manager-address";

const PRIMARY_FUNCTION_BY_TYPE: Partial<Record<PropertyType, string>> = {
  OFFICE: "Office",
  MULTIFAMILY: "Multifamily Housing",
  MIXED_USE: "Mixed Use Property",
};

type BuildingWriteShape = {
  id: string;
  name: string;
  address: string;
  grossSquareFeet: number;
  propertyType: PropertyType;
  yearBuilt: number | null;
  plannedConstructionCompletionYear: number | null;
  occupancyRate: number | null;
  irrigatedAreaSquareFeet: number | null;
  numberOfBuildings: number;
  propertyUses: Array<{
    useKey: BuildingPropertyUseKey;
    displayName: string;
    grossSquareFeet: number;
    details: Record<string, unknown>;
  }>;
};

type BuildingWriteInput = Omit<BuildingWriteShape, "id">;

type ProviderManagedRecord = Pick<
  PortfolioManagerManagement,
  "managementMode" | "connectedAccountId"
>;

export type RemotePropertyDeleteAction = "DELETE_PROPERTY" | "UNSHARE_PROPERTY";

type ProviderPropertyPayload = {
  name: string;
  primaryFunction: string;
  grossFloorArea: number;
  yearBuilt: number;
  occupancyPercentage: number;
  numberOfBuildings: number;
  irrigatedAreaSquareFeet?: number;
  constructionStatus: "Existing" | "New";
  address: {
    address1: string;
    city: string;
    state: string;
    postalCode: string;
  };
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

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toNestedInputJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toNestedInputJsonValue(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toNestedInputJsonValue(entry)]),
    );
  }

  return String(value);
}

function toInputJsonValue(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const normalized = toNestedInputJsonValue(value);
  return normalized ?? Prisma.JsonNull;
}

function getPrimaryFunction(input: {
  propertyType: PropertyType;
  propertyUses: Array<{ useKey: BuildingPropertyUseKey }>;
}) {
  const derivedPrimaryFunction = derivePrimaryFunctionFromUses(
    input.propertyUses.map((propertyUse) => propertyUse.useKey),
  );
  if (derivedPrimaryFunction) {
    return derivedPrimaryFunction;
  }

  const primaryFunction = PRIMARY_FUNCTION_BY_TYPE[input.propertyType];
  if (!primaryFunction) {
    throw new ValidationError(
      "This building type cannot be created or updated in Portfolio Manager through the provider account yet.",
    );
  }

  return primaryFunction;
}

function parseProviderAddress(address: string) {
  const parsed = parsePortfolioManagerMailingAddress(address);

  if (!parsed) {
    throw new ValidationError(PORTFOLIO_MANAGER_MAILING_ADDRESS_ERROR);
  }

  return parsed;
}

function toProviderPropertyPayload(input: BuildingWriteInput): ProviderPropertyPayload {
  return {
    name: input.name,
    primaryFunction: getPrimaryFunction(input),
    grossFloorArea: input.grossSquareFeet,
    yearBuilt: input.yearBuilt ?? input.plannedConstructionCompletionYear ?? 2000,
    occupancyPercentage:
      input.occupancyRate != null
        ? Math.max(0, Math.min(100, Math.round(input.occupancyRate)))
        : 100,
    numberOfBuildings: input.numberOfBuildings,
    irrigatedAreaSquareFeet: input.irrigatedAreaSquareFeet ?? undefined,
    constructionStatus:
      input.yearBuilt == null && input.plannedConstructionCompletionYear != null
        ? "New"
        : "Existing",
    address: parseProviderAddress(input.address),
  };
}

function toConnectedAccountId(management: ProviderManagedRecord | null | undefined) {
  if (management?.managementMode !== "PROVIDER_SHARED") {
    throw new ValidationError(
      "Provider-connected Portfolio Manager is not active for this organization.",
    );
  }

  if (management.connectedAccountId == null) {
    throw new ValidationError(
      "Save the customer's ESPM username and complete the provider connection before creating or editing Portfolio Manager properties.",
    );
  }

  return Number(management.connectedAccountId);
}

export function deriveRemotePropertyDeleteAction(input: {
  managementMode: string | null | undefined;
  connectedAccountId: bigint | number | null | undefined;
  rawPayloadJson?: unknown;
}): RemotePropertyDeleteAction {
  if (input.managementMode !== "PROVIDER_SHARED") {
    return "DELETE_PROPERTY";
  }

  const connectedAccountId =
    input.connectedAccountId == null ? null : Number(input.connectedAccountId);
  if (!Number.isFinite(connectedAccountId)) {
    return "UNSHARE_PROPERTY";
  }

  const property = toArray<Record<string, unknown>>(
    toRecord(input.rawPayloadJson).property,
  )[0];
  const audit = toRecord(property?.audit);
  const createdByAccountId = getNumber(audit.createdByAccountId);
  const lastUpdatedByAccountId = getNumber(audit.lastUpdatedByAccountId);

  if (
    createdByAccountId === connectedAccountId ||
    lastUpdatedByAccountId === connectedAccountId
  ) {
    return "DELETE_PROPERTY";
  }

  return "UNSHARE_PROPERTY";
}

async function upsertRemotePropertyCache(input: {
  organizationId: string;
  buildingId: string;
  connectedAccountId: number;
  propertyId: number;
  building: BuildingWriteInput;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const now = new Date();
  const primaryFunction = getPrimaryFunction(input.building);

  await db.portfolioManagerRemoteProperty.upsert({
    where: {
      organizationId_propertyId: {
        organizationId: input.organizationId,
        propertyId: BigInt(input.propertyId),
      },
    },
    create: {
      organizationId: input.organizationId,
      linkedBuildingId: input.buildingId,
      remoteAccountId: BigInt(input.connectedAccountId),
      propertyId: BigInt(input.propertyId),
      shareStatus: "ACCEPTED",
      localSuppressedAt: null,
      localSuppressedByType: null,
      localSuppressedById: null,
      name: input.building.name,
      address: input.building.address,
      primaryFunction,
      grossSquareFeet: input.building.grossSquareFeet,
      yearBuilt: input.building.yearBuilt,
      propertyUsesJson: toInputJsonValue(input.building.propertyUses),
      usageSummaryJson: {},
      latestMetricsJson: {},
      rawPayloadJson: {
        source: "QUOIN_PROVIDER_PROPERTY_WRITE",
      },
      lastAcceptedAt: now,
      lastSyncedAt: now,
      latestErrorCode: null,
      latestErrorMessage: null,
    },
    update: {
      linkedBuildingId: input.buildingId,
      remoteAccountId: BigInt(input.connectedAccountId),
      shareStatus: "ACCEPTED",
      localSuppressedAt: null,
      localSuppressedByType: null,
      localSuppressedById: null,
      name: input.building.name,
      address: input.building.address,
      primaryFunction,
      grossSquareFeet: input.building.grossSquareFeet,
      yearBuilt: input.building.yearBuilt,
      propertyUsesJson: toInputJsonValue(input.building.propertyUses),
      rawPayloadJson: {
        source: "QUOIN_PROVIDER_PROPERTY_WRITE",
      },
      lastAcceptedAt: now,
      lastSyncedAt: now,
      latestErrorCode: null,
      latestErrorMessage: null,
    },
  });
}

async function loadProviderManagement(input: {
  organizationId: string;
  db?: PrismaClient;
}) {
  return (input.db ?? prisma).portfolioManagerManagement.findUnique({
    where: { organizationId: input.organizationId },
  });
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

export async function createProviderSharedPropertyForBuilding(input: {
  organizationId: string;
  building: BuildingWriteShape;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const management = await loadProviderManagement({
    organizationId: input.organizationId,
    db,
  });
  const connectedAccountId = toConnectedAccountId(management);
  const espmClient = await resolvePortfolioManagerClientForOrganization({
    organizationId: input.organizationId,
    db,
  });
  const response = await espmClient.property.createProperty(
    connectedAccountId,
    toProviderPropertyPayload(input.building),
  );
  const propertyId = extractCreatedEntityId(response);

  if (!propertyId) {
    throw new ValidationError(
      "Portfolio Manager property creation did not return a property id.",
    );
  }

  await upsertRemotePropertyCache({
    organizationId: input.organizationId,
    buildingId: input.building.id,
    connectedAccountId,
    propertyId,
    building: input.building,
    db,
  });

  return {
    connectedAccountId,
    propertyId,
  };
}

export async function updateProviderSharedPropertyForBuilding(input: {
  organizationId: string;
  propertyId: string;
  building: BuildingWriteShape;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const management = await loadProviderManagement({
    organizationId: input.organizationId,
    db,
  });
  const connectedAccountId = toConnectedAccountId(management);
  const numericPropertyId = Number(input.propertyId);

  if (!Number.isFinite(numericPropertyId)) {
    throw new ValidationError("Portfolio Manager property id is invalid.");
  }

  const espmClient = await resolvePortfolioManagerClientForOrganization({
    organizationId: input.organizationId,
    db,
  });
  await espmClient.property.updateProperty(
    numericPropertyId,
    toProviderPropertyPayload(input.building),
  );

  await upsertRemotePropertyCache({
    organizationId: input.organizationId,
    buildingId: input.building.id,
    connectedAccountId,
    propertyId: numericPropertyId,
    building: input.building,
    db,
  });

  return {
    connectedAccountId,
    propertyId: numericPropertyId,
  };
}

export async function deleteRemotePropertyForBuilding(input: {
  organizationId: string;
  propertyId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const numericPropertyId = Number(input.propertyId);

  if (!Number.isFinite(numericPropertyId)) {
    throw new ValidationError("Portfolio Manager property id is invalid.");
  }

  const management = await loadProviderManagement({
    organizationId: input.organizationId,
    db,
  });
  const remoteProperty = await db.portfolioManagerRemoteProperty.findUnique({
    where: {
      organizationId_propertyId: {
        organizationId: input.organizationId,
        propertyId: BigInt(numericPropertyId),
      },
    },
    select: {
      rawPayloadJson: true,
    },
  });

  const espmClient = await resolvePortfolioManagerClientForOrganization({
    organizationId: input.organizationId,
    db,
  });

  let alreadyMissing = false;
  const remoteAction = deriveRemotePropertyDeleteAction({
    managementMode: management?.managementMode,
    connectedAccountId: management?.connectedAccountId ?? null,
    rawPayloadJson: remoteProperty?.rawPayloadJson,
  });

  try {
    if (remoteAction === "UNSHARE_PROPERTY") {
      await espmClient.property.unshareProperty(numericPropertyId);
    } else {
      await espmClient.property.deleteProperty(numericPropertyId);
    }
  } catch (error) {
    if (error instanceof ESPMNotFoundError) {
      alreadyMissing = true;
    } else {
      throw error;
    }
  }

  await db.portfolioManagerRemoteProperty.deleteMany({
    where: {
      organizationId: input.organizationId,
      propertyId: BigInt(numericPropertyId),
    },
  });

  return {
    propertyId: numericPropertyId,
    alreadyMissing,
    remoteAction,
  };
}
