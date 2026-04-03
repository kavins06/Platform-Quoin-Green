import { z } from "zod";
import { router, operatorProcedure, tenantProcedure } from "../init";
import {
  configurePortfolioManagerProviderConnectionForOrganization,
  getPortfolioManagerProviderConnectionStateForOrganization,
  getPortfolioManagerRemotePropertyDetailForOrganization,
  refreshPortfolioManagerProviderConnectionForOrganization,
  restoreSuppressedPortfolioManagerRemotePropertyForOrganization,
} from "@/server/portfolio-manager/provider-share";
import {
  enqueuePortfolioManagerSetupApply,
  getPortfolioManagerSetupForBuilding,
  savePortfolioManagerSetupInputs,
} from "@/server/portfolio-manager/setup";
import {
  enqueuePortfolioManagerMeterAssociationsApply,
  enqueuePortfolioManagerMeterSetupApply,
  getPortfolioManagerMeterSetupForBuilding,
  savePortfolioManagerMeterSetup,
} from "@/server/portfolio-manager/meter-setup";
import {
  enqueuePortfolioManagerUsageImport,
  requestPortfolioManagerUsagePush,
  getPortfolioManagerUsageStatusForBuilding,
} from "@/server/portfolio-manager/usage";
import { runPortfolioManagerFullPullForBuilding } from "@/server/portfolio-manager/full-pull";
import { BUILDING_PROPERTY_USE_KEYS } from "@/lib/buildings/property-use-registry";
import {
  hasCapability,
  requireCapability,
} from "@/server/lib/capabilities";
import { requestPmUsagePushApproval } from "@/server/lib/approval-requests";
import type { AppRole } from "@/server/lib/organization-membership";

const propertyUseInputSchema = z.object({
  id: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0),
  useKey: z.enum(BUILDING_PROPERTY_USE_KEYS),
  displayName: z.string().min(1).max(200),
  grossSquareFeet: z.number().int().positive(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

const meterStrategyInputSchema = z.object({
  meterId: z.string().min(1),
  strategy: z.enum(["LINK_EXISTING_REMOTE", "CREATE_REMOTE"]),
  selectedRemoteMeterId: z.string().min(1).nullable().optional(),
});

export const portfolioManagerRouter = router({
  getProviderConnectionStatus: operatorProcedure.query(async ({ ctx }) =>
    getPortfolioManagerProviderConnectionStateForOrganization({
      organizationId: ctx.organizationId,
    }),
  ),

  configureProviderConnection: operatorProcedure
    .input(
      z.object({
        targetUsername: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      configurePortfolioManagerProviderConnectionForOrganization({
        organizationId: ctx.organizationId,
        targetUsername: input.targetUsername,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      }),
    ),

  refreshProviderConnection: operatorProcedure.mutation(async ({ ctx }) =>
    refreshPortfolioManagerProviderConnectionForOrganization({
      organizationId: ctx.organizationId,
      actorType: "USER",
      actorId: ctx.authUserId ?? null,
      requestId: ctx.requestId ?? null,
    }),
  ),

  getRemotePropertyDetail: tenantProcedure
    .input(
      z.object({
        propertyId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) =>
      getPortfolioManagerRemotePropertyDetailForOrganization({
        organizationId: ctx.organizationId,
        propertyId: input.propertyId,
      }),
    ),

  restoreRemoteProperty: operatorProcedure
    .input(
      z.object({
        propertyId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      restoreSuppressedPortfolioManagerRemotePropertyForOrganization({
        organizationId: ctx.organizationId,
        propertyId: input.propertyId,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      }),
    ),

  getBuildingSetup: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) =>
      getPortfolioManagerSetupForBuilding({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
      }),
    ),

  saveBuildingSetupInputs: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
        propertyUses: z.array(propertyUseInputSchema).max(12),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      savePortfolioManagerSetupInputs({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        propertyUses: input.propertyUses,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      }),
    ),

  applyBuildingSetup: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      enqueuePortfolioManagerSetupApply({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      }),
    ),

  getBuildingMeterSetup: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) =>
      getPortfolioManagerMeterSetupForBuilding({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
      }),
    ),

  saveBuildingMeterSetup: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
        localMeterStrategies: z.array(meterStrategyInputSchema).max(50),
        importRemoteMeterIds: z.array(z.string().min(1)).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      savePortfolioManagerMeterSetup({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        localMeterStrategies: input.localMeterStrategies,
        importRemoteMeterIds: input.importRemoteMeterIds,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      }),
    ),

  applyBuildingMeterSetup: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      enqueuePortfolioManagerMeterSetupApply({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      }),
    ),

  applyBuildingMeterAssociations: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      enqueuePortfolioManagerMeterAssociationsApply({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      }),
    ),

  getBuildingUsageStatus: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) =>
      getPortfolioManagerUsageStatusForBuilding({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
      }),
    ),

  pushBuildingUsage: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
        reportingYear: z.number().int().min(2000).max(2100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const appRole = ctx.appRole as AppRole;
      requireCapability({
        role: appRole,
        capability: "PM_PUSH_REQUEST",
      });

      if (!hasCapability(appRole, "PM_PUSH_EXECUTE")) {
        return requestPmUsagePushApproval({
          organizationId: ctx.organizationId,
          buildingId: input.buildingId,
          reportingYear: input.reportingYear,
          requestedByType: "USER",
          requestedById: ctx.authUserId ?? null,
          requestId: ctx.requestId ?? null,
        });
      }

      const result = await requestPortfolioManagerUsagePush({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        reportingYear: input.reportingYear,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      });

      return {
        outcome: "EXECUTED" as const,
        approvalRequestId: null,
        message:
          result.mode === "inline"
            ? result.warning ?? "Push completed in Portfolio Manager."
            : "Push queued successfully.",
      };
    }),

  importBuildingUsage: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
        reportingYear: z.number().int().min(2000).max(2100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      enqueuePortfolioManagerUsageImport({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        reportingYear: input.reportingYear,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      }),
    ),

  refreshBuildingPull: operatorProcedure
    .input(
      z.object({
        buildingId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      runPortfolioManagerFullPullForBuilding({
        organizationId: ctx.organizationId,
        buildingId: input.buildingId,
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        requestId: ctx.requestId ?? null,
      }),
    ),
});

