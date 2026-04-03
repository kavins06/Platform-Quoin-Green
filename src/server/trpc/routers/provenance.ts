import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, tenantProcedure } from "../init";
import { LATEST_SNAPSHOT_ORDER } from "@/server/lib/compliance-snapshots";

async function ensureTenantBuilding(
  tenantDb: {
    building: {
      findUnique: (args: { where: { id: string } }) => Promise<{ id: string } | null>;
    };
  },
  buildingId: string,
) {
  const building = await tenantDb.building.findUnique({
    where: { id: buildingId },
  });

  if (!building) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Building not found",
    });
  }
}

export const provenanceRouter = router({
  rulePackages: protectedProcedure
    .input(
      z
        .object({
          activeOnly: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const activeOnly = input?.activeOnly ?? false;

      return ctx.prisma.rulePackage.findMany({
        orderBy: { key: "asc" },
        include: {
          versions: {
            where: activeOnly ? { status: "ACTIVE" } : undefined,
            orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
            include: {
              sourceArtifact: {
                select: {
                  id: true,
                  name: true,
                  artifactType: true,
                  externalUrl: true,
                },
              },
            },
          },
        },
      });
    }),

  factorSetVersions: protectedProcedure
    .input(
      z
        .object({
          activeOnly: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const activeOnly = input?.activeOnly ?? false;

      return ctx.prisma.factorSetVersion.findMany({
        where: activeOnly ? { status: "ACTIVE" } : undefined,
        orderBy: [{ key: "asc" }, { effectiveFrom: "desc" }],
        include: {
          sourceArtifact: {
            select: {
              id: true,
              name: true,
              artifactType: true,
              externalUrl: true,
            },
          },
        },
      });
    }),

  complianceRuns: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureTenantBuilding(ctx.tenantDb, input.buildingId);

      return ctx.tenantDb.complianceRun.findMany({
        where: { buildingId: input.buildingId },
        orderBy: { executedAt: "desc" },
        take: input.limit,
        include: {
          ruleVersion: {
            include: {
              rulePackage: true,
            },
          },
          factorSetVersion: true,
          calculationManifest: true,
          evidenceArtifacts: {
            orderBy: { createdAt: "desc" },
          },
          complianceSnapshots: {
            orderBy: LATEST_SNAPSHOT_ORDER,
            take: 1,
          },
        },
      });
    }),

  benchmarkSubmissions: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureTenantBuilding(ctx.tenantDb, input.buildingId);

      return ctx.tenantDb.benchmarkSubmission.findMany({
        where: { buildingId: input.buildingId },
        orderBy: [{ reportingYear: "desc" }, { createdAt: "desc" }],
        take: input.limit,
        include: {
          ruleVersion: {
            include: {
              rulePackage: true,
            },
          },
          factorSetVersion: true,
          complianceRun: {
            include: {
              calculationManifest: true,
            },
          },
          evidenceArtifacts: {
            orderBy: { createdAt: "desc" },
          },
        },
      });
    }),

  filingRecords: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureTenantBuilding(ctx.tenantDb, input.buildingId);

      return ctx.tenantDb.filingRecord.findMany({
        where: { buildingId: input.buildingId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          benchmarkSubmission: true,
          complianceRun: {
            include: {
              calculationManifest: true,
            },
          },
          evidenceArtifacts: {
            orderBy: { createdAt: "desc" },
          },
        },
      });
    }),
});
