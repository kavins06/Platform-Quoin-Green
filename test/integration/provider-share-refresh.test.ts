import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/lib/db";

const {
  createESPMClientMock,
  getPmRuntimeHealthMock,
  runPortfolioManagerFullPullForBuildingMock,
} = vi.hoisted(() => ({
  createESPMClientMock: vi.fn(),
  getPmRuntimeHealthMock: vi.fn(),
  runPortfolioManagerFullPullForBuildingMock: vi.fn(),
}));

vi.mock("@/server/integrations/espm", async () => {
  const actual = await vi.importActual<typeof import("@/server/integrations/espm")>(
    "@/server/integrations/espm",
  );
  return {
    ...actual,
    createESPMClient: createESPMClientMock,
  };
});

vi.mock("@/server/lib/runtime-health", async () => {
  const actual = await vi.importActual<typeof import("@/server/lib/runtime-health")>(
    "@/server/lib/runtime-health",
  );
  return {
    ...actual,
    getPmRuntimeHealth: getPmRuntimeHealthMock,
  };
});

vi.mock("@/server/portfolio-manager/full-pull", () => ({
  runPortfolioManagerFullPullForBuilding: runPortfolioManagerFullPullForBuildingMock,
}));

import { refreshPortfolioManagerProviderConnectionForOrganization } from "@/server/portfolio-manager/provider-share";

function buildFakeEspmClient(propertyId: number, propertyName: string) {
  return {
    sharing: {
      listPendingPropertyShares: vi.fn().mockResolvedValue({ pendingList: { property: [] } }),
      listPendingMeterShares: vi.fn().mockResolvedValue({ pendingList: { meter: [] } }),
    },
    property: {
      listProperties: vi.fn().mockResolvedValue({
        response: { links: { link: [{ "@_id": propertyId }] } },
      }),
      getProperty: vi.fn().mockResolvedValue({
        property: {
          "@_id": propertyId,
          name: propertyName,
          primaryFunction: "Office",
          yearBuilt: 2020,
          grossFloorArea: { value: 25000 },
          address: {
            "@_address1": "1 Test St NW",
            "@_city": "Washington",
            "@_state": "DC",
            "@_postalCode": "20001",
          },
        },
      }),
      listPropertyUses: vi.fn().mockResolvedValue({
        response: { links: { link: [{ "@_id": 550001 }] } },
      }),
      getPropertyUse: vi.fn().mockResolvedValue({
        office: {
          name: "Main Office",
          useDetails: {
            totalGrossFloorArea: {
              value: 25000,
              "@_units": "Square Feet",
              "@_id": 660001,
            },
          },
        },
      }),
    },
    meter: {
      listMeters: vi.fn().mockResolvedValue({ response: { links: { link: [] } } }),
    },
    metrics: {
      getLatestAvailablePropertyMetrics: vi.fn().mockResolvedValue({
        score: null,
        siteTotal: null,
        sourceTotal: null,
        siteIntensity: null,
        sourceIntensity: null,
        weatherNormalizedSiteIntensity: null,
        weatherNormalizedSourceIntensity: null,
      }),
      getReasonsForNoScore: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("provider-share refresh", () => {
  const scope = `${Date.now()}`;
  let orgId: string;

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: {
        name: `Provider Refresh Org ${scope}-${Math.random().toString(36).slice(2, 8)}`,
        slug: `provider-refresh-${scope}-${Math.random().toString(36).slice(2, 8)}`,
      },
      select: { id: true },
    });
    orgId = org.id;

    await prisma.portfolioManagerManagement.create({
      data: {
        organizationId: orgId,
        managementMode: "PROVIDER_SHARED",
        status: "READY",
        targetUsername: "Kavin06",
        connectedUsername: "Kavin06",
        connectedAccountId: BigInt(382504),
        providerCustomerId: BigInt(999001),
      },
    });

    runPortfolioManagerFullPullForBuildingMock.mockResolvedValue({
      outcome: "SYNCED",
      stages: {
        snapshot: { message: null },
        usage: { message: null },
        setup: { message: null },
      },
    });
  });

  afterEach(async () => {
    createESPMClientMock.mockReset();
    getPmRuntimeHealthMock.mockReset();
    runPortfolioManagerFullPullForBuildingMock.mockReset();

    await prisma.portfolioManagerRemoteMeter.deleteMany({ where: { organizationId: orgId } });
    await prisma.portfolioManagerRemoteProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.portfolioManagerImportState.deleteMany({ where: { organizationId: orgId } });
    await prisma.portfolioManagerManagement.deleteMany({ where: { organizationId: orgId } });
    await prisma.building.deleteMany({ where: { organizationId: orgId } });
    await prisma.job.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("runs inline and imports a new shared property when the worker is offline", async () => {
    createESPMClientMock.mockReturnValue(
      buildFakeEspmClient(99010001, "Auto Imported Shared Property"),
    );
    getPmRuntimeHealthMock.mockResolvedValue({
      workerStatus: "OFFLINE",
      lastHeartbeatAt: null,
      queuesHealthy: true,
      activeWorkers: [],
      latestJob: {
        latestJobId: null,
        latestJobStatus: null,
        latestJobStartedAt: null,
        latestJobCreatedAt: null,
        latestJobCompletedAt: null,
        latestJobError: null,
        stalled: false,
      },
      warning: "Background Portfolio Manager worker appears offline right now.",
    });

    const result = await refreshPortfolioManagerProviderConnectionForOrganization({
      organizationId: orgId,
      actorType: "USER",
      actorId: "user-test",
      requestId: "provider-refresh-offline",
    });

    expect(result.mode).toBe("inline");
    expect(result.syncedPropertyCount).toBe(1);
    expect(result.message).toContain("checked Portfolio Manager directly");

    const remoteProperty = await prisma.portfolioManagerRemoteProperty.findUnique({
      where: {
        organizationId_propertyId: {
          organizationId: orgId,
          propertyId: BigInt(99010001),
        },
      },
    });
    expect(remoteProperty).not.toBeNull();
    expect(remoteProperty?.linkedBuildingId).toBeTruthy();

    const building = await prisma.building.findFirst({
      where: { organizationId: orgId, espmPropertyId: BigInt(99010001) },
    });
    expect(building?.name).toBe("Auto Imported Shared Property");

    const propertyUses = await prisma.buildingPropertyUse.findMany({
      where: { organizationId: orgId, buildingId: building?.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(propertyUses).toHaveLength(1);
    expect(propertyUses[0]?.useKey).toBe("OFFICE");
    expect(propertyUses[0]?.espmPropertyUseId?.toString()).toBe("550001");

    const setupState = await prisma.portfolioManagerSetupState.findUnique({
      where: { buildingId: building?.id },
    });
    expect(setupState?.propertyUsesStatus).toBe("APPLIED");
  });

  it("recovers from a stale provider-sync job and still imports the new shared property inline", async () => {
    const staleJob = await prisma.job.create({
      data: {
        type: "PORTFOLIO_MANAGER_PROVIDER_SYNC",
        status: "RUNNING",
        organizationId: orgId,
        maxAttempts: 3,
        startedAt: new Date(Date.now() - 11 * 60_000),
      },
      select: { id: true },
    });

    await prisma.portfolioManagerManagement.update({
      where: { organizationId: orgId },
      data: {
        status: "RUNNING",
        latestJobId: staleJob.id,
      },
    });
    await prisma.portfolioManagerImportState.create({
      data: {
        organizationId: orgId,
        status: "RUNNING",
        latestJobId: staleJob.id,
        selectedPropertyIdsJson: [],
        resultSummaryJson: { results: [] },
        selectedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      },
    });

    createESPMClientMock.mockReturnValue(
      buildFakeEspmClient(99010002, "Recovered Shared Property"),
    );
    getPmRuntimeHealthMock.mockResolvedValue({
      workerStatus: "HEALTHY",
      lastHeartbeatAt: new Date().toISOString(),
      queuesHealthy: true,
      activeWorkers: ["portfolio-manager-provider-sync"],
      latestJob: {
        latestJobId: staleJob.id,
        latestJobStatus: "RUNNING",
        latestJobStartedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
        latestJobCreatedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
        latestJobCompletedAt: null,
        latestJobError: null,
        stalled: true,
      },
      warning: "The latest PM job appears stalled and may need operator attention.",
    });

    const result = await refreshPortfolioManagerProviderConnectionForOrganization({
      organizationId: orgId,
      actorType: "USER",
      actorId: "user-test",
      requestId: "provider-refresh-stale",
    });

    expect(result.mode).toBe("inline");
    expect(result.message).toContain("stuck provider sync");

    const remoteProperty = await prisma.portfolioManagerRemoteProperty.findUnique({
      where: {
        organizationId_propertyId: {
          organizationId: orgId,
          propertyId: BigInt(99010002),
        },
      },
    });
    expect(remoteProperty?.linkedBuildingId).toBeTruthy();

    const management = await prisma.portfolioManagerManagement.findUniqueOrThrow({
      where: { organizationId: orgId },
    });
    expect(management.status).toBe("READY");

    const importState = await prisma.portfolioManagerImportState.findUniqueOrThrow({
      where: { organizationId: orgId },
    });
    expect(importState.status).toBe("SUCCEEDED");
  });
});
