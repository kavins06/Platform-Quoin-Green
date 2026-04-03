import type { ActorType } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import { refreshSourceReconciliationDataIssues } from "@/server/compliance/data-issues";
import { enqueueGreenButtonNotificationJob } from "@/server/pipelines/data-ingestion/green-button";

export type BulkPortfolioOperatorAction = "RERUN_SOURCE_RECONCILIATION";

export interface BulkPortfolioOperatorActionItemResult {
  buildingId: string;
  buildingName: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  message: string;
}

export interface BulkPortfolioOperatorActionResult {
  action: BulkPortfolioOperatorAction;
  targetCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  results: BulkPortfolioOperatorActionItemResult[];
}

function buildOperatorActionAuditBase(input: {
  actorType: ActorType;
  actorId?: string | null;
  organizationId: string;
  buildingId: string;
  requestId?: string | null;
}) {
  return {
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    requestId: input.requestId ?? null,
  };
}

function summarizeOperatorError(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Operator action failed.";
}

function buildGreenButtonReplayUri(resourceUri: string | null, subscriptionId: string) {
  if (!resourceUri) {
    return null;
  }

  const trimmed = resourceUri.replace(/\/+$/, "");
  return `${trimmed}/Batch/Subscription/${subscriptionId}`;
}

export async function reenqueueGreenButtonIngestionFromOperator(input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}) {
  const auditBase = buildOperatorActionAuditBase(input);

  await createAuditLog({
    ...auditBase,
    action: "OPERATOR_GREEN_BUTTON_REENQUEUE_REQUESTED",
  });

  try {
    const connection = await prisma.greenButtonConnection.findFirst({
      where: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
      },
      select: {
        id: true,
        status: true,
        subscriptionId: true,
        resourceUri: true,
      },
    });

    if (!connection) {
      throw new NotFoundError("Green Button connection not found for building");
    }

    if (connection.status !== "ACTIVE") {
      throw new ValidationError("Green Button ingestion can only be retried for an active connection.");
    }

    if (!connection.subscriptionId) {
      throw new ValidationError("Green Button ingestion cannot be retried because the subscription ID is missing.");
    }

    const enqueueResult = await enqueueGreenButtonNotificationJob({
      requestId: input.requestId ?? `operator-gb:${input.buildingId}`,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      connectionId: connection.id,
      subscriptionId: connection.subscriptionId,
      resourceUri: connection.resourceUri,
      notificationUri: buildGreenButtonReplayUri(
        connection.resourceUri,
        connection.subscriptionId,
      ),
    });

    await createAuditLog({
      ...auditBase,
      action: "OPERATOR_GREEN_BUTTON_REENQUEUE_COMPLETED",
      outputSnapshot: {
        queueJobId: enqueueResult.queueJobId,
        deduplicated: enqueueResult.deduplicated,
        notificationUri: enqueueResult.notificationUri,
      },
    });

    return {
      action: "GREEN_BUTTON_REENQUEUE",
      status: enqueueResult.deduplicated ? "DEDUPED" : "QUEUED",
      queueJobId: enqueueResult.queueJobId,
      notificationUri: enqueueResult.notificationUri,
      message: enqueueResult.deduplicated
        ? "A matching Green Button ingestion job is already queued."
        : "Green Button ingestion was re-enqueued.",
    };
  } catch (error) {
    await createAuditLog({
      ...auditBase,
      action: "OPERATOR_GREEN_BUTTON_REENQUEUE_FAILED",
      errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
    throw error;
  }
}

export async function rerunSourceReconciliationFromOperator(input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}) {
  const auditBase = buildOperatorActionAuditBase(input);

  await createAuditLog({
    ...auditBase,
    action: "OPERATOR_SOURCE_RECONCILIATION_REFRESH_REQUESTED",
  });

  try {
    const result = await refreshSourceReconciliationDataIssues({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      requestId: input.requestId ?? null,
    });

    await createAuditLog({
      ...auditBase,
      action: "OPERATOR_SOURCE_RECONCILIATION_REFRESH_COMPLETED",
      outputSnapshot: {
        readinessState: result.readinessSummary.state,
        blockingIssueCount: result.readinessSummary.blockingIssueCount,
        warningIssueCount: result.readinessSummary.warningIssueCount,
        reconciliationStatus: result.reconciliationSummary.status,
      },
    });

    return {
      action: "SOURCE_RECONCILIATION_REFRESH",
      status: result.readinessSummary.state,
      message: "Source reconciliation and downstream issue state were refreshed.",
    };
  } catch (error) {
    await createAuditLog({
      ...auditBase,
      action: "OPERATOR_SOURCE_RECONCILIATION_REFRESH_FAILED",
      errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
    throw error;
  }
}

export async function executeBulkPortfolioOperatorAction(input: {
  organizationId: string;
  buildingIds: string[];
  action: BulkPortfolioOperatorAction;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}): Promise<BulkPortfolioOperatorActionResult> {
  const requestedBuildingIds = Array.from(new Set(input.buildingIds)).filter(Boolean);

  if (requestedBuildingIds.length === 0) {
    return {
      action: input.action,
      targetCount: 0,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
      results: [],
    };
  }

  const buildings = await prisma.building.findMany({
    where: {
      organizationId: input.organizationId,
      id: {
        in: requestedBuildingIds,
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  const buildingById = new Map(buildings.map((building) => [building.id, building]));
  const results: BulkPortfolioOperatorActionItemResult[] = [];

  for (const buildingId of requestedBuildingIds) {
    const building = buildingById.get(buildingId);
    if (!building) {
      results.push({
        buildingId,
        buildingName: "Unknown building",
        status: "SKIPPED",
        message: "Building was not found or is not accessible in this organization.",
      });
      continue;
    }

    try {
      switch (input.action) {
        case "RERUN_SOURCE_RECONCILIATION": {
          const result = await rerunSourceReconciliationFromOperator({
            organizationId: input.organizationId,
            buildingId: building.id,
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            requestId: input.requestId ?? null,
          });

          results.push({
            buildingId: building.id,
            buildingName: building.name,
            status: "SUCCEEDED",
            message: result.message,
          });
          break;
        }
      }
    } catch (error) {
      results.push({
        buildingId: building.id,
        buildingName: building.name,
        status: "FAILED",
        message: summarizeOperatorError(error),
      });
    }
  }

  return {
    action: input.action,
    targetCount: requestedBuildingIds.length,
    succeededCount: results.filter((result) => result.status === "SUCCEEDED").length,
    failedCount: results.filter((result) => result.status === "FAILED").length,
    skippedCount: results.filter((result) => result.status === "SKIPPED").length,
    results,
  };
}
