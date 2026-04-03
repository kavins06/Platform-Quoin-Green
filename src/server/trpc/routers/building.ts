import { z } from "zod";
import { router, tenantProcedure, protectedProcedure, operatorProcedure } from "../init";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/server/lib/db";
import { Prisma } from "@/generated/prisma";
import {
  getLatestComplianceSnapshot,
  LATEST_SNAPSHOT_ORDER,
} from "@/server/lib/compliance-snapshots";
import {
  collapseDisplayEnergyReadings,
  dedupeEnergyReadings,
} from "@/server/lib/energy-readings";
import { getPortfolioWorklist } from "@/server/compliance/portfolio-worklist";
import {
  listBuildingDataIssues,
  listPortfolioDataIssues,
  refreshBuildingIssuesAfterDataChange,
  updateDataIssueStatus,
} from "@/server/compliance/data-issues";
import {
  getBuildingGovernedOperationalSummary,
  listBuildingGovernedOperationalSummaries,
} from "@/server/compliance/governed-operational-summary";
import { getBuildingArtifactWorkspace } from "@/server/compliance/compliance-artifacts";
import { getBuildingSourceReconciliationSummary } from "@/server/compliance/source-reconciliation";
import { transitionSubmissionWorkflow as executeSubmissionWorkflowTransition } from "@/server/compliance/submission-workflows";
import {
  executeBulkPortfolioOperatorAction,
  reenqueueGreenButtonIngestionFromOperator,
  rerunSourceReconciliationFromOperator,
} from "@/server/compliance/operator-controls";
import { BUILDING_SELECTED_PATHWAY_VALUES } from "@/lib/contracts/beps";
import { deleteBuildingLifecycle } from "@/server/lifecycle/building-teardown";
import {
  enqueuePortfolioManagerProvisioningForBuilding,
  getPortfolioManagerManagementForOrganization,
  getPortfolioManagerManagedContext,
  retryPortfolioManagerProvisioningFromOperator,
} from "@/server/portfolio-manager/managed-provisioning";
import { ValidationError } from "@/server/lib/errors";
import { getPortfolioManagerSetupSummaryForBuilding } from "@/server/portfolio-manager/setup";
import type { AppRole } from "@/server/lib/organization-membership";
import { listOrganizationMembershipsForUser } from "@/server/lib/organization-membership";
import { canManageOperatorActions } from "@/server/lib/tenant-access";
import { getPmRuntimeHealth } from "@/server/lib/runtime-health";
import { env } from "@/server/lib/config";
import {
  hasCapability,
  requireCapability,
} from "@/server/lib/capabilities";
import { createAuditLog } from "@/server/lib/audit-log";
import {
  requestRemoteBuildingDeleteApproval,
  requestSubmissionWorkflowTransitionApproval,
} from "@/server/lib/approval-requests";
import {
  createProviderSharedPropertyForBuilding,
  deriveRemotePropertyDeleteAction,
  deleteRemotePropertyForBuilding,
  updateProviderSharedPropertyForBuilding,
} from "@/server/portfolio-manager/provider-property-writes";
import {
  confirmUtilityBillCandidates,
  getUtilityBillUploadReview,
  listUtilityBillUploadsForBuilding,
  retryUtilityBillUpload,
} from "@/server/utility-bills/service";
import {
  evaluateBuildingProfile,
  buildDefaultPropertyUsesFromCoarseType,
  getBuildingProfileMissingInputMessage,
  toSerializablePropertyUseDetails,
} from "@/lib/buildings/property-use-profile";
import { BUILDING_PROPERTY_USE_KEYS } from "@/lib/buildings/property-use-registry";
import { BEPS_TARGET_SCORES } from "@/lib/buildings/beps-targets";
import {
  hasPortfolioManagerMailingAddress,
  PORTFOLIO_MANAGER_MAILING_ADDRESS_ERROR,
} from "@/lib/buildings/portfolio-manager-address";

const DEFAULT_BUILDING_COORDINATES = {
  latitude: 38.9072,
  longitude: -77.0369,
} as const;

const buildingPropertyUseKeySchema = z.enum(BUILDING_PROPERTY_USE_KEYS);
const propertyUseDetailValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
const buildingPropertyUseInputSchema = z.object({
  id: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0),
  useKey: buildingPropertyUseKeySchema,
  displayName: z.string().max(200),
  grossSquareFeet: z.number().int().min(0),
  details: z.record(z.string(), propertyUseDetailValueSchema).default({}),
});

const createBuildingInput = z.object({
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  grossSquareFeet: z.number().int().positive(),
  propertyType: z.enum(["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"]).optional(),
  yearBuilt: z.number().int().min(1800).max(2030).optional(),
  plannedConstructionCompletionYear: z.number().int().min(1800).max(2100).optional(),
  occupancyRate: z.number().min(0).max(100).optional(),
  irrigatedAreaSquareFeet: z.number().int().min(0).optional(),
  numberOfBuildings: z.number().int().min(1).default(1),
  propertyUses: z.array(buildingPropertyUseInputSchema).max(12).default([]),
  bepsTargetScore: z.number().min(0).max(100).optional(),
  maxPenaltyExposure: z.number().min(0).default(0),
  espmPropertyId: z.string().max(50).optional(),
});

const listBuildingsInput = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  sortBy: z
    .enum(["name", "address", "grossSquareFeet", "propertyType", "createdAt"])
    .default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
  propertyType: z
    .enum(["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"])
    .optional(),
  search: z.string().max(200).optional(),
});

const portfolioWorklistInput = z.object({
  search: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
  pageSize: z.number().int().min(1).max(100).default(25),
  triageBucket: z
    .enum([
      "COMPLIANCE_BLOCKER",
      "ARTIFACT_ATTENTION",
      "REVIEW_QUEUE",
      "SUBMISSION_QUEUE",
      "SYNC_ATTENTION",
      "MONITORING",
    ])
    .optional(),
  readinessState: z
    .enum(["DATA_INCOMPLETE", "READY_FOR_REVIEW", "READY_TO_SUBMIT", "SUBMITTED"])
    .optional(),
  hasBlockingIssues: z.boolean().optional(),
  triageUrgency: z.enum(["NOW", "NEXT", "MONITOR"]).optional(),
  submissionState: z
    .enum([
      "NOT_STARTED",
      "DRAFT",
      "READY_FOR_REVIEW",
      "APPROVED_FOR_SUBMISSION",
      "SUBMITTED",
      "COMPLETED",
      "NEEDS_CORRECTION",
      "SUPERSEDED",
    ])
    .optional(),
  needsSyncAttention: z.boolean().optional(),
  artifactStatus: z
    .enum(["NOT_STARTED", "GENERATED", "STALE", "FINALIZED"])
    .optional(),
  nextAction: z
    .enum([
      "RESOLVE_BLOCKING_ISSUES",
      "REFRESH_INTEGRATION",
      "REGENERATE_ARTIFACT",
      "FINALIZE_ARTIFACT",
      "REVIEW_COMPLIANCE_RESULT",
      "SUBMIT_ARTIFACT",
      "MONITOR_SUBMISSION",
    ])
    .optional(),
  sortBy: z
    .enum(["PRIORITY", "NAME", "LAST_COMPLIANCE_EVALUATED"])
    .default("PRIORITY"),
});

const dataIssueActionStatusSchema = z.enum([
  "IN_PROGRESS",
  "RESOLVED",
  "DISMISSED",
]);

const submissionWorkflowTransitionSchema = z.enum([
  "READY_FOR_REVIEW",
  "APPROVED_FOR_SUBMISSION",
  "SUBMITTED",
  "COMPLETED",
  "NEEDS_CORRECTION",
]);

const bulkPortfolioOperatorActionSchema = z.enum([
  "RERUN_SOURCE_RECONCILIATION",
]);

const buildingDeleteModeSchema = z.enum([
  "UNLINK_ONLY",
  "DELETE_REMOTE_PROPERTY",
]);
const utilityBillUtilityTypeSchema = z.enum(["ELECTRIC", "GAS", "WATER"]);
const utilityBillUnitSchema = z.enum(["KWH", "THERMS", "KBTU", "MMBTU", "GAL", "KGAL", "CCF"]);

async function ensureOrganizationBuilding(organizationId: string, buildingId: string) {
  const building = await prisma.building.findFirst({
    where: {
      id: buildingId,
      organizationId,
    },
    select: {
      id: true,
    },
  });

  if (!building) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Building not found",
    });
  }
}

function buildOperatorAccess(appRole: AppRole) {
  return {
    canManage: canManageOperatorActions(appRole),
    appRole,
  };
}

function canWriteThroughProviderAccount(managementMode: string | null | undefined) {
  return managementMode === "PROVIDER_SHARED";
}

function validatePortfolioManagerAddressForManagedFlow(input: {
  address: string;
  requiresPortfolioManagerAddress: boolean;
}) {
  if (
    input.requiresPortfolioManagerAddress &&
    !hasPortfolioManagerMailingAddress(input.address)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: PORTFOLIO_MANAGER_MAILING_ADDRESS_ERROR,
    });
  }
}

type RemoteBuildingActionKind = "DELETE_PROPERTY" | "UNSHARE_PROPERTY";

function buildRemoteBuildingAction(input: {
  appRole: AppRole;
  espmPropertyId: string | null;
  managementMode: string | null | undefined;
  connectedAccountId?: bigint | number | null;
  rawPayloadJson?: unknown;
}) {
  if (!input.espmPropertyId) {
    return {
      available: false,
      kind: null,
      label: null,
      description: null,
      unavailableReason: null,
    };
  }

  if (!hasCapability(input.appRole, "BUILDING_DELETE_REMOTE_REQUEST")) {
    return {
      available: false,
      kind: null,
      label: null,
      description: null,
      unavailableReason:
        "You can still unlink this building in Quoin, but you do not have permission to run the linked ESPM action.",
    };
  }

  const resolvedRemoteAction =
    input.espmPropertyId == null
      ? null
      : deriveRemotePropertyDeleteAction({
          managementMode: input.managementMode,
          connectedAccountId: input.connectedAccountId ?? null,
          rawPayloadJson: input.rawPayloadJson,
        });

  if (resolvedRemoteAction === "UNSHARE_PROPERTY") {
    return {
      available: true,
      kind: "UNSHARE_PROPERTY" as const,
      label: "Remove ESPM provider access too",
      description: `Remove Quoin's provider access to linked ESPM property ${input.espmPropertyId}, then remove the local Quoin building.`,
      unavailableReason: null,
    };
  }

  if (resolvedRemoteAction === "DELETE_PROPERTY") {
    return {
      available: true,
      kind: "DELETE_PROPERTY" as const,
      label: "Delete from ESPM too",
      description: `Delete linked ESPM property ${input.espmPropertyId}, then remove the local Quoin building.`,
      unavailableReason: null,
    };
  }

  return {
    available: false,
    kind: null,
    label: null,
    description: null,
    unavailableReason:
      "This building is linked to an ESPM property, but Quoin does not have a supported remote action for the current Portfolio Manager connection mode.",
  };
}

function extractRemoteBuildingFields(input: {
  name: string;
  address: string;
  grossSquareFeet: number;
  propertyType: "OFFICE" | "MULTIFAMILY" | "MIXED_USE" | "OTHER";
  yearBuilt: number | null;
  plannedConstructionCompletionYear: number | null;
  occupancyRate: number | null;
  irrigatedAreaSquareFeet: number | null;
  numberOfBuildings: number;
  propertyUses: Array<{
    useKey: (typeof BUILDING_PROPERTY_USE_KEYS)[number];
    displayName: string;
    grossSquareFeet: number;
    details: Record<string, unknown>;
  }>;
}) {
  return {
    name: input.name,
    address: input.address,
    grossSquareFeet: input.grossSquareFeet,
    propertyType: input.propertyType,
    yearBuilt: input.yearBuilt,
    plannedConstructionCompletionYear: input.plannedConstructionCompletionYear,
    occupancyRate: input.occupancyRate,
    irrigatedAreaSquareFeet: input.irrigatedAreaSquareFeet,
    numberOfBuildings: input.numberOfBuildings,
    propertyUses: input.propertyUses,
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toInputJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeBuildingPropertyUses(
  propertyUses: Array<z.infer<typeof buildingPropertyUseInputSchema>>,
) {
  return [...propertyUses]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((row, index) => ({
      id: row.id ?? null,
      sortOrder: index,
      useKey: row.useKey,
      displayName: row.displayName.trim(),
      grossSquareFeet: row.grossSquareFeet,
      details: toSerializablePropertyUseDetails(row.useKey, row.details),
    }));
}

function buildResolvedPropertyUses(input: {
  buildingName: string;
  grossSquareFeet: number;
  propertyType?: "OFFICE" | "MULTIFAMILY" | "MIXED_USE" | "OTHER";
  propertyUses: Array<z.infer<typeof buildingPropertyUseInputSchema>>;
}) {
  if (input.propertyUses.length > 0) {
    return normalizeBuildingPropertyUses(input.propertyUses);
  }

  if (!input.propertyType) {
    return [];
  }

  return buildDefaultPropertyUsesFromCoarseType({
    buildingName: input.buildingName,
    propertyType: input.propertyType,
    grossSquareFeet: input.grossSquareFeet,
  }).map((propertyUse, index) => ({
    id: null,
    sortOrder: propertyUse.sortOrder ?? index,
    useKey: propertyUse.useKey,
    displayName: propertyUse.displayName,
    grossSquareFeet: propertyUse.grossSquareFeet,
    details: toSerializablePropertyUseDetails(propertyUse.useKey, propertyUse.details),
  }));
}

function buildBuildingResultPayload(input: {
  building: {
    id: string;
    organizationId: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    grossSquareFeet: number;
    propertyType: "OFFICE" | "MULTIFAMILY" | "MIXED_USE" | "OTHER";
    yearBuilt: number | null;
    plannedConstructionCompletionYear: number | null;
    occupancyRate: number | null;
    irrigatedAreaSquareFeet: number | null;
    numberOfBuildings: number;
    bepsTargetScore: number;
    maxPenaltyExposure: number;
    espmPropertyId: bigint | null;
    espmShareStatus: string;
    createdAt: Date;
    updatedAt: Date;
    propertyUses: Array<{
      id: string;
      sortOrder: number;
      useKey: string;
      displayName: string;
      grossSquareFeet: number;
      detailsJson: unknown;
      espmPropertyUseId: bigint | null;
      espmUseDetailsId: bigint | null;
    }>;
  };
}) {
  const propertyUses = input.building.propertyUses.map(toClientBuildingPropertyUse);
  const benchmarkProfile = buildBenchmarkProfileSummary({
    grossSquareFeet: input.building.grossSquareFeet,
    yearBuilt: input.building.yearBuilt,
    plannedConstructionCompletionYear: input.building.plannedConstructionCompletionYear,
    propertyUses,
  });

  return {
    ...input.building,
    espmPropertyId: input.building.espmPropertyId?.toString() ?? null,
    propertyUses,
    benchmarkProfile,
  };
}

function toClientBuildingPropertyUse(
  propertyUse: {
    id: string;
    sortOrder: number;
    useKey: string;
    displayName: string;
    grossSquareFeet: number;
    detailsJson: unknown;
    espmPropertyUseId: bigint | null;
    espmUseDetailsId: bigint | null;
  },
) {
  return {
    id: propertyUse.id,
    sortOrder: propertyUse.sortOrder,
    useKey: propertyUse.useKey,
    displayName: propertyUse.displayName,
    grossSquareFeet: propertyUse.grossSquareFeet,
    details: toRecord(propertyUse.detailsJson),
    espmPropertyUseId: propertyUse.espmPropertyUseId?.toString() ?? null,
    espmUseDetailsId: propertyUse.espmUseDetailsId?.toString() ?? null,
  };
}

function buildBenchmarkProfileSummary(input: {
  grossSquareFeet: number;
  yearBuilt: number | null;
  plannedConstructionCompletionYear: number | null;
  propertyUses: Array<{
    id?: string | null;
    sortOrder: number;
    useKey: string;
    displayName: string;
    grossSquareFeet: number;
    details: Record<string, unknown>;
  }>;
}) {
  const evaluation = evaluateBuildingProfile({
    grossSquareFeet: input.grossSquareFeet,
    yearBuilt: input.yearBuilt,
    plannedConstructionCompletionYear: input.plannedConstructionCompletionYear,
    propertyUses: input.propertyUses.map((propertyUse) => ({
      ...propertyUse,
      useKey: propertyUse.useKey as (typeof BUILDING_PROPERTY_USE_KEYS)[number],
    })),
  });

  return {
    ...evaluation,
    missingInputMessages: evaluation.missingInputCodes.map(
      getBuildingProfileMissingInputMessage,
    ),
  };
}

function normalizePortfolioManagerOverviewMetrics(latestMetricsJson: unknown) {
  const latestMetrics = toRecord(latestMetricsJson);
  if (Object.keys(latestMetrics).length === 0) {
    return null;
  }

  return {
    energyStarScore: toNumber(latestMetrics.score),
    siteEui: toNumber(latestMetrics.siteIntensity),
    sourceEui: toNumber(latestMetrics.sourceIntensity),
    weatherNormalizedSiteEui: toNumber(latestMetrics.weatherNormalizedSiteIntensity),
  };
}

export const buildingRouter = router({
  onboardingStatus: protectedProcedure.query(async ({ ctx }) => {
    let hasOrg = false;
    let orgExists = false;
    let buildingCount = 0;
    let appRole: AppRole = "VIEWER";

    if (ctx.authUserId) {
      const membershipData = await listOrganizationMembershipsForUser({
        authUserId: ctx.authUserId,
      });
      const activeMembership =
        membershipData.memberships.find(
          (membership) => membership.organization.id === ctx.activeOrganizationId,
        ) ?? membershipData.memberships[0] ?? null;

      hasOrg = membershipData.memberships.length > 0;
      orgExists = activeMembership != null;
      appRole = activeMembership?.role ?? "VIEWER";

      if (activeMembership) {
        buildingCount = await prisma.building.count({
          where: { organizationId: activeMembership.organization.id },
        });
      }
    }

      return {
        hasOrg,
        orgSynced: orgExists,
        hasBuilding: buildingCount > 0,
        buildingCount,
        isComplete: hasOrg && orgExists,
        operatorAccess: buildOperatorAccess(appRole),
      };
    }),

  list: tenantProcedure
    .input(listBuildingsInput)
    .query(async ({ ctx, input }) => {
      const { page, pageSize, sortBy, sortOrder, propertyType, search } = input;
      const skip = (page - 1) * pageSize;

      const where: Record<string, unknown> = {
        organizationId: ctx.organizationId,
      };
      if (propertyType) where.propertyType = propertyType;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { address: { contains: search, mode: "insensitive" } },
        ];
      }

      const [buildings, total] = await Promise.all([
        prisma.building.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { [sortBy]: sortOrder },
          include: {
            complianceSnapshots: {
              orderBy: LATEST_SNAPSHOT_ORDER,
              take: 1,
            },
          },
        }),
        prisma.building.count({ where }),
      ]);

      const buildingIds = buildings.map((building) => building.id);
      const governedSummaries = await listBuildingGovernedOperationalSummaries({
        organizationId: ctx.organizationId,
        buildingIds,
      });

      return {
        buildings: buildings.map((b) => {
          const governedSummary = governedSummaries.get(b.id);
          if (!governedSummary) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Building readiness state is unavailable",
            });
          }

          return {
            ...b,
            latestSnapshot: b.complianceSnapshots[0] ?? null,
            readinessSummary: governedSummary.readinessSummary,
            issueSummary: governedSummary.issueSummary,
            activeIssueCounts: governedSummary.activeIssueCounts,
            governedSummary,
          };
        }),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    }),

  get: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const building = await prisma.building.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          _count: {
            select: {
              meters: true,
              energyReadings: true,
              complianceSnapshots: true,
            },
          },
          propertyUses: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          complianceSnapshots: {
            orderBy: LATEST_SNAPSHOT_ORDER,
            take: 1,
          },
          auditLogs: {
            orderBy: { timestamp: "desc" },
            take: 8,
            select: {
              id: true,
              timestamp: true,
              action: true,
              errorCode: true,
              requestId: true,
            },
          },
        },
      });

      if (!building) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Building not found",
        });
      }

      const [
        governedSummary,
        sourceReconciliation,
        managedPortfolioManager,
        portfolioManagerImportState,
        portfolioManagerSetupSummary,
        portfolioManagerUsageState,
        remoteProperty,
      ] = await Promise.all([
        getBuildingGovernedOperationalSummary({
          organizationId: ctx.organizationId,
          buildingId: input.id,
        }),
        getBuildingSourceReconciliationSummary({
          organizationId: ctx.organizationId,
          buildingId: input.id,
        }),
        getPortfolioManagerManagedContext({
          organizationId: ctx.organizationId,
          buildingId: input.id,
        }),
        prisma.portfolioManagerImportState.findUnique({
          where: { organizationId: ctx.organizationId },
        }),
        getPortfolioManagerSetupSummaryForBuilding({
          organizationId: ctx.organizationId,
          buildingId: input.id,
        }),
        prisma.portfolioManagerUsageState.findUnique({
          where: { buildingId: input.id },
          select: {
            latestMetricsJson: true,
            lastMetricsRefreshedAt: true,
            metricsStatus: true,
          },
        }),
        building.espmPropertyId
          ? prisma.portfolioManagerRemoteProperty.findUnique({
              where: {
                organizationId_propertyId: {
                  organizationId: ctx.organizationId,
                  propertyId: building.espmPropertyId,
                },
              },
              select: {
                rawPayloadJson: true,
              },
            })
          : Promise.resolve(null),
      ]);
      const runtimeHealth = await getPmRuntimeHealth({
        latestJobId:
          managedPortfolioManager.provisioning?.latestJobId ??
          portfolioManagerImportState?.latestJobId ??
          null,
        active:
          managedPortfolioManager.provisioning?.status === "QUEUED" ||
          managedPortfolioManager.provisioning?.status === "RUNNING" ||
          portfolioManagerImportState?.status === "QUEUED" ||
          portfolioManagerImportState?.status === "RUNNING",
      });
      const propertyUses = building.propertyUses.map(toClientBuildingPropertyUse);
      const benchmarkProfile = buildBenchmarkProfileSummary({
        grossSquareFeet: building.grossSquareFeet,
        yearBuilt: building.yearBuilt,
        plannedConstructionCompletionYear: building.plannedConstructionCompletionYear,
        propertyUses,
      });
      const espmPropertyId = building.espmPropertyId?.toString() ?? null;
      const managementMode = managedPortfolioManager.management?.managementMode;
      const remoteBuildingAction = buildRemoteBuildingAction({
        appRole: ctx.appRole,
        espmPropertyId,
        managementMode,
        connectedAccountId:
          managedPortfolioManager.management?.connectedAccountId ?? null,
        rawPayloadJson: remoteProperty?.rawPayloadJson,
      });

      return {
        ...building,
        espmPropertyId,
        latestSnapshot: building.complianceSnapshots[0] ?? null,
        recentAuditLogs: building.auditLogs,
        localDataCounts: {
          meterCount: building._count.meters,
          energyReadingCount: building._count.energyReadings,
          complianceSnapshotCount: building._count.complianceSnapshots,
        },
        operatorAccess: buildOperatorAccess(ctx.appRole),
        readinessSummary: governedSummary.readinessSummary,
        issueSummary: governedSummary.issueSummary,
        governedSummary,
        sourceReconciliation,
        portfolioManagerManagement: managedPortfolioManager.management
          ? {
              ...managedPortfolioManager.management,
              providerUsername: env.ESPM_USERNAME ?? null,
            }
          : null,
        portfolioManagerProvisioning: managedPortfolioManager.provisioning,
        portfolioManagerImportState,
        portfolioManagerSetupSummary,
        latestPortfolioManagerMetrics: normalizePortfolioManagerOverviewMetrics(
          portfolioManagerUsageState?.latestMetricsJson,
        ),
        portfolioManagerRuntimeHealth: runtimeHealth,
        remoteBuildingAction,
        propertyUses,
        benchmarkProfile,
      };
    }),

  getArtifactWorkspace: tenantProcedure
    .input(z.object({ buildingId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);

      return getBuildingArtifactWorkspace({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
      });
    }),

  portfolioWorklist: tenantProcedure
    .input(portfolioWorklistInput)
    .query(async ({ ctx, input }) => {
      const result = await getPortfolioWorklist({
        organizationId: ctx.organizationId,
        search: input.search,
        triageBucket: input.triageBucket,
        readinessState: input.readinessState,
        hasBlockingIssues: input.hasBlockingIssues,
        triageUrgency: input.triageUrgency,
        submissionState: input.submissionState,
        needsSyncAttention: input.needsSyncAttention,
        artifactStatus: input.artifactStatus,
        nextAction: input.nextAction,
        sortBy: input.sortBy,
        cursor: input.cursor,
        pageSize: input.pageSize,
      });

      return {
        ...result,
        operatorAccess: buildOperatorAccess(ctx.appRole),
      };
    }),

  listIssues: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
        status: z.enum(["ACTIVE", "ALL"]).default("ACTIVE"),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return listBuildingDataIssues({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        status: input.status,
      });
    }),

  portfolioIssues: tenantProcedure
    .input(
      z.object({
        status: z.enum(["ACTIVE", "ALL"]).default("ACTIVE"),
        limit: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ ctx, input }) =>
      listPortfolioDataIssues({
        organizationId: ctx.organizationId,
        status: input.status,
        limit: input.limit,
      }),
    ),

  updateIssueStatus: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
        issueId: z.string(),
        nextStatus: dataIssueActionStatusSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return updateDataIssueStatus({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        issueId: input.issueId,
        nextStatus: input.nextStatus,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      });
    }),

  retryPortfolioManagerProvisioning: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);

      return retryPortfolioManagerProvisioningFromOperator({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      });
    }),

  reenqueueGreenButtonIngestion: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return reenqueueGreenButtonIngestionFromOperator({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      });
    }),

  rerunSourceReconciliation: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return rerunSourceReconciliationFromOperator({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      });
    }),

  bulkOperatePortfolio: operatorProcedure
    .input(
      z.object({
        buildingIds: z.array(z.string()).min(1).max(100),
        action: bulkPortfolioOperatorActionSchema,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      executeBulkPortfolioOperatorAction({
        organizationId: ctx.organizationId,
        buildingIds: input.buildingIds,
        action: input.action,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      }),
    ),

  transitionSubmissionWorkflow: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
        workflowId: z.string(),
        nextState: submissionWorkflowTransitionSchema,
        notes: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      const appRole = ctx.appRole as AppRole;
      requireCapability({
        role: appRole,
        capability: "SUBMISSION_TRANSITION_REQUEST",
      });

      if (!hasCapability(appRole, "SUBMISSION_TRANSITION_EXECUTE")) {
        const approvalRequest = await requestSubmissionWorkflowTransitionApproval({
          organizationId: ctx.organizationId,
          buildingId: input.buildingId,
          workflowId: input.workflowId,
          nextState: input.nextState,
          notes: input.notes ?? null,
          requestedByType: "USER",
          requestedById: ctx.authUserId ?? null,
          requestId: ctx.requestId ?? null,
        });

        return {
          ...approvalRequest,
          state: "NOT_STARTED" as const,
          history: [] as Array<{
            id: string;
            fromState: null;
            toState: "READY_FOR_REVIEW";
            notes: null;
            createdAt: string;
            createdByType: "SYSTEM";
            createdById: null;
          }>,
        };
      }

      const workflow = await executeSubmissionWorkflowTransition({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        workflowId: input.workflowId,
        nextState: input.nextState,
        notes: input.notes ?? null,
        createdByType: "USER",
        createdById: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      });

      return {
        ...workflow,
        outcome: "EXECUTED" as const,
        approvalRequestId: null,
        message: "Submission workflow updated.",
        history: workflow?.history ?? [],
        state: workflow?.state ?? "NOT_STARTED",
      };
    }),

  create: operatorProcedure
    .input(createBuildingInput)
    .mutation(async ({ ctx, input }) => {
      const {
        espmPropertyId,
        latitude,
        longitude,
        propertyUses: rawPropertyUses,
        propertyType: requestedPropertyType,
        bepsTargetScore,
        ...rest
      } = input;
      const managedPortfolioManager = await getPortfolioManagerManagementForOrganization({
        organizationId: ctx.organizationId,
      });
      const hasAuthoritativePortfolioManagerMode =
        managedPortfolioManager.management?.managementMode != null;
      const providerManagedWrite =
        canWriteThroughProviderAccount(
          managedPortfolioManager.management?.managementMode,
        );
      const propertyUses = buildResolvedPropertyUses({
        buildingName: input.name,
        grossSquareFeet: input.grossSquareFeet,
        propertyType: requestedPropertyType,
        propertyUses: rawPropertyUses,
      });
      const benchmarkProfile = buildBenchmarkProfileSummary({
        grossSquareFeet: input.grossSquareFeet,
        yearBuilt: input.yearBuilt ?? null,
        plannedConstructionCompletionYear:
          input.plannedConstructionCompletionYear ?? null,
        propertyUses,
      });
      const resolvedPropertyType =
        propertyUses.length > 0
          ? benchmarkProfile.derivedPropertyType
          : requestedPropertyType ?? "OTHER";
      const resolvedBepsTargetScore =
        bepsTargetScore ??
        (propertyUses.length > 0
          ? benchmarkProfile.recommendedTargetScore
          : (BEPS_TARGET_SCORES[resolvedPropertyType] ?? 50));

      validatePortfolioManagerAddressForManagedFlow({
        address: input.address,
        requiresPortfolioManagerAddress:
          benchmarkProfile.isComplete &&
          (providerManagedWrite || managedPortfolioManager.isManaged),
      });

      const building = await prisma.building.create({
        data: {
          ...rest,
          propertyType: resolvedPropertyType,
          bepsTargetScore: resolvedBepsTargetScore,
          latitude: latitude ?? DEFAULT_BUILDING_COORDINATES.latitude,
          longitude: longitude ?? DEFAULT_BUILDING_COORDINATES.longitude,
          organizationId: ctx.organizationId,
          espmPropertyId:
            hasAuthoritativePortfolioManagerMode || !espmPropertyId
              ? null
              : BigInt(espmPropertyId),
          espmShareStatus:
            managedPortfolioManager.isManaged && benchmarkProfile.isComplete
              ? "PENDING"
              : undefined,
          propertyUses: {
            create: propertyUses.map((propertyUse) => ({
              organization: {
                connect: {
                  id: ctx.organizationId,
                },
              },
              sortOrder: propertyUse.sortOrder,
              useKey: propertyUse.useKey,
              displayName: propertyUse.displayName,
              grossSquareFeet: propertyUse.grossSquareFeet,
              detailsJson: toInputJsonValue(propertyUse.details),
            })),
          },
        },
        include: {
          propertyUses: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      });

      if (providerManagedWrite && benchmarkProfile.isComplete) {
        try {
          const remoteProperty = await createProviderSharedPropertyForBuilding({
            organizationId: ctx.organizationId,
            building: {
              id: building.id,
              ...extractRemoteBuildingFields({
                name: building.name,
                address: building.address,
                grossSquareFeet: building.grossSquareFeet,
                propertyType: building.propertyType,
                yearBuilt: building.yearBuilt,
                plannedConstructionCompletionYear:
                  building.plannedConstructionCompletionYear,
                occupancyRate: building.occupancyRate,
                irrigatedAreaSquareFeet: building.irrigatedAreaSquareFeet,
                numberOfBuildings: building.numberOfBuildings,
                propertyUses: building.propertyUses.map((propertyUse) => ({
                  useKey: propertyUse.useKey as (typeof BUILDING_PROPERTY_USE_KEYS)[number],
                  displayName: propertyUse.displayName,
                  grossSquareFeet: propertyUse.grossSquareFeet,
                  details: toRecord(propertyUse.detailsJson),
                })),
              }),
            },
          });

          const linkedBuilding = await prisma.building.update({
            where: { id: building.id },
            data: {
              espmPropertyId: BigInt(remoteProperty.propertyId),
              espmShareStatus: "LINKED",
            },
            include: {
              propertyUses: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          });

          return buildBuildingResultPayload({
            building: linkedBuilding,
          });
        } catch (error) {
          const message =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Portfolio Manager property could not be created through the provider account.";

          const failedBuilding = await prisma.building.update({
            where: { id: building.id },
            data: {
              espmShareStatus: "FAILED",
            },
            include: {
              propertyUses: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          });

          return {
            ...buildBuildingResultPayload({
              building: failedBuilding,
            }),
            portfolioManagerWarning: message,
          };
        }
      }

      if (managedPortfolioManager.isManaged && benchmarkProfile.isComplete) {
        try {
          await enqueuePortfolioManagerProvisioningForBuilding({
            organizationId: ctx.organizationId,
            buildingId: building.id,
            requestId: ctx.requestId ?? null,
            actorType: "USER",
            actorId: ctx.authUserId ?? null,
            trigger: "BUILDING_CREATE",
          });
        } catch (error) {
          const message =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Portfolio Manager provisioning could not be queued.";

          await prisma.portfolioManagerProvisioningState.upsert({
            where: { buildingId: building.id },
            create: {
              organizationId: ctx.organizationId,
              buildingId: building.id,
              status: "FAILED",
              latestErrorCode: "PM_QUEUE_ENQUEUE_FAILED",
              latestErrorMessage: message,
              lastFailedAt: new Date(),
            },
            update: {
              status: "FAILED",
              latestErrorCode: "PM_QUEUE_ENQUEUE_FAILED",
              latestErrorMessage: message,
              lastFailedAt: new Date(),
            },
          });

          await prisma.building.update({
            where: { id: building.id },
            data: {
              espmShareStatus: "FAILED",
            },
          });
        }
      }

      return buildBuildingResultPayload({
        building,
      });
    }),

  update: operatorProcedure
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          name: z.string().min(1).max(200).optional(),
          address: z.string().min(1).max(500).optional(),
          latitude: z.number().min(-90).max(90).optional(),
          longitude: z.number().min(-180).max(180).optional(),
          grossSquareFeet: z.number().int().positive().optional(),
          propertyType: z
            .enum(["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"])
            .optional(),
          yearBuilt: z.number().int().min(1800).max(2030).nullable().optional(),
          plannedConstructionCompletionYear: z
            .number()
            .int()
            .min(1800)
            .max(2100)
            .nullable()
            .optional(),
          occupancyRate: z.number().min(0).max(100).nullable().optional(),
          irrigatedAreaSquareFeet: z.number().int().min(0).nullable().optional(),
          numberOfBuildings: z.number().int().min(1).optional(),
          propertyUses: z.array(buildingPropertyUseInputSchema).max(12).optional(),
          bepsTargetScore: z.number().min(0).max(100).optional(),
          maxPenaltyExposure: z.number().min(0).optional(),
          espmPropertyId: z.string().max(50).nullable().optional(),
          selectedPathway: z.enum(BUILDING_SELECTED_PATHWAY_VALUES).optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { espmPropertyId, propertyUses: requestedPropertyUses, ...rest } = input.data;
      const portfolioManager = await getPortfolioManagerManagementForOrganization({
        organizationId: ctx.organizationId,
      });

      if (portfolioManager.management && espmPropertyId !== undefined) {
        throw new ValidationError(
          "Managed Portfolio Manager linkage is authoritative for this organization. Use the managed connection flow instead.",
        );
      }

      const existingBuilding = await prisma.building.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          propertyUses: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      });

      if (!existingBuilding) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Building not found",
        });
      }

      const nextPropertyUses =
        requestedPropertyUses === undefined
          ? existingBuilding.propertyUses.map((propertyUse) => ({
              id: propertyUse.id,
              sortOrder: propertyUse.sortOrder,
              useKey: propertyUse.useKey,
              displayName: propertyUse.displayName,
              grossSquareFeet: propertyUse.grossSquareFeet,
              details: toRecord(propertyUse.detailsJson),
            }))
          : normalizeBuildingPropertyUses(requestedPropertyUses);

      const nextBenchmarkProfile = buildBenchmarkProfileSummary({
        grossSquareFeet: rest.grossSquareFeet ?? existingBuilding.grossSquareFeet,
        yearBuilt:
          rest.yearBuilt !== undefined ? rest.yearBuilt : existingBuilding.yearBuilt,
        plannedConstructionCompletionYear:
          rest.plannedConstructionCompletionYear !== undefined
            ? rest.plannedConstructionCompletionYear
            : existingBuilding.plannedConstructionCompletionYear,
        propertyUses: nextPropertyUses,
      });
      const nextPropertyType =
        nextPropertyUses.length > 0
          ? nextBenchmarkProfile.derivedPropertyType
          : rest.propertyType ?? existingBuilding.propertyType;
      const nextBepsTargetScore =
        rest.bepsTargetScore ??
        (nextPropertyUses.length > 0
          ? nextBenchmarkProfile.recommendedTargetScore
          : (BEPS_TARGET_SCORES[nextPropertyType] ?? existingBuilding.bepsTargetScore));

      const nextRemoteFields = extractRemoteBuildingFields({
        name: rest.name ?? existingBuilding.name,
        address: rest.address ?? existingBuilding.address,
        grossSquareFeet: rest.grossSquareFeet ?? existingBuilding.grossSquareFeet,
        propertyType: nextPropertyType,
        yearBuilt:
          rest.yearBuilt !== undefined ? rest.yearBuilt : existingBuilding.yearBuilt,
        plannedConstructionCompletionYear:
          rest.plannedConstructionCompletionYear !== undefined
            ? rest.plannedConstructionCompletionYear
            : existingBuilding.plannedConstructionCompletionYear,
        occupancyRate:
          rest.occupancyRate !== undefined
            ? rest.occupancyRate
            : existingBuilding.occupancyRate,
        irrigatedAreaSquareFeet:
          rest.irrigatedAreaSquareFeet !== undefined
            ? rest.irrigatedAreaSquareFeet
            : existingBuilding.irrigatedAreaSquareFeet,
        numberOfBuildings:
          rest.numberOfBuildings !== undefined
            ? rest.numberOfBuildings
            : existingBuilding.numberOfBuildings,
        propertyUses: nextPropertyUses.map((propertyUse) => ({
          useKey: propertyUse.useKey as (typeof BUILDING_PROPERTY_USE_KEYS)[number],
          displayName: propertyUse.displayName,
          grossSquareFeet: propertyUse.grossSquareFeet,
          details: propertyUse.details,
        })),
      });

      validatePortfolioManagerAddressForManagedFlow({
        address: nextRemoteFields.address,
        requiresPortfolioManagerAddress:
          nextBenchmarkProfile.isComplete &&
          (canWriteThroughProviderAccount(
            portfolioManager.management?.managementMode,
          ) || portfolioManager.isManaged),
      });

      const shouldUpdateProviderProperty =
        canWriteThroughProviderAccount(portfolioManager.management?.managementMode) &&
        existingBuilding.espmPropertyId != null &&
        nextBenchmarkProfile.isComplete &&
        (rest.name !== undefined ||
          rest.address !== undefined ||
          rest.grossSquareFeet !== undefined ||
          rest.propertyType !== undefined ||
          rest.yearBuilt !== undefined ||
          rest.plannedConstructionCompletionYear !== undefined ||
          rest.occupancyRate !== undefined ||
          rest.irrigatedAreaSquareFeet !== undefined ||
          rest.numberOfBuildings !== undefined ||
          requestedPropertyUses !== undefined);

      if (
        shouldUpdateProviderProperty
      ) {
        await updateProviderSharedPropertyForBuilding({
          organizationId: ctx.organizationId,
          propertyId: existingBuilding.espmPropertyId!.toString(),
          building: {
            id: existingBuilding.id,
            ...nextRemoteFields,
          },
        });
      }

      const existingPropertyUsesById = new Map(
        existingBuilding.propertyUses.map((propertyUse) => [propertyUse.id, propertyUse]),
      );

      const building = await prisma.$transaction(async (tx) => {
        if (requestedPropertyUses !== undefined) {
          const keepIds = nextPropertyUses
            .map((propertyUse) => propertyUse.id)
            .filter((value): value is string => Boolean(value));

          await tx.buildingPropertyUse.deleteMany({
            where: {
              buildingId: input.id,
              organizationId: ctx.organizationId,
              ...(keepIds.length > 0 ? { id: { notIn: keepIds } } : {}),
            },
          });

          for (const propertyUse of nextPropertyUses) {
            const existingPropertyUse = propertyUse.id
              ? existingPropertyUsesById.get(propertyUse.id)
              : null;

            if (existingPropertyUse) {
              await tx.buildingPropertyUse.update({
                where: { id: existingPropertyUse.id },
                data: {
                  sortOrder: propertyUse.sortOrder,
                  useKey: propertyUse.useKey,
                  displayName: propertyUse.displayName,
                  grossSquareFeet: propertyUse.grossSquareFeet,
                  detailsJson: toInputJsonValue(propertyUse.details),
                  espmPropertyUseId:
                    existingPropertyUse.useKey === propertyUse.useKey
                      ? existingPropertyUse.espmPropertyUseId
                      : null,
                  espmUseDetailsId:
                    existingPropertyUse.useKey === propertyUse.useKey
                      ? existingPropertyUse.espmUseDetailsId
                      : null,
                },
              });
            } else {
              await tx.buildingPropertyUse.create({
                data: {
                  organizationId: ctx.organizationId,
                  buildingId: input.id,
                  sortOrder: propertyUse.sortOrder,
                  useKey: propertyUse.useKey,
                  displayName: propertyUse.displayName,
                  grossSquareFeet: propertyUse.grossSquareFeet,
                  detailsJson: toInputJsonValue(propertyUse.details),
                },
              });
            }
          }
        }

        return tx.building.update({
          where: { id: input.id },
          data: {
            ...rest,
            propertyType: nextPropertyType,
            bepsTargetScore: nextBepsTargetScore,
            ...(espmPropertyId !== undefined
              ? { espmPropertyId: espmPropertyId ? BigInt(espmPropertyId) : null }
              : {}),
          },
          include: {
            propertyUses: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
          },
        });
      });

      const shouldCreateProviderProperty =
        canWriteThroughProviderAccount(portfolioManager.management?.managementMode) &&
        existingBuilding.espmPropertyId == null &&
        building.espmPropertyId == null &&
        nextBenchmarkProfile.isComplete;

      if (shouldCreateProviderProperty) {
        try {
          const remoteProperty = await createProviderSharedPropertyForBuilding({
            organizationId: ctx.organizationId,
            building: {
              id: building.id,
              ...nextRemoteFields,
            },
          });

          const linkedBuilding = await prisma.building.update({
            where: { id: input.id },
            data: {
              espmPropertyId: BigInt(remoteProperty.propertyId),
              espmShareStatus: "LINKED",
            },
            include: {
              propertyUses: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          });

          return buildBuildingResultPayload({
            building: linkedBuilding,
          });
        } catch {
          await prisma.building.update({
            where: { id: input.id },
            data: {
              espmShareStatus: "FAILED",
            },
          });
        }
      } else if (
        portfolioManager.isManaged &&
        nextBenchmarkProfile.isComplete &&
        existingBuilding.espmPropertyId == null &&
        building.espmPropertyId == null
      ) {
        try {
          await enqueuePortfolioManagerProvisioningForBuilding({
            organizationId: ctx.organizationId,
            buildingId: input.id,
            requestId: ctx.requestId ?? null,
            actorType: "USER",
            actorId: ctx.authUserId ?? null,
            trigger: "RETRY",
          });
        } catch (error) {
          const message =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Portfolio Manager provisioning could not be queued.";

          await prisma.portfolioManagerProvisioningState.upsert({
            where: { buildingId: input.id },
            create: {
              organizationId: ctx.organizationId,
              buildingId: input.id,
              status: "FAILED",
              latestErrorCode: "PM_QUEUE_ENQUEUE_FAILED",
              latestErrorMessage: message,
              lastFailedAt: new Date(),
            },
            update: {
              status: "FAILED",
              latestErrorCode: "PM_QUEUE_ENQUEUE_FAILED",
              latestErrorMessage: message,
              lastFailedAt: new Date(),
            },
          });

          await prisma.building.update({
            where: { id: input.id },
            data: {
              espmShareStatus: "FAILED",
            },
          });
        }
      }

      return buildBuildingResultPayload({
        building,
      });
    }),

  delete: operatorProcedure
    .input(
      z.object({
        id: z.string(),
        deleteMode: buildingDeleteModeSchema.default("UNLINK_ONLY"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const appRole = ctx.appRole as AppRole;
      requireCapability({
        role: appRole,
        capability: "BUILDING_DELETE",
      });

      const building = await prisma.building.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        select: {
          id: true,
          name: true,
          espmPropertyId: true,
        },
      });
      if (!building) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Building not found",
        });
      }
      const portfolioManagerManagement = (
        await getPortfolioManagerManagementForOrganization({
          organizationId: ctx.organizationId,
        })
      ).management;
      const remoteProperty =
        building?.espmPropertyId != null
          ? await prisma.portfolioManagerRemoteProperty.findUnique({
              where: {
                organizationId_propertyId: {
                  organizationId: ctx.organizationId,
                  propertyId: building.espmPropertyId,
                },
              },
              select: {
                rawPayloadJson: true,
              },
            })
          : null;

      if (input.deleteMode === "DELETE_REMOTE_PROPERTY") {
        requireCapability({
          role: appRole,
          capability: "BUILDING_DELETE_REMOTE_REQUEST",
        });

        if (!building.espmPropertyId) {
          throw new ValidationError(
            "This building is not linked to an ESPM property, so there is nothing to delete remotely.",
          );
        }

        const remoteBuildingAction = buildRemoteBuildingAction({
          appRole,
          espmPropertyId: building.espmPropertyId.toString(),
          managementMode: portfolioManagerManagement?.managementMode ?? null,
          connectedAccountId:
            portfolioManagerManagement?.connectedAccountId ?? null,
          rawPayloadJson: remoteProperty?.rawPayloadJson,
        });

        if (!remoteBuildingAction.available || !remoteBuildingAction.kind) {
          throw new ValidationError(
            remoteBuildingAction.unavailableReason ??
              "This linked ESPM property cannot be changed remotely from Quoin.",
          );
        }

        if (!hasCapability(appRole, "BUILDING_DELETE_REMOTE_EXECUTE")) {
          const approvalRequest = await requestRemoteBuildingDeleteApproval({
            organizationId: ctx.organizationId,
            buildingId: input.id,
            propertyId: building.espmPropertyId.toString(),
            actionKind: remoteBuildingAction.kind,
            requestedByType: "USER",
            requestedById: ctx.authUserId ?? null,
            requestId: ctx.requestId ?? null,
          });

          return {
            success: true,
            deleteMode: input.deleteMode,
            ...approvalRequest,
          };
        }

        const remoteDeleteResult = await deleteRemotePropertyForBuilding({
          organizationId: ctx.organizationId,
          propertyId: building.espmPropertyId.toString(),
        });

        await createAuditLog({
          actorType: "USER",
          actorId: ctx.authUserId ?? null,
          organizationId: ctx.organizationId,
          buildingId: null,
          action:
            remoteDeleteResult.remoteAction === "UNSHARE_PROPERTY"
              ? "BUILDING_REMOTE_PROPERTY_UNSHARED"
              : "BUILDING_REMOTE_PROPERTY_DELETED",
          inputSnapshot: {
            buildingId: input.id,
            propertyId: building.espmPropertyId.toString(),
            deleteMode: input.deleteMode,
            managementMode: portfolioManagerManagement?.managementMode ?? null,
          },
          outputSnapshot: remoteDeleteResult,
          requestId: ctx.requestId ?? null,
        });
      }

      if (
        input.deleteMode === "UNLINK_ONLY" &&
        portfolioManagerManagement?.managementMode === "PROVIDER_SHARED" &&
        building.espmPropertyId
      ) {
        const suppressedAt = new Date();
        await prisma.portfolioManagerRemoteProperty.upsert({
          where: {
            organizationId_propertyId: {
              organizationId: ctx.organizationId,
              propertyId: building.espmPropertyId,
            },
          },
          create: {
            organizationId: ctx.organizationId,
            linkedBuildingId: null,
            remoteAccountId: portfolioManagerManagement.connectedAccountId ?? null,
            propertyId: building.espmPropertyId,
            shareStatus: "ACCEPTED",
            localSuppressedAt: suppressedAt,
            localSuppressedByType: "USER",
            localSuppressedById: ctx.authUserId ?? null,
          },
          update: {
            linkedBuildingId: null,
            localSuppressedAt: suppressedAt,
            localSuppressedByType: "USER",
            localSuppressedById: ctx.authUserId ?? null,
          },
        });

        await createAuditLog({
          actorType: "USER",
          actorId: ctx.authUserId ?? null,
          organizationId: ctx.organizationId,
          buildingId: null,
          action: "BUILDING_PROVIDER_SHARED_SUPPRESSED",
          inputSnapshot: {
            buildingId: input.id,
            buildingName: building.name,
            propertyId: building.espmPropertyId.toString(),
            managementMode: portfolioManagerManagement.managementMode,
          },
          outputSnapshot: {
            success: true,
            suppressedInQuoin: true,
          },
          requestId: ctx.requestId ?? null,
        });
      }

      await createAuditLog({
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        organizationId: ctx.organizationId,
        buildingId: null,
        action: "BUILDING_LOCAL_DELETED",
        inputSnapshot: {
          buildingId: input.id,
          deleteMode: input.deleteMode,
          propertyId: building.espmPropertyId?.toString() ?? null,
          managementMode: portfolioManagerManagement?.managementMode ?? null,
        },
        outputSnapshot: {
          success: true,
        },
        requestId: ctx.requestId ?? null,
      });

      await deleteBuildingLifecycle({
        organizationId: ctx.organizationId,
        buildingId: input.id,
      });

      return {
        success: true,
        deleteMode: input.deleteMode,
        outcome: "EXECUTED" as const,
        approvalRequestId: null,
        message:
          input.deleteMode === "DELETE_REMOTE_PROPERTY"
            ? portfolioManagerManagement?.managementMode === "PROVIDER_SHARED"
              ? "Provider access removed in ESPM and building deleted in Quoin."
              : "Building deleted in Quoin and ESPM."
            : portfolioManagerManagement?.managementMode === "PROVIDER_SHARED" &&
                building.espmPropertyId
              ? "Removed from Quoin. ESPM access stays connected."
              : "Building deleted in Quoin.",
      };
    }),

  pipelineRuns: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return prisma.pipelineRun.findMany({
        where: {
          buildingId: input.buildingId,
          organizationId: ctx.organizationId,
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
    }),

  latestSnapshot: tenantProcedure
    .input(z.object({ buildingId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return getLatestComplianceSnapshot(prisma, {
        buildingId: input.buildingId,
        organizationId: ctx.organizationId,
      });
    }),

  createEnergyReadingOverride: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
        readingId: z.string(),
        periodStart: z.coerce.date(),
        periodEnd: z.coerce.date(),
        consumption: z.number().positive(),
        cost: z.number().min(0).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      const sourceReading = await prisma.energyReading.findFirst({
        where: {
          id: input.readingId,
          buildingId: input.buildingId,
          organizationId: ctx.organizationId,
          archivedAt: null,
        },
      });

      if (!sourceReading) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Energy reading not found for building",
        });
      }

      if (Number.isNaN(input.periodStart.getTime()) || Number.isNaN(input.periodEnd.getTime())) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Reading dates are invalid.",
        });
      }

      if (input.periodEnd <= input.periodStart) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End date must be after start date.",
        });
      }

      const override = await prisma.energyReading.create({
        data: {
          buildingId: sourceReading.buildingId,
          organizationId: ctx.organizationId,
          source: "MANUAL",
          meterType: sourceReading.meterType,
          meterId: sourceReading.meterId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          consumption: input.consumption,
          unit: sourceReading.unit,
          consumptionKbtu:
            sourceReading.consumption > 0
              ? sourceReading.consumptionKbtu * (input.consumption / sourceReading.consumption)
              : sourceReading.consumptionKbtu,
          cost: input.cost === undefined ? sourceReading.cost : input.cost,
          isVerified: true,
          rawPayload: {
            overrideOfReadingId: sourceReading.id,
            overrideSource: sourceReading.source,
            originalPeriodStart: sourceReading.periodStart.toISOString(),
            originalPeriodEnd: sourceReading.periodEnd.toISOString(),
            originalConsumption: sourceReading.consumption,
          },
        },
      });

      await refreshBuildingIssuesAfterDataChange({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      });

      return override;
    }),

  getUtilityBillUploadReview: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
        uploadId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return getUtilityBillUploadReview({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        uploadId: input.uploadId,
      });
    }),

  listUtilityBillUploads: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return listUtilityBillUploadsForBuilding({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
      });
    }),

  confirmUtilityBillUpload: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
        uploadId: z.string(),
        candidates: z
          .array(
            z.object({
              candidateId: z.string(),
              utilityType: utilityBillUtilityTypeSchema,
              unit: utilityBillUnitSchema,
              periodStart: z.coerce.date(),
              periodEnd: z.coerce.date(),
              consumption: z.number().positive(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return confirmUtilityBillCandidates({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        uploadId: input.uploadId,
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
        candidates: input.candidates,
      });
    }),

  retryUtilityBillUpload: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
        uploadId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return retryUtilityBillUpload({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        uploadId: input.uploadId,
        requestId: ctx.requestId ?? null,
      });
    }),

  energyReadings: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
        months: z.number().int().min(1).max(60).default(24),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setMonth(since.getMonth() - input.months);

      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      const readings = await prisma.energyReading.findMany({
        where: {
          buildingId: input.buildingId,
          organizationId: ctx.organizationId,
          archivedAt: null,
          meterType: {
            in: ["ELECTRIC", "GAS", "STEAM"],
          },
          periodStart: { gte: since },
        },
        orderBy: [{ periodStart: "asc" }, { ingestedAt: "desc" }, { id: "desc" }],
        include: {
          meter: {
            select: {
              name: true,
            },
          },
        },
      });

      return collapseDisplayEnergyReadings(dedupeEnergyReadings(readings)).map((reading) => ({
        ...reading,
        meterName: reading.meter?.name ?? null,
        originalSource:
          reading.rawPayload &&
          typeof reading.rawPayload === "object" &&
          !Array.isArray(reading.rawPayload) &&
          typeof (reading.rawPayload as Record<string, unknown>).overrideSource === "string"
            ? ((reading.rawPayload as Record<string, unknown>).overrideSource as string)
            : null,
      }));
    }),

  utilityReadings: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);

      const meters = await prisma.meter.findMany({
        where: {
          buildingId: input.buildingId,
          organizationId: ctx.organizationId,
          isActive: true,
          meterType: {
            in: ["WATER_INDOOR", "WATER_OUTDOOR", "WATER_RECYCLED", "OTHER"],
          },
        },
        include: {
          energyReadings: {
            where: {
              archivedAt: null,
            },
            orderBy: [{ periodEnd: "desc" }, { ingestedAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              meterId: true,
              meterType: true,
              periodStart: true,
              periodEnd: true,
              consumption: true,
              unit: true,
              cost: true,
              source: true,
              ingestedAt: true,
              rawPayload: true,
              archivedAt: true,
            },
          },
          _count: {
            select: {
              energyReadings: true,
            },
          },
        },
        orderBy: [{ meterType: "asc" }, { name: "asc" }],
      });

      return meters.map((meter) => {
        const readings = collapseDisplayEnergyReadings(dedupeEnergyReadings(meter.energyReadings))
          .slice()
          .sort((left, right) => {
            const byEnd = right.periodEnd.getTime() - left.periodEnd.getTime();
            if (byEnd !== 0) {
              return byEnd;
            }

            return right.ingestedAt.getTime() - left.ingestedAt.getTime();
          });

        return {
        id: meter.id,
        name: meter.name,
        meterType: meter.meterType,
        unit: meter.unit,
        espmMeterId: meter.espmMeterId?.toString() ?? null,
        readingCount: readings.length,
        latestReading: readings[0] ?? null,
        readings: readings.map((reading) => ({
          ...reading,
          originalSource:
            reading.rawPayload &&
            typeof reading.rawPayload === "object" &&
            !Array.isArray(reading.rawPayload) &&
            typeof (reading.rawPayload as Record<string, unknown>).overrideSource === "string"
              ? ((reading.rawPayload as Record<string, unknown>).overrideSource as string)
              : null,
        })),
      };
      });
    }),

  complianceHistory: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureOrganizationBuilding(ctx.organizationId, input.buildingId);
      return prisma.complianceSnapshot.findMany({
        where: {
          buildingId: input.buildingId,
          organizationId: ctx.organizationId,
        },
        orderBy: { snapshotDate: "desc" },
        take: input.limit,
      });
    }),

  portfolioStats: tenantProcedure.query(async ({ ctx }) => {
    const buildings = await prisma.building.findMany({
      where: {
        organizationId: ctx.organizationId,
      },
      include: {
        complianceSnapshots: {
          orderBy: LATEST_SNAPSHOT_ORDER,
          take: 1,
        },
      },
    });
    const governedSummaries = await listBuildingGovernedOperationalSummaries({
      organizationId: ctx.organizationId,
      buildingIds: buildings.map((building) => building.id),
    });

    const stats = {
      totalBuildings: buildings.length,
      nonCompliant: 0,
      atRisk: 0,
      compliant: 0,
      exempt: 0,
      pendingData: 0,
      averageScore: 0,
    };

    let scoreSum = 0;
    let scoreCount = 0;

    for (const building of buildings) {
      const snapshot = building.complianceSnapshots[0] ?? null;
      const governedSummary = governedSummaries.get(building.id);

      switch (governedSummary?.complianceSummary.primaryStatus) {
        case "NON_COMPLIANT":
          stats.nonCompliant++;
          break;
        case "READY":
          // Compatibility shim: older dashboard consumers still read `atRisk`.
          stats.atRisk++;
          break;
        case "COMPLIANT":
          stats.compliant++;
          break;
        case "DATA_INCOMPLETE":
        default:
          stats.pendingData++;
          break;
      }
      if (snapshot?.energyStarScore != null) {
        scoreSum += snapshot.energyStarScore;
        scoreCount++;
      }
    }

    stats.averageScore =
      scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;

    return stats;
  }),

});

