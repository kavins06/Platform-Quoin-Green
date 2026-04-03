import type { PrismaClient } from "@/generated/prisma";
import {
  PortfolioManagerUsageDirection,
  type ActorType,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import { AppError, ValidationError } from "@/server/lib/errors";
import {
  createJob,
  JOB_STATUS,
  markCompleted,
  markDead,
  markRunning,
} from "@/server/lib/jobs";
import {
  buildDefaultPropertyUseInputs,
  getPortfolioManagerSetupForBuilding,
  hasPersistedPortfolioManagerSetupInputs,
  markPortfolioManagerSetupFailed,
  runPortfolioManagerSetupApply,
  savePortfolioManagerSetupInputs,
} from "@/server/portfolio-manager/setup";
import {
  getPortfolioManagerMeterSetupForBuilding,
  markPortfolioManagerMeterSetupFailed,
  runPortfolioManagerMeterAssociationsApply,
  runPortfolioManagerMeterSetupApply,
  savePortfolioManagerMeterSetup,
} from "@/server/portfolio-manager/meter-setup";
import {
  getPortfolioManagerUsageStatusForBuilding,
  markPortfolioManagerUsageFailed,
  runPortfolioManagerUsageApply,
} from "@/server/portfolio-manager/usage";
import { resolvePortfolioManagerClientForOrganization } from "@/server/portfolio-manager/existing-account";
import { parsePortfolioManagerProperty } from "@/server/compliance/portfolio-manager-support";

const PORTFOLIO_MANAGER_FULL_PULL_JOB_TYPE = "PORTFOLIO_MANAGER_FULL_PULL";

type FullPullStageStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "SKIPPED" | "FAILED";

type FullPullStageSummary = {
  status: FullPullStageStatus;
  message: string | null;
};

type FullPullStageMap = {
  setup: FullPullStageSummary;
  meters: FullPullStageSummary;
  associations: FullPullStageSummary;
  usage: FullPullStageSummary;
  snapshot: FullPullStageSummary;
};

type FullPullOutcome = "SYNCED" | "PARTIAL" | "NEEDS_MANUAL_SETUP" | "FAILED";

function composePropertyAddress(input: {
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}) {
  const segments = [input.addressLine1, input.city, input.state, input.postalCode]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => value!.trim());

  return segments.length > 0 ? segments.join(", ") : null;
}

async function syncLinkedBuildingProfileFromPortfolioManager(input: {
  organizationId: string;
  buildingId: string;
  propertyId: number;
  db: PrismaClient;
}) {
  const espmClient = await resolvePortfolioManagerClientForOrganization({
    organizationId: input.organizationId,
    db: input.db,
  });
  const rawProperty = await espmClient.property.getProperty(input.propertyId);
  const property = parsePortfolioManagerProperty(rawProperty, input.propertyId);
  const address = composePropertyAddress({
    addressLine1: property.addressLine1,
    city: property.city,
    state: property.state,
    postalCode: property.postalCode,
  });

  await input.db.building.update({
    where: { id: input.buildingId },
    data: {
      ...(property.name ? { name: property.name } : {}),
      ...(address ? { address } : {}),
      ...(property.grossFloorArea != null && Number.isFinite(property.grossFloorArea)
        ? { grossSquareFeet: Math.round(property.grossFloorArea) }
        : {}),
      ...(property.yearBuilt != null ? { yearBuilt: property.yearBuilt } : {}),
      espmShareStatus: "LINKED",
    },
  });
}

function getStepErrorCode(step: "setup" | "meters" | "associations" | "usage") {
  switch (step) {
    case "setup":
      return "PM_FULL_PULL_SETUP_FAILED";
    case "meters":
      return "PM_FULL_PULL_METER_SETUP_FAILED";
    case "associations":
      return "PM_FULL_PULL_ASSOCIATIONS_FAILED";
    default:
      return "PM_FULL_PULL_USAGE_IMPORT_FAILED";
  }
}

function deriveAutomaticMeterSelections(
  meterSetup: Awaited<ReturnType<typeof getPortfolioManagerMeterSetupForBuilding>>,
) {
  const localMeterStrategies: Array<{
    meterId: string;
    strategy: "LINK_EXISTING_REMOTE" | "CREATE_REMOTE";
    selectedRemoteMeterId: string | null;
  }> = [];

  for (const meter of meterSetup.localMeters) {
    if (!meter.isActive || meter.espmMeterId != null) {
      continue;
    }

    if (meter.suggestedRemoteMeterId) {
      localMeterStrategies.push({
        meterId: meter.id,
        strategy: "LINK_EXISTING_REMOTE",
        selectedRemoteMeterId: meter.suggestedRemoteMeterId,
      });
      continue;
    }

    if (meter.canCreateRemote) {
      localMeterStrategies.push({
        meterId: meter.id,
        strategy: "CREATE_REMOTE",
        selectedRemoteMeterId: null,
      });
    }
  }

  const importRemoteMeterIds = meterSetup.remoteMeters
    .filter(
      (meter) =>
        !meter.alreadyLinkedLocally &&
        meter.suggestedForLocalMeterId == null &&
        meter.canImport,
    )
    .map((meter) => meter.meterId);

  return {
    localMeterStrategies,
    importRemoteMeterIds,
  };
}

async function runFullPullPipeline(input: {
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const stages: FullPullStageMap = {
    setup: { status: "PENDING", message: null },
    meters: { status: "PENDING", message: null },
    associations: { status: "PENDING", message: null },
    usage: { status: "PENDING", message: null },
    snapshot: { status: "PENDING", message: null },
  };

  let setup = await getPortfolioManagerSetupForBuilding({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  if (!setup.building.espmPropertyId || setup.building.espmShareStatus !== "LINKED") {
    throw new ValidationError("Portfolio Manager full pull requires a linked PM property.");
  }

  await syncLinkedBuildingProfileFromPortfolioManager({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    propertyId: Number(setup.building.espmPropertyId),
    db,
  });

  setup = await getPortfolioManagerSetupForBuilding({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  const hasPersistedInputs = await hasPersistedPortfolioManagerSetupInputs({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  if (!hasPersistedInputs && setup.setupState.propertyUsesStatus !== "APPLIED") {
    const defaultInputs = buildDefaultPropertyUseInputs(setup.building);
    if (defaultInputs.length === 0) {
      stages.setup = {
        status: "FAILED",
        message: "This property needs manual Portfolio Manager setup before Quoin can finish the full pull.",
      };

      return {
        buildingId: input.buildingId,
        reportingYear: new Date().getUTCFullYear() - 1,
        usageResult: null,
        snapshotId: null,
        snapshotDate: null,
        outcome: "NEEDS_MANUAL_SETUP" as const,
        stages,
      };
    }

    stages.setup = {
      status: "RUNNING",
      message: "Saving default Portfolio Manager property-use inputs.",
    };
    setup = await savePortfolioManagerSetupInputs({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      propertyUses: defaultInputs.map((row) => ({
        sortOrder: row.sortOrder,
        useKey: row.useKey,
        displayName: row.displayName,
        grossSquareFeet: row.grossSquareFeet,
        details: row.details,
      })),
      actorType: "SYSTEM",
      actorId: null,
      requestId: `pm-full-pull:${input.buildingId}`,
      db,
    });
    stages.setup = {
      status: "SUCCEEDED",
      message: "Default Portfolio Manager setup inputs were saved.",
    };
  }

  if (setup.setupState.propertyUsesStatus !== "APPLIED") {
    try {
      stages.setup = {
        status: "RUNNING",
        message: "Applying property uses in Portfolio Manager.",
      };
      await runPortfolioManagerSetupApply({
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        operationalJobId: input.operationalJobId,
        db,
      });
      stages.setup = {
        status: "SUCCEEDED",
        message: "Property-use setup applied successfully.",
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Portfolio Manager setup failed.";
      stages.setup = {
        status: "FAILED",
        message,
      };
      await markPortfolioManagerSetupFailed({
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        operationalJobId: input.operationalJobId,
        errorCode: getStepErrorCode("setup"),
        errorMessage: message,
        db,
      });
      throw error;
    }
  } else {
    stages.setup = {
      status: "SKIPPED",
      message: "Property-use setup was already applied.",
    };
  }

  let meterSetup = await getPortfolioManagerMeterSetupForBuilding({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });
  const automaticMeterSelections = deriveAutomaticMeterSelections(meterSetup);

  if (
    automaticMeterSelections.localMeterStrategies.length > 0 ||
    automaticMeterSelections.importRemoteMeterIds.length > 0
  ) {
    stages.meters = {
      status: "RUNNING",
      message: "Saving Portfolio Manager meter mappings.",
    };
    meterSetup = await savePortfolioManagerMeterSetup({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      localMeterStrategies: automaticMeterSelections.localMeterStrategies,
      importRemoteMeterIds: automaticMeterSelections.importRemoteMeterIds,
      actorType: "SYSTEM",
      actorId: null,
      requestId: `pm-full-pull:${input.buildingId}`,
      db,
    });
    stages.meters = {
      status: "SUCCEEDED",
      message: "Meter mappings were saved.",
    };
  }

  if (meterSetup.setupState.canApplyMeters) {
    try {
      stages.meters = {
        status: "RUNNING",
        message: "Applying meter setup in Portfolio Manager.",
      };
      await runPortfolioManagerMeterSetupApply({
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        operationalJobId: input.operationalJobId,
        db,
      });
      stages.meters = {
        status: "SUCCEEDED",
        message: "Meter setup applied successfully.",
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Portfolio Manager meter setup failed.";
      stages.meters = {
        status: "FAILED",
        message,
      };
      await markPortfolioManagerMeterSetupFailed({
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        operationalJobId: input.operationalJobId,
        errorCode: getStepErrorCode("meters"),
        errorMessage: message,
        db,
      });
      throw error;
    }
  } else if (stages.meters.status === "PENDING") {
    stages.meters = {
      status: "SKIPPED",
      message: "No new meter setup changes were needed.",
    };
  }

  meterSetup = await getPortfolioManagerMeterSetupForBuilding({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  if (meterSetup.setupState.canApplyAssociations) {
    try {
      stages.associations = {
        status: "RUNNING",
        message: "Applying Portfolio Manager meter associations.",
      };
      await runPortfolioManagerMeterAssociationsApply({
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        operationalJobId: input.operationalJobId,
        db,
      });
      stages.associations = {
        status: "SUCCEEDED",
        message: "Meter associations applied successfully.",
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Portfolio Manager meter associations failed.";
      stages.associations = {
        status: "FAILED",
        message,
      };
      await markPortfolioManagerMeterSetupFailed({
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        operationalJobId: input.operationalJobId,
        errorCode: getStepErrorCode("associations"),
        errorMessage: message,
        db,
      });
      throw error;
    }
  } else {
    stages.associations = {
      status: "SKIPPED",
      message: "Meter associations were already up to date.",
    };
  }

  const usageStatus = await getPortfolioManagerUsageStatusForBuilding({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    db,
  });

  let usageResult: Awaited<ReturnType<typeof runPortfolioManagerUsageApply>> | null = null;
  if (usageStatus.usageState.canImport) {
    try {
      stages.usage = {
        status: "RUNNING",
        message: "Importing monthly usage and refreshing Portfolio Manager metrics.",
      };
      usageResult = await runPortfolioManagerUsageApply({
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        operationalJobId: input.operationalJobId,
        direction: PortfolioManagerUsageDirection.IMPORT_PM_TO_LOCAL,
        reportingYear: usageStatus.usageState.reportingYear,
        db,
      });
      stages.usage = {
        status: "SUCCEEDED",
        message:
          typeof usageResult.resultSummary?.partialReasonSummary === "string" &&
          usageResult.resultSummary.partialReasonSummary.trim().length > 0
            ? usageResult.resultSummary.partialReasonSummary
            : "Usage import completed.",
      };
      stages.snapshot = {
        status: usageResult.snapshotSummary?.status ?? "SKIPPED",
        message:
          usageResult.snapshotSummary?.message ??
          "No usable Portfolio Manager metrics were available for a benchmark snapshot.",
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Portfolio Manager usage import failed.";
      stages.usage = {
        status: "FAILED",
        message,
      };
      stages.snapshot = {
        status: "SKIPPED",
        message: "Snapshot refresh did not run because usage import failed.",
      };
      await markPortfolioManagerUsageFailed({
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        operationalJobId: input.operationalJobId,
        errorCode: getStepErrorCode("usage"),
        errorMessage: message,
        db,
      });
      throw error;
    }
  } else {
    stages.usage = {
      status: "SKIPPED",
      message: usageStatus.usageState.summaryLine,
    };
    stages.snapshot = {
      status: "SKIPPED",
      message: "Snapshot refresh waits until Portfolio Manager usage import can run.",
    };
  }

  const outcome: FullPullOutcome =
    stages.setup.status === "FAILED" &&
    stages.setup.message?.toLowerCase().includes("manual")
      ? "NEEDS_MANUAL_SETUP"
      : stages.setup.status === "FAILED" ||
          stages.meters.status === "FAILED" ||
          stages.associations.status === "FAILED" ||
          stages.usage.status === "FAILED"
        ? "FAILED"
        : usageResult?.usageStatus === "PARTIAL"
          ? "PARTIAL"
          : stages.usage.status === "SUCCEEDED" || stages.snapshot.status === "SUCCEEDED"
          ? "SYNCED"
          : "PARTIAL";

  return {
    buildingId: input.buildingId,
    reportingYear: usageStatus.usageState.reportingYear,
    usageResult,
    snapshotId: usageResult?.snapshotSummary?.snapshotId ?? null,
    snapshotDate: usageResult?.snapshotSummary?.snapshotDate ?? null,
    outcome,
    stages,
  };
}

export async function runPortfolioManagerFullPullForBuilding(input: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
  db?: PrismaClient;
}) {
  const db = input.db ?? prisma;
  const job = await createJob(
    {
      type: PORTFOLIO_MANAGER_FULL_PULL_JOB_TYPE,
      status: JOB_STATUS.QUEUED,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      maxAttempts: 1,
    },
    db,
  );

  await markRunning(job.id, db);

  try {
    const result = await runFullPullPipeline({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      operationalJobId: job.id,
      db,
    });

    await markCompleted(job.id, db);
    await createAuditLog({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      requestId: input.requestId ?? null,
      action: "portfolio_manager.full_pull.completed",
      outputSnapshot: {
        operationalJobId: job.id,
        reportingYear: result.reportingYear,
        snapshotId: result.snapshotId,
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
        : "Portfolio Manager full pull failed.";

    await markDead(job.id, message, db);
    await createAuditLog({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      requestId: input.requestId ?? null,
      action: "portfolio_manager.full_pull.failed",
      errorCode: error instanceof AppError ? error.code : "PM_FULL_PULL_FAILED",
      outputSnapshot: {
        operationalJobId: job.id,
        message,
      },
    });

    throw error;
  }
}
