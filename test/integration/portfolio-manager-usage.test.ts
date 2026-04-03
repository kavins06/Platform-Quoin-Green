import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/lib/db";
import {
  enqueuePortfolioManagerUsageImport,
  enqueuePortfolioManagerUsagePush,
  getPortfolioManagerUsageStatusForBuilding,
  requestPortfolioManagerUsagePush,
  runPortfolioManagerUsageApply,
} from "@/server/portfolio-manager/usage";

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
    PORTFOLIO_MANAGER_USAGE: "portfolio-manager-usage",
    ESPM_SYNC: "espm-sync",
    PATHWAY_ANALYSIS: "pathway-analysis",
    CAPITAL_STRUCTURING: "capital-structuring",
    DRIFT_DETECTION: "drift-detection",
    AI_ANALYSIS: "ai-analysis",
    NOTIFICATIONS: "notifications",
    REPORT_GENERATOR: "report-generator",
  },
}));

describe("Portfolio Manager usage lifecycle", () => {
  const scope = `${Date.now()}`;
  const reportingYear = 2025;
  let org: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: {
        name: `PM Usage Org ${scope}`,
        slug: `pm-usage-org-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });
  });

  afterEach(async () => {
    queueAddMock.mockReset();
    resolvePortfolioManagerClientForOrganizationMock.mockReset();
    await prisma.complianceSnapshot.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.job.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.portfolioManagerUsageState.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.meterSourceReconciliation.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.buildingSourceReconciliation.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.energyReading.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.portfolioManagerMeterLinkState.deleteMany({
      where: { organizationId: org.id },
    });
    await prisma.meter.deleteMany({
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
    await prisma.organization.delete({
      where: { id: org.id },
    });
  });

  async function createReadyBuilding(input: {
    name: string;
    propertyUsesStatus?: "APPLIED" | "READY_TO_APPLY" | "NOT_STARTED";
    metersStatus?: "APPLIED" | "READY_TO_APPLY" | "NOT_STARTED";
    associationsStatus?: "APPLIED" | "READY_TO_APPLY" | "NOT_STARTED";
    espmPropertyId?: number;
  }) {
    const building = await prisma.building.create({
      data: {
        organizationId: org.id,
        name: input.name,
        address: "1500 Usage Avenue NW, Washington, DC 20005",
        latitude: 38.9072,
        longitude: -77.0369,
        grossSquareFeet: 88000,
        propertyType: "OFFICE",
        yearBuilt: 2004,
        bepsTargetScore: 71,
        espmPropertyId: BigInt(input.espmPropertyId ?? 99100001),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    await prisma.portfolioManagerSetupState.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        status: "APPLIED",
        propertyUsesStatus: input.propertyUsesStatus ?? "APPLIED",
        metersStatus: input.metersStatus ?? "APPLIED",
        associationsStatus: input.associationsStatus ?? "APPLIED",
        usageCoverageStatus: "NOT_STARTED",
      },
    });

    return building;
  }

  function createResolvedEspmClient(input: {
    propertyId: number;
    meterId: number;
    rawType?: string;
    rawUnitOfMeasure?: string;
  }) {
    return {
      meter: {
        listMeters: vi.fn().mockResolvedValue({
          response: { links: { link: [{ "@_id": input.meterId }] } },
        }),
        getMeter: vi.fn().mockResolvedValue({
          meter: {
            "@_id": input.meterId,
            type: input.rawType ?? "Electric",
            name: "Resolved Meter",
            unitOfMeasure: input.rawUnitOfMeasure ?? "kWh (thousand Watt-hours)",
            metered: true,
            inUse: true,
          },
        }),
        listPropertyMeterAssociations: vi.fn().mockResolvedValue({
          response: { links: { link: [{ "@_id": input.meterId }] } },
        }),
      },
    } as never;
  }

  async function createLinkedMeter(input: {
    buildingId: string;
    name: string;
    meterType?: "ELECTRIC" | "GAS" | "STEAM";
    unit?: "KWH" | "THERMS" | "MMBTU";
    espmMeterId?: number;
  }) {
    return prisma.meter.create({
      data: {
        organizationId: org.id,
        buildingId: input.buildingId,
        meterType: input.meterType ?? "ELECTRIC",
        name: input.name,
        unit: input.unit ?? "KWH",
        espmMeterId: BigInt(input.espmMeterId ?? 77100001),
      },
    });
  }

  async function seedMonthlyReadings(input: {
    buildingId: string;
    meterId: string;
    meterType: "ELECTRIC" | "GAS";
    unit: "KWH" | "THERMS";
    source: "MANUAL" | "ESPM_SYNC";
    months: number[];
  }) {
    for (const month of input.months) {
      const periodStart = new Date(Date.UTC(reportingYear, month - 1, 1));
      const periodEnd = new Date(Date.UTC(reportingYear, month, 0));
      await prisma.energyReading.create({
        data: {
          organizationId: org.id,
          buildingId: input.buildingId,
          meterId: input.meterId,
          meterType: input.meterType,
          source: input.source,
          periodStart,
          periodEnd,
          consumption: 1000 + month,
          unit: input.unit,
          consumptionKbtu: 3400 + month,
          cost: 100 + month,
          isVerified: true,
          rawPayload: {
            seeded: true,
            month,
          },
        },
      });
    }
  }

  async function seedDailyReadings(input: {
    buildingId: string;
    meterId: string;
    meterType: "ELECTRIC" | "GAS";
    unit: "KWH" | "THERMS";
    source: "MANUAL" | "ESPM_SYNC";
    count: number;
    startDay?: number;
    usageBase?: number;
  }) {
    const startDay = input.startDay ?? 1;
    const usageBase = input.usageBase ?? 100;

    for (let index = 0; index < input.count; index += 1) {
      const periodStart = new Date(Date.UTC(reportingYear, 0, startDay + index));
      const periodEnd = new Date(Date.UTC(reportingYear, 0, startDay + index));
      await prisma.energyReading.create({
        data: {
          organizationId: org.id,
          buildingId: input.buildingId,
          meterId: input.meterId,
          meterType: input.meterType,
          source: input.source,
          periodStart,
          periodEnd,
          consumption: usageBase + index,
          unit: input.unit,
          consumptionKbtu:
            input.unit === "KWH" ? (usageBase + index) * 3.412 : (usageBase + index) * 100,
          cost: 10 + index,
          isVerified: true,
          rawPayload: {
            seeded: true,
            index,
          },
        },
      });
    }
  }

  const fullMetricsPayload = {
    propertyId: 99100001,
    year: reportingYear,
    month: 12,
    score: 86,
    siteTotal: 100,
    sourceTotal: 120,
    siteIntensity: 44,
    sourceIntensity: 55,
    weatherNormalizedSiteIntensity: 42,
    weatherNormalizedSourceIntensity: 53,
    directGHGEmissions: 30,
    medianScore: 50,
  };

  function buildMonthlyConsumptionRows(input: {
    months: number[];
    usageBase?: number;
    costBase?: number;
  }) {
    return input.months.map((month) => ({
      id: 980000 + month,
      startDate: new Date(Date.UTC(reportingYear, month - 1, 1)).toISOString(),
      endDate: new Date(Date.UTC(reportingYear, month, 0)).toISOString(),
      usage: (input.usageBase ?? 1000) + month,
      cost: (input.costBase ?? 100) + month,
      estimatedValue: false,
    }));
  }

  it("pushes linked local monthly usage to PM and refreshes metrics when coverage is ready", async () => {
    const building = await createReadyBuilding({
      name: `Usage Push Building ${scope}`,
      espmPropertyId: 99100001,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Main Electric",
      espmMeterId: 77110001,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "MANUAL",
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "ESPM_SYNC",
      months: [1],
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100001,
        meterId: 77110001,
      }),
    );

    const queued = await enqueuePortfolioManagerUsagePush({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    expect(queued.queueName).toBe("portfolio-manager-usage");
    expect(queueAddMock).toHaveBeenCalledTimes(1);

    const pushConsumptionData = vi.fn().mockResolvedValue({});
    const updateConsumptionData = vi.fn().mockResolvedValue({});
    const deleteConsumptionData = vi.fn().mockResolvedValue({});
    const getLatestAvailablePropertyMetrics = vi.fn().mockResolvedValue(fullMetricsPayload);
    const getReasonsForNoScore = vi.fn().mockResolvedValue([]);
    const getConsumptionData = vi
      .fn()
      .mockResolvedValueOnce({
        meterData: {
          meterConsumption: [],
        },
      })
      .mockResolvedValueOnce({
        meterData: {
          meterConsumption: buildMonthlyConsumptionRows({
            months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
          }),
        },
      });

    const result = await runPortfolioManagerUsageApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      direction: "PUSH_LOCAL_TO_PM",
      reportingYear,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110001 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 77110001,
              type: "Electric",
              name: "Main Electric",
              unitOfMeasure: "kWh (thousand Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110001 }] } },
          }),
        },
        consumption: {
          getConsumptionData,
          pushConsumptionData,
          updateConsumptionData,
          deleteConsumptionData,
        },
        metrics: {
          getLatestAvailablePropertyMetrics,
          getReasonsForNoScore,
        },
      } as never,
    });

    const usageState = await prisma.portfolioManagerUsageState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });
    const setupState = await prisma.portfolioManagerSetupState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });
    const snapshots = await prisma.complianceSnapshot.count({
      where: { buildingId: building.id },
    });
    const usageResult = usageState.lastUsageResultJson as Record<string, unknown>;

    expect(result.coverageStatus).toBe("READY_FOR_METRICS");
    expect(usageState.overallStatus).toBe("SUCCEEDED");
    expect(usageState.metricsStatus).toBe("SUCCEEDED");
    expect(usageResult.readingsPrepared).toBe(12);
    expect(pushConsumptionData).toHaveBeenCalledTimes(1);
    expect(updateConsumptionData).not.toHaveBeenCalled();
    expect(deleteConsumptionData).not.toHaveBeenCalled();
    expect(getLatestAvailablePropertyMetrics).toHaveBeenCalledOnce();
    expect(setupState.usageCoverageStatus).toBe("APPLIED");
    expect(snapshots).toBe(1);
  });

  it("deletes remote PM periods when no active Quoin readings remain for a linked meter", async () => {
    const building = await createReadyBuilding({
      name: `Usage Delete Mirror Building ${scope}`,
      espmPropertyId: 99100028,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Mirror Delete Electric",
      espmMeterId: 77110028,
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100028,
        meterId: 77110028,
      }),
    );

    const queued = await enqueuePortfolioManagerUsagePush({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    const getConsumptionData = vi
      .fn()
      .mockResolvedValueOnce({
        meterData: {
          meterConsumption: [
            {
              id: 99110028,
              startDate: "2025-01-01",
              endDate: "2025-01-31",
              usage: 271770.3,
              cost: 40765.55,
              estimatedValue: false,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        meterData: {
          meterConsumption: [],
        },
      });
    const pushConsumptionData = vi.fn().mockResolvedValue({});
    const updateConsumptionData = vi.fn().mockResolvedValue({});
    const deleteConsumptionData = vi.fn().mockResolvedValue({});

    const result = await runPortfolioManagerUsageApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      direction: "PUSH_LOCAL_TO_PM",
      reportingYear,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110028 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 77110028,
              type: "Electric",
              name: "Mirror Delete Electric",
              unitOfMeasure: "kWh (thousand Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110028 }] } },
          }),
        },
        consumption: {
          getConsumptionData,
          pushConsumptionData,
          updateConsumptionData,
          deleteConsumptionData,
        },
        metrics: {
          getLatestAvailablePropertyMetrics: vi.fn().mockResolvedValue(null),
          getReasonsForNoScore: vi.fn().mockResolvedValue([]),
        },
      } as never,
    });

    const usageState = await prisma.portfolioManagerUsageState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });
    const usageResult = usageState.lastUsageResultJson as Record<string, number>;

    expect(result.coverageStatus).toBe("NO_USABLE_DATA");
    expect(deleteConsumptionData).toHaveBeenCalledWith(99110028);
    expect(pushConsumptionData).not.toHaveBeenCalled();
    expect(updateConsumptionData).not.toHaveBeenCalled();
    expect(usageResult.readingsDeleted).toBe(1);
  });

  it("runs usage push inline when the background worker is unavailable", async () => {
    const building = await createReadyBuilding({
      name: `Inline Push Building ${scope}`,
      espmPropertyId: 99100027,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Inline Push Electric",
      espmMeterId: 77110027,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "MANUAL",
      months: [1, 2, 3],
    });

    const pushConsumptionData = vi.fn().mockResolvedValue({});
    const updateConsumptionData = vi.fn().mockResolvedValue({});
    const getLatestAvailablePropertyMetrics = vi.fn().mockResolvedValue(fullMetricsPayload);
    const getReasonsForNoScore = vi.fn().mockResolvedValue([]);

    const resolvedClient = createResolvedEspmClient({
      propertyId: 99100027,
      meterId: 77110027,
    }) as {
      meter: Record<string, unknown>;
      consumption?: Record<string, unknown>;
      metrics?: Record<string, unknown>;
    };

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue({
      ...resolvedClient,
      consumption: {
        getConsumptionData: vi.fn().mockResolvedValue({
          meterData: {
            meterConsumption: [],
          },
        }),
        pushConsumptionData,
        updateConsumptionData,
      },
      metrics: {
        getLatestAvailablePropertyMetrics,
        getReasonsForNoScore,
      },
    } as never);

    const result = await requestPortfolioManagerUsagePush({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    expect(result.mode).toBe("inline");
    expect(result.warning).toContain("background worker is unavailable");
    expect(queueAddMock).not.toHaveBeenCalled();
    expect(pushConsumptionData).toHaveBeenCalledTimes(1);
    expect(updateConsumptionData).not.toHaveBeenCalled();
  });

  it("imports PM usage into canonical ESPM_SYNC readings for linked local meters only", async () => {
    const building = await createReadyBuilding({
      name: `Usage Import Building ${scope}`,
      espmPropertyId: 99100002,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Import Electric",
      espmMeterId: 77110002,
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100002,
        meterId: 77110002,
      }),
    );

    const queued = await enqueuePortfolioManagerUsageImport({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    await runPortfolioManagerUsageApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      direction: "IMPORT_PM_TO_LOCAL",
      reportingYear,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110002 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 77110002,
              type: "Electric",
              name: "Import Electric",
              unitOfMeasure: "kWh (thousand Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110002 }] } },
          }),
        },
        consumption: {
          getConsumptionData: vi.fn().mockResolvedValue({
            meterData: {
              meterConsumption: Array.from({ length: 12 }, (_, index) => ({
                id: 8800 + index,
                startDate: new Date(Date.UTC(reportingYear, index, 1)).toISOString(),
                endDate: new Date(Date.UTC(reportingYear, index + 1, 0)).toISOString(),
                usage: 1100 + index,
                cost: 120 + index,
                estimatedValue: false,
              })),
            },
          }),
        },
        metrics: {
          getLatestAvailablePropertyMetrics: vi.fn().mockResolvedValue({
            ...fullMetricsPayload,
            propertyId: 99100002,
          }),
          getReasonsForNoScore: vi.fn().mockResolvedValue([]),
        },
      } as never,
    });

    const importedReadings = await prisma.energyReading.findMany({
      where: {
        buildingId: building.id,
        meterId: meter.id,
        source: "ESPM_SYNC",
      },
    });
    const usageState = await prisma.portfolioManagerUsageState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });

    expect(importedReadings).toHaveLength(12);
    expect(usageState.lastRunDirection).toBe("IMPORT_PM_TO_LOCAL");
    expect(usageState.coverageStatus).toBe("READY_FOR_METRICS");
    expect(usageState.metricsStatus).toBe("SUCCEEDED");
  });

  it("archives newer local rows and replaces them with authoritative PM readings on import", async () => {
    const building = await createReadyBuilding({
      name: `Same Period Conflict ${scope}`,
      espmPropertyId: 99100007,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Conflict Electric",
      espmMeterId: 77110007,
    });
    const periodStart = new Date(Date.UTC(reportingYear, 0, 1));
    const periodEnd = new Date(Date.UTC(reportingYear, 0, 31));

    const staleSync = await prisma.energyReading.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        meterId: meter.id,
        meterType: "ELECTRIC",
        source: "ESPM_SYNC",
        periodStart,
        periodEnd,
        consumption: 800,
        unit: "KWH",
        consumptionKbtu: 2729.6,
        cost: 80,
        isVerified: true,
        rawPayload: { marker: "stale-sync" },
        ingestedAt: new Date(Date.UTC(reportingYear, 1, 1)),
      },
    });

    await prisma.energyReading.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        meterId: meter.id,
        meterType: "ELECTRIC",
        source: "MANUAL",
        periodStart,
        periodEnd,
        consumption: 1200,
        unit: "KWH",
        consumptionKbtu: 4094.4,
        cost: 120,
        isVerified: true,
        rawPayload: { marker: "governed-local" },
        ingestedAt: new Date(Date.UTC(reportingYear, 2, 1)),
      },
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100007,
        meterId: 77110007,
      }),
    );

    const queued = await enqueuePortfolioManagerUsageImport({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    await runPortfolioManagerUsageApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      direction: "IMPORT_PM_TO_LOCAL",
      reportingYear,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110007 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 77110007,
              type: "Electric",
              name: "Conflict Electric",
              unitOfMeasure: "kWh (thousand Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110007 }] } },
          }),
        },
        consumption: {
          getConsumptionData: vi.fn().mockResolvedValue({
            meterData: {
              meterConsumption: [
                {
                  id: 88007,
                  startDate: periodStart.toISOString(),
                  endDate: periodEnd.toISOString(),
                  usage: 1500,
                  cost: 150,
                  estimatedValue: false,
                },
              ],
            },
          }),
        },
        metrics: {
          getLatestAvailablePropertyMetrics: vi.fn().mockResolvedValue(null),
          getReasonsForNoScore: vi.fn().mockResolvedValue([]),
        },
      } as never,
    });

    const staleSyncAfter = await prisma.energyReading.findUniqueOrThrow({
      where: { id: staleSync.id },
    });
    const manualAfter = await prisma.energyReading.findFirstOrThrow({
      where: {
        buildingId: building.id,
        meterId: meter.id,
        source: "MANUAL",
      },
    });
    const usageState = await prisma.portfolioManagerUsageState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });
    const usageResult = usageState.lastUsageResultJson as Record<string, number>;

    expect(staleSyncAfter.consumption).toBe(1500);
    expect(staleSyncAfter.archivedAt).toBeNull();
    expect(manualAfter.archivedAt).not.toBeNull();
    expect(usageResult.readingsUpdated).toBe(1);
    expect(usageResult.readingsArchived).toBe(1);
  });

  it("converts remote MWh electric usage into local canonical KWH readings on import", async () => {
    const building = await createReadyBuilding({
      name: `MWh Import Building ${scope}`,
      espmPropertyId: 99100012,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "MWh Electric",
      espmMeterId: 77110012,
      unit: "KWH",
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100012,
        meterId: 77110012,
        rawUnitOfMeasure: "MWh (million Watt-hours)",
      }),
    );

    const queued = await enqueuePortfolioManagerUsageImport({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    await runPortfolioManagerUsageApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      direction: "IMPORT_PM_TO_LOCAL",
      reportingYear,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110012 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 77110012,
              type: "Electric",
              name: "MWh Electric",
              unitOfMeasure: "MWh (million Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110012 }] } },
          }),
        },
        consumption: {
          getConsumptionData: vi.fn().mockResolvedValue({
            meterData: {
              meterConsumption: [
                {
                  id: 99001,
                  startDate: new Date(Date.UTC(reportingYear, 0, 1)).toISOString(),
                  endDate: new Date(Date.UTC(reportingYear, 0, 31)).toISOString(),
                  usage: 2,
                  cost: 50,
                  estimatedValue: false,
                },
              ],
            },
          }),
        },
        metrics: {
          getLatestAvailablePropertyMetrics: vi.fn().mockResolvedValue(null),
          getReasonsForNoScore: vi.fn().mockResolvedValue([]),
        },
      } as never,
    });

    const imported = await prisma.energyReading.findFirstOrThrow({
      where: {
        buildingId: building.id,
        meterId: meter.id,
        source: "ESPM_SYNC",
      },
    });

    expect(imported.consumption).toBeCloseTo(2000, 6);
    expect(imported.unit).toBe("KWH");
    expect(imported.consumptionKbtu).toBeCloseTo(6824, 6);
  });

  it("converts local canonical KWH readings into exact remote MWh usage on push", async () => {
    const building = await createReadyBuilding({
      name: `MWh Push Building ${scope}`,
      espmPropertyId: 99100013,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Push MWh Electric",
      espmMeterId: 77110013,
      unit: "KWH",
    });

    await prisma.energyReading.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        meterId: meter.id,
        meterType: "ELECTRIC",
        source: "MANUAL",
        periodStart: new Date(Date.UTC(reportingYear, 0, 1)),
        periodEnd: new Date(Date.UTC(reportingYear, 0, 31)),
        consumption: 2000,
        unit: "KWH",
        consumptionKbtu: 6824,
        cost: 50,
        isVerified: true,
      },
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100013,
        meterId: 77110013,
        rawUnitOfMeasure: "MWh (million Watt-hours)",
      }),
    );

    const queued = await enqueuePortfolioManagerUsagePush({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    const pushConsumptionData = vi.fn().mockResolvedValue({});
    await runPortfolioManagerUsageApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      direction: "PUSH_LOCAL_TO_PM",
      reportingYear,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110013 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 77110013,
              type: "Electric",
              name: "Push MWh Electric",
              unitOfMeasure: "MWh (million Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110013 }] } },
          }),
        },
        consumption: {
          getConsumptionData: vi.fn().mockResolvedValue({
            meterData: { meterConsumption: [] },
          }),
          pushConsumptionData,
          updateConsumptionData: vi.fn().mockResolvedValue({}),
        },
        metrics: {
          getLatestAvailablePropertyMetrics: vi.fn().mockResolvedValue(null),
          getReasonsForNoScore: vi.fn().mockResolvedValue([]),
        },
      } as never,
    });

    expect(pushConsumptionData).toHaveBeenCalledWith(
      77110013,
      expect.arrayContaining([
        expect.objectContaining({
          usage: 2,
        }),
      ]),
    );
  });

  it("converts supported gas Ccf units safely during import", async () => {
    const building = await createReadyBuilding({
      name: `Gas Ccf Import ${scope}`,
      espmPropertyId: 99100014,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Gas Ccf",
      meterType: "GAS",
      unit: "THERMS",
      espmMeterId: 77110014,
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100014,
        meterId: 77110014,
        rawType: "Natural Gas",
        rawUnitOfMeasure: "Ccf (hundred cubic feet)",
      }),
    );

    const queued = await enqueuePortfolioManagerUsageImport({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    await runPortfolioManagerUsageApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      direction: "IMPORT_PM_TO_LOCAL",
      reportingYear,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110014 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 77110014,
              type: "Natural Gas",
              name: "Gas Ccf",
              unitOfMeasure: "Ccf (hundred cubic feet)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110014 }] } },
          }),
        },
        consumption: {
          getConsumptionData: vi.fn().mockResolvedValue({
            meterData: {
              meterConsumption: [
                {
                  id: 99014,
                  startDate: new Date(Date.UTC(reportingYear, 0, 1)).toISOString(),
                  endDate: new Date(Date.UTC(reportingYear, 0, 31)).toISOString(),
                  usage: 10,
                  cost: 50,
                  estimatedValue: false,
                },
              ],
            },
          }),
        },
        metrics: {
          getLatestAvailablePropertyMetrics: vi.fn().mockResolvedValue(null),
          getReasonsForNoScore: vi.fn().mockResolvedValue([]),
        },
      } as never,
    });

    const imported = await prisma.energyReading.findFirstOrThrow({
      where: {
        buildingId: building.id,
        meterId: meter.id,
        source: "ESPM_SYNC",
      },
    });

    expect(imported.consumption).toBeCloseTo(10.26, 6);
    expect(imported.unit).toBe("THERMS");
    expect(imported.consumptionKbtu).toBeCloseTo(1026, 6);
  });

  it("blocks usage when the remote PM unit cannot be converted safely", async () => {
    const building = await createReadyBuilding({
      name: `Unsupported Unit Usage ${scope}`,
      espmPropertyId: 99100015,
    });
    await createLinkedMeter({
      buildingId: building.id,
      name: "Unsupported Steam",
      meterType: "STEAM",
      unit: "MMBTU",
      espmMeterId: 77110015,
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue(
      createResolvedEspmClient({
        propertyId: 99100015,
        meterId: 77110015,
        rawType: "District Steam",
        rawUnitOfMeasure: "Gallons",
      }),
    );

    const usageStatus = await getPortfolioManagerUsageStatusForBuilding({
      organizationId: org.id,
      buildingId: building.id,
    });

    expect(usageStatus.pushReadiness.canPush).toBe(false);
    expect(usageStatus.pushReadiness.blockers[0]).toContain("cannot be converted safely");
  });

  it("returns a blocked usage status instead of throwing when PM association lookup fails", async () => {
    const building = await createReadyBuilding({
      name: `Association Status Failure ${scope}`,
      espmPropertyId: 99100020,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Association Status Electric",
      espmMeterId: 77110020,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "MANUAL",
      months: [1, 2, 3],
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue({
      meter: {
        listMeters: vi.fn().mockResolvedValue({
          response: { links: { link: [{ "@_id": 77110020 }] } },
        }),
        getMeter: vi.fn().mockResolvedValue({
          meter: {
            "@_id": 77110020,
            type: "Electric",
            name: "Association Status Electric",
            unitOfMeasure: "kWh (thousand Watt-hours)",
            metered: true,
            inUse: true,
          },
        }),
        listPropertyMeterAssociations: vi
          .fn()
          .mockRejectedValue(new Error("Association service unavailable")),
      },
    } as never);

    const usageStatus = await getPortfolioManagerUsageStatusForBuilding({
      organizationId: org.id,
      buildingId: building.id,
    });

    expect(usageStatus).toBeTruthy();
    expect(usageStatus.pushReadiness.canPush).toBe(false);
    expect(usageStatus.usageState.canImport).toBe(false);
    expect(usageStatus.pushReadiness.blockers).toContain(
      "Quoin could not validate this property's Portfolio Manager meter associations right now. Retry usage after association access is restored.",
    );
    expect(usageStatus.usageState.summaryLine).toContain(
      "Portfolio Manager meter associations right now",
    );
  });

  it("marks coverage partial and skips metrics refresh when monthly data is incomplete", async () => {
    const building = await createReadyBuilding({
      name: `Usage Partial Building ${scope}`,
      espmPropertyId: 99100003,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Partial Electric",
      espmMeterId: 77110003,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "MANUAL",
      months: [1, 2, 3, 4, 5, 6],
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100003,
        meterId: 77110003,
      }),
    );

    const getLatestAvailablePropertyMetrics = vi.fn();
    const getConsumptionData = vi
      .fn()
      .mockResolvedValueOnce({
        meterData: {
          meterConsumption: [],
        },
      })
      .mockResolvedValueOnce({
        meterData: {
          meterConsumption: buildMonthlyConsumptionRows({
            months: [1, 2, 3, 4, 5, 6],
          }),
        },
      });

    const queued = await enqueuePortfolioManagerUsagePush({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    const result = await runPortfolioManagerUsageApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      direction: "PUSH_LOCAL_TO_PM",
      reportingYear,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110003 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 77110003,
              type: "Electric",
              name: "Partial Electric",
              unitOfMeasure: "kWh (thousand Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110003 }] } },
          }),
        },
        consumption: {
          getConsumptionData,
          pushConsumptionData: vi.fn().mockResolvedValue({}),
          updateConsumptionData: vi.fn().mockResolvedValue({}),
          deleteConsumptionData: vi.fn().mockResolvedValue({}),
        },
        metrics: {
          getLatestAvailablePropertyMetrics,
          getReasonsForNoScore: vi.fn(),
        },
      } as never,
    });

    const usageState = await prisma.portfolioManagerUsageState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });
    const setupState = await prisma.portfolioManagerSetupState.findUniqueOrThrow({
      where: { buildingId: building.id },
    });

    expect(result.coverageStatus).toBe("PARTIAL_COVERAGE");
    expect(usageState.overallStatus).toBe("PARTIAL");
    expect(usageState.metricsStatus).toBe("SKIPPED");
    expect(getLatestAvailablePropertyMetrics).not.toHaveBeenCalled();
    expect(setupState.usageCoverageStatus).toBe("INPUT_REQUIRED");
  });

  it("fetches all PM consumption pages during import when a meter has more than 120 records", async () => {
    const building = await createReadyBuilding({
      name: `Paged Import Building ${scope}`,
      espmPropertyId: 99100016,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Paged Import Electric",
      espmMeterId: 77110016,
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100016,
        meterId: 77110016,
      }),
    );

    const queued = await enqueuePortfolioManagerUsageImport({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    const pageOne = Array.from({ length: 120 }, (_, index) => ({
      id: 880000 + index,
      startDate: new Date(Date.UTC(reportingYear, 0, index + 1)).toISOString(),
      endDate: new Date(Date.UTC(reportingYear, 0, index + 1)).toISOString(),
      usage: 100 + index,
      cost: 20 + index,
      estimatedValue: false,
    }));
    const pageTwo = [
      {
        id: 880120,
        startDate: new Date(Date.UTC(reportingYear, 4, 1)).toISOString(),
        endDate: new Date(Date.UTC(reportingYear, 4, 1)).toISOString(),
        usage: 500,
        cost: 40,
        estimatedValue: false,
      },
    ];
    const getConsumptionData = vi
      .fn()
      .mockResolvedValueOnce({ meterData: { meterConsumption: pageOne } })
      .mockResolvedValueOnce({ meterData: { meterConsumption: pageTwo } });

    await runPortfolioManagerUsageApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      direction: "IMPORT_PM_TO_LOCAL",
      reportingYear,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110016 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 77110016,
              type: "Electric",
              name: "Paged Import Electric",
              unitOfMeasure: "kWh (thousand Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110016 }] } },
          }),
        },
        consumption: {
          getConsumptionData,
        },
        metrics: {
          getLatestAvailablePropertyMetrics: vi.fn().mockResolvedValue(null),
          getReasonsForNoScore: vi.fn().mockResolvedValue([]),
        },
      } as never,
    });

    expect(getConsumptionData).toHaveBeenCalledTimes(2);
    const importedCount = await prisma.energyReading.count({
      where: {
        buildingId: building.id,
        meterId: meter.id,
        source: "ESPM_SYNC",
      },
    });
    expect(importedCount).toBe(121);
  });

  it("uses all remote consumption pages before deciding whether PM periods already exist", async () => {
    const building = await createReadyBuilding({
      name: `Paged Push Building ${scope}`,
      espmPropertyId: 99100017,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Paged Push Electric",
      espmMeterId: 77110017,
    });

    await seedDailyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "MANUAL",
      count: 121,
      usageBase: 200,
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100017,
        meterId: 77110017,
      }),
    );

    const queued = await enqueuePortfolioManagerUsagePush({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    const existingPeriods = Array.from({ length: 121 }, (_, index) => ({
      id: 990000 + index,
      startDate: new Date(Date.UTC(reportingYear, 0, index + 1)).toISOString(),
      endDate: new Date(Date.UTC(reportingYear, 0, index + 1)).toISOString(),
      usage: 200 + index,
      cost: 10 + index,
      estimatedValue: false,
    }));
    const getConsumptionData = vi
      .fn()
      .mockResolvedValueOnce({ meterData: { meterConsumption: existingPeriods.slice(0, 120) } })
      .mockResolvedValueOnce({ meterData: { meterConsumption: existingPeriods.slice(120) } })
      .mockResolvedValueOnce({ meterData: { meterConsumption: existingPeriods.slice(0, 120) } })
      .mockResolvedValueOnce({ meterData: { meterConsumption: existingPeriods.slice(120) } });
    const pushConsumptionData = vi.fn().mockResolvedValue({});
    const updateConsumptionData = vi.fn().mockResolvedValue({});
    const deleteConsumptionData = vi.fn().mockResolvedValue({});

    await runPortfolioManagerUsageApply({
      organizationId: org.id,
      buildingId: building.id,
      operationalJobId: queued.operationalJobId,
      direction: "PUSH_LOCAL_TO_PM",
      reportingYear,
      espmClient: {
        meter: {
          listMeters: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110017 }] } },
          }),
          getMeter: vi.fn().mockResolvedValue({
            meter: {
              "@_id": 77110017,
              type: "Electric",
              name: "Paged Push Electric",
              unitOfMeasure: "kWh (thousand Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
          listPropertyMeterAssociations: vi.fn().mockResolvedValue({
            response: { links: { link: [{ "@_id": 77110017 }] } },
          }),
        },
        consumption: {
          getConsumptionData,
          pushConsumptionData,
          updateConsumptionData,
          deleteConsumptionData,
        },
        metrics: {
          getLatestAvailablePropertyMetrics: vi.fn().mockResolvedValue(null),
          getReasonsForNoScore: vi.fn().mockResolvedValue([]),
        },
      } as never,
    });

    expect(getConsumptionData).toHaveBeenCalledTimes(4);
    expect(pushConsumptionData).not.toHaveBeenCalled();
    expect(updateConsumptionData).not.toHaveBeenCalled();
    expect(deleteConsumptionData).not.toHaveBeenCalled();
  });

  it("blocks usage when PM setup prerequisites are not yet applied", async () => {
    const building = await createReadyBuilding({
      name: `Usage Blocked Building ${scope}`,
      propertyUsesStatus: "READY_TO_APPLY",
      metersStatus: "APPLIED",
      associationsStatus: "APPLIED",
      espmPropertyId: 99100004,
    });
    await createLinkedMeter({
      buildingId: building.id,
      name: "Blocked Electric",
      espmMeterId: 77110004,
    });

    await expect(
      enqueuePortfolioManagerUsagePush({
        organizationId: org.id,
        buildingId: building.id,
        actorType: "SYSTEM",
        reportingYear,
      }),
    ).rejects.toThrow("Apply Portfolio Manager property uses before usage.");
  });

  it("blocks push when source reconciliation is conflicted", async () => {
    const building = await createReadyBuilding({
      name: `Usage Conflict Building ${scope}`,
      espmPropertyId: 99100005,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Conflicted Electric",
      espmMeterId: 77110005,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "ESPM_SYNC",
      months: [1, 2, 3, 4, 5, 6],
    });

    for (const month of [1, 2, 3, 4, 5, 6]) {
      const periodStart = new Date(Date.UTC(reportingYear, month - 1, 1));
      const periodEnd = new Date(Date.UTC(reportingYear, month, 0));
      await prisma.energyReading.create({
        data: {
          organizationId: org.id,
          buildingId: building.id,
          meterId: meter.id,
          meterType: "ELECTRIC",
          source: "GREEN_BUTTON",
          periodStart,
          periodEnd,
          consumption: 5000 + month,
          unit: "KWH",
          consumptionKbtu: 17000 + month,
          cost: 200 + month,
          isVerified: true,
          rawPayload: {
            subscriptionId: "gb-subscription-1",
          },
        },
      });
    }

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue(
      createResolvedEspmClient({
        propertyId: 99100005,
        meterId: 77110005,
      }),
    );

    const usageStatus = await getPortfolioManagerUsageStatusForBuilding({
      organizationId: org.id,
      buildingId: building.id,
    });

    expect(usageStatus.pushReadiness.canPush).toBe(false);
    expect(usageStatus.pushReadiness.reconciliationStatus).toBe("CONFLICTED");
    expect(usageStatus.pushReadiness.blockers).toContain(
      "Source reconciliation is conflicted for this reporting year. Resolve local source conflicts before pushing to Portfolio Manager.",
    );

    await expect(
      enqueuePortfolioManagerUsagePush({
        organizationId: org.id,
        buildingId: building.id,
        actorType: "SYSTEM",
        reportingYear,
      }),
    ).rejects.toThrow("Source reconciliation is conflicted for this reporting year.");
  });

  it("blocks readiness and queueing when a linked PM meter is no longer associated to the property", async () => {
    const building = await createReadyBuilding({
      name: `Association Drift Building ${scope}`,
      espmPropertyId: 99100018,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Drifted Electric",
      espmMeterId: 77110018,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "MANUAL",
      months: [1, 2, 3],
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue({
      meter: {
        listMeters: vi.fn().mockResolvedValue({
          response: { links: { link: [{ "@_id": 77110018 }] } },
        }),
        getMeter: vi.fn().mockResolvedValue({
          meter: {
            "@_id": 77110018,
            type: "Electric",
            name: "Drifted Electric",
            unitOfMeasure: "kWh (thousand Watt-hours)",
            metered: true,
            inUse: true,
          },
        }),
        listPropertyMeterAssociations: vi.fn().mockResolvedValue({
          response: { links: { link: [] } },
        }),
      },
    } as never);

    const usageStatus = await getPortfolioManagerUsageStatusForBuilding({
      organizationId: org.id,
      buildingId: building.id,
    });

    expect(usageStatus.pushReadiness.canPush).toBe(false);
    expect(usageStatus.pushReadiness.blockers).toContain(
      "PM association drift detected for linked meter Drifted Electric. Re-apply PM associations before usage.",
    );

    await expect(
      enqueuePortfolioManagerUsagePush({
        organizationId: org.id,
        buildingId: building.id,
        actorType: "SYSTEM",
        reportingYear,
      }),
    ).rejects.toThrow("PM association drift detected for linked meter Drifted Electric");
  });

  it("blocks queueing safely when PM association lookup fails", async () => {
    const building = await createReadyBuilding({
      name: `Association Queue Failure ${scope}`,
      espmPropertyId: 99100021,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Association Queue Electric",
      espmMeterId: 77110021,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "MANUAL",
      months: [1, 2, 3],
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue({
      meter: {
        listMeters: vi.fn().mockResolvedValue({
          response: { links: { link: [{ "@_id": 77110021 }] } },
        }),
        getMeter: vi.fn().mockResolvedValue({
          meter: {
            "@_id": 77110021,
            type: "Electric",
            name: "Association Queue Electric",
            unitOfMeasure: "kWh (thousand Watt-hours)",
            metered: true,
            inUse: true,
          },
        }),
        listPropertyMeterAssociations: vi
          .fn()
          .mockRejectedValue(new Error("Association service unavailable")),
      },
    } as never);

    await expect(
      enqueuePortfolioManagerUsagePush({
        organizationId: org.id,
        buildingId: building.id,
        actorType: "SYSTEM",
        reportingYear,
      }),
    ).rejects.toThrow(
      "Quoin could not validate this property's Portfolio Manager meter associations right now",
    );
  });

  it("blocks run-time usage when PM associations drift after queueing", async () => {
    const building = await createReadyBuilding({
      name: `Run Drift Building ${scope}`,
      espmPropertyId: 99100019,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Run Drift Electric",
      espmMeterId: 77110019,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "MANUAL",
      months: [1, 2, 3],
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100019,
        meterId: 77110019,
      }),
    );

    const queued = await enqueuePortfolioManagerUsagePush({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    await expect(
      runPortfolioManagerUsageApply({
        organizationId: org.id,
        buildingId: building.id,
        operationalJobId: queued.operationalJobId,
        direction: "PUSH_LOCAL_TO_PM",
        reportingYear,
        espmClient: {
          meter: {
            listMeters: vi.fn().mockResolvedValue({
              response: { links: { link: [{ "@_id": 77110019 }] } },
            }),
            getMeter: vi.fn().mockResolvedValue({
              meter: {
                "@_id": 77110019,
                type: "Electric",
                name: "Run Drift Electric",
                unitOfMeasure: "kWh (thousand Watt-hours)",
                metered: true,
                inUse: true,
              },
            }),
            listPropertyMeterAssociations: vi.fn().mockResolvedValue({
              response: { links: { link: [] } },
            }),
          },
          consumption: {
            getConsumptionData: vi.fn().mockResolvedValue({
              meterData: { meterConsumption: [] },
            }),
            pushConsumptionData: vi.fn(),
            updateConsumptionData: vi.fn(),
          },
          metrics: {
            getLatestAvailablePropertyMetrics: vi.fn(),
            getReasonsForNoScore: vi.fn(),
          },
        } as never,
      }),
    ).rejects.toThrow("PM association drift detected for linked meter Run Drift Electric");
  });

  it("blocks runtime usage safely when PM association lookup fails after queueing", async () => {
    const building = await createReadyBuilding({
      name: `Association Runtime Failure ${scope}`,
      espmPropertyId: 99100022,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "Association Runtime Electric",
      espmMeterId: 77110022,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "MANUAL",
      months: [1, 2, 3],
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValueOnce(
      createResolvedEspmClient({
        propertyId: 99100022,
        meterId: 77110022,
      }),
    );

    const queued = await enqueuePortfolioManagerUsagePush({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });

    await expect(
      runPortfolioManagerUsageApply({
        organizationId: org.id,
        buildingId: building.id,
        operationalJobId: queued.operationalJobId,
        direction: "PUSH_LOCAL_TO_PM",
        reportingYear,
        espmClient: {
          meter: {
            listMeters: vi.fn().mockResolvedValue({
              response: { links: { link: [{ "@_id": 77110022 }] } },
            }),
            getMeter: vi.fn().mockResolvedValue({
              meter: {
                "@_id": 77110022,
                type: "Electric",
                name: "Association Runtime Electric",
                unitOfMeasure: "kWh (thousand Watt-hours)",
                metered: true,
                inUse: true,
              },
            }),
            listPropertyMeterAssociations: vi
              .fn()
              .mockRejectedValue(new Error("Association service unavailable")),
          },
          consumption: {
            getConsumptionData: vi.fn().mockResolvedValue({
              meterData: { meterConsumption: [] },
            }),
            pushConsumptionData: vi.fn(),
            updateConsumptionData: vi.fn(),
          },
          metrics: {
            getLatestAvailablePropertyMetrics: vi.fn(),
            getReasonsForNoScore: vi.fn(),
          },
        } as never,
      }),
    ).rejects.toThrow(
      "Quoin could not validate this property's Portfolio Manager meter associations right now",
    );
  });

  it("allows push when the active Quoin dataset only contains PM-synced linked readings", async () => {
    const building = await createReadyBuilding({
      name: `Usage PM Canonical Building ${scope}`,
      espmPropertyId: 99100006,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "PM Canonical Electric",
      espmMeterId: 77110006,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "ESPM_SYNC",
      months: [1, 2, 3, 4, 5, 6],
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue(
      createResolvedEspmClient({
        propertyId: 99100006,
        meterId: 77110006,
      }),
    );

    const usageStatus = await getPortfolioManagerUsageStatusForBuilding({
      organizationId: org.id,
      buildingId: building.id,
    });

    expect(usageStatus.pushReadiness.canPush).toBe(true);
    expect(usageStatus.pushReadiness.status).toBe("READY_WITH_WARNINGS");
    expect(usageStatus.pushReadiness.pushableMeterCount).toBe(1);
    expect(usageStatus.pushReadiness.pushableReadingCount).toBe(6);
    expect(usageStatus.pushReadiness.warnings).toContain(
      "Linked meter PM Canonical Electric still reconciles to Portfolio Manager data, but Quoin will push the latest local readings for this meter.",
    );

    const queued = await enqueuePortfolioManagerUsagePush({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      reportingYear,
    });
    expect(queued.queueName).toBe("portfolio-manager-usage");
  });

  it("allows push readiness when local uploaded readings exist even if PM remains canonical", async () => {
    const building = await createReadyBuilding({
      name: `Usage PM Canonical Local Override ${scope}`,
      espmPropertyId: 99100026,
    });
    const meter = await createLinkedMeter({
      buildingId: building.id,
      name: "PM Canonical Local Electric",
      espmMeterId: 77110026,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: meter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "ESPM_SYNC",
      months: [1, 2, 3, 4, 5, 6],
    });

    for (const month of [10, 11, 12]) {
      const periodStart = new Date(Date.UTC(reportingYear, month - 1, 1));
      const periodEnd = new Date(Date.UTC(reportingYear, month, 0));
      await prisma.energyReading.create({
        data: {
          organizationId: org.id,
          buildingId: building.id,
          meterId: meter.id,
          meterType: "ELECTRIC",
          source: "CSV_UPLOAD",
          periodStart,
          periodEnd,
          consumption: 5000 + month,
          unit: "KWH",
          consumptionKbtu: 17000 + month,
          cost: 200 + month,
          isVerified: true,
        },
      });
    }

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue(
      createResolvedEspmClient({
        propertyId: 99100026,
        meterId: 77110026,
      }),
    );

    const usageStatus = await getPortfolioManagerUsageStatusForBuilding({
      organizationId: org.id,
      buildingId: building.id,
    });

    expect(usageStatus.pushReadiness.canPush).toBe(true);
    expect(usageStatus.pushReadiness.status).toBe("READY_WITH_WARNINGS");
    expect(usageStatus.pushReadiness.pushableMeterCount).toBe(1);
    expect(usageStatus.pushReadiness.pushableReadingCount).toBe(9);
    expect(usageStatus.pushReadiness.warnings).toContain(
      "Linked meter PM Canonical Local Electric still reconciles to Portfolio Manager data, but Quoin will push the latest local readings for this meter.",
    );
  });

  it("returns server-authored push review rows that mirror all active linked-meter readings", async () => {
    const building = await createReadyBuilding({
      name: `Usage Review Building ${scope}`,
      espmPropertyId: 99100023,
    });
    const includedMeter = await createLinkedMeter({
      buildingId: building.id,
      name: "Review Ready Electric",
      espmMeterId: 77110023,
    });
    const excludedMeter = await createLinkedMeter({
      buildingId: building.id,
      name: "Review Synced Electric",
      espmMeterId: 77110024,
    });

    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: includedMeter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "MANUAL",
      months: [1, 2, 3],
    });
    await seedMonthlyReadings({
      buildingId: building.id,
      meterId: excludedMeter.id,
      meterType: "ELECTRIC",
      unit: "KWH",
      source: "ESPM_SYNC",
      months: [1, 2, 3],
    });

    resolvePortfolioManagerClientForOrganizationMock.mockResolvedValue({
      meter: {
        listMeters: vi.fn().mockResolvedValue({
          response: {
            links: {
              link: [{ "@_id": 77110023 }, { "@_id": 77110024 }],
            },
          },
        }),
        getMeter: vi.fn().mockImplementation((meterId: number) =>
          Promise.resolve({
            meter: {
              "@_id": meterId,
              type: "Electric",
              name: meterId === 77110023 ? "Review Ready Electric" : "Review Synced Electric",
              unitOfMeasure: "kWh (thousand Watt-hours)",
              metered: true,
              inUse: true,
            },
          }),
        ),
        listPropertyMeterAssociations: vi.fn().mockResolvedValue({
          response: {
            links: {
              link: [{ "@_id": 77110023 }, { "@_id": 77110024 }],
            },
          },
        }),
      },
    } as never);

    const status = await getPortfolioManagerUsageStatusForBuilding({
      organizationId: org.id,
      buildingId: building.id,
    });

    const includedRow = status.pushReadiness.meterRows.find(
      (row) => row.meterId === includedMeter.id,
    );
    const excludedRow = status.pushReadiness.meterRows.find(
      (row) => row.meterId === excludedMeter.id,
    );

    expect(status.pushReadiness.pushableMeterCount).toBe(2);
    expect(status.pushReadiness.pushableReadingCount).toBe(6);
    expect(includedRow).toMatchObject({
      meterId: includedMeter.id,
      includedInPush: true,
      readingCount: 3,
      espmMeterId: "77110023",
      canonicalSource: "MANUAL",
      reconciliationStatus: "INCOMPLETE",
    });
    expect(includedRow?.reviewNote).toContain("Quoin will mirror 3 active readings");
    expect(includedRow?.firstPeriodStart).toEqual(new Date(Date.UTC(reportingYear, 0, 1)));
    expect(includedRow?.lastPeriodEnd).toEqual(new Date(Date.UTC(reportingYear, 2, 31)));
    expect(excludedRow).toMatchObject({
      meterId: excludedMeter.id,
      includedInPush: true,
      readingCount: 3,
      espmMeterId: "77110024",
      canonicalSource: "PORTFOLIO_MANAGER",
      reconciliationStatus: "CLEAN",
    });
    expect(excludedRow?.blockers).toEqual([]);
    expect(excludedRow?.reviewNote).toContain(
      "Quoin will mirror 3 active readings",
    );
  });
});


