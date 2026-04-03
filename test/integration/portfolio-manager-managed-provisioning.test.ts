import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "@/server/trpc/routers";
import { prisma } from "@/server/lib/db";
import {
  retryPortfolioManagerProvisioningFromOperator,
  runPortfolioManagerProvisioning,
} from "@/server/portfolio-manager/managed-provisioning";

const { queueAddMock } = vi.hoisted(() => ({
  queueAddMock: vi.fn(),
}));

vi.mock("@/server/lib/queue", () => ({
  createQueue: () => ({
    add: queueAddMock,
    close: vi.fn(),
  }),
  withQueue: async (_name: string, fn: (queue: { add: typeof queueAddMock }) => Promise<unknown>) =>
    fn({
      add: queueAddMock,
    }),
  createWorker: vi.fn(),
  QUEUES: {
    DATA_INGESTION: "data-ingestion",
    PORTFOLIO_MANAGER_PROVISIONING: "portfolio-manager-provisioning",
    ESPM_SYNC: "espm-sync",
    PATHWAY_ANALYSIS: "pathway-analysis",
    CAPITAL_STRUCTURING: "capital-structuring",
    DRIFT_DETECTION: "drift-detection",
    AI_ANALYSIS: "ai-analysis",
    NOTIFICATIONS: "notifications",
    REPORT_GENERATOR: "report-generator",
  },
}));

describe("managed Portfolio Manager provisioning", () => {
  const scope = `${Date.now()}`;

  let org: { id: string };
  let user: { id: string; authUserId: string };
  const createdBuildingIds: string[] = [];

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: {
        name: `Managed PM Org ${scope}`,
        slug: `managed-pm-org-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    user = await prisma.user.create({
      data: {
        authUserId: `supabase_managed_pm_user_${scope}`,
        email: `managed_pm_${scope}@test.com`,
        name: "Managed PM Operator",
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
        managementMode: "QUOIN_MANAGED",
        status: "NOT_STARTED",
      },
    });
  });

  afterEach(async () => {
    queueAddMock.mockReset();

    if (createdBuildingIds.length > 0) {
      await prisma.job.deleteMany({
        where: {
          buildingId: {
            in: createdBuildingIds,
          },
        },
      });
      await prisma.portfolioManagerProvisioningState.deleteMany({
        where: {
          buildingId: {
            in: createdBuildingIds,
          },
        },
      });
      await prisma.building.deleteMany({
        where: {
          id: {
            in: createdBuildingIds,
          },
        },
      });
      createdBuildingIds.length = 0;
    }

    await prisma.portfolioManagerManagement.update({
      where: { organizationId: org.id },
      data: {
        status: "NOT_STARTED",
        providerCustomerId: null,
        latestJobId: null,
        latestErrorCode: null,
        latestErrorMessage: null,
      },
    });
  });

  afterAll(async () => {
    await prisma.portfolioManagerManagement.deleteMany({
      where: { organizationId: org.id },
    });
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
      requestId: `managed-pm-${scope}`,
    });
  }

  function buildOfficePropertyUses(buildingName: string, grossSquareFeet: number) {
    return [
      {
        sortOrder: 0,
        useKey: "OFFICE" as const,
        displayName: `${buildingName} Office`,
        grossSquareFeet,
        details: {
          weeklyOperatingHours: 55,
          workersOnMainShift: 80,
          numberOfComputers: 60,
          percentThatCanBeCooled: "50% or more",
        },
      },
    ];
  }

  it("queues managed PM provisioning when a building is created", async () => {
    const caller = createCaller();

    const building = await caller.building.create({
      name: `Queued Managed Building ${scope}`,
      address: "1200 Test Avenue NW, Washington, DC 20005",
      grossSquareFeet: 120000,
      yearBuilt: 1998,
      propertyUses: buildOfficePropertyUses(
        `Queued Managed Building ${scope}`,
        120000,
      ),
    });

    createdBuildingIds.push(building.id);

    const provisioning = await prisma.portfolioManagerProvisioningState.findUnique({
      where: { buildingId: building.id },
    });
    const job = provisioning?.latestJobId
      ? await prisma.job.findUnique({
          where: { id: provisioning.latestJobId },
        })
      : null;

    expect(building.espmPropertyId).toBeNull();
    expect(building.espmShareStatus).toBe("PENDING");
    expect(provisioning?.status).toBe("QUEUED");
    expect(job?.status).toBe("QUEUED");
    expect(job?.type).toBe("PORTFOLIO_MANAGER_PROPERTY_PROVISIONING");
    expect(queueAddMock).toHaveBeenCalledTimes(1);
  });

  it("creates the managed PM customer and property, then links the building", async () => {
    const caller = createCaller();
    const building = await caller.building.create({
      name: `Provisioned Managed Building ${scope}`,
      address: "1300 Test Avenue NW, Washington, DC 20005",
      grossSquareFeet: 110000,
      yearBuilt: 2001,
      propertyUses: buildOfficePropertyUses(
        `Provisioned Managed Building ${scope}`,
        110000,
      ),
    });
    createdBuildingIds.push(building.id);

    const provisioning = await prisma.portfolioManagerProvisioningState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });
    const espmClient = {
      account: {
        createCustomer: vi.fn().mockResolvedValue({
          response: { id: 500001 },
        }),
      },
      property: {
        createProperty: vi.fn().mockResolvedValue({
          response: { id: 700001 },
        }),
      },
    } as never;

    const result = await runPortfolioManagerProvisioning({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: provisioning.latestJobId!,
      espmClient,
    });

    const linkedBuilding = await prisma.building.findUniqueOrThrow({
      where: { id: building.id },
    });
    const updatedManagement = await prisma.portfolioManagerManagement.findUniqueOrThrow({
      where: { organizationId: org.id },
    });
    const updatedProvisioning =
      await prisma.portfolioManagerProvisioningState.findUniqueOrThrow({
        where: { buildingId: building.id },
      });

    expect(result.customerId).toBe(500001);
    expect(result.propertyId).toBe(700001);
    expect(linkedBuilding.espmPropertyId?.toString()).toBe("700001");
    expect(linkedBuilding.espmShareStatus).toBe("LINKED");
    expect(updatedManagement.providerCustomerId?.toString()).toBe("500001");
    expect(updatedManagement.status).toBe("READY");
    expect(updatedProvisioning.status).toBe("SUCCEEDED");
    expect(updatedProvisioning.espmPropertyId?.toString()).toBe("700001");
  });

  it("reuses the existing managed PM customer for later buildings", async () => {
    const caller = createCaller();

    const firstBuilding = await caller.building.create({
      name: `Managed PM First ${scope}`,
      address: "1400 Test Avenue NW, Washington, DC 20005",
      grossSquareFeet: 100000,
      yearBuilt: 1999,
      propertyUses: buildOfficePropertyUses(`Managed PM First ${scope}`, 100000),
    });
    createdBuildingIds.push(firstBuilding.id);

    const firstProvisioning =
      await prisma.portfolioManagerProvisioningState.findUniqueOrThrow({
        where: { buildingId: firstBuilding.id },
      });
    await runPortfolioManagerProvisioning({
      organizationId: org.id,
      buildingId: firstBuilding.id,
      operationalJobId: firstProvisioning.latestJobId!,
      espmClient: {
        account: {
          createCustomer: vi.fn().mockResolvedValue({
            response: { id: 500777 },
          }),
        },
        property: {
          createProperty: vi.fn().mockResolvedValue({
            response: { id: 700777 },
          }),
        },
      } as never,
    });

    const secondBuilding = await caller.building.create({
      name: `Managed PM Second ${scope}`,
      address: "1500 Test Avenue NW, Washington, DC 20005",
      grossSquareFeet: 105000,
      yearBuilt: 2004,
      propertyUses: buildOfficePropertyUses(`Managed PM Second ${scope}`, 105000),
    });
    createdBuildingIds.push(secondBuilding.id);

    const secondProvisioning =
      await prisma.portfolioManagerProvisioningState.findUniqueOrThrow({
        where: { buildingId: secondBuilding.id },
      });
    const accountCreateCustomer = vi.fn();
    const propertyCreateProperty = vi.fn().mockResolvedValue({
      response: { id: 700778 },
    });

    await runPortfolioManagerProvisioning({
      organizationId: org.id,
      buildingId: secondBuilding.id,
      operationalJobId: secondProvisioning.latestJobId!,
      espmClient: {
        account: {
          createCustomer: accountCreateCustomer,
        },
        property: {
          createProperty: propertyCreateProperty,
        },
      } as never,
    });

    expect(accountCreateCustomer).not.toHaveBeenCalled();
    expect(propertyCreateProperty).toHaveBeenCalledWith(
      500777,
      expect.objectContaining({
        name: `Managed PM Second ${scope}`,
      }),
    );
  });

  it("requeues failed managed PM provisioning from the operator path", async () => {
    const caller = createCaller();
    const building = await caller.building.create({
      name: `Retry Managed Building ${scope}`,
      address: "1600 Test Avenue NW, Washington, DC 20005",
      grossSquareFeet: 125000,
      yearBuilt: 1996,
      propertyUses: buildOfficePropertyUses(
        `Retry Managed Building ${scope}`,
        125000,
      ),
    });
    createdBuildingIds.push(building.id);

    await prisma.portfolioManagerProvisioningState.update({
      where: { buildingId: building.id },
      data: {
        status: "FAILED",
        latestErrorCode: "PM_PROPERTY_CREATE_FAILED",
        latestErrorMessage: "Property provisioning failed.",
        lastFailedAt: new Date(),
      },
    });
    await prisma.building.update({
      where: { id: building.id },
      data: {
        espmShareStatus: "FAILED",
      },
    });

    const result = await retryPortfolioManagerProvisioningFromOperator({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "USER",
      actorId: user.authUserId,
      requestId: `retry-managed-pm-${scope}`,
    });

    const provisioning = await prisma.portfolioManagerProvisioningState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });

    expect(result.managed).toBe(true);
    expect(provisioning.status).toBe("QUEUED");
    expect(provisioning.retryCount).toBe(1);
    expect(queueAddMock).toHaveBeenCalledTimes(2);
  });
});


