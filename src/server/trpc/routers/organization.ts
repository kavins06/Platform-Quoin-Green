import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "@/server/lib/db";
import { deleteOrganizationLifecycle } from "@/server/lifecycle/organization-teardown";
import {
  createOrganizationForUser,
  deleteOrganizationMembership,
  ensureUserRecord,
  listOrganizationMembershipsForUser,
  slugify,
} from "@/server/lib/organization-membership";
import { protectedProcedure, router, tenantProcedure } from "../init";
import { createAuditLog } from "@/server/lib/audit-log";
import {
  listCapabilitiesForRole,
  requireCapability,
} from "@/server/lib/capabilities";
import {
  listApprovalRequestsForOrganization,
  reviewApprovalRequest,
} from "@/server/lib/approval-requests";
import { getPlatformRuntimeHealth } from "@/server/lib/runtime-health";

function resolveAuthInput(ctx: {
  authUserId?: string | null;
  email?: string | null;
  name?: string | null;
}) {
  const authUserId = ctx.authUserId;

  if (!authUserId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  return {
    authUserId,
    email: ctx.email,
    name: ctx.name,
  };
}

async function buildActorDirectory(actorIds: string[]) {
  if (actorIds.length === 0) {
    return new Map<string, { name: string | null; email: string }>();
  }

  const users = await prisma.user.findMany({
    where: {
      authUserId: {
        in: actorIds,
      },
    },
    select: {
      authUserId: true,
      name: true,
      email: true,
    },
  });

  return new Map(
    users.map((user) => [
      user.authUserId,
      {
        name: user.name,
        email: user.email,
      },
    ]),
  );
}

export const organizationRouter = router({
  session: protectedProcedure.query(async ({ ctx }) => {
    const auth = resolveAuthInput(ctx);
    const user = await ensureUserRecord(auth);
    const membershipData = await listOrganizationMembershipsForUser({
      authUserId: auth.authUserId,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      activeOrganizationId: ctx.activeOrganizationId ?? null,
      memberships: membershipData.memberships.map((membership) => ({
        id: membership.id,
        role: membership.role,
        capabilities: listCapabilitiesForRole(membership.role),
        organization: {
          id: membership.organization.id,
          name: membership.organization.name,
          slug: membership.organization.slug,
        },
      })),
    };
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const auth = resolveAuthInput(ctx);
      const organization = await createOrganizationForUser({
        authUserId: auth.authUserId,
        email: auth.email,
        name: auth.name,
        organizationName: input.name,
        organizationSlug: slugify(input.name),
      });

      await createAuditLog({
        actorType: "USER",
        actorId: auth.authUserId,
        organizationId: organization.id,
        action: "ORGANIZATION_CREATED",
        inputSnapshot: {
          name: organization.name,
          slug: organization.slug,
        },
        requestId: ctx.requestId ?? null,
      });

      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      };
    }),

  leave: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const auth = resolveAuthInput(ctx);
      const user = await ensureUserRecord(auth);
      const membership = await prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: user.id,
          },
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization membership not found.",
        });
      }

      const membershipCount = await prisma.organizationMembership.count({
        where: {
          organizationId: input.organizationId,
        },
      });

      if (membershipCount <= 1) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot leave your only organization.",
        });
      }

      await deleteOrganizationMembership({
        organizationId: input.organizationId,
        userId: user.id,
      });

      await createAuditLog({
        actorType: "USER",
        actorId: auth.authUserId,
        organizationId: input.organizationId,
        action: "ORGANIZATION_LEFT",
        requestId: ctx.requestId ?? null,
      });

      return { success: true };
    }),

  active: tenantProcedure.query(async ({ ctx }) => {
    const organization = await prisma.organization.findUnique({
      where: { id: ctx.organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        memberships: {
          orderBy: [
            { role: "asc" },
            { user: { name: "asc" } },
            { user: { email: "asc" } },
          ],
          select: {
            id: true,
            role: true,
            userId: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!organization) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Active organization not found.",
      });
    }

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      currentUserId: ctx.userId,
      currentRole: ctx.appRole,
      capabilities: ctx.capabilities,
      canManageMembers: ctx.capabilities.includes("ORG_MEMBERS_MANAGE"),
      members: organization.memberships.map((membership) => ({
        id: membership.id,
        role: membership.role,
        userId: membership.userId,
        user: membership.user,
        isCurrentUser: membership.userId === ctx.userId,
      })),
    };
  }),

  governanceOverview: tenantProcedure.query(async ({ ctx }) => {
    requireCapability({
      role: ctx.appRole,
      capability: "GOVERNANCE_VIEW",
    });

    const [
      organization,
      auditLogs,
      approvalRequests,
      runtimeHealth,
      pmManagement,
      linkedPmBuildingCount,
      greenButtonConnections,
      utilityBillUploads,
    ] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: ctx.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      }),
      prisma.auditLog.findMany({
        where: {
          organizationId: ctx.organizationId,
        },
        orderBy: [{ timestamp: "desc" }],
        take: 25,
        select: {
          id: true,
          actorType: true,
          actorId: true,
          buildingId: true,
          action: true,
          errorCode: true,
          requestId: true,
          timestamp: true,
        },
      }),
      listApprovalRequestsForOrganization({
        organizationId: ctx.organizationId,
        limit: 20,
      }),
      getPlatformRuntimeHealth(),
      prisma.portfolioManagerManagement.findUnique({
        where: { organizationId: ctx.organizationId },
        select: {
          managementMode: true,
          status: true,
          targetUsername: true,
          connectedUsername: true,
          connectedAccountId: true,
          lastConnectionCheckedAt: true,
          lastShareAcceptedAt: true,
          propertyCacheRefreshedAt: true,
          latestErrorCode: true,
          latestErrorMessage: true,
        },
      }),
      prisma.building.count({
        where: {
          organizationId: ctx.organizationId,
          espmPropertyId: {
            not: null,
          },
        },
      }),
      prisma.greenButtonConnection.groupBy({
        by: ["status"],
        where: {
          organizationId: ctx.organizationId,
        },
        _count: {
          _all: true,
        },
      }),
      prisma.utilityBillUpload.groupBy({
        by: ["status"],
        where: {
          organizationId: ctx.organizationId,
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    if (!organization) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Active organization not found.",
      });
    }

    const actorIds = Array.from(
      new Set(
        [
          ...auditLogs.map((entry) => entry.actorId),
          ...approvalRequests.flatMap((request) => [
            request.requestedById,
            request.reviewedById,
          ]),
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    const actorDirectory = await buildActorDirectory(actorIds);

    const greenButtonStatusSummary = greenButtonConnections.reduce<Record<string, number>>(
      (summary, row) => {
        summary[row.status] = row._count._all;
        return summary;
      },
      {},
    );
    const utilityBillStatusSummary = utilityBillUploads.reduce<Record<string, number>>(
      (summary, row) => {
        summary[row.status] = row._count._all;
        return summary;
      },
      {},
    );

    return {
      organization,
      currentRole: ctx.appRole,
      capabilities: ctx.capabilities,
      runtimeHealth,
      integrations: {
        portfolioManager: {
          managementMode: pmManagement?.managementMode ?? null,
          status: pmManagement?.status ?? "NOT_STARTED",
          targetUsername: pmManagement?.targetUsername ?? null,
          connectedUsername: pmManagement?.connectedUsername ?? null,
          connectedAccountId: pmManagement?.connectedAccountId?.toString() ?? null,
          linkedBuildingCount: linkedPmBuildingCount,
          lastConnectionCheckedAt: pmManagement?.lastConnectionCheckedAt?.toISOString() ?? null,
          lastShareAcceptedAt: pmManagement?.lastShareAcceptedAt?.toISOString() ?? null,
          propertyCacheRefreshedAt: pmManagement?.propertyCacheRefreshedAt?.toISOString() ?? null,
          latestErrorCode: pmManagement?.latestErrorCode ?? null,
          latestErrorMessage: pmManagement?.latestErrorMessage ?? null,
        },
        greenButton: greenButtonStatusSummary,
        utilityBills: utilityBillStatusSummary,
      },
      approvals: approvalRequests.map((request) => ({
        id: request.id,
        requestType: request.requestType,
        status: request.status,
        title: request.title,
        summary: request.summary,
        buildingId: request.buildingId,
        requestId: request.requestId,
        requestedAt: request.requestedAt.toISOString(),
        requestedByType: request.requestedByType,
        requestedById: request.requestedById,
        requestedByDisplay:
          request.requestedById != null ? actorDirectory.get(request.requestedById) ?? null : null,
        reviewedAt: request.reviewedAt?.toISOString() ?? null,
        reviewedByType: request.reviewedByType,
        reviewedById: request.reviewedById,
        reviewedByDisplay:
          request.reviewedById != null ? actorDirectory.get(request.reviewedById) ?? null : null,
        reviewNotes: request.reviewNotes,
        executionErrorCode: request.executionErrorCode,
        executionErrorMessage: request.executionErrorMessage,
        executedAt: request.executedAt?.toISOString() ?? null,
      })),
      auditLogs: auditLogs.map((entry) => ({
        id: entry.id,
        actorType: entry.actorType,
        actorId: entry.actorId,
        actorDisplay:
          entry.actorId != null ? actorDirectory.get(entry.actorId) ?? null : null,
        buildingId: entry.buildingId,
        action: entry.action,
        errorCode: entry.errorCode,
        requestId: entry.requestId,
        timestamp: entry.timestamp.toISOString(),
      })),
    };
  }),

  addMember: tenantProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(["ADMIN", "MANAGER", "ENGINEER", "VIEWER"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability({
        role: ctx.appRole,
        capability: "ORG_MEMBERS_MANAGE",
      });

      const normalizedEmail = input.email.trim().toLowerCase();
      const user = await prisma.user.findFirst({
        where: {
          email: {
            equals: normalizedEmail,
            mode: "insensitive",
          },
        },
        select: { id: true, authUserId: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That user has not signed in to Quoin yet. Ask them to sign in once, then add them here.",
        });
      }

      const existingMembership = await prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: ctx.organizationId,
            userId: user.id,
          },
        },
        select: { id: true },
      });

      if (existingMembership) {
        await prisma.organizationMembership.update({
          where: { id: existingMembership.id },
          data: { role: input.role },
        });
      } else {
        await prisma.organizationMembership.create({
          data: {
            organizationId: ctx.organizationId,
            userId: user.id,
            role: input.role,
          },
        });
      }

      await createAuditLog({
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        organizationId: ctx.organizationId,
        action: "ORGANIZATION_MEMBER_UPSERTED",
        inputSnapshot: {
          invitedEmail: normalizedEmail,
          targetAuthUserId: user.authUserId,
          role: input.role,
        },
        requestId: ctx.requestId ?? null,
      });

      return { success: true };
    }),

  removeMember: tenantProcedure
    .input(
      z.object({
        membershipId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability({
        role: ctx.appRole,
        capability: "ORG_MEMBERS_MANAGE",
      });

      const membership = await prisma.organizationMembership.findUnique({
        where: { id: input.membershipId },
        select: {
          id: true,
          organizationId: true,
          userId: true,
          user: {
            select: {
              authUserId: true,
              email: true,
            },
          },
        },
      });

      if (!membership || membership.organizationId !== ctx.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization membership not found.",
        });
      }

      if (membership.userId === ctx.userId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Use Leave organization from another organization context. You cannot remove yourself here.",
        });
      }

      const membershipCount = await prisma.organizationMembership.count({
        where: { organizationId: ctx.organizationId },
      });

      if (membershipCount <= 1) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot remove the last organization member.",
        });
      }

      await prisma.organizationMembership.delete({
        where: { id: membership.id },
      });

      await createAuditLog({
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        organizationId: ctx.organizationId,
        action: "ORGANIZATION_MEMBER_REMOVED",
        inputSnapshot: {
          removedAuthUserId: membership.user.authUserId,
          removedEmail: membership.user.email,
        },
        requestId: ctx.requestId ?? null,
      });

      return { success: true };
    }),

  reviewApprovalRequest: tenantProcedure
    .input(
      z.object({
        approvalRequestId: z.string().min(1),
        decision: z.enum(["APPROVE", "REJECT"]),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability({
        role: ctx.appRole,
        capability: "APPROVAL_REVIEW",
      });

      return reviewApprovalRequest({
        organizationId: ctx.organizationId,
        approvalRequestId: input.approvalRequestId,
        decision: input.decision,
        reviewerType: "USER",
        reviewerId: ctx.authUserId ?? null,
        notes: input.notes ?? null,
        requestId: ctx.requestId ?? null,
      });
    }),

  deleteActive: tenantProcedure
    .input(
      z.object({
        confirmationName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability({
        role: ctx.appRole,
        capability: "ORG_DELETE",
      });

      const organization = await prisma.organization.findUnique({
        where: { id: ctx.organizationId },
        select: {
          id: true,
          name: true,
        },
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      if (input.confirmationName.trim() !== organization.name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Type the exact organization name to confirm deletion.",
        });
      }

      await createAuditLog({
        actorType: "USER",
        actorId: ctx.authUserId ?? null,
        organizationId: organization.id,
        action: "ORGANIZATION_DELETE_REQUESTED",
        inputSnapshot: {
          organizationName: organization.name,
        },
        requestId: ctx.requestId ?? null,
      });

      await deleteOrganizationLifecycle({
        organizationId: organization.id,
      });

      return { success: true, deletedOrganizationId: organization.id };
    }),
});
