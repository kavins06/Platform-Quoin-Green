import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/lib/db";
import {
  deleteOrganizationMembership,
  ensureUserRecord,
  upsertOrganizationMembership,
} from "@/server/lib/organization-membership";
import { requireTenantContext } from "@/server/lib/tenant-access";

describe("organization memberships", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let buildingA: { id: string };
  let buildingB: { id: string };

  beforeAll(async () => {
    const ts = Date.now();

    orgA = await prisma.organization.create({
      data: {
        name: "Membership Org A",
        slug: `membership-org-a-${ts}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    orgB = await prisma.organization.create({
      data: {
        name: "Membership Org B",
        slug: `membership-org-b-${ts}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    buildingA = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: "Membership Building A",
        address: "300 Test St NW, Washington, DC 20001",
        latitude: 38.92,
        longitude: -77.02,
        grossSquareFeet: 90000,
        propertyType: "OFFICE",
        bepsTargetScore: 71,
        maxPenaltyExposure: 900000,
      },
      select: { id: true },
    });

    buildingB = await prisma.building.create({
      data: {
        organizationId: orgB.id,
        name: "Membership Building B",
        address: "400 Test St NW, Washington, DC 20001",
        latitude: 38.93,
        longitude: -77.03,
        grossSquareFeet: 85000,
        propertyType: "MULTIFAMILY",
        bepsTargetScore: 66,
        maxPenaltyExposure: 850000,
      },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await prisma.user.deleteMany({
      where: {
        authUserId: {
          startsWith: "supabase_membership_user_",
        },
      },
    });
    await prisma.building.deleteMany({
      where: { id: { in: [buildingA.id, buildingB.id] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA.id, orgB.id] } },
    });
  });

  it("keeps one user in multiple organizations", async () => {
    const ts = Date.now();
    const user = await ensureUserRecord({
      authUserId: `supabase_membership_user_${ts}`,
      email: `membership_${ts}@test.com`,
      name: "Membership User",
    });

    await upsertOrganizationMembership({
      organizationId: orgA.id,
      authUserId: user.authUserId,
      role: "ADMIN",
      email: user.email,
      name: user.name,
    });
    await upsertOrganizationMembership({
      organizationId: orgB.id,
      authUserId: user.authUserId,
      role: "VIEWER",
      email: user.email,
      name: user.name,
    });

    const memberships = await prisma.organizationMembership.findMany({
      where: { userId: user.id },
      orderBy: { organizationId: "asc" },
    });

    expect(memberships).toHaveLength(2);
    expect(memberships.map((membership) => membership.organizationId).sort()).toEqual(
      [orgA.id, orgB.id].sort(),
    );
  });

  it("removes one membership without destroying the user", async () => {
    const ts = Date.now();
    const authUserId = `supabase_membership_user_${ts}`;
    const user = await ensureUserRecord({
      authUserId,
      email: `membership_remove_${ts}@test.com`,
      name: "Remove Membership User",
    });

    await upsertOrganizationMembership({
      organizationId: orgA.id,
      authUserId,
      role: "MANAGER",
    });
    await upsertOrganizationMembership({
      organizationId: orgB.id,
      authUserId,
      role: "ENGINEER",
    });

    const deleted = await deleteOrganizationMembership({
      organizationId: orgA.id,
      userId: user.id,
    });

    expect(deleted).toBe(1);

    const remainingMemberships = await prisma.organizationMembership.findMany({
      where: { userId: user.id },
    });
    expect(remainingMemberships).toHaveLength(1);
    expect(remainingMemberships[0]?.organizationId).toBe(orgB.id);

    const survivingUser = await prisma.user.findUnique({
      where: { id: user.id },
    });
    expect(survivingUser?.authUserId).toBe(authUserId);
  });

  it("derives tenant-scoped access from the authenticated org context", async () => {
    const ts = Date.now();
    const authUserId = `supabase_membership_user_${ts}`;
    await ensureUserRecord({
      authUserId,
      email: `tenant_scope_${ts}@test.com`,
      name: "Tenant Scope User",
    });
    await upsertOrganizationMembership({
      organizationId: orgA.id,
      authUserId,
      role: "ADMIN",
    });
    await upsertOrganizationMembership({
      organizationId: orgB.id,
      authUserId,
      role: "VIEWER",
    });

    const tenantA = await requireTenantContext({
      authUserId,
      activeOrganizationId: orgA.id,
    });
    const tenantB = await requireTenantContext({
      authUserId,
      activeOrganizationId: orgB.id,
    });

    const buildingsForA = await tenantA.tenantDb.building.findMany({
      orderBy: { name: "asc" },
    });
    const buildingsForB = await tenantB.tenantDb.building.findMany({
      orderBy: { name: "asc" },
    });

    expect(buildingsForA.map((building) => building.id)).toEqual([buildingA.id]);
    expect(buildingsForB.map((building) => building.id)).toEqual([buildingB.id]);

    const memberships = await prisma.organizationMembership.findMany({
      where: {
        user: {
          authUserId,
        },
      },
      orderBy: { organizationId: "asc" },
    });
    expect(memberships).toHaveLength(2);
  });
});


