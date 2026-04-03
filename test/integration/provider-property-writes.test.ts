import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/lib/db";
import { deleteRemotePropertyForBuilding } from "@/server/portfolio-manager/provider-property-writes";

const {
  resolvePortfolioManagerClientForOrganizationMock,
  deletePropertyMock,
  unsharePropertyMock,
} = vi.hoisted(() => ({
  resolvePortfolioManagerClientForOrganizationMock: vi.fn(),
  deletePropertyMock: vi.fn(),
  unsharePropertyMock: vi.fn(),
}));

vi.mock("@/server/portfolio-manager/existing-account", () => ({
  resolvePortfolioManagerClientForOrganization:
    resolvePortfolioManagerClientForOrganizationMock,
}));

describe("provider property writes remote delete behavior", () => {
  const scope = `${Date.now()}`;
  let providerSharedOrg: { id: string };
  let quoinManagedOrg: { id: string };

  beforeAll(async () => {
    providerSharedOrg = await prisma.organization.create({
      data: {
        name: `Provider Shared Delete ${scope}`,
        slug: `provider-shared-delete-${scope}`,
      },
      select: { id: true },
    });

    quoinManagedOrg = await prisma.organization.create({
      data: {
        name: `Quoin Managed Delete ${scope}`,
        slug: `quoin-managed-delete-${scope}`,
      },
      select: { id: true },
    });

    await prisma.portfolioManagerManagement.createMany({
      data: [
        {
          organizationId: providerSharedOrg.id,
          managementMode: "PROVIDER_SHARED",
          status: "READY",
          connectedAccountId: BigInt(12345),
        },
        {
          organizationId: quoinManagedOrg.id,
          managementMode: "QUOIN_MANAGED",
          status: "READY",
        },
      ],
    });
  });

  afterEach(async () => {
    deletePropertyMock.mockReset();
    unsharePropertyMock.mockReset();
    resolvePortfolioManagerClientForOrganizationMock.mockReset();

    await prisma.portfolioManagerRemoteProperty.deleteMany({
      where: {
        organizationId: {
          in: [providerSharedOrg.id, quoinManagedOrg.id],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.portfolioManagerRemoteProperty.deleteMany({
      where: {
        organizationId: {
          in: [providerSharedOrg.id, quoinManagedOrg.id],
        },
      },
    });
    await prisma.portfolioManagerManagement.deleteMany({
      where: {
        organizationId: {
          in: [providerSharedOrg.id, quoinManagedOrg.id],
        },
      },
    });
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [providerSharedOrg.id, quoinManagedOrg.id],
        },
      },
    });
  });

  it("unshares provider-shared properties instead of deleting them", async () => {
    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue({
      property: {
        deleteProperty: deletePropertyMock,
        unshareProperty: unsharePropertyMock,
      },
    });

    await prisma.portfolioManagerRemoteProperty.create({
      data: {
        organizationId: providerSharedOrg.id,
        remoteAccountId: BigInt(12345),
        propertyId: BigInt(88027425),
        shareStatus: "ACCEPTED",
        name: "Provider Shared Property",
        address: "100 Test St NW, Washington, DC 20001",
        primaryFunction: "Office",
        grossSquareFeet: 1000,
      },
    });

    const result = await deleteRemotePropertyForBuilding({
      organizationId: providerSharedOrg.id,
      propertyId: "88027425",
    });

    expect(unsharePropertyMock).toHaveBeenCalledWith(88027425);
    expect(deletePropertyMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      propertyId: 88027425,
      alreadyMissing: false,
      remoteAction: "UNSHARE_PROPERTY",
    });
    expect(
      await prisma.portfolioManagerRemoteProperty.count({
        where: {
          organizationId: providerSharedOrg.id,
          propertyId: BigInt(88027425),
        },
      }),
    ).toBe(0);
  });

  it("deletes quoin-managed properties through the property delete endpoint", async () => {
    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue({
      property: {
        deleteProperty: deletePropertyMock,
        unshareProperty: unsharePropertyMock,
      },
    });

    await prisma.portfolioManagerRemoteProperty.create({
      data: {
        organizationId: quoinManagedOrg.id,
        remoteAccountId: BigInt(54321),
        propertyId: BigInt(99001122),
        shareStatus: "ACCEPTED",
        name: "Quoin Managed Property",
        address: "200 Test St NW, Washington, DC 20001",
        primaryFunction: "Office",
        grossSquareFeet: 1000,
      },
    });

    const result = await deleteRemotePropertyForBuilding({
      organizationId: quoinManagedOrg.id,
      propertyId: "99001122",
    });

    expect(deletePropertyMock).toHaveBeenCalledWith(99001122);
    expect(unsharePropertyMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      propertyId: 99001122,
      alreadyMissing: false,
      remoteAction: "DELETE_PROPERTY",
    });
  });

  it("deletes provider-shared properties when the connected account appears to own the property", async () => {
    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue({
      property: {
        deleteProperty: deletePropertyMock,
        unshareProperty: unsharePropertyMock,
      },
    });

    await prisma.portfolioManagerRemoteProperty.create({
      data: {
        organizationId: providerSharedOrg.id,
        remoteAccountId: BigInt(12345),
        propertyId: BigInt(88027426),
        shareStatus: "ACCEPTED",
        name: "Provider Shared Owned Property",
        address: "300 Test St NW, Washington, DC 20001",
        primaryFunction: "Office",
        grossSquareFeet: 1000,
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

    const result = await deleteRemotePropertyForBuilding({
      organizationId: providerSharedOrg.id,
      propertyId: "88027426",
    });

    expect(deletePropertyMock).toHaveBeenCalledWith(88027426);
    expect(unsharePropertyMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      propertyId: 88027426,
      alreadyMissing: false,
      remoteAction: "DELETE_PROPERTY",
    });
  });
});
