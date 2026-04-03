import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "@/server/trpc/routers";
import { prisma } from "@/server/lib/db";
import {
  markPortfolioManagerSetupFailed,
  runPortfolioManagerSetupApply,
} from "@/server/portfolio-manager/setup";

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
    PORTFOLIO_MANAGER_IMPORT: "portfolio-manager-import",
    PORTFOLIO_MANAGER_SETUP: "portfolio-manager-setup",
    ESPM_SYNC: "espm-sync",
    PATHWAY_ANALYSIS: "pathway-analysis",
    CAPITAL_STRUCTURING: "capital-structuring",
    DRIFT_DETECTION: "drift-detection",
    AI_ANALYSIS: "ai-analysis",
    NOTIFICATIONS: "notifications",
    REPORT_GENERATOR: "report-generator",
  },
}));

describe("Portfolio Manager setup lifecycle", () => {
  const scope = `${Date.now()}`;

  let org: { id: string };
  let user: { id: string; authUserId: string };

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: {
        name: `PM Setup Org ${scope}`,
        slug: `pm-setup-org-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    user = await prisma.user.create({
      data: {
        authUserId: `supabase_pm_setup_user_${scope}`,
        email: `pm_setup_${scope}@test.com`,
        name: "PM Setup Operator",
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

  afterEach(async () => {
    queueAddMock.mockReset();
    await prisma.job.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.buildingPropertyUse.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.portfolioManagerPropertyUseInput.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.portfolioManagerSetupState.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.building.deleteMany({
      where: { organizationId: org.id },
    });
  });

  afterAll(async () => {
    await prisma.job.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.buildingPropertyUse.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.portfolioManagerPropertyUseInput.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.portfolioManagerSetupState.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.building.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.user.deleteMany({
      where: { id: user.id },
    });
    await prisma.organization.deleteMany({
      where: { id: org.id },
    });
  });

  function createCaller() {
    return appRouter.createCaller({
      authUserId: user.authUserId,
      activeOrganizationId: org.id,
      prisma,
      requestId: `pm-setup-${scope}`,
    });
  }

  async function createLinkedBuilding(input: {
    name: string;
    propertyType: "OFFICE" | "MULTIFAMILY" | "MIXED_USE" | "OTHER";
    grossSquareFeet: number;
    occupancyRate?: number | null;
  }) {
    return prisma.building.create({
      data: {
        organizationId: org.id,
        name: input.name,
        address: "1900 Setup Avenue NW, Washington, DC 20005",
        latitude: 38.9072,
        longitude: -77.0369,
        grossSquareFeet: input.grossSquareFeet,
        propertyType: input.propertyType,
        yearBuilt: 2000,
        occupancyRate: input.occupancyRate ?? null,
        bepsTargetScore: 71,
        espmPropertyId: BigInt(88762425 + Math.floor(Math.random() * 1000)),
        espmShareStatus: "LINKED",
      },
      select: { id: true, espmPropertyId: true },
    });
  }

  it("queues and applies office property-use setup for a linked building", async () => {
    const caller = createCaller();
    const building = await createLinkedBuilding({
      name: `Office Setup ${scope}`,
      propertyType: "OFFICE",
      grossSquareFeet: 100000,
      occupancyRate: 95,
    });

    const saved = await caller.portfolioManager.saveBuildingSetupInputs({
      buildingId: building.id,
      propertyUses: [
        {
          sortOrder: 0,
          useKey: "OFFICE",
          displayName: "Main Office",
          grossSquareFeet: 100000,
          details: {
            weeklyOperatingHours: 60,
            workersOnMainShift: 180,
            numberOfComputers: 220,
            percentThatCanBeCooled: "50% or more",
          },
        },
      ],
    });

    expect(saved.setupState.status).toBe("READY_TO_APPLY");

    const queued = await caller.portfolioManager.applyBuildingSetup({
      buildingId: building.id,
    });
    const queuedState = await prisma.portfolioManagerSetupState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });

    expect(queued.queueName).toBe("portfolio-manager-setup");
    expect(queuedState.status).toBe("APPLY_QUEUED");
    expect(queueAddMock).toHaveBeenCalledTimes(1);

    await runPortfolioManagerSetupApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      espmClient: {
        property: {
          listPropertyUses: vi.fn().mockResolvedValue({
            response: { link: [] },
          }),
          getPropertyUse: vi.fn(),
          createPropertyUse: vi.fn().mockResolvedValue({
            response: { id: 44001 },
          }),
          createUseDetails: vi.fn().mockResolvedValue({
            response: { id: 55001 },
          }),
          updateUseDetails: vi.fn(),
        },
      } as never,
    });

    const finalState = await prisma.portfolioManagerSetupState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });
    const rows = await prisma.buildingPropertyUse.findMany({
      where: { buildingId: building.id },
    });

    expect(finalState.status).toBe("NOT_STARTED");
    expect(finalState.propertyUsesStatus).toBe("APPLIED");
    expect(finalState.metersStatus).toBe("NOT_STARTED");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.espmPropertyUseId?.toString()).toBe("44001");
    expect(rows[0]?.espmUseDetailsId?.toString()).toBe("55001");
  });

  it("keeps mixed-use setup incomplete until an explicit breakdown is saved", async () => {
    const caller = createCaller();
    const building = await createLinkedBuilding({
      name: `Mixed Use Setup ${scope}`,
      propertyType: "MIXED_USE",
      grossSquareFeet: 120000,
    });

    const setup = await caller.portfolioManager.getBuildingSetup({
      buildingId: building.id,
    });

    expect(setup.setupState.status).toBe("INPUT_REQUIRED");
    expect(setup.setupState.summaryState).toBe("SETUP_INCOMPLETE");
    expect(setup.setupState.summaryLine).toContain("At least one detailed property use");
    expect(setup.propertyUses).toHaveLength(0);
  });

  it("supports registry-driven non-office setups when required details are present", async () => {
    const caller = createCaller();
    const building = await createLinkedBuilding({
      name: `Bank Branch Setup ${scope}`,
      propertyType: "OTHER",
      grossSquareFeet: 50000,
    });

    const saved = await caller.portfolioManager.saveBuildingSetupInputs({
      buildingId: building.id,
      propertyUses: [
        {
          sortOrder: 0,
          useKey: "BANK_BRANCH",
          displayName: "Main Branch",
          grossSquareFeet: 50000,
          details: {
            weeklyOperatingHours: 65,
            workersOnMainShift: 45,
            numberOfComputers: 55,
            percentThatCanBeCooled: "50% or more",
          },
        },
      ],
    });

    expect(saved.setupState.status).toBe("READY_TO_APPLY");
    expect(saved.propertyUses).toHaveLength(1);
    expect(saved.propertyUses[0]?.useKey).toBe("BANK_BRANCH");
  });

  it("marks remote property-use conflicts as needing attention instead of deleting them", async () => {
    const caller = createCaller();
    const building = await createLinkedBuilding({
      name: `Conflict Setup ${scope}`,
      propertyType: "OFFICE",
      grossSquareFeet: 70000,
      occupancyRate: 96,
    });

    const saved = await caller.portfolioManager.saveBuildingSetupInputs({
      buildingId: building.id,
      propertyUses: [
        {
          sortOrder: 0,
          useKey: "OFFICE",
          displayName: "Conflict Office",
          grossSquareFeet: 70000,
          details: {
            weeklyOperatingHours: 55,
            workersOnMainShift: 120,
            numberOfComputers: 140,
            percentThatCanBeCooled: "50% or more",
          },
        },
      ],
    });

    const queued = await caller.portfolioManager.applyBuildingSetup({
      buildingId: building.id,
    });

    await expect(
      runPortfolioManagerSetupApply({
        organizationId: org.id,
        buildingId: building.id,
        operationalJobId: queued.operationalJobId,
        espmClient: {
          property: {
            listPropertyUses: vi.fn().mockResolvedValue({
              response: { link: [{ "@_id": 7001 }, { "@_id": 7002 }] },
            }),
            getPropertyUse: vi
              .fn()
              .mockResolvedValueOnce({
                propertyUse: {
                  "@_id": 7001,
                  name: "Existing Office",
                  type: "Office",
                },
              })
              .mockResolvedValueOnce({
                propertyUse: {
                  "@_id": 7002,
                  name: "Existing Retail",
                  type: "Retail",
                },
              }),
            createPropertyUse: vi.fn(),
            createUseDetails: vi.fn(),
            updateUseDetails: vi.fn(),
          },
        } as never,
      }),
    ).rejects.toThrow("Existing PM property uses need review before setup can be applied.");

    await markPortfolioManagerSetupFailed({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      errorCode: "PM_SETUP_REMOTE_CONFLICT",
      errorMessage: "Existing PM property uses need review before setup can be applied.",
    });

    const finalState = await prisma.portfolioManagerSetupState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });

    expect(saved.setupState.status).toBe("READY_TO_APPLY");
    expect(finalState.status).toBe("NEEDS_ATTENTION");
    expect(finalState.latestErrorCode).toBe("PM_SETUP_REMOTE_CONFLICT");
  });
});


