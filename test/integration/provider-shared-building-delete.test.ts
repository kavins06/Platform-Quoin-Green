import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/routers";
import { prisma } from "@/server/lib/db";

describe("provider-shared building delete", () => {
  const scope = `${Date.now()}`;

  let org: { id: string };
  let user: { id: string; authUserId: string };
  let building: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: {
        name: `Provider Shared Delete Org ${scope}`,
        slug: `provider-shared-local-delete-${scope}`,
      },
      select: { id: true },
    });

    user = await prisma.user.create({
      data: {
        authUserId: `supabase_provider_shared_delete_${scope}`,
        email: `provider-shared-delete-${scope}@test.com`,
        name: "Provider Shared Delete User",
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

    await prisma.portfolioManagerManagement.create({
      data: {
        organizationId: org.id,
        managementMode: "PROVIDER_SHARED",
        status: "READY",
        connectedAccountId: BigInt(12345),
        connectedUsername: "provider-shared-user",
      },
    });

    building = await prisma.building.create({
      data: {
        organizationId: org.id,
        name: `Provider Shared Delete Building ${scope}`,
        address: "500 Provider Test Ave NW, Washington, DC 20001",
        latitude: 38.9,
        longitude: -77.03,
        grossSquareFeet: 25000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        bepsTargetScore: 71,
        espmPropertyId: BigInt(88027424),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    await prisma.portfolioManagerRemoteProperty.create({
      data: {
        organizationId: org.id,
        linkedBuildingId: building.id,
        remoteAccountId: BigInt(12345),
        propertyId: BigInt(88027424),
        shareStatus: "ACCEPTED",
        name: "EPA Sample University",
        address: "4508 Macarthur Blvd, Washington DC",
        primaryFunction: "Office",
        grossSquareFeet: 25000,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.portfolioManagerRemoteProperty.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.portfolioManagerManagement.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.building.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.user.deleteMany({
      where: { id: user?.id },
    });
    await prisma.organization.deleteMany({
      where: { id: org?.id },
    });
  });

  it("suppresses provider-shared local reimport when deleting in Quoin only", async () => {
    const caller = appRouter.createCaller({
      authUserId: user.authUserId,
      activeOrganizationId: org.id,
      prisma,
    });

    const result = await caller.building.delete({
      id: building.id,
      deleteMode: "UNLINK_ONLY",
    });

    expect(result).toEqual({
      success: true,
      deleteMode: "UNLINK_ONLY",
      outcome: "EXECUTED",
      approvalRequestId: null,
      message: "Removed from Quoin. ESPM access stays connected.",
    });

    expect(
      await prisma.building.count({
        where: { id: building.id },
      }),
    ).toBe(0);

    const remoteProperty = await prisma.portfolioManagerRemoteProperty.findUniqueOrThrow({
      where: {
        organizationId_propertyId: {
          organizationId: org.id,
          propertyId: BigInt(88027424),
        },
      },
    });

    expect(remoteProperty.linkedBuildingId).toBeNull();
    expect(remoteProperty.localSuppressedAt).toBeTruthy();
    expect(remoteProperty.localSuppressedByType).toBe("USER");
    expect(remoteProperty.localSuppressedById).toBe(user.authUserId);

    const suppressionAuditLog = await prisma.auditLog.findFirst({
      where: {
        organizationId: org.id,
        action: "BUILDING_PROVIDER_SHARED_SUPPRESSED",
      },
    });

    expect(suppressionAuditLog).not.toBeNull();
  });

  it("offers remote delete instead of unshare when the connected account owns the property", async () => {
    const ownedBuilding = await prisma.building.create({
      data: {
        organizationId: org.id,
        name: `Provider Shared Owned Building ${scope}`,
        address: "501 Provider Test Ave NW, Washington, DC 20001",
        latitude: 38.9,
        longitude: -77.03,
        grossSquareFeet: 25000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        bepsTargetScore: 71,
        espmPropertyId: BigInt(88027426),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    await prisma.portfolioManagerRemoteProperty.create({
      data: {
        organizationId: org.id,
        linkedBuildingId: ownedBuilding.id,
        remoteAccountId: BigInt(12345),
        propertyId: BigInt(88027426),
        shareStatus: "ACCEPTED",
        name: "EPA Sample Laboratory Owned",
        address: "501 Provider Test Ave NW, Washington, DC 20001",
        primaryFunction: "Office",
        grossSquareFeet: 25000,
        rawPayloadJson: {
          property: [
            {
              audit: {
                createdByAccountId: 12345,
                lastUpdatedByAccountId: 12345,
              },
            },
          ],
        },
      },
    });

    const caller = appRouter.createCaller({
      authUserId: user.authUserId,
      activeOrganizationId: org.id,
      prisma,
    });

    const result = await caller.building.get({
      id: ownedBuilding.id,
    });

    expect(result.remoteBuildingAction).toMatchObject({
      available: true,
      kind: "DELETE_PROPERTY",
      label: "Delete from ESPM too",
    });

    await prisma.portfolioManagerRemoteProperty.deleteMany({
      where: {
        organizationId: org.id,
        propertyId: BigInt(88027426),
      },
    });
    await prisma.building.deleteMany({
      where: {
        id: ownedBuilding.id,
      },
    });
  });
});
