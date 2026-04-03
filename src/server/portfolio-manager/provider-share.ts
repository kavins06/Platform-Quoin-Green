import { Prisma, type ActorType, type PrismaClient, type PropertyType } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog, type CreateAuditLogInput } from "@/server/lib/audit-log";
import { QUEUES, withQueue } from "@/server/lib/queue";
import {
  createJob,
  JOB_STATUS,
  markCompleted,
  markDead,
  markRunning,
} from "@/server/lib/jobs";
import { AppError, ValidationError, WorkflowStateError } from "@/server/lib/errors";
import { env } from "@/server/lib/config";
import { createESPMClient, type ESPM, type PropertyMetrics } from "@/server/integrations/espm";
import {
  classifyPortfolioManagerError,
  parsePortfolioManagerConsumptionReadings,
  parsePortfolioManagerMeterDetail,
  parsePortfolioManagerMeterIds,
  parsePortfolioManagerProperty,
} from "@/server/compliance/portfolio-manager-support";
import { BEPS_TARGET_SCORES } from "@/lib/buildings/beps-targets";
import {
  findPropertyUseKeyByPrimaryFunction,
  listPropertyUseDefinitions,
  type BuildingPropertyUseKey,
} from "@/lib/buildings/property-use-registry";
import { buildPortfolioManagerProviderSyncEnvelope } from "@/server/pipelines/portfolio-manager-provider-sync/envelope";
import { getPmRuntimeHealth } from "@/server/lib/runtime-health";
import { runRedisHealthCommand } from "@/server/lib/redis";
import { runPortfolioManagerFullPullForBuilding } from "@/server/portfolio-manager/full-pull";
import { withAdvisoryTransactionLock } from "@/server/lib/transaction-lock";
import { mapWithConcurrency } from "@/server/lib/async";

const DEFAULT_BUILDING_COORDINATES = {
  latitude: 38.9072,
  longitude: -77.0369,
} as const;

const PORTFOLIO_MANAGER_PROVIDER_SYNC_JOB_TYPE =
  "PORTFOLIO_MANAGER_PROVIDER_SYNC";
const PROVIDER_SYNC_QUEUE_FAILED_CODE = "PM_PROVIDER_SYNC_QUEUE_FAILED";
const PROVIDER_SYNC_POLL_INTERVAL_MS = 60_000;
const PROVIDER_SYNC_RUNNING_STALE_THRESHOLD_MS = 10 * 60_000;
const PROVIDER_SYNC_QUEUED_STALE_THRESHOLD_MS = 15 * 60_000;

const PROVIDER_SYNC_SCHEMA_NOT_READY_MESSAGE =
  "Portfolio Manager sync is not ready in this environment yet. Apply the latest database migration and reload.";
const PROVIDER_SYNC_AUTO_CHECK_UNAVAILABLE_MESSAGE =
  "Background Portfolio Manager sync is unavailable right now. Quoin cannot auto-check for the connection request until the worker is back online.";
const PROVIDER_SYNC_DIRECT_CHECK_MESSAGE =
  "Background sync is unavailable, so Quoin checked Portfolio Manager directly.";
const PROVIDER_SYNC_STALE_RECOVERY_MESSAGE =
  "Quoin recovered from a stuck provider sync and checked Portfolio Manager directly.";

function sanitizeProviderSummaryError(message: string | null | undefined) {
  if (!message) {
    return null;
  }

  const normalized = message.trim().toLowerCase();
  if (
    normalized === PROVIDER_SYNC_SCHEMA_NOT_READY_MESSAGE.toLowerCase() ||
    normalized.includes("apply the latest database migration")
  ) {
    return null;
  }

  return message;
}

function isProviderSyncQueueFailureCode(code: string | null | undefined) {
  return code === PROVIDER_SYNC_QUEUE_FAILED_CODE;
}

function formatSyncStepLabel(step: string | null | undefined) {
  switch (step) {
    case "property":
      return "property load";
    case "meters":
      return "meter discovery";
    case "consumption":
      return "usage import";
    case "metrics":
      return "metrics refresh";
    case "benchmarking":
      return "benchmark snapshot refresh";
    default:
      return "sync";
  }
}

function describeProviderPropertySyncFailure(error: unknown) {
  if (error instanceof ValidationError) {
    return error.message;
  }

  const detail = classifyPortfolioManagerError(error, "property");
  const stepLabel = formatSyncStepLabel(detail.step);
  const normalizedMessage = detail.message.trim();

  if (normalizedMessage.toLowerCase() === "espm validation error") {
    return `Portfolio Manager ${stepLabel} failed because ESPM returned a validation response.`;
  }

  return `Portfolio Manager ${stepLabel} failed: ${normalizedMessage}`;
}

type ProviderConnectionSummaryState =
  | "NOT_CONNECTED"
  | "WAITING_FOR_REQUEST"
  | "WAITING_FOR_SHARES"
  | "SYNCING"
  | "CONNECTED"
  | "FAILED"
  | "QUOIN_MANAGED";

type ProviderSyncQueueResult = {
  queued: boolean;
  queueName: string | null;
  queueJobId: string | null;
  operationalJobId: string | null;
  warning: string | null;
};

type RemoteUsageSummary = {
  accessibleMeterCount: number;
  inaccessibleMeterCount: number;
  totalReadingCount: number;
  malformedRowCount: number;
  latestPeriodEnd: string | null;
  earliestPeriodStart: string | null;
  meters: Array<{
    meterId: string;
    readingCount: number;
    malformedRowCount: number;
    rawRowCount: number;
    earliestPeriodStart: string | null;
    latestPeriodEnd: string | null;
  }>;
};

type PropertySyncResult = {
  propertyId: string;
  status: "SYNCED" | "FAILED" | "SKIPPED";
  message: string;
  buildingId?: string | null;
  buildingName?: string | null;
  propertyLinked?: boolean;
  fullPullStatus?: "SYNCED" | "PARTIAL" | "NEEDS_MANUAL_SETUP" | "FAILED" | null;
  fullPullMessage?: string | null;
};

type ProviderDbClient = PrismaClient | Prisma.TransactionClient;

type ProviderPropertyPreview = {
  propertyId: string;
  effectiveAccountId: number;
  linkedBuildingId: string | null;
  linkedBuildingName: string | null;
  suppressedInQuoin: boolean;
};

type PendingConnection = {
  accountId: number;
  username: string | null;
  organization: string | null;
  email: string | null;
};

type ConnectedCustomer = {
  accountId: number;
  username: string | null;
  organization: string | null;
  email: string | null;
};

type PendingPropertyShare = {
  propertyId: number;
  accountId: number | null;
  effectiveAccountId: number | null;
  username: string | null;
  accessLevel: string | null;
  name: string | null;
};

type PendingMeterShare = {
  meterId: number;
  accountId: number | null;
  effectiveAccountId: number | null;
  username: string | null;
  propertyId: number | null;
  accessLevel: string | null;
  name: string | null;
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

function sanitizeUsername(username: string) {
  return username.trim();
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

function normalizeCaseFolded(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function parseAccountId(raw: unknown) {
  const account = toRecord(toRecord(raw).account);
  const accountId = getNumber(account["@_id"] ?? account.id);

  if (accountId == null) {
    throw new ValidationError(
      "Portfolio Manager account validation did not return an account id.",
    );
  }

  return accountId;
}

function parsePropertyIds(raw: unknown) {
  const response = toRecord(toRecord(raw).response);
  const responseLinks = toRecord(response.links);
  const links = toArray<Record<string, unknown>>(
    responseLinks.link ?? response.link,
  );
  const propertyIds = new Set<number>();

  for (const link of links) {
    const directId = getNumber(link["@_id"]);
    if (directId != null) {
      propertyIds.add(directId);
      continue;
    }

    const href =
      typeof link["@_link"] === "string"
        ? link["@_link"]
        : typeof link["@_href"] === "string"
          ? link["@_href"]
          : null;
    const match = href?.match(/\/property\/(\d+)(?:\/|$)/);
    if (match) {
      propertyIds.add(Number(match[1]));
    }
  }

  return Array.from(propertyIds);
}

function parsePropertyUseIds(raw: unknown) {
  const response = toRecord(toRecord(raw).response);
  const responseLinks = toRecord(response.links);
  const links = toArray<Record<string, unknown>>(
    responseLinks.link ?? response.link,
  );
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
  const rawRecord = toRecord(raw);
  const taggedEntry = Object.entries(rawRecord).find(
    ([key, value]) => key !== "?xml" && value && typeof value === "object" && !Array.isArray(value),
  );
  const propertyUse = getNestedObject(raw, "propertyUse") ?? toRecord(taggedEntry?.[1]);
  const rootTag = getNestedObject(raw, "propertyUse") ? null : taggedEntry?.[0] ?? null;
  const propertyUseId = getNumber(propertyUse["@_id"] ?? propertyUse.id) ?? fallbackId;
  const currentUseDetails = getNestedObject(propertyUse, "currentUseDetails");
  const useDetails = getNestedObject(propertyUse, "useDetails");
  const grossFloorArea =
    getNestedObject(useDetails, "totalGrossFloorArea") ??
    getNestedObject(propertyUse, "grossFloorArea");
  const rootTagUseKey =
    rootTag == null
      ? null
      : listPropertyUseDefinitions().find(
          (definition) => definition.pmRootTag.toLowerCase() === rootTag.toLowerCase(),
        )?.key ?? null;

  return {
    propertyUseId,
    name: getString(propertyUse.name),
    useKey:
      rootTagUseKey ??
      findPropertyUseKeyByPrimaryFunction(
        getString(propertyUse.type) ??
          getString(propertyUse.useType) ??
          getString(propertyUse.primaryFunction) ??
          getString(propertyUse.name),
      ),
    grossSquareFeet: getNumber(grossFloorArea?.value ?? propertyUse.grossFloorArea),
    currentUseDetailsId: getNumber(
      currentUseDetails?.["@_id"] ??
        currentUseDetails?.id ??
        useDetails?.["@_id"] ??
        useDetails?.id ??
        propertyUse.useDetailsId,
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

  return mapWithConcurrency(propertyUseIds, 4, async (propertyUseId) =>
    parseRemotePropertyUse(
      await input.espmClient.property.getPropertyUse(propertyUseId),
      propertyUseId,
    ),
  );
}

async function fetchAllRemoteConsumptionPages(input: {
  espmClient: ESPM;
  meterId: number;
  startDate: string;
  endDate: string;
}) {
  const MAX_CONSUMPTION_PAGES = 24;
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
        startDate: input.startDate,
        endDate: input.endDate,
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

function buildPreviewPropertyState(input: {
  propertyId: bigint;
  name: string | null;
  address: string | null;
  primaryFunction: string | null;
  grossSquareFeet: number | null;
  yearBuilt: number | null;
  linkedBuildingId: string | null;
  linkedBuildingName: string | null;
  lastSyncedAt: Date | null;
  latestMetricsJson: unknown;
  usageSummaryJson: unknown;
  shareStatus: string | null;
  latestErrorMessage: string | null;
  localSuppressedAt: Date | null;
}) {
  return {
    propertyId: input.propertyId.toString(),
    name: input.name,
    address: input.address,
    primaryFunction: input.primaryFunction,
    grossSquareFeet: input.grossSquareFeet,
    yearBuilt: input.yearBuilt,
    linkedBuildingId: input.linkedBuildingId,
    linkedBuildingName: input.linkedBuildingName,
    shareStatus: input.shareStatus,
    lastSyncedAt: input.lastSyncedAt,
    latestErrorMessage: input.latestErrorMessage,
    suppressedInQuoin: input.localSuppressedAt != null,
    suppressedAt: input.localSuppressedAt,
    usageSummary: toRecord(input.usageSummaryJson),
    latestMetrics: toRecord(input.latestMetricsJson),
  };
}

function buildImportedPropertyUseRows(input: {
  organizationId: string;
  buildingId: string;
  buildingName: string;
  fallbackGrossSquareFeet: number;
  propertyUses: RemotePropertyUse[];
  primaryFunction: string | null;
}) {
  const fallbackUseKey = findPropertyUseKeyByPrimaryFunction(input.primaryFunction);

  const remoteRows = input.propertyUses
    .map((propertyUse, index) => {
      const useKey = propertyUse.useKey ?? (index === 0 ? fallbackUseKey : null);
      const grossSquareFeet =
        propertyUse.grossSquareFeet ??
        (input.propertyUses.length === 1 ? input.fallbackGrossSquareFeet : null);

      if (!useKey || !grossSquareFeet || grossSquareFeet <= 0) {
        return null;
      }

      return {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        sortOrder: index,
        useKey,
        displayName:
          propertyUse.name ??
          (index === 0 ? input.buildingName : `${input.buildingName} use ${index + 1}`),
        grossSquareFeet: Math.round(grossSquareFeet),
        detailsJson: {} as Prisma.InputJsonValue,
        espmPropertyUseId: BigInt(propertyUse.propertyUseId),
        espmUseDetailsId:
          propertyUse.currentUseDetailsId != null
            ? BigInt(propertyUse.currentUseDetailsId)
            : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (remoteRows.length > 0) {
    return remoteRows;
  }

  if (!fallbackUseKey || input.fallbackGrossSquareFeet <= 0) {
    return [];
  }

  return [
    {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      sortOrder: 0,
      useKey: fallbackUseKey,
      displayName: input.buildingName,
      grossSquareFeet: input.fallbackGrossSquareFeet,
      detailsJson: {} as Prisma.InputJsonValue,
      espmPropertyUseId:
        input.propertyUses[0]?.propertyUseId != null
          ? BigInt(input.propertyUses[0].propertyUseId)
          : null,
      espmUseDetailsId:
        input.propertyUses[0]?.currentUseDetailsId != null
          ? BigInt(input.propertyUses[0].currentUseDetailsId)
          : null,
    },
  ];
}

function parsePendingConnections(raw: unknown): PendingConnection[] {
  const pendingList = getNestedObject(raw, "pendingList") ?? toRecord(raw);
  return toArray<Record<string, unknown>>(pendingList.account)
    .map((account) => {
      const accountInfo = getNestedObject(account, "accountInfo");
      return {
        accountId: getNumber(account.accountId ?? account["@_id"] ?? account.id) ?? -1,
        username: getString(account.username) ?? getString(accountInfo?.username),
        organization:
          getString(accountInfo?.organization) ?? getString(accountInfo?.accountName),
        email: getString(accountInfo?.email) ?? getString(account.email),
      } satisfies PendingConnection;
    })
    .filter((item) => item.accountId > 0);
}

function parseConnectedCustomerIds(raw: unknown) {
  const response = toRecord(getNestedObject(raw, "response") ?? toRecord(raw));
  const responseLinks = toRecord(response.links);
  const links = toArray<Record<string, unknown>>(
    responseLinks.link ?? response.link,
  );
  const customerIds = new Set<number>();

  for (const link of links) {
    const directId = getNumber(link["@_id"] ?? link.id);
    if (directId != null) {
      customerIds.add(directId);
      continue;
    }

    const href = getString(link["@_link"] ?? link["@_href"] ?? link.link ?? link.href);
    const match = href?.match(/\/customer\/(\d+)(?:\/|$)/);
    if (match) {
      customerIds.add(Number(match[1]));
    }
  }

  return Array.from(customerIds);
}

function parseConnectedCustomer(raw: unknown, fallbackId: number): ConnectedCustomer {
  const customer = getNestedObject(raw, "customer") ?? toRecord(raw);
  const accountInfo = getNestedObject(customer, "accountInfo");

  return {
    accountId: getNumber(customer["@_id"] ?? customer.id) ?? fallbackId,
    username: getString(customer.username) ?? getString(accountInfo?.username),
    organization:
      getString(accountInfo?.organization) ?? getString(accountInfo?.accountName),
    email: getString(accountInfo?.email) ?? getString(customer.email),
  };
}

async function loadConnectedCustomers(espmClient: ESPM) {
  const customerIds = parseConnectedCustomerIds(await espmClient.account.listCustomers());
  return mapWithConcurrency(customerIds, 4, async (customerId) =>
    parseConnectedCustomer(await espmClient.account.getCustomer(customerId), customerId),
  );
}

function parsePendingPropertyShares(raw: unknown): PendingPropertyShare[] {
  const pendingList = getNestedObject(raw, "pendingList") ?? toRecord(raw);
  return toArray<Record<string, unknown>>(pendingList.property)
    .map((property) => {
      const propertyInfo = getNestedObject(property, "propertyInfo");
      const accountId = getNumber(property.accountId);
      return {
        propertyId: getNumber(property.propertyId ?? property["@_id"] ?? property.id) ?? -1,
        accountId,
        effectiveAccountId: accountId,
        username: getString(property.username),
        accessLevel: getString(property.accessLevel),
        name: getString(propertyInfo?.name) ?? getString(property.name),
      } satisfies PendingPropertyShare;
    })
    .filter((item) => item.propertyId > 0);
}

function parsePendingMeterShares(raw: unknown): PendingMeterShare[] {
  const pendingList = getNestedObject(raw, "pendingList") ?? toRecord(raw);
  return toArray<Record<string, unknown>>(pendingList.meter)
    .map((meter) => {
      const meterInfo = getNestedObject(meter, "meterInfo");
      const accountId = getNumber(meter.accountId);
      return {
        meterId: getNumber(meter.meterId ?? meter["@_id"] ?? meter.id) ?? -1,
        accountId,
        effectiveAccountId: accountId,
        username: getString(meter.username),
        propertyId: getNumber(meter.propertyId),
        accessLevel: getString(meter.accessLevel),
        name: getString(meterInfo?.name) ?? getString(meter.name),
      } satisfies PendingMeterShare;
    })
    .filter((item) => item.meterId > 0);
}

function parseCachedEffectiveAccountIds(value: unknown) {
  const record = toRecord(value);
  return toArray<unknown>(record.effectiveAccountIds)
    .map((item) => getNumber(item))
    .filter((item): item is number => item != null && item > 0);
}

function startOfUtcMonthMonthsAgo(monthsAgo: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function toJsonValue(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function isProviderSyncSchemaMissingError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022")) ||
    (error instanceof Error &&
      (error.message.includes("portfolio_manager_remote_properties") ||
        error.message.includes("portfolioManagerManagement.findUnique") ||
        error.message.includes("portfolio_manager_management")))
  );
}

async function ensureProviderSyncSchemaReady(db: PrismaClient) {
  try {
    await db.portfolioManagerManagement.findFirst({
      select: {
        organizationId: true,
      },
    });
    await db.portfolioManagerRemoteProperty.findFirst({
      select: {
        propertyId: true,
      },
    });
  } catch (error) {
    if (isProviderSyncSchemaMissingError(error)) {
      throw new ValidationError(PROVIDER_SYNC_SCHEMA_NOT_READY_MESSAGE);
    }

    throw error;
  }
}

async function ensureProviderSyncQueueAvailable() {
  await runRedisHealthCommand((client) => client.ping());
}

async function loadLatestMetrics(
  espmClient: ESPM,
  propertyId: number,
): Promise<{
  status: "READY" | "NO_DATA";
  metrics: PropertyMetrics | null;
  reasonsForNoScore: string[];
}> {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const yearCandidates = [
    { year: currentYear, endMonth: currentMonth },
    { year: currentYear - 1, endMonth: 12 },
  ];

  for (const candidate of yearCandidates) {
    const metrics = await espmClient.metrics.getLatestAvailablePropertyMetrics(
      propertyId,
      candidate.year,
      candidate.endMonth,
    );

    const hasUsableMetrics = [
      metrics.score,
      metrics.siteTotal,
      metrics.sourceTotal,
      metrics.siteIntensity,
      metrics.sourceIntensity,
      metrics.weatherNormalizedSiteIntensity,
      metrics.weatherNormalizedSourceIntensity,
    ].some((value) => value != null);

    const reasonsForNoScore = await espmClient.metrics.getReasonsForNoScore(propertyId);
    if (hasUsableMetrics || reasonsForNoScore.length > 0) {
      return {
        status: hasUsableMetrics ? "READY" : "NO_DATA",
        metrics,
        reasonsForNoScore,
      };
    }
  }

  return {
    status: "NO_DATA",
    metrics: null,
    reasonsForNoScore: [],
  };
}

async function syncRemoteProperty(input: {
  organizationId: string;
  effectiveAccountId: number;
  propertyId: number;
  acceptedPropertyIds: Set<number>;
  acceptedMeterIds: Set<number>;
  espmClient: ESPM;
  db: PrismaClient;
  allowSuppressedRelink?: boolean;
}) {
  const rawProperty = await input.espmClient.property.getProperty(input.propertyId);
  const propertySnapshot = parsePortfolioManagerProperty(rawProperty, input.propertyId);
  const address = composeAddress({
    addressLine1: propertySnapshot.addressLine1,
    city: propertySnapshot.city,
    state: propertySnapshot.state,
    postalCode: propertySnapshot.postalCode,
  });
  const propertyType = mapPrimaryFunctionToPropertyType(propertySnapshot.primaryFunction);

  const [propertyUses, meterIds, metricsSummary] = await Promise.all([
    loadRemotePropertyUses({
      espmClient: input.espmClient,
      propertyId: input.propertyId,
    }),
    (async () =>
      parsePortfolioManagerMeterIds(
        await input.espmClient.meter.listMeters(input.propertyId),
      ))(),
    loadLatestMetrics(input.espmClient, input.propertyId),
  ]);

  const meterSummaries: RemoteUsageSummary["meters"] = [];
  let accessibleMeterCount = 0;
  let inaccessibleMeterCount = 0;
  let totalReadingCount = 0;
  let malformedRowCount = 0;
  let earliestPeriodStart: string | null = null;
  let latestPeriodEnd: string | null = null;

  const meterDetails = await mapWithConcurrency(meterIds, 4, async (meterId) => {
      try {
        const rawMeter = await input.espmClient.meter.getMeter(meterId);
        const meterDetail = parsePortfolioManagerMeterDetail(rawMeter, meterId);
        const consumption = await fetchAllRemoteConsumptionPages({
          espmClient: input.espmClient,
          meterId,
          startDate: isoDate(startOfUtcMonthMonthsAgo(24)),
          endDate: isoDate(new Date()),
        });

        accessibleMeterCount += 1;
        totalReadingCount += consumption.readings.length;
        malformedRowCount += consumption.malformedRowCount;

        const firstReading = consumption.readings[0] ?? null;
        const lastReading = consumption.readings[consumption.readings.length - 1] ?? null;
        const meterEarliest = firstReading ? isoDate(firstReading.periodStart) : null;
        const meterLatest = lastReading ? isoDate(lastReading.periodEnd) : null;
        if (meterEarliest && (!earliestPeriodStart || meterEarliest < earliestPeriodStart)) {
          earliestPeriodStart = meterEarliest;
        }
        if (meterLatest && (!latestPeriodEnd || meterLatest > latestPeriodEnd)) {
          latestPeriodEnd = meterLatest;
        }

        meterSummaries.push({
          meterId: String(meterId),
          readingCount: consumption.readings.length,
          malformedRowCount: consumption.malformedRowCount,
          rawRowCount: consumption.rawRowCount,
          earliestPeriodStart: meterEarliest,
          latestPeriodEnd: meterLatest,
        });

        return {
          meterId,
          ok: true as const,
          detail: meterDetail,
          usageSummary: {
            readingCount: consumption.readings.length,
            malformedRowCount: consumption.malformedRowCount,
            rawRowCount: consumption.rawRowCount,
            earliestPeriodStart: meterEarliest,
            latestPeriodEnd: meterLatest,
          },
          rawPayload: rawMeter,
        };
      } catch (error) {
        inaccessibleMeterCount += 1;
        return {
          meterId,
          ok: false as const,
          error:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : `Meter ${meterId} could not load.`,
        };
      }
    });

  const remoteProperty = await input.db.$transaction(async (tx) => {
    const existingRemoteProperty = await tx.portfolioManagerRemoteProperty.findUnique({
      where: {
        organizationId_propertyId: {
          organizationId: input.organizationId,
          propertyId: BigInt(input.propertyId),
        },
      },
      select: {
        localSuppressedAt: true,
        localSuppressedByType: true,
        localSuppressedById: true,
      },
    });
    const existingBuilding = await tx.building.findFirst({
      where: {
        organizationId: input.organizationId,
        espmPropertyId: BigInt(input.propertyId),
      },
      select: {
        id: true,
        name: true,
      },
    });

    const keepSuppressed =
      existingRemoteProperty?.localSuppressedAt != null && !input.allowSuppressedRelink;

    const building =
      existingBuilding != null
        ? await tx.building.update({
            where: { id: existingBuilding.id },
            data: {
              name: propertySnapshot.name ?? existingBuilding.name,
              address:
                address ??
                "Portfolio Manager Property, Washington, DC 20001",
              grossSquareFeet:
                propertySnapshot.grossFloorArea != null &&
                Number.isFinite(propertySnapshot.grossFloorArea)
                  ? Math.round(propertySnapshot.grossFloorArea)
                  : undefined,
              propertyType,
              yearBuilt: propertySnapshot.yearBuilt ?? undefined,
              espmShareStatus: "LINKED",
            },
            select: {
              id: true,
              name: true,
            },
          })
        : keepSuppressed
          ? null
          : await tx.building.create({
              data: {
                organizationId: input.organizationId,
                name: propertySnapshot.name ?? `Portfolio Manager Property ${input.propertyId}`,
                address:
                  address ??
                  `Portfolio Manager Property ${input.propertyId}, Washington, DC 20001`,
                latitude: DEFAULT_BUILDING_COORDINATES.latitude,
                longitude: DEFAULT_BUILDING_COORDINATES.longitude,
                grossSquareFeet:
                  propertySnapshot.grossFloorArea != null &&
                  Number.isFinite(propertySnapshot.grossFloorArea)
                    ? Math.round(propertySnapshot.grossFloorArea)
                    : 10000,
                propertyType,
                yearBuilt: propertySnapshot.yearBuilt,
                espmPropertyId: BigInt(input.propertyId),
                espmShareStatus: "LINKED",
                bepsTargetScore: BEPS_TARGET_SCORES[propertyType] ?? 1,
              },
            select: {
              id: true,
              name: true,
            },
          });

    if (building) {
      const existingPropertyUses = await tx.buildingPropertyUse.findMany({
        where: {
          organizationId: input.organizationId,
          buildingId: building.id,
        },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          useKey: true,
          espmPropertyUseId: true,
          espmUseDetailsId: true,
        },
      });
      const existingPropertyUseCount = existingPropertyUses.length;
      const importedPropertyUses = buildImportedPropertyUseRows({
        organizationId: input.organizationId,
        buildingId: building.id,
        buildingName: propertySnapshot.name ?? building.name,
        fallbackGrossSquareFeet:
          propertySnapshot.grossFloorArea != null &&
          Number.isFinite(propertySnapshot.grossFloorArea)
            ? Math.round(propertySnapshot.grossFloorArea)
            : 10000,
        propertyUses,
        primaryFunction: propertySnapshot.primaryFunction,
      });

      if (existingPropertyUseCount === 0) {
        if (importedPropertyUses.length > 0) {
          await tx.buildingPropertyUse.createMany({
            data: importedPropertyUses,
          });
        }
      }

      if (existingPropertyUseCount > 0 && importedPropertyUses.length > 0) {
        for (let index = 0; index < existingPropertyUses.length; index += 1) {
          const localPropertyUse = existingPropertyUses[index]!;
          const importedMatch =
            importedPropertyUses.find(
              (candidate) =>
                candidate.useKey === localPropertyUse.useKey &&
                !existingPropertyUses.some(
                  (row) =>
                    row.id !== localPropertyUse.id &&
                    row.espmPropertyUseId?.toString() ===
                      candidate.espmPropertyUseId?.toString(),
                ),
            ) ?? importedPropertyUses[index] ?? null;

          if (
            !importedMatch ||
            importedMatch.espmPropertyUseId == null ||
            (localPropertyUse.espmPropertyUseId != null &&
              localPropertyUse.espmUseDetailsId != null)
          ) {
            continue;
          }

          await tx.buildingPropertyUse.update({
            where: { id: localPropertyUse.id },
            data: {
              espmPropertyUseId: importedMatch.espmPropertyUseId,
              espmUseDetailsId: importedMatch.espmUseDetailsId,
            },
          });
        }
      }

      if (propertyUses.length > 0 && (existingPropertyUseCount > 0 || importedPropertyUses.length > 0)) {
        await tx.portfolioManagerSetupState.upsert({
          where: { buildingId: building.id },
          create: {
            organizationId: input.organizationId,
            buildingId: building.id,
            status: "NOT_STARTED",
            propertyUsesStatus: "APPLIED",
            metersStatus: "NOT_STARTED",
            associationsStatus: "NOT_STARTED",
            usageCoverageStatus: "NOT_STARTED",
            missingInputCodesJson: [],
            lastAppliedAt: new Date(),
          },
          update: {
            status: "NOT_STARTED",
            propertyUsesStatus: "APPLIED",
            latestErrorCode: null,
            latestErrorMessage: null,
            missingInputCodesJson: [],
            lastAppliedAt: new Date(),
          },
        });
      }
    }

    const remotePropertyRecord = await tx.portfolioManagerRemoteProperty.upsert({
      where: {
        organizationId_propertyId: {
          organizationId: input.organizationId,
          propertyId: BigInt(input.propertyId),
        },
      },
      create: {
        organizationId: input.organizationId,
        linkedBuildingId: building?.id ?? null,
        remoteAccountId: BigInt(input.effectiveAccountId),
        propertyId: BigInt(input.propertyId),
        shareStatus: "ACCEPTED",
        localSuppressedAt:
          keepSuppressed ? existingRemoteProperty?.localSuppressedAt ?? new Date() : null,
        localSuppressedByType: keepSuppressed
          ? existingRemoteProperty?.localSuppressedByType ?? "SYSTEM"
          : null,
        localSuppressedById: keepSuppressed
          ? existingRemoteProperty?.localSuppressedById ?? null
          : null,
        name: propertySnapshot.name,
        address,
        primaryFunction: propertySnapshot.primaryFunction,
        grossSquareFeet:
          propertySnapshot.grossFloorArea != null &&
          Number.isFinite(propertySnapshot.grossFloorArea)
            ? Math.round(propertySnapshot.grossFloorArea)
            : null,
        yearBuilt: propertySnapshot.yearBuilt,
        propertyUsesJson: toJsonValue(propertyUses),
        usageSummaryJson: toJsonValue({
          accessibleMeterCount,
          inaccessibleMeterCount,
          totalReadingCount,
          malformedRowCount,
          earliestPeriodStart,
          latestPeriodEnd,
          meters: meterSummaries,
        }),
        latestMetricsJson: toJsonValue({
          status: metricsSummary.status,
          metrics: metricsSummary.metrics,
          reasonsForNoScore: metricsSummary.reasonsForNoScore,
          refreshedAt: new Date().toISOString(),
        }),
        rawPayloadJson: toJsonValue(rawProperty),
        lastAcceptedAt: input.acceptedPropertyIds.has(input.propertyId) ? new Date() : null,
        lastSyncedAt: new Date(),
      },
      update: {
        linkedBuildingId: building?.id ?? null,
        remoteAccountId: BigInt(input.effectiveAccountId),
        shareStatus: "ACCEPTED",
        localSuppressedAt: keepSuppressed ? existingRemoteProperty?.localSuppressedAt : null,
        localSuppressedByType: keepSuppressed ? existingRemoteProperty?.localSuppressedByType : null,
        localSuppressedById: keepSuppressed ? existingRemoteProperty?.localSuppressedById : null,
        name: propertySnapshot.name,
        address,
        primaryFunction: propertySnapshot.primaryFunction,
        grossSquareFeet:
          propertySnapshot.grossFloorArea != null &&
          Number.isFinite(propertySnapshot.grossFloorArea)
            ? Math.round(propertySnapshot.grossFloorArea)
            : null,
        yearBuilt: propertySnapshot.yearBuilt,
        propertyUsesJson: toJsonValue(propertyUses),
        usageSummaryJson: toJsonValue({
          accessibleMeterCount,
          inaccessibleMeterCount,
          totalReadingCount,
          malformedRowCount,
          earliestPeriodStart,
          latestPeriodEnd,
          meters: meterSummaries,
        }),
        latestMetricsJson: toJsonValue({
          status: metricsSummary.status,
          metrics: metricsSummary.metrics,
          reasonsForNoScore: metricsSummary.reasonsForNoScore,
          refreshedAt: new Date().toISOString(),
        }),
        rawPayloadJson: toJsonValue(rawProperty),
        lastAcceptedAt: input.acceptedPropertyIds.has(input.propertyId)
          ? new Date()
          : undefined,
        lastSyncedAt: new Date(),
        latestErrorCode: null,
        latestErrorMessage: null,
      },
      select: {
        id: true,
        linkedBuildingId: true,
      },
    });

    for (const meter of meterDetails) {
      if (!meter.ok) {
        continue;
      }

      await tx.portfolioManagerRemoteMeter.upsert({
        where: {
          organizationId_meterId: {
            organizationId: input.organizationId,
            meterId: BigInt(meter.meterId),
          },
        },
        create: {
          organizationId: input.organizationId,
          remotePropertyId: remotePropertyRecord.id,
          meterId: BigInt(meter.meterId),
          shareStatus: "ACCEPTED",
          name: meter.detail.name,
          meterType: meter.detail.meterType,
          unit: meter.detail.unit,
          inUse: meter.detail.inUse,
          isAssociated: true,
          usageSummaryJson: toJsonValue(meter.usageSummary),
          rawPayloadJson: toJsonValue(meter.rawPayload),
          lastAcceptedAt: input.acceptedMeterIds.has(meter.meterId) ? new Date() : null,
          lastSyncedAt: new Date(),
        },
        update: {
          remotePropertyId: remotePropertyRecord.id,
          shareStatus: "ACCEPTED",
          name: meter.detail.name,
          meterType: meter.detail.meterType,
          unit: meter.detail.unit,
          inUse: meter.detail.inUse,
          isAssociated: true,
          usageSummaryJson: toJsonValue(meter.usageSummary),
          rawPayloadJson: toJsonValue(meter.rawPayload),
          lastAcceptedAt: input.acceptedMeterIds.has(meter.meterId) ? new Date() : undefined,
          lastSyncedAt: new Date(),
          latestErrorCode: null,
          latestErrorMessage: null,
        },
      });
    }

    return {
      propertyId: String(input.propertyId),
      buildingId: remotePropertyRecord.linkedBuildingId,
      buildingName: building?.name ?? null,
      suppressedInQuoin: keepSuppressed,
    };
  });

  return remoteProperty;
}

async function loadProviderManagement(input: {
  organizationId: string;
  db?: ProviderDbClient;
}) {
  const db = input.db ?? prisma;
  try {
    return await db.portfolioManagerManagement.findUnique({
      where: { organizationId: input.organizationId },
    });
  } catch (error) {
    if (isProviderSyncSchemaMissingError(error)) {
      return null;
    }

    throw error;
  }
}

async function loadProviderImportState(input: {
  organizationId: string;
  db?: ProviderDbClient;
}) {
  const db = input.db ?? prisma;
  return db.portfolioManagerImportState.findUnique({
    where: { organizationId: input.organizationId },
  });
}

async function loadJobStatus(input: {
  jobId: string | null | undefined;
  db?: ProviderDbClient;
}) {
  if (!input.jobId) {
    return null;
  }

  const db = input.db ?? prisma;
  return db.job.findUnique({
    where: { id: input.jobId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      lastError: true,
    },
  });
}

function isProviderSyncJobStale(
  job:
    | Awaited<ReturnType<typeof loadJobStatus>>
    | null
    | undefined,
) {
  if (!job || job.completedAt != null) {
    return false;
  }

  const thresholdMs =
    job.status === JOB_STATUS.QUEUED
      ? PROVIDER_SYNC_QUEUED_STALE_THRESHOLD_MS
      : job.status === JOB_STATUS.RUNNING
        ? PROVIDER_SYNC_RUNNING_STALE_THRESHOLD_MS
        : null;

  if (thresholdMs == null) {
    return false;
  }

  const ageFrom = job.startedAt ?? job.createdAt;
  return Date.now() - ageFrom.getTime() > thresholdMs;
}

async function recoverStaleProviderSyncState(input: {
  organizationId: string;
  latestJobId: string | null | undefined;
  db?: ProviderDbClient;
}) {
  const db = input.db ?? prisma;
  const latestJob = await loadJobStatus({
    jobId: input.latestJobId,
    db,
  });

  if (!isProviderSyncJobStale(latestJob)) {
    return {
      recovered: false,
      latestJob,
    };
  }

  await db.portfolioManagerManagement.updateMany({
    where: {
      organizationId: input.organizationId,
      managementMode: "PROVIDER_SHARED",
      status: "RUNNING",
    },
    data: {
      status: "READY",
      latestJobId: null,
    },
  });

  await markImportState({
    organizationId: input.organizationId,
    status: "NOT_STARTED",
    operationalJobId: null,
    db,
  });

  return {
    recovered: true,
    latestJob,
  };
}

function ensureProviderManagement(
  management: Awaited<ReturnType<typeof loadProviderManagement>>,
): asserts management is NonNullable<Awaited<ReturnType<typeof loadProviderManagement>>> {
  if (!management || management.managementMode !== "PROVIDER_SHARED") {
    throw new ValidationError(
      "Portfolio Manager provider sync is not configured for this organization.",
    );
  }
}

async function markImportState(input: {
  organizationId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "NOT_STARTED";
  operationalJobId?: string | null;
  selectedPropertyIds?: string[];
  results?: PropertySyncResult[];
  latestErrorCode?: string | null;
  latestErrorMessage?: string | null;
  importedCount?: number;
  failedCount?: number;
  skippedCount?: number;
  db?: ProviderDbClient;
}) {
  const db = input.db ?? prisma;
  const now = new Date();
  return db.portfolioManagerImportState.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      status: input.status,
      latestJobId: input.operationalJobId ?? null,
      selectedPropertyIdsJson: input.selectedPropertyIds ?? [],
      resultSummaryJson: {
        results: input.results ?? [],
      },
      selectedCount: input.selectedPropertyIds?.length ?? 0,
      importedCount: input.importedCount ?? 0,
      skippedCount: input.skippedCount ?? 0,
      failedCount: input.failedCount ?? 0,
      latestErrorCode: input.latestErrorCode ?? null,
      latestErrorMessage: input.latestErrorMessage ?? null,
      lastAttemptedAt:
        input.status === "QUEUED" ||
        input.status === "RUNNING" ||
        input.status === "SUCCEEDED" ||
        input.status === "FAILED"
          ? now
          : null,
      lastSucceededAt: input.status === "SUCCEEDED" ? now : null,
      lastFailedAt: input.status === "FAILED" ? now : null,
    },
    update: {
      status: input.status,
      latestJobId: input.operationalJobId ?? undefined,
      selectedPropertyIdsJson: input.selectedPropertyIds ?? undefined,
      resultSummaryJson:
        input.results != null
          ? {
              results: input.results,
            }
          : undefined,
      selectedCount: input.selectedPropertyIds?.length ?? undefined,
      importedCount: input.importedCount ?? undefined,
      skippedCount: input.skippedCount ?? undefined,
      failedCount: input.failedCount ?? undefined,
      latestErrorCode: input.latestErrorCode ?? null,
      latestErrorMessage: input.latestErrorMessage ?? null,
      lastAttemptedAt:
        input.status === "QUEUED" ||
        input.status === "RUNNING" ||
        input.status === "SUCCEEDED" ||
        input.status === "FAILED"
          ? now
          : undefined,
      lastSucceededAt: input.status === "SUCCEEDED" ? now : undefined,
      lastFailedAt: input.status === "FAILED" ? now : undefined,
    },
  });
}

export async function getPortfolioManagerProviderConnectionStateForOrganization(input: {
  organizationId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  let schemaWarning: string | null = null;
  const [management, importState] = await Promise.all([
    loadProviderManagement({
      organizationId: input.organizationId,
      db,
    }),
    db.portfolioManagerImportState.findUnique({
      where: { organizationId: input.organizationId },
    }),
  ]);
  let remoteProperties: Prisma.PortfolioManagerRemotePropertyGetPayload<{
    include: {
      linkedBuilding: {
        select: {
          id: true;
          name: true;
        };
      };
    };
  }>[] = [];

  try {
    remoteProperties = await db.portfolioManagerRemoteProperty.findMany({
      where: {
        organizationId: input.organizationId,
      },
      orderBy: [{ updatedAt: "desc" }, { propertyId: "asc" }],
      include: {
        linkedBuilding: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  } catch (error) {
    if (isProviderSyncSchemaMissingError(error)) {
      schemaWarning = PROVIDER_SYNC_SCHEMA_NOT_READY_MESSAGE;
    } else {
      throw error;
    }
  }

  const providerModeActive = management?.managementMode === "PROVIDER_SHARED";
  const runtimeHealth = await getPmRuntimeHealth({
    latestJobId: management?.latestJobId ?? importState?.latestJobId ?? null,
    active: providerModeActive && Boolean(management?.targetUsername),
    db,
  });

  const syncStateActive =
    management?.status === "RUNNING" ||
    importState?.status === "RUNNING" ||
    importState?.status === "QUEUED";
  const syncStateTrustworthy =
    runtimeHealth.workerStatus === "HEALTHY" && !runtimeHealth.latestJob.stalled;

  const baseSummaryState: ProviderConnectionSummaryState =
    management?.managementMode === "QUOIN_MANAGED"
      ? "QUOIN_MANAGED"
      : schemaWarning
        ? "NOT_CONNECTED"
        : management?.managementMode !== "PROVIDER_SHARED"
          ? "NOT_CONNECTED"
          : syncStateActive && syncStateTrustworthy
            ? "SYNCING"
            : management.connectedAccountId == null
              ? "WAITING_FOR_REQUEST"
              : remoteProperties.length === 0
                ? "WAITING_FOR_SHARES"
                : "CONNECTED";

  const backgroundSyncUnavailable =
    isProviderSyncQueueFailureCode(management?.latestErrorCode) ||
    isProviderSyncQueueFailureCode(importState?.latestErrorCode) ||
    ((baseSummaryState === "WAITING_FOR_REQUEST" ||
      baseSummaryState === "WAITING_FOR_SHARES" ||
      baseSummaryState === "SYNCING") &&
      runtimeHealth.workerStatus !== "HEALTHY");

  const fatalProviderError =
    providerModeActive &&
    !backgroundSyncUnavailable &&
    (Boolean(sanitizeProviderSummaryError(management?.latestErrorMessage)) ||
      Boolean(sanitizeProviderSummaryError(importState?.latestErrorMessage)) ||
      importState?.status === "FAILED" ||
      management?.status === "FAILED");

  const summaryState: ProviderConnectionSummaryState = fatalProviderError
    ? "FAILED"
    : baseSummaryState;

  const backgroundSyncAvailable =
    runtimeHealth.workerStatus === "HEALTHY" && runtimeHealth.queuesHealthy;
  const backgroundSyncMessage = backgroundSyncUnavailable
    ? PROVIDER_SYNC_AUTO_CHECK_UNAVAILABLE_MESSAGE
    : runtimeHealth.latestJob.stalled
      ? "The last provider sync got stuck. Use Check now to refresh shared properties directly."
      : runtimeHealth.warning;

  const linkedBuildingCount = remoteProperties.filter((property) => property.linkedBuildingId != null).length;
  return {
    management,
    importState,
    provider: {
      username: env.ESPM_USERNAME ?? null,
    },
    remoteProperties: remoteProperties.map((property) =>
      buildPreviewPropertyState({
        propertyId: property.propertyId,
        name: property.name,
        address: property.address,
        primaryFunction: property.primaryFunction,
        grossSquareFeet: property.grossSquareFeet,
        yearBuilt: property.yearBuilt,
        linkedBuildingId: property.linkedBuildingId,
        linkedBuildingName: property.linkedBuilding?.name ?? null,
        lastSyncedAt: property.lastSyncedAt,
        latestMetricsJson: property.latestMetricsJson,
        usageSummaryJson: property.usageSummaryJson,
        shareStatus: property.shareStatus,
        latestErrorMessage: property.latestErrorMessage,
        localSuppressedAt: property.localSuppressedAt,
      }),
    ),
    runtimeHealth,
    summary: {
      state: summaryState,
      providerUsername: env.ESPM_USERNAME ?? null,
      linkedAccountId: management?.connectedAccountId?.toString() ?? null,
      linkedUsername: management?.connectedUsername ?? null,
      targetUsername: management?.targetUsername ?? null,
      propertyCount: remoteProperties.length,
      linkedBuildingCount,
      latestErrorMessage: fatalProviderError
        ? schemaWarning ??
          sanitizeProviderSummaryError(importState?.latestErrorMessage) ??
          sanitizeProviderSummaryError(management?.latestErrorMessage) ??
          null
        : null,
      lastSyncedAt:
        remoteProperties[0]?.lastSyncedAt ??
        management?.propertyCacheRefreshedAt ??
        null,
      lastConnectionCheckedAt: management?.lastConnectionCheckedAt ?? null,
      backgroundSyncAvailable,
      backgroundSyncMessage,
    },
  };
}

export async function getPortfolioManagerRemotePropertyDetailForOrganization(input: {
  organizationId: string;
  propertyId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  await ensureProviderSyncSchemaReady(db);
  const propertyId = Number(input.propertyId);
  if (!Number.isFinite(propertyId)) {
    throw new ValidationError("Portfolio Manager property id is invalid.");
  }

  return db.portfolioManagerRemoteProperty.findUnique({
    where: {
      organizationId_propertyId: {
        organizationId: input.organizationId,
        propertyId: BigInt(propertyId),
      },
    },
    include: {
      linkedBuilding: {
        select: {
          id: true,
          name: true,
        },
      },
      remoteMeters: {
        orderBy: {
          meterId: "asc",
        },
      },
    },
  });
}

export async function restoreSuppressedPortfolioManagerRemotePropertyForOrganization(input: {
  organizationId: string;
  propertyId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  await ensureProviderSyncSchemaReady(db);
  const numericPropertyId = Number(input.propertyId);

  if (!Number.isFinite(numericPropertyId)) {
    throw new ValidationError("Portfolio Manager property id is invalid.");
  }

  const [management, remoteProperty] = await Promise.all([
    loadProviderManagement({
      organizationId: input.organizationId,
      db,
    }),
    db.portfolioManagerRemoteProperty.findUnique({
      where: {
        organizationId_propertyId: {
          organizationId: input.organizationId,
          propertyId: BigInt(numericPropertyId),
        },
      },
      select: {
        propertyId: true,
        remoteAccountId: true,
        linkedBuildingId: true,
        localSuppressedAt: true,
        name: true,
      },
    }),
  ]);

  ensureProviderManagement(management);

  if (!remoteProperty) {
    throw new ValidationError("This shared ESPM property is not available to restore.");
  }

  if (remoteProperty.localSuppressedAt == null) {
    throw new ValidationError("This shared ESPM property is already visible in Quoin.");
  }

  const effectiveAccountId =
    remoteProperty.remoteAccountId != null
      ? Number(remoteProperty.remoteAccountId)
      : management.connectedAccountId != null
        ? Number(management.connectedAccountId)
        : null;

  if (!effectiveAccountId) {
    throw new ValidationError(
      "Portfolio Manager connection details are unavailable for this shared property.",
    );
  }

  const espmClient = createESPMClient();
  const result = await syncRemoteProperty({
    organizationId: input.organizationId,
    effectiveAccountId,
    propertyId: numericPropertyId,
    acceptedPropertyIds: new Set<number>(),
    acceptedMeterIds: new Set<number>(),
    espmClient,
    db,
    allowSuppressedRelink: true,
  });

  if (!result.buildingId) {
    throw new ValidationError("Quoin could not restore this shared ESPM property.");
  }

  let fullPullStatus: PropertySyncResult["fullPullStatus"] = null;
  let fullPullMessage: string | null = null;

  try {
    const fullPullResult = await runPortfolioManagerFullPullForBuilding({
      organizationId: input.organizationId,
      buildingId: result.buildingId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      requestId:
        input.requestId ?? `pm-provider-restore-full-pull:${input.organizationId}:${result.buildingId}`,
      db,
    });
    fullPullStatus = fullPullResult.outcome;
    fullPullMessage =
      fullPullResult.stages.snapshot.message ??
      fullPullResult.stages.usage.message ??
      fullPullResult.stages.setup.message;
  } catch (error) {
    fullPullStatus = "FAILED";
    fullPullMessage =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager full pull failed after restore.";
  }

  await createAuditLog({
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    buildingId: result.buildingId,
    action: "BUILDING_PROVIDER_SHARED_RESTORED",
    inputSnapshot: {
      propertyId: String(remoteProperty.propertyId),
      priorBuildingId: remoteProperty.linkedBuildingId,
      suppressedAt: remoteProperty.localSuppressedAt,
    },
    outputSnapshot: {
      buildingId: result.buildingId,
      buildingName: result.buildingName,
      fullPullStatus,
      fullPullMessage,
    },
    requestId: input.requestId ?? null,
  });

  return {
    success: true,
    propertyId: String(remoteProperty.propertyId),
    buildingId: result.buildingId,
    buildingName: result.buildingName,
    fullPullStatus,
    fullPullMessage,
  };
}

export async function enqueuePortfolioManagerProviderSync(input: {
  organizationId: string;
  actorType: CreateAuditLogInput["actorType"];
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  await ensureProviderSyncSchemaReady(db);
  const management = await loadProviderManagement({
    organizationId: input.organizationId,
    db,
  });
  ensureProviderManagement(management);
  await ensureProviderSyncQueueAvailable();

  const {
    job,
    now,
    previousManagementJobId,
    previousImportState,
  } = await withAdvisoryTransactionLock(
    db,
    `pm-provider-sync:${input.organizationId}`,
    async (tx) => {
      const [lockedManagement, lockedImportState] = await Promise.all([
        loadProviderManagement({
          organizationId: input.organizationId,
          db: tx,
        }),
        loadProviderImportState({
          organizationId: input.organizationId,
          db: tx,
        }),
      ]);
      ensureProviderManagement(lockedManagement);

      if (lockedManagement.status === "RUNNING" && lockedManagement.latestJobId) {
        throw new WorkflowStateError(
          "Portfolio Manager provider sync is already queued or running.",
        );
      }

      const queuedJob = await createJob(
        {
          type: PORTFOLIO_MANAGER_PROVIDER_SYNC_JOB_TYPE,
          status: JOB_STATUS.QUEUED,
          organizationId: input.organizationId,
          maxAttempts: 3,
        },
        tx,
      );
      const queuedAt = new Date();

      await tx.portfolioManagerManagement.update({
        where: { organizationId: input.organizationId },
        data: {
          status: "RUNNING",
          latestJobId: queuedJob.id,
          latestErrorCode: null,
          latestErrorMessage: null,
        },
      });

      await markImportState({
        organizationId: input.organizationId,
        status: "QUEUED",
        operationalJobId: queuedJob.id,
        db: tx,
      });

      return {
        job: queuedJob,
        now: queuedAt,
        previousManagementJobId: lockedManagement.latestJobId,
        previousImportState: lockedImportState,
      };
    },
  );

  const envelope = buildPortfolioManagerProviderSyncEnvelope({
    requestId: input.requestId,
    organizationId: input.organizationId,
    operationalJobId: job.id,
    triggeredAt: now,
  });
  const queueJobId = `pm-provider-sync-${job.id}`;

  try {
    await withQueue(QUEUES.PORTFOLIO_MANAGER_PROVIDER_SYNC, async (queue) => {
      await queue.add("portfolio-manager-provider-sync", envelope, {
        jobId: queueJobId,
      });
    });
  } catch (error) {
    const message = PROVIDER_SYNC_AUTO_CHECK_UNAVAILABLE_MESSAGE;

    await db.portfolioManagerManagement.update({
      where: { organizationId: input.organizationId },
      data: {
        status: "READY",
        latestJobId: previousManagementJobId,
        latestErrorCode: PROVIDER_SYNC_QUEUE_FAILED_CODE,
        latestErrorMessage: message,
      },
    });
    await markImportState({
      organizationId: input.organizationId,
      status: previousImportState?.status ?? "NOT_STARTED",
      operationalJobId: previousImportState?.latestJobId ?? null,
      selectedPropertyIds:
        Array.isArray(previousImportState?.selectedPropertyIdsJson)
          ? previousImportState.selectedPropertyIdsJson
              .filter((value): value is string => typeof value === "string")
          : undefined,
      latestErrorCode: PROVIDER_SYNC_QUEUE_FAILED_CODE,
      latestErrorMessage: message,
      importedCount: previousImportState?.importedCount ?? undefined,
      failedCount: previousImportState?.failedCount ?? undefined,
      skippedCount: previousImportState?.skippedCount ?? undefined,
      db,
    });
    await markDead(job.id, message, db);

    throw error;
  }

  await createAuditLog({
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    requestId: envelope.requestId,
    action: "portfolio_manager.provider_sync.queued",
    outputSnapshot: {
      operationalJobId: job.id,
      queueJobId,
    },
  });

  return {
    queueName: QUEUES.PORTFOLIO_MANAGER_PROVIDER_SYNC,
    queueJobId,
    operationalJobId: job.id,
  };
}

async function tryEnqueuePortfolioManagerProviderSync(input: {
  organizationId: string;
  actorType: CreateAuditLogInput["actorType"];
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}): Promise<ProviderSyncQueueResult> {
  try {
    const queued = await enqueuePortfolioManagerProviderSync(input);
    return {
      queued: true,
      queueName: queued.queueName,
      queueJobId: queued.queueJobId,
      operationalJobId: queued.operationalJobId,
      warning: null,
    };
  } catch {
    return {
      queued: false,
      queueName: null,
      queueJobId: null,
      operationalJobId: null,
      warning: PROVIDER_SYNC_AUTO_CHECK_UNAVAILABLE_MESSAGE,
    };
  }
}

export async function configurePortfolioManagerProviderConnectionForOrganization(input: {
  organizationId: string;
  targetUsername: string;
  actorType: CreateAuditLogInput["actorType"];
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  await ensureProviderSyncSchemaReady(db);
  const targetUsername = sanitizeUsername(input.targetUsername);
  if (targetUsername.length === 0) {
    throw new ValidationError("Enter the customer's Portfolio Manager username.");
  }

  const existing = await loadProviderManagement({
    organizationId: input.organizationId,
    db,
  });

  if (existing?.managementMode === "QUOIN_MANAGED") {
    throw new ValidationError(
      "Quoin-managed Portfolio Manager is already enabled for this organization.",
    );
  }

  const shouldResetConnection =
    existing?.connectedUsername != null &&
    normalizeCaseFolded(existing.connectedUsername) !== normalizeCaseFolded(targetUsername);

  await db.$transaction(async (tx) => {
    await tx.portfolioManagerManagement.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        managementMode: "PROVIDER_SHARED",
        status: "READY",
        targetUsername,
        latestErrorCode: null,
        latestErrorMessage: null,
      },
      update: {
        managementMode: "PROVIDER_SHARED",
        status: "READY",
        targetUsername,
        latestErrorCode: null,
        latestErrorMessage: null,
        connectedAccountId: shouldResetConnection ? null : undefined,
        connectedUsername: shouldResetConnection ? null : undefined,
        propertyCacheJson: shouldResetConnection ? {} : undefined,
        propertyCacheRefreshedAt: shouldResetConnection ? null : undefined,
      },
    });

    if (shouldResetConnection) {
      await tx.portfolioManagerRemoteMeter.deleteMany({
        where: {
          organizationId: input.organizationId,
        },
      });
      await tx.portfolioManagerRemoteProperty.deleteMany({
        where: {
          organizationId: input.organizationId,
        },
      });
    }

    await tx.portfolioManagerImportState.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        status: "NOT_STARTED",
        latestJobId: null,
        selectedPropertyIdsJson: [],
        resultSummaryJson: {
          results: [],
        },
        selectedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        latestErrorCode: null,
        latestErrorMessage: null,
      },
      update: {
        status: "NOT_STARTED",
        latestJobId: null,
        selectedPropertyIdsJson: [],
        resultSummaryJson: {
          results: [],
        },
        selectedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        latestErrorCode: null,
        latestErrorMessage: null,
      },
    });
  });

  await createAuditLog({
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    requestId: input.requestId ?? null,
    action: "portfolio_manager.provider_sync.configured",
    outputSnapshot: {
      targetUsername,
      resetConnection: shouldResetConnection,
    },
  });

  const queueResult = await tryEnqueuePortfolioManagerProviderSync({
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    requestId: input.requestId,
    db,
  });

  return {
    saved: true,
    targetUsername,
    resetConnection: shouldResetConnection,
    autoCheckQueued: queueResult.queued,
    queueName: queueResult.queueName,
    queueJobId: queueResult.queueJobId,
    operationalJobId: queueResult.operationalJobId,
    warning: queueResult.warning,
  };
}

export async function refreshPortfolioManagerProviderConnectionForOrganization(input: {
  organizationId: string;
  actorType: CreateAuditLogInput["actorType"];
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  await ensureProviderSyncSchemaReady(db);
  const management = await loadProviderManagement({
    organizationId: input.organizationId,
    db,
  });
  ensureProviderManagement(management);

  if (!management.targetUsername) {
    throw new ValidationError(
      "Save the customer's Portfolio Manager username before refreshing provider sync.",
    );
  }

  const recovery = await recoverStaleProviderSyncState({
    organizationId: input.organizationId,
    latestJobId: management.latestJobId,
    db,
  });
  const runtimeHealth = await getPmRuntimeHealth({
    latestJobId: recovery.recovered ? null : management.latestJobId,
    active: true,
    db,
  });
  const shouldRunInline =
    recovery.recovered || runtimeHealth.workerStatus !== "HEALTHY" || runtimeHealth.latestJob.stalled;

  if (!shouldRunInline) {
    const queueResult = await tryEnqueuePortfolioManagerProviderSync({
      organizationId: input.organizationId,
      actorType: input.actorType,
      actorId: input.actorId,
      requestId: input.requestId,
      db,
    });

    if (queueResult.queued) {
      return {
        mode: "queued" as const,
        message: "Checking shared properties in the background.",
        ...queueResult,
      };
    }
  }

  const inlineResult = await runPortfolioManagerProviderSyncInline({
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    requestId: input.requestId,
    db,
  });

  return {
    mode: "inline" as const,
    queued: false,
    queueName: null,
    queueJobId: null,
    operationalJobId: inlineResult.operationalJobId,
    syncedPropertyCount: inlineResult.syncedPropertyCount,
    failedPropertyCount: inlineResult.failedPropertyCount,
    warning: recovery.recovered
      ? PROVIDER_SYNC_STALE_RECOVERY_MESSAGE
      : runtimeHealth.workerStatus !== "HEALTHY"
        ? PROVIDER_SYNC_DIRECT_CHECK_MESSAGE
        : runtimeHealth.latestJob.stalled
          ? PROVIDER_SYNC_STALE_RECOVERY_MESSAGE
          : null,
    message:
      recovery.recovered
        ? PROVIDER_SYNC_STALE_RECOVERY_MESSAGE
        : runtimeHealth.workerStatus !== "HEALTHY"
          ? PROVIDER_SYNC_DIRECT_CHECK_MESSAGE
          : "Checked Portfolio Manager directly.",
  };
}

async function runPortfolioManagerProviderSyncInline(input: {
  organizationId: string;
  actorType: CreateAuditLogInput["actorType"];
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const job = await createJob(
    {
      type: PORTFOLIO_MANAGER_PROVIDER_SYNC_JOB_TYPE,
      status: JOB_STATUS.QUEUED,
      organizationId: input.organizationId,
      maxAttempts: 1,
    },
    db,
  );

  await markRunning(job.id, db);

  try {
    const result = await runPortfolioManagerProviderSync({
      organizationId: input.organizationId,
      operationalJobId: job.id,
      db,
    });

    await markCompleted(job.id, db);
    await createAuditLog({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
      requestId: input.requestId ?? null,
      action: "portfolio_manager.provider_sync.inline_completed",
      outputSnapshot: {
        operationalJobId: job.id,
        acceptedConnection: result.acceptedConnection,
        acceptedPropertyCount: result.acceptedPropertyCount,
        acceptedMeterCount: result.acceptedMeterCount,
        syncedPropertyCount: result.syncedPropertyCount,
        failedPropertyCount: result.failedPropertyCount,
      },
    });

    return {
      operationalJobId: job.id,
      ...result,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Portfolio Manager provider sync failed.";
    const errorCode =
      error instanceof AppError ? error.code : "PM_PROVIDER_SYNC_FAILED";

    await markPortfolioManagerProviderSyncFailed({
      organizationId: input.organizationId,
      operationalJobId: job.id,
      errorCode,
      errorMessage: message,
      db,
    });
    await markDead(job.id, message, db);

    throw error;
  }
}

export async function runPortfolioManagerProviderSync(input: {
  organizationId: string;
  operationalJobId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  await ensureProviderSyncSchemaReady(db);
  const management = await loadProviderManagement({
    organizationId: input.organizationId,
    db,
  });
  ensureProviderManagement(management);

  if (!management.targetUsername) {
    throw new ValidationError(
      "No target Portfolio Manager username is configured for provider sync.",
    );
  }

  const espmClient = createESPMClient();
  const now = new Date();

  await db.portfolioManagerManagement.update({
    where: { organizationId: input.organizationId },
    data: {
      status: "RUNNING",
      latestJobId: input.operationalJobId,
      lastConnectionCheckedAt: now,
      latestErrorCode: null,
      latestErrorMessage: null,
    },
  });
  await markImportState({
    organizationId: input.organizationId,
    status: "RUNNING",
    operationalJobId: input.operationalJobId,
    db,
  });

  const providerAccountId =
    management.providerCustomerId != null
      ? Number(management.providerCustomerId)
      : parseAccountId(await espmClient.account.getAccount());

  let connectedAccountId =
    management.connectedAccountId != null
      ? Number(management.connectedAccountId)
      : null;
  let connectedUsername = management.connectedUsername;

  if (connectedAccountId == null) {
    const pendingConnections = parsePendingConnections(
      await espmClient.sharing.listPendingConnections(),
    );
    const pendingConnection = pendingConnections.find(
      (connection) =>
        normalizeCaseFolded(connection.username) ===
        normalizeCaseFolded(management.targetUsername),
    );

    if (!pendingConnection) {
      const connectedCustomers = await loadConnectedCustomers(espmClient);
      const existingConnection = connectedCustomers.find(
        (customer) =>
          normalizeCaseFolded(customer.username) ===
          normalizeCaseFolded(management.targetUsername),
      );

      if (existingConnection) {
        connectedAccountId = existingConnection.accountId;
        connectedUsername =
          existingConnection.username ?? management.targetUsername;

        await db.portfolioManagerManagement.update({
          where: { organizationId: input.organizationId },
          data: {
            providerCustomerId: BigInt(providerAccountId),
            connectedAccountId: BigInt(connectedAccountId),
            connectedUsername,
            lastConnectionAcceptedAt:
              management.lastConnectionAcceptedAt ?? new Date(),
          },
        });
      } else {
        const updatedManagement = await db.portfolioManagerManagement.update({
          where: { organizationId: input.organizationId },
          data: {
            status: "READY",
            providerCustomerId: BigInt(providerAccountId),
            latestJobId: input.operationalJobId,
            latestErrorCode: null,
            latestErrorMessage: null,
          },
        });

        const importState = await markImportState({
          organizationId: input.organizationId,
          status: "NOT_STARTED",
          operationalJobId: input.operationalJobId,
          db,
        });

        return {
          management: updatedManagement,
          importState,
          acceptedConnection: false,
          acceptedPropertyCount: 0,
          acceptedMeterCount: 0,
          syncedPropertyCount: 0,
          failedPropertyCount: 0,
          results: [] as PropertySyncResult[],
        };
      }
    } else {
      await espmClient.sharing.acceptConnection(pendingConnection.accountId);
      connectedAccountId = pendingConnection.accountId;
      connectedUsername = pendingConnection.username ?? management.targetUsername;

      await db.portfolioManagerManagement.update({
        where: { organizationId: input.organizationId },
        data: {
          providerCustomerId: BigInt(providerAccountId),
          connectedAccountId: BigInt(connectedAccountId),
          connectedUsername,
          lastConnectionAcceptedAt: new Date(),
        },
      });
    }
  }

  const pendingPropertyShares = parsePendingPropertyShares(
    await espmClient.sharing.listPendingPropertyShares(),
  );
  const pendingMeterShares = parsePendingMeterShares(
    await espmClient.sharing.listPendingMeterShares(),
  );
  const cachedEffectiveAccountIds = parseCachedEffectiveAccountIds(management.propertyCacheJson);
  const effectiveAccountIds = Array.from(
    new Set(
      [
        connectedAccountId,
        ...cachedEffectiveAccountIds,
        ...pendingPropertyShares
          .map((share) => share.effectiveAccountId)
          .filter((value): value is number => value != null),
        ...pendingMeterShares
          .map((share) => share.effectiveAccountId)
          .filter((value): value is number => value != null),
      ],
    ),
  );
  const acceptedPropertyIds = new Set<number>();
  const acceptedMeterIds = new Set<number>();

  for (const propertyShare of pendingPropertyShares) {
    if (
      propertyShare.effectiveAccountId != null &&
      !effectiveAccountIds.includes(propertyShare.effectiveAccountId)
    ) {
      continue;
    }
    await espmClient.sharing.acceptPropertyShare(propertyShare.propertyId);
    acceptedPropertyIds.add(propertyShare.propertyId);
  }

  for (const meterShare of pendingMeterShares) {
    if (
      meterShare.effectiveAccountId != null &&
      !effectiveAccountIds.includes(meterShare.effectiveAccountId)
    ) {
      continue;
    }
    await espmClient.sharing.acceptMeterShare(meterShare.meterId);
    acceptedMeterIds.add(meterShare.meterId);
  }
  const propertyAccountPairs = new Map<number, number>();
  for (const effectiveAccountId of effectiveAccountIds) {
    const accountPropertyIds = parsePropertyIds(
      await espmClient.property.listProperties(effectiveAccountId),
    );
    for (const propertyId of accountPropertyIds) {
      if (!propertyAccountPairs.has(propertyId)) {
        propertyAccountPairs.set(propertyId, effectiveAccountId);
      }
    }
  }
  const propertyIds = Array.from(propertyAccountPairs.keys());

  if (propertyIds.length === 0) {
    const updatedManagement = await db.portfolioManagerManagement.update({
      where: { organizationId: input.organizationId },
      data: {
        status: "READY",
        providerCustomerId: BigInt(providerAccountId),
        connectedAccountId: BigInt(connectedAccountId),
        connectedUsername,
        lastShareAcceptedAt:
          acceptedPropertyIds.size > 0 || acceptedMeterIds.size > 0 ? new Date() : undefined,
        propertyCacheJson: toJsonValue({
          properties: [],
          effectiveAccountIds,
        }),
        propertyCacheRefreshedAt: new Date(),
      },
    });

    const importState = await markImportState({
      organizationId: input.organizationId,
      status: "NOT_STARTED",
      operationalJobId: input.operationalJobId,
      db,
    });

    return {
      management: updatedManagement,
      importState,
      acceptedConnection: true,
      acceptedPropertyCount: acceptedPropertyIds.size,
      acceptedMeterCount: acceptedMeterIds.size,
      syncedPropertyCount: 0,
      failedPropertyCount: 0,
      results: [] as PropertySyncResult[],
    };
  }

  const propertySyncResults: Array<{
    result: PropertySyncResult;
    previewProperty: ProviderPropertyPreview | null;
  }> = await mapWithConcurrency(propertyIds, 2, async (propertyId) => {
    try {
      const effectiveAccountId = propertyAccountPairs.get(propertyId) ?? connectedAccountId;
      const result = await syncRemoteProperty({
        organizationId: input.organizationId,
        effectiveAccountId,
        propertyId,
        acceptedPropertyIds,
        acceptedMeterIds,
        espmClient,
        db,
      });

      if (result.suppressedInQuoin) {
        return {
          result: {
            propertyId: String(propertyId),
            status: "SKIPPED",
            message: "Property stays hidden in Quoin until restored from Settings.",
            buildingId: null,
            buildingName: null,
            propertyLinked: false,
            fullPullStatus: null,
            fullPullMessage: null,
          },
          previewProperty: {
            propertyId: String(propertyId),
            effectiveAccountId,
            linkedBuildingId: null,
            linkedBuildingName: null,
            suppressedInQuoin: true,
          },
        };
      }

      let fullPullStatus: PropertySyncResult["fullPullStatus"] = null;
      let fullPullMessage: string | null = null;
      if (result.buildingId) {
        try {
          const fullPullResult = await runPortfolioManagerFullPullForBuilding({
            organizationId: input.organizationId,
            buildingId: result.buildingId,
            actorType: "SYSTEM",
            actorId: null,
            requestId: `pm-provider-full-pull:${result.buildingId}`,
            db,
          });
          fullPullStatus = fullPullResult.outcome;
          fullPullMessage =
            fullPullResult.stages.snapshot.message ??
            fullPullResult.stages.usage.message ??
            fullPullResult.stages.setup.message;
        } catch (error) {
          fullPullStatus = "FAILED";
          fullPullMessage =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Portfolio Manager full pull failed after the property was linked.";
        }
      }

      return {
        result: {
          propertyId: String(propertyId),
          status: "SYNCED",
          message:
            fullPullStatus === "FAILED"
              ? "Property linked successfully, but the full PM sync needs a retry."
              : fullPullStatus === "NEEDS_MANUAL_SETUP"
                ? "Property linked successfully. This building still needs manual PM setup."
                : "Property pulled and linked successfully.",
          buildingId: result.buildingId,
          buildingName: result.buildingName,
          propertyLinked: true,
          fullPullStatus,
          fullPullMessage,
        },
        previewProperty: {
          propertyId: String(propertyId),
          effectiveAccountId,
          linkedBuildingId: result.buildingId,
          linkedBuildingName: result.buildingName,
          suppressedInQuoin: false,
        },
      };
    } catch (error) {
      return {
        result: {
          propertyId: String(propertyId),
          status: "FAILED",
          message: describeProviderPropertySyncFailure(error),
        },
        previewProperty: null,
      };
    }
  });

  const results = propertySyncResults.map((item) => item.result);
  const previewProperties = propertySyncResults
    .map((item) => item.previewProperty)
    .filter((item): item is ProviderPropertyPreview => item != null);
  const syncedPropertyCount = results.filter((result) => result.status === "SYNCED").length;
  const failedPropertyCount = results.filter((result) => result.status === "FAILED").length;

  const finalStatus = failedPropertyCount > 0 ? "FAILED" : "SUCCEEDED";
  const firstFailure = results.find((result) => result.status === "FAILED")?.message ?? null;
  const importState = await markImportState({
    organizationId: input.organizationId,
    status: finalStatus,
    operationalJobId: input.operationalJobId,
    selectedPropertyIds: propertyIds.map(String),
    results,
    importedCount: syncedPropertyCount,
    failedCount: failedPropertyCount,
    skippedCount: 0,
    latestErrorCode: finalStatus === "FAILED" ? "PM_PROVIDER_SYNC_FAILED" : null,
    latestErrorMessage: finalStatus === "FAILED" ? firstFailure : null,
    db,
  });

  const updatedManagement = await db.portfolioManagerManagement.update({
    where: { organizationId: input.organizationId },
    data: {
      status: finalStatus === "FAILED" ? "FAILED" : "READY",
      providerCustomerId: BigInt(providerAccountId),
      connectedAccountId: BigInt(connectedAccountId),
      connectedUsername,
      lastShareAcceptedAt:
        acceptedPropertyIds.size > 0 || acceptedMeterIds.size > 0 ? new Date() : undefined,
      propertyCacheJson: toJsonValue({
        properties: previewProperties,
        effectiveAccountIds,
      }),
      propertyCacheRefreshedAt: new Date(),
      latestJobId: input.operationalJobId,
      latestErrorCode: finalStatus === "FAILED" ? "PM_PROVIDER_SYNC_FAILED" : null,
      latestErrorMessage: finalStatus === "FAILED" ? firstFailure : null,
    },
  });

  return {
    management: updatedManagement,
    importState,
    acceptedConnection: true,
    acceptedPropertyCount: acceptedPropertyIds.size,
    acceptedMeterCount: acceptedMeterIds.size,
    syncedPropertyCount,
    failedPropertyCount,
    results,
  };
}

export async function enqueuePendingPortfolioManagerProviderSyncPoll(input?: {
  db?: PrismaClient;
}) {
  const db = input?.db ?? prisma;
  await ensureProviderSyncSchemaReady(db);

  const managements = await db.portfolioManagerManagement.findMany({
    where: {
      managementMode: "PROVIDER_SHARED",
      targetUsername: {
        not: null,
      },
    },
    select: {
      organizationId: true,
      latestJobId: true,
      status: true,
    },
  });

  const enqueuedOrganizationIds: string[] = [];

  for (const management of managements) {
    const recovery = await recoverStaleProviderSyncState({
      organizationId: management.organizationId,
      latestJobId: management.latestJobId,
      db,
    });

    const latestJob = await loadJobStatus({
      jobId: management.latestJobId,
      db,
    });

    if (management.status === "RUNNING" && !recovery.recovered) {
      continue;
    }
    if (
      !recovery.recovered &&
      (latestJob?.status === JOB_STATUS.QUEUED ||
        latestJob?.status === JOB_STATUS.RUNNING)
    ) {
      continue;
    }

    const runtimeHealth = await getPmRuntimeHealth({
      latestJobId: recovery.recovered ? null : management.latestJobId,
      active: true,
      db,
    });
    if (runtimeHealth.workerStatus !== "HEALTHY") {
      continue;
    }

    const queueResult = await tryEnqueuePortfolioManagerProviderSync({
      organizationId: management.organizationId,
      actorType: "SYSTEM",
      actorId: null,
      requestId: `pm-provider-poll:${management.organizationId}`,
      db,
    });

    if (queueResult.queued) {
      enqueuedOrganizationIds.push(management.organizationId);
    }
  }

  return {
    scannedCount: managements.length,
    enqueuedCount: enqueuedOrganizationIds.length,
    enqueuedOrganizationIds,
  };
}

export function getPortfolioManagerProviderSyncPollIntervalMs() {
  return PROVIDER_SYNC_POLL_INTERVAL_MS;
}

export async function markPortfolioManagerProviderSyncFailed(input: {
  organizationId: string;
  operationalJobId: string;
  errorCode: string;
  errorMessage: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;

  await db.portfolioManagerManagement.updateMany({
    where: {
      organizationId: input.organizationId,
      managementMode: "PROVIDER_SHARED",
    },
    data: {
      status: "FAILED",
      latestJobId: input.operationalJobId,
      latestErrorCode: input.errorCode,
      latestErrorMessage: input.errorMessage,
    },
  });

  await markImportState({
    organizationId: input.organizationId,
    status: "FAILED",
    operationalJobId: input.operationalJobId,
    latestErrorCode: input.errorCode,
    latestErrorMessage: input.errorMessage,
    db,
  });
}

export function isProviderSyncRetryable(error: unknown) {
  if (error instanceof AppError) {
    return error.retryable;
  }

  return false;
}
