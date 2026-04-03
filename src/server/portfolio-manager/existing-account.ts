import type { PrismaClient, PropertyType } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog, type CreateAuditLogInput } from "@/server/lib/audit-log";
import { QUEUES, withQueue } from "@/server/lib/queue";
import { createJob, JOB_STATUS, markDead } from "@/server/lib/jobs";
import {
  AppError,
  ConfigError,
  ValidationError,
  WorkflowStateError,
} from "@/server/lib/errors";
import {
  createESPMClient,
  createESPMClientFromCredentials,
  ESPMAccessError,
  type ESPM,
} from "@/server/integrations/espm";
import { parsePortfolioManagerProperty } from "@/server/compliance/portfolio-manager-support";
import {
  getSecretEnvelopeVersion,
  openSecret,
  sealSecret,
} from "@/server/lib/crypto/secret-envelope";
import { requireEspmCredentialMasterKey } from "@/server/lib/config";
import { BEPS_TARGET_SCORES } from "@/lib/buildings/beps-targets";
import { buildPortfolioManagerImportEnvelope } from "@/server/pipelines/portfolio-manager-import/envelope";
import { withAdvisoryTransactionLock } from "@/server/lib/transaction-lock";
import { getPmRuntimeHealth } from "@/server/lib/runtime-health";
import { mapWithConcurrency } from "@/server/lib/async";

const EXISTING_ACCOUNT_USERNAME_PURPOSE = "espm-existing-account-username";
const EXISTING_ACCOUNT_PASSWORD_PURPOSE = "espm-existing-account-password";
const DEFAULT_BUILDING_COORDINATES = {
  latitude: 38.9072,
  longitude: -77.0369,
} as const;
const PORTFOLIO_MANAGER_EXISTING_IMPORT_JOB_TYPE =
  "PORTFOLIO_MANAGER_EXISTING_ACCOUNT_IMPORT";
const EXISTING_ACCOUNT_IMPORT_STALE_THRESHOLD_MS = 10 * 60_000;

export const ESPM_CREDENTIAL_ENCRYPTION_VERSION = getSecretEnvelopeVersion();

type PortfolioManagerManagementRecord = Awaited<
  ReturnType<typeof prisma.portfolioManagerManagement.findUnique>
>;

type ExistingAccountPropertyPreview = {
  propertyId: string;
  name: string | null;
  address: string | null;
  primaryFunction: string | null;
  grossSquareFeet: number | null;
  yearBuilt: number | null;
  localPropertyType: PropertyType | null;
  bepsTargetScore: number | null;
  disabledReason: string | null;
};

type ExistingAccountPropertyState = ExistingAccountPropertyPreview & {
  alreadyImported: boolean;
  linkedBuildingId: string | null;
  linkedBuildingName: string | null;
  importable: boolean;
};

type ExistingAccountImportResult = {
  propertyId: string;
  status: "IMPORTED" | "SKIPPED" | "FAILED";
  message: string;
  buildingId?: string | null;
  buildingName?: string | null;
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

function extractNumericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function sanitizeUsername(username: string) {
  return username.trim();
}

function parseAccountId(raw: unknown) {
  const account = toRecord(toRecord(raw).account);
  const accountId = extractNumericId(account["@_id"] ?? account.id);

  if (accountId == null) {
    throw new ValidationError(
      "Portfolio Manager account validation did not return an account id.",
    );
  }

  return accountId;
}

function parseWebserviceUserEnabled(raw: unknown) {
  const account = toRecord(toRecord(raw).account);
  const accountInfo = toRecord(account.accountInfo);
  const value = accountInfo.webserviceUser;

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }

    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return null;
}

function parsePropertyIds(raw: unknown) {
  const response = toRecord(toRecord(raw).response);
  const responseLinks = toRecord(response.links);
  const links = toArray<Record<string, unknown>>(
    responseLinks.link ?? response.link,
  );
  const propertyIds = new Set<number>();

  for (const link of links) {
    const directId = extractNumericId(link["@_id"]);
    if (directId != null) {
      propertyIds.add(directId);
      continue;
    }

    const href = typeof link["@_link"] === "string" ? link["@_link"] : null;
    const match = href?.match(/\/property\/(\d+)(?:\/|$)/);
    if (match) {
      propertyIds.add(Number(match[1]));
    }
  }

  return Array.from(propertyIds);
}

function composeAddress(input: {
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}) {
  const parts = [
    input.addressLine1,
    input.city && input.state && input.postalCode
      ? `${input.city}, ${input.state} ${input.postalCode}`
      : [input.city, input.state, input.postalCode].filter(Boolean).join(" "),
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));

  return parts.length > 0 ? parts.join(", ") : null;
}

function mapPrimaryFunctionToPropertyType(
  primaryFunction: string | null,
): PropertyType {
  const normalized = primaryFunction?.trim().toLowerCase() ?? "";

  if (normalized === "office") {
    return "OFFICE";
  }

  if (normalized === "multifamily housing") {
    return "MULTIFAMILY";
  }

  if (
    normalized === "mixed use property" ||
    normalized === "mixed-use property" ||
    normalized === "mixed use" ||
    normalized === "mixed-use"
  ) {
    return "MIXED_USE";
  }

  return "OTHER";
}

function buildPropertyPreview(snapshot: ReturnType<typeof parsePortfolioManagerProperty>) {
  const localPropertyType = mapPrimaryFunctionToPropertyType(snapshot.primaryFunction);

  return {
    propertyId: String(snapshot.propertyId),
    name: snapshot.name,
    address: composeAddress({
      addressLine1: snapshot.addressLine1,
      city: snapshot.city,
      state: snapshot.state,
      postalCode: snapshot.postalCode,
    }),
    primaryFunction: snapshot.primaryFunction,
    grossSquareFeet:
      snapshot.grossFloorArea != null && Number.isFinite(snapshot.grossFloorArea)
        ? Math.round(snapshot.grossFloorArea)
        : null,
    yearBuilt: snapshot.yearBuilt,
    localPropertyType,
    bepsTargetScore: BEPS_TARGET_SCORES[localPropertyType] ?? null,
    disabledReason: null,
  } satisfies ExistingAccountPropertyPreview;
}

function parseCachedProperties(value: unknown): ExistingAccountPropertyPreview[] {
  const record = toRecord(value);
  const properties = toArray<Record<string, unknown>>(record.properties);

  return properties
    .map((item) => {
      const propertyIdRaw = item.propertyId;
      const propertyId =
        typeof propertyIdRaw === "string" && propertyIdRaw.trim().length > 0
          ? propertyIdRaw.trim()
          : null;

      if (!propertyId) {
        return null;
      }

      const localPropertyTypeRaw =
        typeof item.localPropertyType === "string"
          ? item.localPropertyType
          : null;
      const localPropertyType =
        localPropertyTypeRaw === "OFFICE" ||
        localPropertyTypeRaw === "MULTIFAMILY" ||
        localPropertyTypeRaw === "MIXED_USE" ||
        localPropertyTypeRaw === "OTHER"
          ? (localPropertyTypeRaw as PropertyType)
          : null;

      return {
        propertyId,
        name: typeof item.name === "string" ? item.name : null,
        address: typeof item.address === "string" ? item.address : null,
        primaryFunction:
          typeof item.primaryFunction === "string" ? item.primaryFunction : null,
        grossSquareFeet:
          typeof item.grossSquareFeet === "number" &&
          Number.isFinite(item.grossSquareFeet)
            ? Math.round(item.grossSquareFeet)
            : null,
        yearBuilt:
          typeof item.yearBuilt === "number" && Number.isFinite(item.yearBuilt)
            ? Math.round(item.yearBuilt)
            : null,
        localPropertyType,
        bepsTargetScore:
          typeof item.bepsTargetScore === "number" &&
          Number.isFinite(item.bepsTargetScore)
            ? item.bepsTargetScore
            : null,
        disabledReason:
          typeof item.disabledReason === "string" ? item.disabledReason : null,
      } satisfies ExistingAccountPropertyPreview;
    })
    .filter((item): item is ExistingAccountPropertyPreview => item != null);
}

function buildManagementFailureState(
  existing: PortfolioManagerManagementRecord | null,
  message: string,
) {
  return {
    status: "FAILED",
    latestErrorCode: "PM_EXISTING_ACCOUNT_CONNECT_FAILED",
    latestErrorMessage: message,
  } as const;
}

function buildCredentialUpdate(input: {
  username: string;
  password: string;
  masterKey: string;
}) {
  return {
    connectedUsername: sanitizeUsername(input.username),
    usernameEncrypted: sealSecret({
      plaintext: sanitizeUsername(input.username),
      masterKey: input.masterKey,
      purpose: EXISTING_ACCOUNT_USERNAME_PURPOSE,
    }),
    passwordEncrypted: sealSecret({
      plaintext: input.password,
      masterKey: input.masterKey,
      purpose: EXISTING_ACCOUNT_PASSWORD_PURPOSE,
    }),
    credentialEncryptionVersion: ESPM_CREDENTIAL_ENCRYPTION_VERSION,
  };
}

function resolveExistingAccountCredentials(input: {
  management: NonNullable<PortfolioManagerManagementRecord>;
  masterKey: string;
}) {
  if (
    input.management.credentialEncryptionVersion !== ESPM_CREDENTIAL_ENCRYPTION_VERSION
  ) {
    throw new ConfigError(
      "Unsupported ESPM credential encryption version.",
    );
  }

  if (
    !input.management.usernameEncrypted ||
    !input.management.passwordEncrypted
  ) {
    throw new ValidationError(
      "Existing Portfolio Manager credentials are not stored for this organization.",
    );
  }

  return {
    username: openSecret({
      envelope: input.management.usernameEncrypted,
      masterKey: input.masterKey,
      purpose: EXISTING_ACCOUNT_USERNAME_PURPOSE,
    }),
    password: openSecret({
      envelope: input.management.passwordEncrypted,
      masterKey: input.masterKey,
      purpose: EXISTING_ACCOUNT_PASSWORD_PURPOSE,
    }),
  };
}

async function fetchPropertyPreviewCache(input: {
  espmClient: ESPM;
  connectedAccountId: number;
}) {
  const propertyIds = parsePropertyIds(
    await input.espmClient.property.listProperties(input.connectedAccountId),
  );

  const rawSnapshots = await mapWithConcurrency(propertyIds, 4, async (propertyId) =>
    parsePortfolioManagerProperty(
      await input.espmClient.property.getProperty(propertyId),
      propertyId,
    ),
  );

  return rawSnapshots
    .map(buildPropertyPreview)
    .sort((left, right) => {
      const leftName = left.name ?? "";
      const rightName = right.name ?? "";
      return leftName.localeCompare(rightName) || left.propertyId.localeCompare(right.propertyId);
    });
}

function buildWebserviceDisabledError() {
  return new ValidationError(
    "This ESPM account is not enabled for web services. In Portfolio Manager, open Account Settings for this account, enable web services, then refresh the property list in Quoin.",
  );
}

function toDirectAccountPropertyAccessError(
  error: unknown,
  options?: {
    webserviceUserEnabled?: boolean | null;
  },
) {
  if (options?.webserviceUserEnabled === false) {
    return buildWebserviceDisabledError();
  }

  if (error instanceof ESPMAccessError) {
    return new ValidationError(
      "ESPM accepted these credentials, but this account still cannot list properties through the web service. Make sure this exact account directly owns or manages the properties you want Quoin to import.",
    );
  }

  return error;
}

async function buildExistingAccountPropertyStates(input: {
  organizationId: string;
  management: PortfolioManagerManagementRecord;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const cachedProperties = parseCachedProperties(input.management?.propertyCacheJson);
  const propertyIds = cachedProperties.map((property) => BigInt(property.propertyId));

  const linkedBuildings =
    propertyIds.length > 0
      ? await db.building.findMany({
          where: {
            organizationId: input.organizationId,
            espmPropertyId: {
              in: propertyIds,
            },
          },
          select: {
            id: true,
            name: true,
            espmPropertyId: true,
          },
        })
      : [];

  const buildingByPropertyId = new Map(
    linkedBuildings
      .filter((building) => building.espmPropertyId != null)
      .map((building) => [building.espmPropertyId!.toString(), building]),
  );

  return cachedProperties.map((property) => {
    const linkedBuilding = buildingByPropertyId.get(property.propertyId) ?? null;
    const alreadyImported = linkedBuilding != null;
    return {
      ...property,
      alreadyImported,
      linkedBuildingId: linkedBuilding?.id ?? null,
      linkedBuildingName: linkedBuilding?.name ?? null,
      importable: property.disabledReason == null && !alreadyImported,
    } satisfies ExistingAccountPropertyState;
  });
}

function ensureExistingAccountManagement(
  management: PortfolioManagerManagementRecord,
): asserts management is NonNullable<PortfolioManagerManagementRecord> {
  if (!management || management.managementMode !== "EXISTING_ESPM") {
    throw new ValidationError(
      "Connect or reconnect the customer's ESPM account directly before syncing Portfolio Manager data for this organization.",
    );
  }
}

function buildDirectAccountReconnectError() {
  return new ValidationError(
    "Connect or reconnect the customer's ESPM account directly before syncing Portfolio Manager data for this organization.",
  );
}

function buildProviderShareConnectionError() {
  return new ValidationError(
    "Save the customer's ESPM username and finish the provider-share connection before syncing Portfolio Manager data for this organization.",
  );
}

async function loadExistingAccountManagement(input: {
  organizationId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  return db.portfolioManagerManagement.findUnique({
    where: { organizationId: input.organizationId },
  });
}

async function reconcileExistingAccountImportState(input: {
  organizationId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const importState = await db.portfolioManagerImportState.findUnique({
    where: { organizationId: input.organizationId },
  });

  if (!importState || (importState.status !== "QUEUED" && importState.status !== "RUNNING")) {
    return importState;
  }

  const latestJob =
    importState.latestJobId == null
      ? null
      : await db.job.findUnique({
          where: { id: importState.latestJobId },
          select: {
            id: true,
            status: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
            lastError: true,
          },
        });

  const now = new Date();
  const latestErrorMessage =
    latestJob == null
      ? "The latest Portfolio Manager import job could not be found. Retry the import."
      : latestJob.status === JOB_STATUS.FAILED || latestJob.status === JOB_STATUS.DEAD
        ? latestJob.lastError ??
          "The latest Portfolio Manager import failed before completion. Retry the import."
        : latestJob.status === JOB_STATUS.COMPLETED
          ? "The latest Portfolio Manager import completed, but the import runtime state was not updated."
          : (() => {
              const ageFrom = latestJob.startedAt ?? latestJob.createdAt;
              const ageMs = now.getTime() - ageFrom.getTime();
              if (ageMs <= EXISTING_ACCOUNT_IMPORT_STALE_THRESHOLD_MS) {
                return null;
              }

              return "The latest Portfolio Manager import stalled before completion. Retry the import.";
            })();

  if (!latestErrorMessage) {
    return importState;
  }

  const failedAt = new Date();
  const updatedImportState = await db.portfolioManagerImportState.update({
    where: { organizationId: input.organizationId },
    data: {
      status: "FAILED",
      latestErrorCode: "PM_EXISTING_ACCOUNT_IMPORT_STALLED",
      latestErrorMessage,
      lastFailedAt: failedAt,
    },
  });

  await db.portfolioManagerManagement.updateMany({
    where: {
      organizationId: input.organizationId,
      managementMode: "EXISTING_ESPM",
    },
    data: {
      latestJobId: updatedImportState.latestJobId,
      latestErrorCode: "PM_EXISTING_ACCOUNT_IMPORT_STALLED",
      latestErrorMessage,
    },
  });

  return updatedImportState;
}

async function refreshPropertyCacheWithStoredCredentials(input: {
  organizationId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const management = await loadExistingAccountManagement({
    organizationId: input.organizationId,
    db,
  });
  ensureExistingAccountManagement(management);

  const masterKey = requireEspmCredentialMasterKey();
  const credentials = resolveExistingAccountCredentials({
    management,
    masterKey,
  });
  const espmClient = createESPMClientFromCredentials(credentials);
  const accountProfile = await espmClient.account.getAccount();
  const connectedAccountId =
    management.connectedAccountId != null
      ? Number(management.connectedAccountId)
      : parseAccountId(accountProfile);
  const webserviceUserEnabled = parseWebserviceUserEnabled(accountProfile);
  if (webserviceUserEnabled === false) {
    throw buildWebserviceDisabledError();
  }
  let properties;
  try {
    properties = await fetchPropertyPreviewCache({
      espmClient,
      connectedAccountId,
    });
  } catch (error) {
    throw toDirectAccountPropertyAccessError(error, {
      webserviceUserEnabled,
    });
  }

  const updatedManagement = await db.portfolioManagerManagement.update({
    where: { organizationId: input.organizationId },
    data: {
      status: "READY",
      connectedAccountId: BigInt(connectedAccountId),
      lastValidatedAt: new Date(),
      propertyCacheJson: {
        properties,
      },
      propertyCacheRefreshedAt: new Date(),
      latestErrorCode: null,
      latestErrorMessage: null,
    },
  });

  return {
    management: updatedManagement,
    properties,
  };
}

export async function getPortfolioManagerConnectionStateForOrganization(input: {
  organizationId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const [management, initialImportState] = await Promise.all([
    loadExistingAccountManagement({
      organizationId: input.organizationId,
      db,
    }),
    reconcileExistingAccountImportState({
      organizationId: input.organizationId,
      db,
    }),
  ]);
  const importState = initialImportState;

  const properties =
    management?.managementMode === "EXISTING_ESPM"
      ? await buildExistingAccountPropertyStates({
          organizationId: input.organizationId,
          management,
          db,
        })
      : [];

  const summaryState =
    management?.managementMode === "QUOIN_MANAGED"
      ? "QUOIN_MANAGED"
      : management?.managementMode === "PROVIDER_SHARED"
        ? "NEEDS_RECONNECT"
      : importState?.status === "RUNNING" || importState?.status === "QUEUED"
        ? "IMPORT_RUNNING"
      : importState?.status === "FAILED"
          ? "IMPORT_FAILED"
        : importState?.status === "SUCCEEDED"
            ? "IMPORT_SUCCEEDED"
          : management?.managementMode === "EXISTING_ESPM" &&
              management.status === "FAILED"
            ? "FAILED"
          : management?.managementMode === "EXISTING_ESPM" &&
              management.status === "RUNNING"
            ? "VALIDATING"
          : management?.managementMode === "EXISTING_ESPM" &&
                management.status === "READY"
              ? "CONNECTED"
              : "NOT_CONNECTED";
  const runtimeHealth = await getPmRuntimeHealth({
    latestJobId: importState?.latestJobId ?? null,
    active:
      importState?.status === "RUNNING" ||
      importState?.status === "QUEUED" ||
      (management?.managementMode === "EXISTING_ESPM" && management.status === "RUNNING"),
    db,
  });

  return {
    management,
    importState,
    properties,
    runtimeHealth,
    summary: {
      state: summaryState,
      latestErrorMessage:
        management?.managementMode === "PROVIDER_SHARED"
          ? "This organization now syncs through Quoin's provider account instead of a direct ESPM password."
          : importState?.latestErrorMessage ?? management?.latestErrorMessage ?? null,
    },
  };
}

export async function connectExistingAccountForOrganization(input: {
  organizationId: string;
  username: string;
  password: string;
  actorType: CreateAuditLogInput["actorType"];
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const existing = await loadExistingAccountManagement({
    organizationId: input.organizationId,
    db,
  });
  const sanitizedUsername = sanitizeUsername(input.username);

  if (existing?.managementMode === "QUOIN_MANAGED") {
    throw new ValidationError(
      "Quoin-managed Portfolio Manager is already enabled for this organization.",
    );
  }

  await db.portfolioManagerManagement.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      managementMode: "EXISTING_ESPM",
      status: "RUNNING",
      connectedUsername: sanitizedUsername,
      providerCustomerId: null,
      targetUsername: null,
      latestErrorCode: null,
      latestErrorMessage: null,
    },
    update: {
      managementMode: "EXISTING_ESPM",
      status: "RUNNING",
      connectedUsername: sanitizedUsername,
      providerCustomerId: null,
      targetUsername: null,
      lastConnectionCheckedAt: null,
      lastConnectionAcceptedAt: null,
      lastShareAcceptedAt: null,
      lifecycleMetadataJson: {},
      latestErrorCode: null,
      latestErrorMessage: null,
    },
  });

  let connectedAccountId: number | null = null;
  let validatedAt: Date | null = null;
  let credentialUpdate:
    | ReturnType<typeof buildCredentialUpdate>
    | null = null;
  let webserviceUserEnabled: boolean | null = null;

  try {
    const masterKey = requireEspmCredentialMasterKey();
    credentialUpdate = buildCredentialUpdate({
      username: input.username,
      password: input.password,
      masterKey,
    });
    const espmClient = createESPMClientFromCredentials({
      username: input.username,
      password: input.password,
    });
    const accountProfile = await espmClient.account.getAccount();
    connectedAccountId = parseAccountId(accountProfile);
    webserviceUserEnabled = parseWebserviceUserEnabled(accountProfile);
    validatedAt = new Date();
    if (webserviceUserEnabled === false) {
      throw buildWebserviceDisabledError();
    }
    let properties;
    try {
      properties = await fetchPropertyPreviewCache({
        espmClient,
        connectedAccountId,
      });
    } catch (error) {
      throw toDirectAccountPropertyAccessError(error, {
        webserviceUserEnabled,
      });
    }

    const management = await db.portfolioManagerManagement.update({
      where: { organizationId: input.organizationId },
      data: {
        managementMode: "EXISTING_ESPM",
        status: "READY",
        connectedAccountId: BigInt(connectedAccountId),
        ...credentialUpdate,
        providerCustomerId: null,
        targetUsername: null,
        lastValidatedAt: validatedAt,
        lastConnectionCheckedAt: null,
        lastConnectionAcceptedAt: null,
        lastShareAcceptedAt: null,
        propertyCacheJson: {
          properties,
        },
        propertyCacheRefreshedAt: new Date(),
        lifecycleMetadataJson: {},
        latestErrorCode: null,
        latestErrorMessage: null,
      },
    });

    await createAuditLog({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
      requestId: input.requestId ?? null,
      action: "portfolio_manager.existing_account.connected",
      outputSnapshot: {
        connectedAccountId,
        propertyCount: properties.length,
      },
    });

    return {
      management,
      properties: await buildExistingAccountPropertyStates({
        organizationId: input.organizationId,
        management,
        db,
      }),
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager credentials could not be validated.";

    await db.portfolioManagerManagement.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        managementMode: "EXISTING_ESPM",
        ...buildManagementFailureState(existing ?? null, message),
        connectedUsername: sanitizedUsername,
        connectedAccountId:
          connectedAccountId != null ? BigInt(connectedAccountId) : null,
        ...(credentialUpdate ?? {}),
        lastValidatedAt: validatedAt,
        providerCustomerId: null,
        targetUsername: null,
      },
      update: {
        managementMode: "EXISTING_ESPM",
        connectedUsername: sanitizedUsername,
        connectedAccountId:
          connectedAccountId != null ? BigInt(connectedAccountId) : existing?.connectedAccountId,
        ...(credentialUpdate ?? {}),
        lastValidatedAt: validatedAt ?? existing?.lastValidatedAt ?? null,
        providerCustomerId: null,
        targetUsername: null,
        lastConnectionCheckedAt: null,
        lastConnectionAcceptedAt: null,
        lastShareAcceptedAt: null,
        lifecycleMetadataJson: {},
        ...buildManagementFailureState(existing ?? null, message),
      },
    });

    await createAuditLog({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
      requestId: input.requestId ?? null,
      action: "portfolio_manager.existing_account.connect_failed",
      errorCode:
        error instanceof AppError ? error.code : "PM_EXISTING_ACCOUNT_CONNECT_FAILED",
      outputSnapshot: {
        message,
      },
    });

    throw error;
  }
}

export async function refreshExistingAccountPropertiesForOrganization(input: {
  organizationId: string;
  actorType: CreateAuditLogInput["actorType"];
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const management = await loadExistingAccountManagement({
    organizationId: input.organizationId,
    db,
  });
  ensureExistingAccountManagement(management);

  await db.portfolioManagerManagement.update({
    where: { organizationId: input.organizationId },
    data: {
      status: "RUNNING",
      latestErrorCode: null,
      latestErrorMessage: null,
    },
  });

  try {
    const result = await refreshPropertyCacheWithStoredCredentials({
      organizationId: input.organizationId,
      db,
    });

    await createAuditLog({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
      requestId: input.requestId ?? null,
      action: "portfolio_manager.existing_account.properties_refreshed",
      outputSnapshot: {
        propertyCount: result.properties.length,
      },
    });

    return {
      management: result.management,
      properties: await buildExistingAccountPropertyStates({
        organizationId: input.organizationId,
        management: result.management,
        db,
      }),
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager properties could not be refreshed.";

    await db.portfolioManagerManagement.update({
      where: { organizationId: input.organizationId },
      data: {
        status: "FAILED",
        latestErrorCode: "PM_EXISTING_ACCOUNT_REFRESH_FAILED",
        latestErrorMessage: message,
      },
    });

    await createAuditLog({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
      requestId: input.requestId ?? null,
      action: "portfolio_manager.existing_account.refresh_failed",
      errorCode:
        error instanceof AppError ? error.code : "PM_EXISTING_ACCOUNT_REFRESH_FAILED",
      outputSnapshot: {
        message,
      },
    });

    throw error;
  }
}

export async function resolvePortfolioManagerClientForOrganization(input: {
  organizationId: string;
  espmFactory?: (() => ESPM) | undefined;
  db?: PrismaClient;
}) {
  if (input.espmFactory) {
    return input.espmFactory();
  }

  const db = input.db ?? prisma;
  const management = await loadExistingAccountManagement({
    organizationId: input.organizationId,
    db,
  });

  if (management?.managementMode === "QUOIN_MANAGED") {
    return createESPMClient();
  }

  if (management?.managementMode === "PROVIDER_SHARED") {
    return createESPMClient();
  }

  if (!management) {
    throw buildProviderShareConnectionError();
  }

  if (management.managementMode !== "EXISTING_ESPM") {
    throw buildProviderShareConnectionError();
  }

  const masterKey = requireEspmCredentialMasterKey();
  const credentials = resolveExistingAccountCredentials({
    management,
    masterKey,
  });

  return createESPMClientFromCredentials(credentials);
}

export async function enqueueExistingAccountPropertyImport(input: {
  organizationId: string;
  propertyIds: string[];
  requestId?: string | null;
  actorType: CreateAuditLogInput["actorType"];
  actorId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  await reconcileExistingAccountImportState({
    organizationId: input.organizationId,
    db,
  });
  const management = await loadExistingAccountManagement({
    organizationId: input.organizationId,
    db,
  });
  ensureExistingAccountManagement(management);

  const properties = await buildExistingAccountPropertyStates({
    organizationId: input.organizationId,
    management,
    db,
  });
  const propertyById = new Map(properties.map((property) => [property.propertyId, property]));
  const dedupedPropertyIds = Array.from(new Set(input.propertyIds)).filter(Boolean);

  if (dedupedPropertyIds.length === 0) {
    throw new ValidationError("Select at least one Portfolio Manager property to import.");
  }

  for (const propertyId of dedupedPropertyIds) {
    const property = propertyById.get(propertyId);
    if (!property) {
      throw new ValidationError(
        `Portfolio Manager property ${propertyId} is not available in the current review set.`,
      );
    }

    if (!property.importable) {
      throw new ValidationError(
        property.disabledReason ??
          `Portfolio Manager property ${propertyId} cannot be imported.`,
      );
    }
  }

  const { job, now } = await withAdvisoryTransactionLock(
    db,
    `pm-existing-import:${input.organizationId}`,
    async (tx) => {
      const existingImportState = await tx.portfolioManagerImportState.findUnique({
        where: { organizationId: input.organizationId },
        select: {
          status: true,
          latestJobId: true,
        },
      });

      if (
        (existingImportState?.status === "QUEUED" ||
          existingImportState?.status === "RUNNING") &&
        (existingImportState?.latestJobId ?? "").length > 0
      ) {
        throw new WorkflowStateError(
          "Portfolio Manager existing-account import is already queued or running.",
        );
      }

      const queuedJob = await createJob(
        {
          type: PORTFOLIO_MANAGER_EXISTING_IMPORT_JOB_TYPE,
          status: JOB_STATUS.QUEUED,
          organizationId: input.organizationId,
          maxAttempts: 3,
        },
        tx,
      );
      const queuedAt = new Date();

      await tx.portfolioManagerImportState.upsert({
        where: { organizationId: input.organizationId },
        create: {
          organizationId: input.organizationId,
          status: "QUEUED",
          latestJobId: queuedJob.id,
          selectedPropertyIdsJson: dedupedPropertyIds,
          resultSummaryJson: {
            results: [],
          },
          selectedCount: dedupedPropertyIds.length,
          importedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          lastAttemptedAt: queuedAt,
        },
        update: {
          status: "QUEUED",
          latestJobId: queuedJob.id,
          selectedPropertyIdsJson: dedupedPropertyIds,
          resultSummaryJson: {
            results: [],
          },
          selectedCount: dedupedPropertyIds.length,
          importedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          latestErrorCode: null,
          latestErrorMessage: null,
          lastAttemptedAt: queuedAt,
        },
      });

      await tx.portfolioManagerManagement.update({
        where: { organizationId: input.organizationId },
        data: {
          latestJobId: queuedJob.id,
          latestErrorCode: null,
          latestErrorMessage: null,
        },
      });

      return {
        job: queuedJob,
        now: queuedAt,
      };
    },
  );

  const envelope = buildPortfolioManagerImportEnvelope({
    requestId: input.requestId,
    organizationId: input.organizationId,
    operationalJobId: job.id,
    propertyIds: dedupedPropertyIds,
    triggeredAt: now,
  });
  const queueJobId = `pm-import-${job.id}`;
  try {
    await withQueue(QUEUES.PORTFOLIO_MANAGER_IMPORT, async (queue) => {
      await queue.add("portfolio-manager-existing-account-import", envelope, {
        jobId: queueJobId,
      });
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager import could not be queued.";

    await markExistingAccountImportFailed({
      organizationId: input.organizationId,
      operationalJobId: job.id,
      errorCode: "PM_EXISTING_ACCOUNT_IMPORT_QUEUE_FAILED",
      errorMessage: message,
      db,
    });
    await markDead(job.id, message, db);

    await createAuditLog({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
      requestId: envelope.requestId,
      action: "portfolio_manager.existing_account.import_queue_failed",
      errorCode: "PM_EXISTING_ACCOUNT_IMPORT_QUEUE_FAILED",
      outputSnapshot: {
        operationalJobId: job.id,
        queueJobId,
        selectedPropertyIds: dedupedPropertyIds,
        message,
      },
    });

    throw error;
  }

  await createAuditLog({
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    requestId: envelope.requestId,
    action: "portfolio_manager.existing_account.import_queued",
    outputSnapshot: {
      operationalJobId: job.id,
      queueJobId,
      selectedPropertyIds: dedupedPropertyIds,
    },
  });

  return {
    queueName: QUEUES.PORTFOLIO_MANAGER_IMPORT,
    queueJobId,
    operationalJobId: job.id,
  };
}

export async function runExistingAccountPropertyImport(input: {
  organizationId: string;
  propertyIds: string[];
  operationalJobId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const management = await loadExistingAccountManagement({
    organizationId: input.organizationId,
    db,
  });
  ensureExistingAccountManagement(management);

  const masterKey = requireEspmCredentialMasterKey();
  const credentials = resolveExistingAccountCredentials({
    management,
    masterKey,
  });
  const espmClient = createESPMClientFromCredentials(credentials);

  await db.portfolioManagerImportState.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      status: "RUNNING",
      latestJobId: input.operationalJobId,
      selectedPropertyIdsJson: input.propertyIds,
      selectedCount: input.propertyIds.length,
      lastAttemptedAt: new Date(),
    },
    update: {
      status: "RUNNING",
      latestJobId: input.operationalJobId,
      selectedPropertyIdsJson: input.propertyIds,
      selectedCount: input.propertyIds.length,
      latestErrorCode: null,
      latestErrorMessage: null,
      lastAttemptedAt: new Date(),
    },
  });

  const results: ExistingAccountImportResult[] = [];
  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const propertyId of Array.from(new Set(input.propertyIds))) {
    try {
      const propertyIdNumber = Number(propertyId);
      if (!Number.isFinite(propertyIdNumber)) {
        throw new ValidationError(`Portfolio Manager property ${propertyId} is invalid.`);
      }

      const existingBuilding = await db.building.findFirst({
        where: {
          organizationId: input.organizationId,
          espmPropertyId: BigInt(propertyId),
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (existingBuilding) {
        skippedCount += 1;
        results.push({
          propertyId,
          status: "SKIPPED",
          message: "This Portfolio Manager property is already linked in Quoin.",
          buildingId: existingBuilding.id,
          buildingName: existingBuilding.name,
        });
        continue;
      }

      const property = buildPropertyPreview(
        parsePortfolioManagerProperty(
          await espmClient.property.getProperty(propertyIdNumber),
          propertyIdNumber,
        ),
      );

      if (!property.localPropertyType || property.disabledReason) {
        failedCount += 1;
        results.push({
          propertyId,
          status: "FAILED",
          message:
            property.disabledReason ??
            "Portfolio Manager property type is not supported for import.",
        });
        continue;
      }

      const building = await db.building.create({
        data: {
          organizationId: input.organizationId,
          name: property.name ?? `Portfolio Manager Property ${propertyId}`,
          address:
            property.address ??
            `Portfolio Manager Property ${propertyId}, Washington, DC 20001`,
          latitude: DEFAULT_BUILDING_COORDINATES.latitude,
          longitude: DEFAULT_BUILDING_COORDINATES.longitude,
          grossSquareFeet: property.grossSquareFeet ?? 10000,
          propertyType: property.localPropertyType,
          yearBuilt: property.yearBuilt,
          espmPropertyId: BigInt(propertyId),
          espmShareStatus: "LINKED",
          bepsTargetScore:
            property.bepsTargetScore ??
            BEPS_TARGET_SCORES[property.localPropertyType],
        },
        select: {
          id: true,
          name: true,
        },
      });

      importedCount += 1;
      results.push({
        propertyId,
        status: "IMPORTED",
        message: "Building imported and linked to Portfolio Manager.",
        buildingId: building.id,
        buildingName: building.name,
      });

      await createAuditLog({
        actorType: "SYSTEM",
        organizationId: input.organizationId,
        buildingId: building.id,
        action: "portfolio_manager.existing_account.imported_building",
        requestId: null,
        outputSnapshot: {
          espmPropertyId: propertyId,
          propertyName: property.name,
        },
      });
    } catch (error) {
      failedCount += 1;
      results.push({
        propertyId,
        status: "FAILED",
        message:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Building import failed.",
      });
    }
  }

  const finalStatus = failedCount > 0 ? "FAILED" : "SUCCEEDED";
  const completedAt = new Date();
  const importState = await db.portfolioManagerImportState.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      status: finalStatus,
      latestJobId: input.operationalJobId,
      selectedPropertyIdsJson: input.propertyIds,
      resultSummaryJson: {
        results,
      },
      selectedCount: input.propertyIds.length,
      importedCount,
      skippedCount,
      failedCount,
      latestErrorCode:
        finalStatus === "FAILED" ? "PM_EXISTING_ACCOUNT_IMPORT_FAILED" : null,
      latestErrorMessage:
        finalStatus === "FAILED"
          ? results.find((result) => result.status === "FAILED")?.message ?? null
          : null,
      lastSucceededAt: finalStatus === "SUCCEEDED" ? completedAt : null,
      lastFailedAt: finalStatus === "FAILED" ? completedAt : null,
      lastAttemptedAt: completedAt,
    },
    update: {
      status: finalStatus,
      latestJobId: input.operationalJobId,
      selectedPropertyIdsJson: input.propertyIds,
      resultSummaryJson: {
        results,
      },
      selectedCount: input.propertyIds.length,
      importedCount,
      skippedCount,
      failedCount,
      latestErrorCode:
        finalStatus === "FAILED" ? "PM_EXISTING_ACCOUNT_IMPORT_FAILED" : null,
      latestErrorMessage:
        finalStatus === "FAILED"
          ? results.find((result) => result.status === "FAILED")?.message ?? null
          : null,
      lastSucceededAt: finalStatus === "SUCCEEDED" ? completedAt : null,
      lastFailedAt: finalStatus === "FAILED" ? completedAt : null,
      lastAttemptedAt: completedAt,
    },
  });

  await db.portfolioManagerManagement.update({
    where: { organizationId: input.organizationId },
    data: {
      latestJobId: input.operationalJobId,
      latestErrorCode: importState.latestErrorCode,
      latestErrorMessage: importState.latestErrorMessage,
    },
  });

  return {
    importState,
    results,
    importedCount,
    skippedCount,
    failedCount,
  };
}

export async function markExistingAccountImportFailed(input: {
  organizationId: string;
  operationalJobId: string;
  errorCode: string;
  errorMessage: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;

  await db.portfolioManagerImportState.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      status: "FAILED",
      latestJobId: input.operationalJobId,
      resultSummaryJson: {
        results: [],
      },
      latestErrorCode: input.errorCode,
      latestErrorMessage: input.errorMessage,
      lastFailedAt: new Date(),
      lastAttemptedAt: new Date(),
    },
    update: {
      status: "FAILED",
      latestJobId: input.operationalJobId,
      latestErrorCode: input.errorCode,
      latestErrorMessage: input.errorMessage,
      lastFailedAt: new Date(),
      lastAttemptedAt: new Date(),
    },
  });

  await db.portfolioManagerManagement.updateMany({
    where: {
      organizationId: input.organizationId,
      managementMode: "EXISTING_ESPM",
    },
    data: {
      latestJobId: input.operationalJobId,
      latestErrorCode: input.errorCode,
      latestErrorMessage: input.errorMessage,
    },
  });
}
