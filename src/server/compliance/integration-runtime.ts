import type {
  DataIngestionMethod,
  EspmShareStatus,
  GreenButtonStatus,
  IntegrationRuntimeStatus,
  Prisma,
  PortfolioManagerSyncStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";

const INTEGRATION_STALE_DAYS = 30;

type RuntimeStatusValue =
  | "NOT_CONNECTED"
  | "IDLE"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "RETRYING"
  | "STALE";

type BuildingRuntimeInput = {
  id: string;
  greenButtonStatus: GreenButtonStatus | null;
  dataIngestionMethod: DataIngestionMethod | null;
  espmShareStatus: EspmShareStatus | null;
};

type PortfolioManagerRuntimeSource = {
  id: string;
  status: PortfolioManagerSyncStatus;
  lastAttemptedSyncAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastFailedSyncAt: Date | null;
  attemptCount: number;
  retryCount: number;
  latestJobId: string | null;
  latestErrorCode: string | null;
  latestErrorMessage: string | null;
} | null;

type GreenButtonRuntimeSource = {
  id: string;
  status: GreenButtonStatus;
  runtimeStatus: IntegrationRuntimeStatus;
  lastWebhookReceivedAt: Date | null;
  lastAttemptedIngestionAt: Date | null;
  lastSuccessfulIngestionAt: Date | null;
  lastFailedIngestionAt: Date | null;
  attemptCount: number;
  retryCount: number;
  latestJobId: string | null;
  latestErrorCode: string | null;
  latestErrorMessage: string | null;
} | null;

export interface IntegrationRuntimeSummary {
  system: "PORTFOLIO_MANAGER" | "GREEN_BUTTON";
  currentState: RuntimeStatusValue;
  connectionStatus: string | null;
  lastAttemptedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastWebhookReceivedAt: string | null;
  attemptCount: number;
  retryCount: number;
  latestJobId: string | null;
  latestErrorCode: string | null;
  latestErrorMessage: string | null;
  isStale: boolean;
  needsAttention: boolean;
  attentionReason: string | null;
  staleReason: string | null;
  sourceRecordId: string | null;
}

export interface BuildingIntegrationRuntimeSummary {
  portfolioManager: IntegrationRuntimeSummary;
  greenButton: IntegrationRuntimeSummary;
  needsAttention: boolean;
  attentionCount: number;
  nextAction: {
    title: string;
    reason: string;
  } | null;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function isOlderThanDays(value: Date | null | undefined, days: number, now: Date) {
  if (!value) {
    return false;
  }

  return value.getTime() < now.getTime() - days * 24 * 60 * 60 * 1000;
}

function buildPortfolioManagerRuntimeSummary(input: {
  building: BuildingRuntimeInput;
  syncState: PortfolioManagerRuntimeSource;
  now: Date;
}): IntegrationRuntimeSummary {
  if (!input.syncState) {
    const needsAttention = input.building.espmShareStatus === "LINKED";
    return {
      system: "PORTFOLIO_MANAGER",
      currentState: needsAttention ? "IDLE" : "NOT_CONNECTED",
      connectionStatus: input.building.espmShareStatus,
      lastAttemptedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastWebhookReceivedAt: null,
      attemptCount: 0,
      retryCount: 0,
      latestJobId: null,
      latestErrorCode: null,
      latestErrorMessage: null,
      isStale: false,
      needsAttention,
      attentionReason: needsAttention
        ? "Portfolio Manager is linked but no sync has been recorded yet."
        : null,
      staleReason: null,
      sourceRecordId: null,
    };
  }

  const isStale =
    input.syncState.status !== "RUNNING" &&
    isOlderThanDays(input.syncState.lastSuccessfulSyncAt, INTEGRATION_STALE_DAYS, input.now);
  const currentState: RuntimeStatusValue =
    input.syncState.status === "RUNNING"
      ? "RUNNING"
      : input.syncState.status === "FAILED"
        ? input.syncState.retryCount > 0
          ? "RETRYING"
          : "FAILED"
        : isStale
          ? "STALE"
          : input.syncState.status === "SUCCEEDED" || input.syncState.status === "PARTIAL"
            ? "SUCCEEDED"
            : "IDLE";
  const attentionReason =
    currentState === "STALE"
      ? "Portfolio Manager data is stale and should be refreshed."
      : currentState === "FAILED" || currentState === "RETRYING"
        ? input.syncState.latestErrorMessage ?? "Portfolio Manager sync needs attention."
        : currentState === "IDLE" && input.building.espmShareStatus === "LINKED"
          ? "Portfolio Manager is linked but has not been synced."
          : input.building.espmShareStatus !== "LINKED"
            ? "Portfolio Manager linkage is incomplete."
            : null;

  return {
    system: "PORTFOLIO_MANAGER",
    currentState,
    connectionStatus: input.building.espmShareStatus,
    lastAttemptedAt: toIso(input.syncState.lastAttemptedSyncAt),
    lastSucceededAt: toIso(input.syncState.lastSuccessfulSyncAt),
    lastFailedAt: toIso(input.syncState.lastFailedSyncAt),
    lastWebhookReceivedAt: null,
    attemptCount: input.syncState.attemptCount,
    retryCount: input.syncState.retryCount,
    latestJobId: input.syncState.latestJobId,
    latestErrorCode: input.syncState.latestErrorCode,
    latestErrorMessage: input.syncState.latestErrorMessage,
    isStale,
    needsAttention: attentionReason != null,
    attentionReason,
    staleReason: isStale ? `No successful sync in the last ${INTEGRATION_STALE_DAYS} days.` : null,
    sourceRecordId: input.syncState.id,
  };
}

function buildGreenButtonRuntimeSummary(input: {
  building: BuildingRuntimeInput;
  connection: GreenButtonRuntimeSource;
  now: Date;
}): IntegrationRuntimeSummary {
  if (!input.connection) {
    const needsAttention =
      input.building.dataIngestionMethod === "GREEN_BUTTON" ||
      input.building.greenButtonStatus === "PENDING_AUTH";
    return {
      system: "GREEN_BUTTON",
      currentState: needsAttention ? "IDLE" : "NOT_CONNECTED",
      connectionStatus: input.building.greenButtonStatus,
      lastAttemptedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastWebhookReceivedAt: null,
      attemptCount: 0,
      retryCount: 0,
      latestJobId: null,
      latestErrorCode: null,
      latestErrorMessage: null,
      isStale: false,
      needsAttention,
      attentionReason: !needsAttention
        ? null
        : input.building.greenButtonStatus === "PENDING_AUTH"
          ? "Green Button authorization is pending."
          : "Green Button ingestion is configured but no connection exists.",
      staleReason: null,
      sourceRecordId: null,
    };
  }

  const isEnabled =
    input.connection.status === "ACTIVE" ||
    input.building.greenButtonStatus === "ACTIVE" ||
    input.building.dataIngestionMethod === "GREEN_BUTTON";
  const isStale =
    isEnabled &&
    input.connection.runtimeStatus !== "RUNNING" &&
    isOlderThanDays(
      input.connection.lastSuccessfulIngestionAt,
      INTEGRATION_STALE_DAYS,
      input.now,
    );
  const currentState: RuntimeStatusValue =
    input.connection.status !== "ACTIVE"
      ? "NOT_CONNECTED"
      : input.connection.runtimeStatus === "RUNNING"
        ? "RUNNING"
        : input.connection.runtimeStatus === "FAILED"
          ? input.connection.retryCount > 0
            ? "RETRYING"
            : "FAILED"
          : input.connection.runtimeStatus === "RETRYING"
            ? "RETRYING"
            : isStale
              ? "STALE"
              : input.connection.runtimeStatus === "SUCCEEDED"
                ? "SUCCEEDED"
                : "IDLE";
  const attentionReason =
    currentState === "STALE"
      ? "Green Button ingestion is stale and should be checked."
      : currentState === "FAILED" || currentState === "RETRYING"
        ? input.connection.latestErrorMessage ?? "Green Button ingestion needs attention."
        : currentState === "NOT_CONNECTED"
          ? "Green Button is not connected for this building."
          : currentState === "IDLE" && isEnabled
            ? "Green Button is active but no ingestion has succeeded yet."
            : null;

  return {
    system: "GREEN_BUTTON",
    currentState,
    connectionStatus: input.connection.status,
    lastAttemptedAt: toIso(input.connection.lastAttemptedIngestionAt),
    lastSucceededAt: toIso(input.connection.lastSuccessfulIngestionAt),
    lastFailedAt: toIso(input.connection.lastFailedIngestionAt),
    lastWebhookReceivedAt: toIso(input.connection.lastWebhookReceivedAt),
    attemptCount: input.connection.attemptCount,
    retryCount: input.connection.retryCount,
    latestJobId: input.connection.latestJobId,
    latestErrorCode: input.connection.latestErrorCode,
    latestErrorMessage: input.connection.latestErrorMessage,
    isStale,
    needsAttention: attentionReason != null,
    attentionReason,
    staleReason: isStale ? `No successful ingestion in the last ${INTEGRATION_STALE_DAYS} days.` : null,
    sourceRecordId: input.connection.id,
  };
}

function buildBuildingIntegrationRuntimeSummary(input: {
  building: BuildingRuntimeInput;
  syncState: PortfolioManagerRuntimeSource;
  greenButtonConnection: GreenButtonRuntimeSource;
  now?: Date;
}): BuildingIntegrationRuntimeSummary {
  const now = input.now ?? new Date();
  const portfolioManager = buildPortfolioManagerRuntimeSummary({
    building: input.building,
    syncState: input.syncState,
    now,
  });
  const greenButton = buildGreenButtonRuntimeSummary({
    building: input.building,
    connection: input.greenButtonConnection,
    now,
  });
  const attentionCount = [portfolioManager, greenButton].filter(
    (entry) => entry.needsAttention,
  ).length;
  const nextAction =
    portfolioManager.needsAttention && portfolioManager.attentionReason
      ? {
          title: "Refresh Portfolio Manager sync",
          reason: portfolioManager.attentionReason,
        }
      : greenButton.needsAttention && greenButton.attentionReason
        ? {
            title: "Review Green Button ingestion",
            reason: greenButton.attentionReason,
          }
        : null;

  return {
    portfolioManager,
    greenButton,
    needsAttention: attentionCount > 0,
    attentionCount,
    nextAction,
  };
}

type BuildingRuntimeRecord = {
  id: string;
  greenButtonStatus: GreenButtonStatus | null;
  dataIngestionMethod: DataIngestionMethod | null;
  espmShareStatus: EspmShareStatus | null;
};

export async function listBuildingIntegrationRuntimeSummaries(params: {
  organizationId: string;
  buildingIds: string[];
}) {
  const buildingIds = Array.from(new Set(params.buildingIds)).filter(Boolean);
  if (buildingIds.length === 0) {
    return new Map<string, BuildingIntegrationRuntimeSummary>();
  }

  const [buildings, syncStates, greenButtonConnections] = await Promise.all([
    prisma.building.findMany({
      where: {
        organizationId: params.organizationId,
        id: { in: buildingIds },
      },
      select: {
        id: true,
        greenButtonStatus: true,
        dataIngestionMethod: true,
        espmShareStatus: true,
      },
    }),
    prisma.portfolioManagerSyncState.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: { in: buildingIds },
      },
      select: {
        id: true,
        buildingId: true,
        status: true,
        lastAttemptedSyncAt: true,
        lastSuccessfulSyncAt: true,
        lastFailedSyncAt: true,
        attemptCount: true,
        retryCount: true,
        latestJobId: true,
        latestErrorCode: true,
        latestErrorMessage: true,
      },
    }),
    prisma.greenButtonConnection.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: { in: buildingIds },
      },
      select: {
        id: true,
        buildingId: true,
        status: true,
        runtimeStatus: true,
        lastWebhookReceivedAt: true,
        lastAttemptedIngestionAt: true,
        lastSuccessfulIngestionAt: true,
        lastFailedIngestionAt: true,
        attemptCount: true,
        retryCount: true,
        latestJobId: true,
        latestErrorCode: true,
        latestErrorMessage: true,
      },
    }),
  ]);

  const syncStateByBuildingId = new Map(
    syncStates.map((entry) => [entry.buildingId, entry]),
  );
  const connectionByBuildingId = new Map(
    greenButtonConnections.map((entry) => [entry.buildingId, entry]),
  );

  return new Map(
    buildings.map((building) => [
      building.id,
      buildBuildingIntegrationRuntimeSummary({
        building,
        syncState: syncStateByBuildingId.get(building.id) ?? null,
        greenButtonConnection: connectionByBuildingId.get(building.id) ?? null,
      }),
    ]),
  );
}

export async function getBuildingIntegrationRuntimeSummary(params: {
  organizationId: string;
  buildingId: string;
}) {
  const summaries = await listBuildingIntegrationRuntimeSummaries({
    organizationId: params.organizationId,
    buildingIds: [params.buildingId],
  });

  return (
    summaries.get(params.buildingId) ??
    buildBuildingIntegrationRuntimeSummary({
      building: {
        id: params.buildingId,
        greenButtonStatus: null,
        dataIngestionMethod: null,
        espmShareStatus: null,
      },
      syncState: null,
      greenButtonConnection: null,
    })
  );
}

export async function noteGreenButtonWebhookReceived(params: {
  connectionId: string;
  at?: Date;
}) {
  const at = params.at ?? new Date();
  return prisma.greenButtonConnection.update({
    where: { id: params.connectionId },
    data: {
      lastWebhookReceivedAt: at,
    },
  });
}

export async function markGreenButtonIngestionRunning(params: {
  connectionId: string;
  jobId: string;
  at?: Date;
}) {
  const at = params.at ?? new Date();
  return prisma.greenButtonConnection.update({
    where: { id: params.connectionId },
    data: {
      runtimeStatus: "RUNNING",
      lastAttemptedIngestionAt: at,
      attemptCount: { increment: 1 },
      latestJobId: params.jobId,
      latestErrorCode: null,
      latestErrorMessage: null,
    },
  });
}

export async function markGreenButtonIngestionSucceeded(params: {
  connectionId: string;
  jobId: string;
  at?: Date;
}) {
  const at = params.at ?? new Date();
  return prisma.greenButtonConnection.update({
    where: { id: params.connectionId },
    data: {
      runtimeStatus: "SUCCEEDED",
      lastSuccessfulIngestionAt: at,
      latestJobId: params.jobId,
      latestErrorCode: null,
      latestErrorMessage: null,
    },
  });
}

export async function markGreenButtonIngestionFailed(params: {
  connectionId: string;
  jobId: string;
  errorCode?: string | null;
  errorMessage: string;
  retryScheduled: boolean;
  at?: Date;
}) {
  const at = params.at ?? new Date();
  return prisma.greenButtonConnection.update({
    where: { id: params.connectionId },
    data: {
      runtimeStatus: params.retryScheduled ? "RETRYING" : "FAILED",
      lastFailedIngestionAt: at,
      retryCount: params.retryScheduled ? { increment: 1 } : undefined,
      latestJobId: params.jobId,
      latestErrorCode: params.errorCode ?? null,
      latestErrorMessage: params.errorMessage,
    },
  });
}

export function mergeRuntimeSyncMetadata(
  syncMetadata: unknown,
  updates: Record<string, unknown>,
): Prisma.InputJsonValue {
  const base =
    syncMetadata && typeof syncMetadata === "object" && !Array.isArray(syncMetadata)
      ? (syncMetadata as Record<string, unknown>)
      : {};

  return {
    ...base,
    ...updates,
  } as Prisma.InputJsonValue;
}
