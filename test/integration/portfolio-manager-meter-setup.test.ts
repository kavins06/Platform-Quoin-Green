import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/lib/db";
import { ESPMAccessError } from "@/server/integrations/espm/errors";
import {
  enqueuePortfolioManagerMeterAssociationsApply,
  enqueuePortfolioManagerMeterSetupApply,
  getPortfolioManagerMeterSetupForBuilding,
  runPortfolioManagerMeterAssociationsApply,
  runPortfolioManagerMeterSetupApply,
  savePortfolioManagerMeterSetup,
} from "@/server/portfolio-manager/meter-setup";

const { resolvePortfolioManagerClientForOrganizationMock } = vi.hoisted(() => ({
  resolvePortfolioManagerClientForOrganizationMock: vi.fn(),
}));
const queueAddMock = vi.fn();

vi.mock("@/server/portfolio-manager/existing-account", () => ({
  resolvePortfolioManagerClientForOrganization: resolvePortfolioManagerClientForOrganizationMock,
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
    PORTFOLIO_MANAGER_METER_SETUP: "portfolio-manager-meter-setup",
    ESPM_SYNC: "espm-sync",
    PATHWAY_ANALYSIS: "pathway-analysis",
    CAPITAL_STRUCTURING: "capital-structuring",
    DRIFT_DETECTION: "drift-detection",
    AI_ANALYSIS: "ai-analysis",
    NOTIFICATIONS: "notifications",
    REPORT_GENERATOR: "report-generator",
  },
}));

describe("Portfolio Manager meter setup lifecycle", () => {
  const scope = `${Date.now()}`;

  let org: { id: string };
  let existingOrg: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: {
        name: `PM Meter Org ${scope}`,
        slug: `pm-meter-org-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });
    existingOrg = await prisma.organization.create({
      data: {
        name: `PM Meter Existing Org ${scope}`,
        slug: `pm-meter-existing-org-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    await prisma.portfolioManagerManagement.createMany({
      data: [
        {
          organizationId: org.id,
          managementMode: "QUOIN_MANAGED",
          status: "READY",
        },
        {
          organizationId: existingOrg.id,
          managementMode: "EXISTING_ESPM",
          status: "READY",
          connectedAccountId: BigInt(9001),
          connectedUsername: "existing@example.com",
        },
      ],
    });
  });

  afterEach(async () => {
    queueAddMock.mockReset();
    resolvePortfolioManagerClientForOrganizationMock.mockReset();
    await prisma.job.deleteMany({
      where: {
        organizationId: { in: [org.id, existingOrg.id] },
      },
    });
    await prisma.energyReading.deleteMany({
      where: {
        organizationId: { in: [org.id, existingOrg.id] },
      },
    });
    await prisma.portfolioManagerMeterLinkState.deleteMany({
      where: {
        organizationId: { in: [org.id, existingOrg.id] },
      },
    });
    await prisma.meter.deleteMany({
      where: {
        organizationId: { in: [org.id, existingOrg.id] },
      },
    });
    await prisma.portfolioManagerPropertyUseInput.deleteMany({
      where: {
        organizationId: { in: [org.id, existingOrg.id] },
      },
    });
    await prisma.portfolioManagerSetupState.deleteMany({
      where: {
        organizationId: { in: [org.id, existingOrg.id] },
      },
    });
    await prisma.building.deleteMany({
      where: {
        organizationId: { in: [org.id, existingOrg.id] },
      },
    });
  });

  afterAll(async () => {
    await prisma.portfolioManagerManagement.deleteMany({
      where: {
        organizationId: { in: [org.id, existingOrg.id] },
      },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [org.id, existingOrg.id] } },
    });
  });

  async function createLinkedBuilding(input: {
    organizationId: string;
    name: string;
    propertyType?: "OFFICE" | "MULTIFAMILY" | "MIXED_USE" | "OTHER";
    espmPropertyId?: number;
  }) {
    const building = await prisma.building.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        address: "1900 Meter Avenue NW, Washington, DC 20005",
        latitude: 38.9072,
        longitude: -77.0369,
        grossSquareFeet: 90000,
        propertyType: input.propertyType ?? "OFFICE",
        yearBuilt: 2001,
        bepsTargetScore: 71,
        espmPropertyId: BigInt(input.espmPropertyId ?? 88000001),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    await prisma.portfolioManagerSetupState.create({
      data: {
        organizationId: input.organizationId,
        buildingId: building.id,
        status: "APPLIED",
        propertyUsesStatus: "APPLIED",
        metersStatus: "NOT_STARTED",
        associationsStatus: "NOT_STARTED",
        usageCoverageStatus: "NOT_STARTED",
      },
    });

    return building;
  }

  it("creates remote meters for managed electric and gas meters", async () => {
    const building = await createLinkedBuilding({
      organizationId: org.id,
      name: `Managed Meter Building ${scope}`,
      espmPropertyId: 88001001,
    });

    const [electricMeter, gasMeter] = await Promise.all([
      prisma.meter.create({
        data: {
          organizationId: org.id,
          buildingId: building.id,
          meterType: "ELECTRIC",
          name: "Main Electric",
          unit: "KWH",
        },
      }),
      prisma.meter.create({
        data: {
          organizationId: org.id,
          buildingId: building.id,
          meterType: "GAS",
          name: "Main Gas",
          unit: "THERMS",
        },
      }),
    ]);

    await savePortfolioManagerMeterSetup({
      organizationId: org.id,
      buildingId: building.id,
      localMeterStrategies: [
        { meterId: electricMeter.id, strategy: "CREATE_REMOTE" },
        { meterId: gasMeter.id, strategy: "CREATE_REMOTE" },
      ],
      importRemoteMeterIds: [],
      actorType: "SYSTEM",
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({ response: { link: [] } }),
          getMeter: vi.fn(),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({ response: { link: [] } }),
          createMeter: vi
            .fn()
            .mockResolvedValueOnce({ response: { id: 6001 } })
            .mockResolvedValueOnce({ response: { id: 6002 } }),
        },
      } as never,
    });
    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce({
      meter: {
        listMeters: vi.fn().mockResolvedValue({ response: { link: [] } }),
      },
    } as never);

    const queued = await enqueuePortfolioManagerMeterSetupApply({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
    });

    expect(queued.queueName).toBe("portfolio-manager-meter-setup");
    expect(queueAddMock).toHaveBeenCalledTimes(1);

    await runPortfolioManagerMeterSetupApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({ response: { link: [] } }),
          getMeter: vi.fn(),
          createMeter: vi
            .fn()
            .mockResolvedValueOnce({ response: { id: 6001 } })
            .mockResolvedValueOnce({ response: { id: 6002 } }),
        },
      } as never,
    });

    const meters = await prisma.meter.findMany({
      where: { buildingId: building.id },
      orderBy: { name: "asc" },
    });
    const setupState = await prisma.portfolioManagerSetupState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });

    expect(meters.map((meter) => meter.espmMeterId?.toString())).toEqual(["6001", "6002"]);
    expect(setupState.metersStatus).toBe("APPLIED");
    expect(setupState.associationsStatus).toBe("READY_TO_APPLY");
  });

  it("imports selected remote meters into local canonical meters for existing-account orgs", async () => {
    const building = await createLinkedBuilding({
      organizationId: existingOrg.id,
      name: `Existing Meter Building ${scope}`,
      espmPropertyId: 88002001,
    });

    const saved = await savePortfolioManagerMeterSetup({
      organizationId: existingOrg.id,
      buildingId: building.id,
      localMeterStrategies: [],
      importRemoteMeterIds: ["7001"],
      actorType: "SYSTEM",
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 7001 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 7001,
              type: "Electric",
              name: "Imported Electric",
              unitOfMeasure: "kWh (thousand Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({ response: { link: [] } }),
        },
      } as never,
    });

    const localMeter = await prisma.meter.findFirstOrThrow({
      where: { buildingId: building.id },
    });

    expect(localMeter.espmMeterId?.toString()).toBe("7001");
    expect(saved.localMeters.some((meter) => meter.espmMeterId === "7001")).toBe(true);
  });

  it("treats exact PM units like MWh as supported conversions instead of lossy normalized matches", async () => {
    const building = await createLinkedBuilding({
      organizationId: existingOrg.id,
      name: `MWh Compatible Building ${scope}`,
      espmPropertyId: 88002501,
    });
    const localMeter = await prisma.meter.create({
      data: {
        organizationId: existingOrg.id,
        buildingId: building.id,
        meterType: "ELECTRIC",
        name: "Converted Electric",
        unit: "KWH",
      },
    });

    const result = await getPortfolioManagerMeterSetupForBuilding({
      organizationId: existingOrg.id,
      buildingId: building.id,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 7051 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 7051,
              type: "Electric",
              name: "Converted Electric",
              unitOfMeasure: "MWh (million Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({ response: { link: [] } }),
        },
      } as never,
    });

    const local = result.localMeters.find((meter) => meter.id === localMeter.id);
    const remote = result.remoteMeters.find((meter) => meter.meterId === "7051");

    expect(local?.suggestedRemoteMeterId).toBe("7051");
    expect(remote?.unitCompatibilityStatus).toBe("SUPPORTED_CONVERSION");
    expect(remote?.canImport).toBe(true);
  });

  it("blocks unsupported exact remote units instead of guessing import safety", async () => {
    const building = await createLinkedBuilding({
      organizationId: existingOrg.id,
      name: `Unsupported Unit Building ${scope}`,
      espmPropertyId: 88002502,
    });

    const result = await getPortfolioManagerMeterSetupForBuilding({
      organizationId: existingOrg.id,
      buildingId: building.id,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 7052 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 7052,
              type: "Natural Gas",
              name: "Unsupported Gas",
              unitOfMeasure: "Gallons",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({ response: { link: [] } }),
        },
      } as never,
    });

    const remote = result.remoteMeters.find((meter) => meter.meterId === "7052");
    expect(remote?.canImport).toBe(false);
    expect(remote?.unitCompatibilityStatus).toBe("UNSUPPORTED");
    expect(remote?.importBlockedReason).toContain("cannot be converted safely");
  });

  it("requires review instead of guessing when multiple remote candidates could map to one local meter", async () => {
    const building = await createLinkedBuilding({
      organizationId: existingOrg.id,
      name: `Ambiguous Meter Building ${scope}`,
      espmPropertyId: 88003001,
    });
    const localMeter = await prisma.meter.create({
      data: {
        organizationId: existingOrg.id,
        buildingId: building.id,
        meterType: "ELECTRIC",
        name: "Ambiguous Electric",
        unit: "KWH",
      },
    });

    const result = await getPortfolioManagerMeterSetupForBuilding({
      organizationId: existingOrg.id,
      buildingId: building.id,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 7101 }, { "@_id": 7102 }] } },
          }),
          getMeter: vi
            .fn()
            .mockResolvedValueOnce({
              meter: {
                "@_id": 7101,
                type: "Electric",
                name: "Ambiguous Electric",
                unitOfMeasure: "kWh (thousand Watt-hours)",
                metered: true,
                inUse: true,
              },
            })
            .mockResolvedValueOnce({
              meter: {
                "@_id": 7102,
                type: "Electric",
                name: "Ambiguous Electric",
                unitOfMeasure: "kWh (thousand Watt-hours)",
                metered: true,
                inUse: true,
              },
            }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({ response: { link: [] } }),
        },
      } as never,
    });

    const local = result.localMeters.find((meter) => meter.id === localMeter.id);
    expect(local?.suggestedRemoteMeterId).toBeNull();
    expect(result.setupState.canApplyMeters).toBe(false);
  });

  it("returns accessible meters with a partial-access warning instead of failing the entire setup snapshot", async () => {
    const building = await createLinkedBuilding({
      organizationId: existingOrg.id,
      name: `Partial Access Meter Building ${scope}`,
      espmPropertyId: 88003501,
    });
    await prisma.meter.create({
      data: {
        organizationId: existingOrg.id,
        buildingId: building.id,
        meterType: "ELECTRIC",
        name: "Visible Electric",
        unit: "KWH",
      },
    });

    const result = await getPortfolioManagerMeterSetupForBuilding({
      organizationId: existingOrg.id,
      buildingId: building.id,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 7201 }, { "@_id": 7202 }] } },
          }),
          getMeter: vi
            .fn()
            .mockResolvedValueOnce({
              meter: {
                "@_id": 7201,
                type: "Electric",
                name: "Visible Electric",
                unitOfMeasure: "kWh (thousand Watt-hours)",
                metered: true,
                inUse: true,
              },
            })
            .mockRejectedValueOnce(
              new ESPMAccessError("Portfolio Manager denied access to this resource"),
            ),
          listPropertyMeterAssociations: vi.fn(),
        },
      } as never,
    });

    expect(result.remoteMeters).toHaveLength(1);
    expect(result.remoteMeters[0]?.meterId).toBe("7201");
    expect(result.remoteMeterAccess.status).toBe("PARTIAL_ACCESS");
    expect(result.remoteMeterAccess.inaccessibleCount).toBe(1);
    expect(result.remoteMeterAccess.inaccessibleMeterIds).toEqual(["7202"]);
    expect(result.remoteMeterAccess.warning).toContain(
      "Quoin imported the Portfolio Manager meters it can access",
    );
    expect(result.remoteMeterAccess.warning).toContain("provider account");
    expect(result.setupState.summaryState).toBe("SETUP_INCOMPLETE");
    expect(result.setupState.summaryLine).toContain(
      "Meters still need to be selected or linked.",
    );
    expect(result.setupState.canApplyMeters).toBe(false);
    expect(result.setupState.canApplyAssociations).toBe(false);
  });

  it("blocks meter setup save while remote meter access is incomplete", async () => {
    const building = await createLinkedBuilding({
      organizationId: existingOrg.id,
      name: `Blocked Partial Access Building ${scope}`,
      espmPropertyId: 88003502,
    });
    const localMeter = await prisma.meter.create({
      data: {
        organizationId: existingOrg.id,
        buildingId: building.id,
        meterType: "ELECTRIC",
        name: "Blocked Electric",
        unit: "KWH",
      },
    });

    const espmClient = {
      meter: {
        listMeters: vi.fn().mockResolvedValue({
          response: { links: { link: [{ "@_id": 7301 }, { "@_id": 7302 }] } },
        }),
        getMeter: vi
          .fn()
          .mockResolvedValueOnce({
            meter: {
              "@_id": 7301,
              type: "Electric",
              name: "Blocked Electric",
              unitOfMeasure: "kWh (thousand Watt-hours)",
              metered: true,
              inUse: true,
            },
          })
          .mockRejectedValueOnce(
            new ESPMAccessError("Portfolio Manager denied access to this resource"),
          ),
        listPropertyMeterAssociations: vi.fn(),
      },
    } as never;

    const result = await savePortfolioManagerMeterSetup({
      organizationId: existingOrg.id,
      buildingId: building.id,
      localMeterStrategies: [
        {
          meterId: localMeter.id,
          strategy: "LINK_EXISTING_REMOTE",
          selectedRemoteMeterId: "7301",
        },
      ],
      importRemoteMeterIds: [],
      actorType: "SYSTEM",
      espmClient,
    });

    expect(result.remoteMeterAccess.canProceed).toBe(false);
    expect(result.remoteMeterAccess.status).toBe("UNAVAILABLE");
    expect(result.remoteMeterAccess.inaccessibleMeterIds).toEqual(["7301", "7302"]);
    expect(result.remoteMeterAccess.warning).toContain(
      "Quoin could not read 2 Portfolio Manager meter(s) for this property right now.",
    );
    expect(result.setupState.summaryState).toBe("NEEDS_ATTENTION");
    expect(result.setupState.summaryLine).toContain(
      "Portfolio Manager meter access is incomplete.",
    );
  });

  it("applies property-to-meter associations without deleting extra remote associations", async () => {
    const building = await createLinkedBuilding({
      organizationId: org.id,
      name: `Association Meter Building ${scope}`,
      espmPropertyId: 88004001,
    });
    const localMeter = await prisma.meter.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        meterType: "ELECTRIC",
        name: "Association Electric",
        unit: "KWH",
        espmMeterId: BigInt(8001),
      },
    });
    await prisma.portfolioManagerMeterLinkState.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        meterId: localMeter.id,
        strategy: "LINK_EXISTING_REMOTE",
        selectedRemoteMeterId: BigInt(8001),
        meterStatus: "APPLIED",
        associationStatus: "NOT_STARTED",
      },
    });
    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce({
      meter: {
        listMeters: vi.fn().mockResolvedValue({
          response: { links: { link: [{ "@_id": 8001 }] } },
        }),
        getMeter: vi.fn().mockResolvedValue({
          meter: {
            "@_id": 8001,
            type: "Electric",
            name: "Association Electric",
            unitOfMeasure: "kWh (thousand Watt-hours)",
            metered: true,
            inUse: true,
          },
        }),
      },
    } as never);

    const queued = await enqueuePortfolioManagerMeterAssociationsApply({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
    });

    await runPortfolioManagerMeterAssociationsApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      espmClient: {
        meter: {
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 9999 }] } },
          }),
          associateMeterToProperty: vi.fn().mockResolvedValue({ response: { id: 1 } }),
        },
      } as never,
    });

    const linkState = await prisma.portfolioManagerMeterLinkState.findUniqueOrThrow({
      where: { meterId: localMeter.id },
    });
    const setupState = await prisma.portfolioManagerSetupState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });

    expect(linkState.associationStatus).toBe("APPLIED");
    expect(setupState.associationsStatus).toBe("APPLIED");
  });

  it("uses the earliest governed local reading date for remote meter firstBillDate", async () => {
    const building = await createLinkedBuilding({
      organizationId: org.id,
      name: `First Bill Date Building ${scope}`,
      espmPropertyId: 88004002,
    });
    const localMeter = await prisma.meter.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        meterType: "ELECTRIC",
        name: "Created Electric",
        unit: "KWH",
      },
    });
    await prisma.energyReading.createMany({
      data: [
        {
          organizationId: org.id,
          buildingId: building.id,
          meterId: localMeter.id,
          meterType: "ELECTRIC",
          source: "CSV_UPLOAD",
          periodStart: new Date(Date.UTC(2025, 0, 1)),
          periodEnd: new Date(Date.UTC(2025, 0, 31)),
          consumption: 1200,
          unit: "KWH",
          consumptionKbtu: 4094.4,
        },
        {
          organizationId: org.id,
          buildingId: building.id,
          meterId: localMeter.id,
          meterType: "ELECTRIC",
          source: "MANUAL",
          periodStart: new Date(Date.UTC(2025, 2, 1)),
          periodEnd: new Date(Date.UTC(2025, 2, 31)),
          consumption: 1300,
          unit: "KWH",
          consumptionKbtu: 4435.6,
        },
      ],
    });
    const buildingReconciliation = await prisma.buildingSourceReconciliation.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        status: "CLEAN",
        canonicalSource: "MANUAL",
        referenceYear: 2025,
        conflictCount: 0,
        incompleteCount: 0,
        sourceRecordsJson: [],
        conflictsJson: [],
        chosenValuesJson: {},
        reconciledByType: "SYSTEM",
      },
      select: { id: true },
    });
    await prisma.meterSourceReconciliation.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        meterId: localMeter.id,
        buildingSourceReconciliationId: buildingReconciliation.id,
        status: "CLEAN",
        canonicalSource: "MANUAL",
        conflictCount: 0,
        sourceRecordsJson: [],
        conflictsJson: [],
        chosenValuesJson: {},
        reconciledByType: "SYSTEM",
      },
    });

    await savePortfolioManagerMeterSetup({
      organizationId: org.id,
      buildingId: building.id,
      localMeterStrategies: [{ meterId: localMeter.id, strategy: "CREATE_REMOTE" }],
      importRemoteMeterIds: [],
      actorType: "SYSTEM",
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({ response: { link: [] } }),
          getMeter: vi.fn(),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({ response: { link: [] } }),
          createMeter: vi.fn().mockResolvedValue({ response: { id: 6010 } }),
        },
      } as never,
    });
    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce({
      meter: {
        listMeters: vi.fn().mockResolvedValue({ response: { link: [] } }),
      },
    } as never);

    const queued = await enqueuePortfolioManagerMeterSetupApply({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
    });

    const createMeter = vi.fn().mockResolvedValue({ response: { id: 6010 } });
    await runPortfolioManagerMeterSetupApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({ response: { link: [] } }),
          getMeter: vi.fn(),
          createMeter,
        },
      } as never,
    });

    expect(createMeter).toHaveBeenCalledWith(
      88004002,
      expect.objectContaining({
        firstBillDate: "2025-03-01",
      }),
    );
  });
});


