import type { ActorType } from "@/generated/prisma/client";
import type { ESPM } from "@/server/integrations/espm";
import { prisma } from "@/server/lib/db";
import {
  summarizePortfolioManagerSyncState,
  type PortfolioManagerSyncDiagnostics,
} from "./portfolio-manager-support";
import { syncPortfolioManagerForBuildingReliable } from "./portfolio-manager-sync-reliable";

// Legacy benchmarking compatibility layer only. The current Portfolio Manager
// connection, setup, import, and push workflow lives in src/server/portfolio-manager/*.

type PortfolioManagerCompatibilityClient = Pick<
  ESPM,
  "property" | "meter" | "consumption" | "metrics"
>;
type PortfolioManagerCompatibilityStatus =
  | "IDLE"
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "FAILED";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getDefaultReportingYear(now = new Date()) {
  return now.getUTCFullYear() - 1;
}

/**
 * Projects the persisted legacy PM compatibility row into a diagnostics shape
 * that current benchmark surfaces can still render safely.
 */
export function describePortfolioManagerSyncState(syncState: {
  status: string;
  lastErrorMetadata: unknown;
  syncMetadata: unknown;
} | null): PortfolioManagerSyncDiagnostics | null {
  return summarizePortfolioManagerSyncState(
    syncState as {
      status: PortfolioManagerCompatibilityStatus;
      lastErrorMetadata: unknown;
      syncMetadata: unknown;
    } | null,
  );
}

/**
 * Loads the persisted legacy PM benchmark-compatibility state for one building.
 */
export async function getPortfolioManagerSyncState(params: {
  organizationId: string;
  buildingId: string;
}) {
  const syncState = await prisma.portfolioManagerSyncState.findFirst({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    },
  });

  if (!syncState) {
    return null;
  }

  return {
    ...syncState,
    diagnostics: describePortfolioManagerSyncState(syncState),
  };
}

/**
 * Lists the legacy benchmark-compatibility projection that current annual
 * benchmarking surfaces still depend on.
 */
export async function listPortfolioBenchmarkReadiness(params: {
  organizationId: string;
  reportingYear?: number;
  limit?: number;
}) {
  const reportingYear = params.reportingYear ?? getDefaultReportingYear();
  const limit = params.limit ?? 50;

  const buildings = await prisma.building.findMany({
    where: {
      organizationId: params.organizationId,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      address: true,
      espmPropertyId: true,
      espmShareStatus: true,
    },
  });

  const buildingIds = buildings.map((building) => building.id);
  const [syncStates, submissions] = await Promise.all([
    prisma.portfolioManagerSyncState.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: { in: buildingIds },
      },
    }),
    prisma.benchmarkSubmission.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: { in: buildingIds },
        reportingYear,
      },
      include: {
        complianceRun: true,
      },
    }),
  ]);

  const syncStateByBuilding = new Map(syncStates.map((state) => [state.buildingId, state]));
  const submissionByBuilding = new Map(
    submissions.map((submission) => [submission.buildingId, submission]),
  );

  return buildings.map((building) => {
    const syncState = syncStateByBuilding.get(building.id) ?? null;
    const submission = submissionByBuilding.get(building.id) ?? null;
    const submissionPayload = toRecord(submission?.submissionPayload);
    const readiness = toRecord(submissionPayload["readiness"]);

    return {
      building,
      reportingYear,
      syncState: syncState
        ? {
            ...syncState,
            diagnostics: describePortfolioManagerSyncState(syncState),
          }
        : null,
      benchmarkSubmission: submission,
      readiness: Object.keys(readiness).length > 0 ? readiness : null,
    };
  });
}

/**
 * Runs the retained legacy benchmark-compatibility sync implementation.
 */
export async function syncPortfolioManagerForBuilding(params: {
  organizationId: string;
  buildingId: string;
  reportingYear?: number;
  espmClient: PortfolioManagerCompatibilityClient;
  producedByType: ActorType;
  producedById?: string | null;
  requestId?: string | null;
  now?: Date;
}) {
  return syncPortfolioManagerForBuildingReliable(params);
}
