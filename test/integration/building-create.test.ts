import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/routers";
import { prisma } from "@/server/lib/db";

describe("building create", () => {
  const scope = `${Date.now()}`;

  let org: { id: string };
  let user: { id: string; authUserId: string };
  const createdBuildingIds: string[] = [];

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: {
        name: `Create Org ${scope}`,
        slug: `create-org-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    user = await prisma.user.create({
      data: {
        authUserId: `supabase_create_user_${scope}`,
        email: `create_${scope}@test.com`,
        name: "Create User",
      },
      select: { id: true, authUserId: true },
    });

    await prisma.organizationMembership.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: "ADMIN",
      },
    });
  });

  afterAll(async () => {
    if (createdBuildingIds.length > 0) {
      await prisma.building.deleteMany({
        where: {
          id: {
            in: createdBuildingIds,
          },
        },
      });
    }

    await prisma.organizationMembership.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  function createCaller() {
    return appRouter.createCaller({
      authUserId: user.authUserId,
      activeOrganizationId: org.id,
      prisma,
    });
  }

  it("creates a building when coordinates are omitted and derives the default DC location", async () => {
    const caller = createCaller();

    const building = await caller.building.create({
      name: `Create Building ${scope}`,
      address: "1200 Test Avenue NW, Washington, DC 20005",
      grossSquareFeet: 120000,
      yearBuilt: 1998,
      propertyUses: [
        {
          sortOrder: 0,
          useKey: "OFFICE",
          displayName: `Create Building ${scope} Office`,
          grossSquareFeet: 120000,
          details: {
            weeklyOperatingHours: 55,
            workersOnMainShift: 85,
            numberOfComputers: 70,
            percentThatCanBeCooled: "50% or more",
          },
        },
      ],
    });

    createdBuildingIds.push(building.id);

    expect(building.latitude).toBe(38.9072);
    expect(building.longitude).toBe(-77.0369);
    expect(building.organizationId).toBe(org.id);
    expect(building.espmPropertyId).toBeNull();
    expect(building.propertyUses).toHaveLength(1);
    expect(building.propertyType).toBe("OFFICE");
    expect(building.benchmarkProfile.isComplete).toBe(true);
  });

  it("allows saving an incomplete building shell before detailed uses are complete", async () => {
    const caller = createCaller();

    const building = await caller.building.create({
      name: `Incomplete Building ${scope}`,
      address: "1300 Test Avenue NW, Washington, DC 20005",
      grossSquareFeet: 90000,
      yearBuilt: 2005,
    });

    createdBuildingIds.push(building.id);

    expect(building.propertyUses).toHaveLength(0);
    expect(building.benchmarkProfile.isComplete).toBe(false);
    expect(building.benchmarkProfile.missingInputMessages).toContain(
      "At least one detailed property use is still required.",
    );
  });

  it("rejects a provider-managed create before saving when the address is not a full mailing address", async () => {
    const providerOrg = await prisma.organization.create({
      data: {
        name: `Provider Create Org ${scope}`,
        slug: `provider-create-org-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    await prisma.organizationMembership.create({
      data: {
        organizationId: providerOrg.id,
        userId: user.id,
        role: "ADMIN",
      },
    });

    await prisma.portfolioManagerManagement.create({
      data: {
        organizationId: providerOrg.id,
        managementMode: "PROVIDER_SHARED",
        status: "READY",
        connectedAccountId: BigInt(382504),
        connectedUsername: "Kavin06",
        targetUsername: "Kavin06",
      },
    });

    const providerCaller = appRouter.createCaller({
      authUserId: user.authUserId,
      activeOrganizationId: providerOrg.id,
      prisma,
    });

    try {
      await expect(
        providerCaller.building.create({
          name: `Provider Address Building ${scope}`,
          address: "111 Massachusetts Ave NW",
          grossSquareFeet: 55000,
          yearBuilt: 2020,
          occupancyRate: 100,
          irrigatedAreaSquareFeet: 0,
          numberOfBuildings: 1,
          propertyUses: [
            {
              sortOrder: 0,
              useKey: "OFFICE",
              displayName: `Provider Address Building ${scope} Office`,
              grossSquareFeet: 55000,
              details: {
                weeklyOperatingHours: 55,
                workersOnMainShift: 120,
                numberOfComputers: 100,
                percentThatCanBeCooled: "50% or more",
              },
            },
          ],
        }),
      ).rejects.toMatchObject({
        message:
          "Enter the full mailing address like 'Street, City, ST ZIP'.",
      });

      expect(
        await prisma.building.count({
          where: {
            organizationId: providerOrg.id,
            name: `Provider Address Building ${scope}`,
          },
        }),
      ).toBe(0);
    } finally {
      await prisma.building.deleteMany({
        where: { organizationId: providerOrg.id },
      });
      await prisma.portfolioManagerManagement.deleteMany({
        where: { organizationId: providerOrg.id },
      });
      await prisma.organizationMembership.deleteMany({
        where: { organizationId: providerOrg.id },
      });
      await prisma.organization.deleteMany({
        where: { id: providerOrg.id },
      });
    }
  });
});


