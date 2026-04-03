import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { pushLocalEnergyToPortfolioManager } from "@/server/compliance/portfolio-manager-push";
import { syncPortfolioManagerForBuilding } from "@/server/compliance/portfolio-manager-sync";
import { prisma } from "@/server/lib/db";
import { appRouter } from "@/server/trpc/routers";

function monthConsumptions() {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const monthStart = new Date(Date.UTC(2025, index, 1));
    const monthEnd = new Date(Date.UTC(2025, month, 0));

    return {
      startDate: monthStart.toISOString().slice(0, 10),
      endDate: monthEnd.toISOString().slice(0, 10),
      usage: 10000 + index * 250,
    };
  });
}

type LegacyBenchmarkCompatibilitySyncClient = Parameters<
  typeof syncPortfolioManagerForBuilding
>[0]["espmClient"];

type LegacyBenchmarkCompatibilityPushClient = Parameters<
  typeof pushLocalEnergyToPortfolioManager
>[0]["espmClient"];

describe("Legacy Portfolio Manager benchmark compatibility", () => {
  const scope = `${Date.now()}`;
  const freshDqcCheckedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const benchmarkingApplicabilityBands = [
    {
      ownershipType: "PRIVATE" as const,
      minimumGrossSquareFeet: 10000,
      maximumGrossSquareFeet: 24999,
      label: "PRIVATE_10K_TO_24_999",
      verificationYears: [2027],
      verificationCadenceYears: 6,
      deadlineType: "MAY_1_FOLLOWING_YEAR" as const,
    },
    {
      ownershipType: "PRIVATE" as const,
      minimumGrossSquareFeet: 25000,
      maximumGrossSquareFeet: 49999,
      label: "PRIVATE_25K_TO_49_999",
      verificationYears: [2024, 2027],
      verificationCadenceYears: 6,
      deadlineType: "MAY_1_FOLLOWING_YEAR" as const,
    },
    {
      ownershipType: "PRIVATE" as const,
      minimumGrossSquareFeet: 50000,
      label: "PRIVATE_50K_PLUS",
      verificationYears: [2024, 2027],
      verificationCadenceYears: 6,
      deadlineType: "MAY_1_FOLLOWING_YEAR" as const,
    },
    {
      ownershipType: "DISTRICT" as const,
      minimumGrossSquareFeet: 10000,
      label: "DISTRICT_10K_PLUS",
      deadlineType: "WITHIN_DAYS_OF_BENCHMARK_GENERATION" as const,
      deadlineDaysFromGeneration: 60,
      manualSubmissionAllowedWhenNotBenchmarkable: true,
    },
  ];

  let orgA: { id: string };
  let orgB: { id: string };
  let userA: { id: string; authUserId: string };
  let userB: { id: string; authUserId: string };
  let buildingReady: { id: string };
  let buildingFailure: { id: string };
  let buildingQa: { id: string };
  let buildingPush: { id: string };

  beforeAll(async () => {
    const sourceArtifact = await prisma.sourceArtifact.create({
      data: {
        artifactType: "LAW",
        name: `PM benchmark compatibility source ${scope}`,
        externalUrl: "https://example.com/pm-sync-test",
        metadata: { scope },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

    const guidanceArtifact = await prisma.sourceArtifact.create({
      data: {
        artifactType: "GUIDE",
        name: `PM benchmark compatibility guidance ${scope}`,
        externalUrl: "https://example.com/pm-sync-guidance-test",
        metadata: { scope },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

    const rulePackage = await prisma.rulePackage.upsert({
      where: { key: "DC_BENCHMARKING_2025" },
      update: {
        name: "DC Benchmarking Annual Submission Workflow",
      },
      create: {
        key: "DC_BENCHMARKING_2025",
        name: "DC Benchmarking Annual Submission Workflow",
      },
    });

    await prisma.ruleVersion.upsert({
      where: {
        rulePackageId_version: {
          rulePackageId: rulePackage.id,
          version: "test-v1",
        },
      },
      update: {
        sourceArtifactId: sourceArtifact.id,
        status: "ACTIVE",
        implementationKey: "benchmarking/readiness-v1",
        configJson: {
          requirements: {
            propertyIdPattern: "^RPUID-[0-9]{6}$",
            dqcFreshnessDays: 30,
            verification: {
              minimumGrossSquareFeet: 50000,
              requiredReportingYears: [2025],
              evidenceKind: "VERIFICATION",
            },
            gfaCorrection: {
              evidenceKind: "GFA_CORRECTION",
            },
          },
        },
      },
      create: {
        rulePackageId: rulePackage.id,
        sourceArtifactId: sourceArtifact.id,
        version: "test-v1",
        status: "ACTIVE",
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        implementationKey: "benchmarking/readiness-v1",
        configJson: {
          requirements: {
            propertyIdPattern: "^RPUID-[0-9]{6}$",
            dqcFreshnessDays: 30,
            verification: {
              minimumGrossSquareFeet: 50000,
              requiredReportingYears: [2025],
              evidenceKind: "VERIFICATION",
            },
            gfaCorrection: {
              evidenceKind: "GFA_CORRECTION",
            },
          },
        },
      },
    });

    await prisma.factorSetVersion.upsert({
      where: {
        key_version: {
          key: "DC_CURRENT_STANDARDS",
          version: "test-v1",
        },
      },
      update: {
        sourceArtifactId: guidanceArtifact.id,
        status: "ACTIVE",
        factorsJson: {
          benchmarking: {
            dqcFreshnessDays: 30,
            applicabilityBands: benchmarkingApplicabilityBands,
          },
        },
      },
      create: {
        key: "DC_CURRENT_STANDARDS",
        version: "test-v1",
        status: "ACTIVE",
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        sourceArtifactId: guidanceArtifact.id,
        factorsJson: {
          benchmarking: {
            dqcFreshnessDays: 30,
            applicabilityBands: benchmarkingApplicabilityBands,
          },
        },
      },
    });

    orgA = await prisma.organization.create({
      data: {
        name: `PM Benchmark Compatibility Org A ${scope}`,
        slug: `pm-sync-org-a-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    orgB = await prisma.organization.create({
      data: {
        name: `PM Benchmark Compatibility Org B ${scope}`,
        slug: `pm-sync-org-b-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    userA = await prisma.user.create({
      data: {
        authUserId: `supabase_pm_sync_user_a_${scope}`,
        email: `pm_sync_a_${scope}@test.com`,
        name: "PM Benchmark Compatibility User A",
      },
      select: { id: true, authUserId: true },
    });

    userB = await prisma.user.create({
      data: {
        authUserId: `supabase_pm_sync_user_b_${scope}`,
        email: `pm_sync_b_${scope}@test.com`,
        name: "PM Benchmark Compatibility User B",
      },
      select: { id: true, authUserId: true },
    });

    await prisma.organizationMembership.createMany({
      data: [
        {
          organizationId: orgA.id,
          userId: userA.id,
          role: "ADMIN",
        },
        {
          organizationId: orgB.id,
          userId: userB.id,
          role: "ADMIN",
        },
      ],
    });

    buildingReady = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `PM Ready Building ${scope}`,
        address: "100 Ready Ave NW, Washington, DC 20001",
        latitude: 38.9,
        longitude: -77.03,
        grossSquareFeet: 40000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        yearBuilt: 2001,
        bepsTargetScore: 71,
        maxPenaltyExposure: 0,
        doeeBuildingId: "RPUID-123456",
        espmPropertyId: BigInt(111111),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    buildingFailure = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `PM Failure Building ${scope}`,
        address: "200 Failure Ave NW, Washington, DC 20001",
        latitude: 38.91,
        longitude: -77.02,
        grossSquareFeet: 42000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        yearBuilt: 2004,
        bepsTargetScore: 71,
        maxPenaltyExposure: 0,
        doeeBuildingId: "RPUID-654321",
        espmPropertyId: BigInt(222222),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    buildingQa = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `PM QA Building ${scope}`,
        address: "300 QA Ave NW, Washington, DC 20001",
        latitude: 38.92,
        longitude: -77.01,
        grossSquareFeet: 35000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        yearBuilt: 1998,
        bepsTargetScore: 71,
        maxPenaltyExposure: 0,
        doeeBuildingId: "RPUID-777777",
        espmPropertyId: BigInt(333333),
        espmShareStatus: "UNLINKED",
      },
      select: { id: true },
    });

    buildingPush = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `PM Push Building ${scope}`,
        address: "400 Push Ave NW, Washington, DC 20001",
        latitude: 38.925,
        longitude: -77.015,
        grossSquareFeet: 28000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        yearBuilt: 2005,
        bepsTargetScore: 71,
        maxPenaltyExposure: 0,
        doeeBuildingId: "RPUID-888888",
        espmPropertyId: BigInt(444444),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    await prisma.evidenceArtifact.create({
      data: {
        organizationId: orgA.id,
        buildingId: buildingReady.id,
        artifactType: "PM_REPORT",
        name: `Fresh DQC ${scope}`,
        artifactRef: `dqc:${scope}`,
        metadata: {
          benchmarking: {
            kind: "DQC_REPORT",
            reportingYear: 2025,
            checkedAt: freshDqcCheckedAt,
          },
        },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });
  });

  afterAll(async () => {
    await prisma.meterSourceReconciliation.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.buildingSourceReconciliation.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.greenButtonConnection.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.dataIssue.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.portfolioManagerSyncState.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.evidenceArtifact.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.benchmarkSubmission.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.complianceRun.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.complianceSnapshot.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.energyReading.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.meter.deleteMany({
      where: {
        buildingId: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.organizationMembership.deleteMany({
      where: {
        organizationId: {
          in: [orgA.id, orgB.id],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [userA.id, userB.id],
        },
      },
    });
    await prisma.building.deleteMany({
      where: {
        id: {
          in: [buildingReady.id, buildingFailure.id, buildingQa.id, buildingPush.id],
        },
      },
    });
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [orgA.id, orgB.id],
        },
      },
    });
    await prisma.sourceArtifact.deleteMany({
      where: {
        name: { contains: scope },
      },
    });
  });

  function createCaller(input: {
    authUserId: string;
    activeOrganizationId: string;
    espmFactory?: () => unknown;
  }) {
    return appRouter.createCaller({
      authUserId: input.authUserId,
      activeOrganizationId: input.activeOrganizationId,
      prisma,
      espmFactory: input.espmFactory as (() => never) | undefined,
    });
  }

  /**
   * Runs the legacy benchmark-compatibility sync directly against the
   * compatibility service instead of the public router.
   */
  async function runLegacyBenchmarkCompatibilitySync(input: {
    organizationId: string;
    buildingId: string;
    reportingYear: number;
    producedById: string;
    espmClient: unknown;
  }) {
    return syncPortfolioManagerForBuilding({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      reportingYear: input.reportingYear,
      espmClient: input.espmClient as LegacyBenchmarkCompatibilitySyncClient,
      producedByType: "USER",
      producedById: input.producedById,
      requestId: null,
    });
  }

  /**
   * Runs the legacy benchmark-compatibility push directly against the
   * compatibility service instead of the public router.
   */
  async function runLegacyBenchmarkCompatibilityPush(input: {
    organizationId: string;
    buildingId: string;
    reportingYear: number;
    producedById: string;
    espmClient: unknown;
  }) {
    return pushLocalEnergyToPortfolioManager({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      reportingYear: input.reportingYear,
      espmClient: input.espmClient as LegacyBenchmarkCompatibilityPushClient,
      producedByType: "USER",
      producedById: input.producedById,
    });
  }

  it("syncs Portfolio Manager data into canonical records and auto-refreshes benchmarking readiness", async () => {
    const successClient = {
      property: {
        getProperty: async () => ({
          property: [
            {
              "@_id": 111111,
              name: "Ready Property",
              primaryFunction: "Office",
              grossFloorArea: { value: 40000 },
              yearBuilt: 2001,
              address: {
                "@_address1": "100 Ready Ave NW",
                "@_city": "Washington",
                "@_state": "DC",
                "@_postalCode": "20001",
              },
            },
          ],
        }),
      },
      meter: {
        listMeters: async () => ({
          response: {
            links: {
              link: [{ "@_id": 2001, "@_link": "/meter/2001" }],
            },
          },
        }),
        getMeter: async () => ({
          meter: [
            {
              "@_id": 2001,
              type: "Electric",
              name: "Main Electric",
              unitOfMeasure: "kWh",
              inUse: true,
            },
          ],
        }),
      },
      consumption: {
        getConsumptionData: async () => ({
          meterData: {
            meterConsumption: monthConsumptions(),
          },
        }),
      },
      metrics: {
        getLatestAvailablePropertyMetrics: async () => ({
          propertyId: 111111,
          year: 2025,
          month: 12,
          score: 82,
          siteTotal: 1200000,
          sourceTotal: 3000000,
          siteIntensity: 60,
          sourceIntensity: 140,
          weatherNormalizedSiteIntensity: 58,
          weatherNormalizedSourceIntensity: 136,
          directGHGEmissions: 0,
          medianScore: 50,
        }),
        getReasonsForNoScore: async () => [],
      },
    };

    const result = await runLegacyBenchmarkCompatibilitySync({
      organizationId: orgA.id,
      buildingId: buildingReady.id,
      reportingYear: 2025,
      producedById: userA.authUserId,
      espmClient: successClient,
    });

    expect(result.syncState.status).toBe("SUCCEEDED");
    expect(result.syncState.attemptCount).toBe(1);
    expect(result.syncState.retryCount).toBe(0);
    expect(result.syncState.latestJobId).toBeTruthy();
    expect(result.syncState.latestErrorCode).toBeNull();
    expect(result.benchmarkSubmission?.status).toBeTruthy();
    expect(result.benchmarkSubmission?.complianceRunId).toBeTruthy();

    const meters = await prisma.meter.findMany({
      where: { buildingId: buildingReady.id },
    });
    expect(meters).toHaveLength(1);
    expect(meters[0]?.espmMeterId?.toString()).toBe("2001");

    const readings = await prisma.energyReading.findMany({
      where: {
        buildingId: buildingReady.id,
        source: "ESPM_SYNC",
      },
    });
    expect(readings).toHaveLength(12);

    const snapshots = await prisma.complianceSnapshot.findMany({
      where: {
        buildingId: buildingReady.id,
        triggerType: "ESPM_SYNC",
      },
    });
    expect(snapshots.length).toBeGreaterThan(0);

    const buildingSourceReconciliation =
      await prisma.buildingSourceReconciliation.findUnique({
        where: { buildingId: buildingReady.id },
      });
    expect(buildingSourceReconciliation).toMatchObject({
      status: "CLEAN",
      canonicalSource: "PORTFOLIO_MANAGER",
      referenceYear: 2025,
    });
  });

  it("does not duplicate meters or ESPM readings on repeat sync", async () => {
    const repeatClient = {
      property: {
        getProperty: async () => ({
          property: [
            {
              "@_id": 111111,
              name: "Ready Property",
              primaryFunction: "Office",
              grossFloorArea: { value: 40000 },
              yearBuilt: 2001,
            },
          ],
        }),
      },
      meter: {
        listMeters: async () => ({
          response: {
            links: {
              link: [{ "@_id": 2001, "@_link": "/meter/2001" }],
            },
          },
        }),
        getMeter: async () => ({
          meter: [
            {
              "@_id": 2001,
              type: "Electric",
              name: "Main Electric",
              unitOfMeasure: "kWh",
              inUse: true,
            },
          ],
        }),
      },
      consumption: {
        getConsumptionData: async () => ({
          meterData: {
            meterConsumption: monthConsumptions(),
          },
        }),
      },
      metrics: {
        getLatestAvailablePropertyMetrics: async () => ({
          propertyId: 111111,
          year: 2025,
          month: 12,
          score: 82,
          siteTotal: 1200000,
          sourceTotal: 3000000,
          siteIntensity: 60,
          sourceIntensity: 140,
          weatherNormalizedSiteIntensity: 58,
          weatherNormalizedSourceIntensity: 136,
          directGHGEmissions: 0,
          medianScore: 50,
        }),
        getReasonsForNoScore: async () => [],
      },
    };

    const meterCountBefore = await prisma.meter.count({
      where: { buildingId: buildingReady.id },
    });
    const readingCountBefore = await prisma.energyReading.count({
      where: { buildingId: buildingReady.id, source: "ESPM_SYNC" },
    });

    const result = await runLegacyBenchmarkCompatibilitySync({
      organizationId: orgA.id,
      buildingId: buildingReady.id,
      reportingYear: 2025,
      producedById: userA.authUserId,
      espmClient: repeatClient,
    });

    const meterCountAfter = await prisma.meter.count({
      where: { buildingId: buildingReady.id },
    });
    const readingCountAfter = await prisma.energyReading.count({
      where: { buildingId: buildingReady.id, source: "ESPM_SYNC" },
    });

    expect(result.syncState.status).toBe("SUCCEEDED");
    expect(meterCountAfter).toBe(meterCountBefore);
    expect(readingCountAfter).toBe(readingCountBefore);
    expect(result.syncState.diagnostics?.readingsUpdated).toBeGreaterThanOrEqual(1);
  });

  it("persists sync failure metadata when Portfolio Manager refresh fails", async () => {
    const failingClient = {
      property: {
        getProperty: async () => {
          throw new Error("ESPM property fetch failed");
        },
      },
      meter: {
        listMeters: async () => ({ response: { links: { link: [] } } }),
        getMeter: async () => ({ meter: {} }),
      },
      consumption: {
        getConsumptionData: async () => ({ meterData: { meterConsumption: [] } }),
      },
      metrics: {
        getLatestAvailablePropertyMetrics: async () => {
          throw new Error("metrics should not run");
        },
        getReasonsForNoScore: async () => [],
      },
    };

    const caller = createCaller({
      authUserId: userA.authUserId,
      activeOrganizationId: orgA.id,
      espmFactory: () => failingClient,
    });

    const result = await runLegacyBenchmarkCompatibilitySync({
      organizationId: orgA.id,
      buildingId: buildingFailure.id,
      reportingYear: 2025,
      producedById: userA.authUserId,
      espmClient: failingClient,
    });

    expect(result.syncState.status).toBe("FAILED");

    const persisted = await caller.benchmarking.getLegacyPortfolioManagerBenchmarkStatus({
      buildingId: buildingFailure.id,
    });
    const errorMetadata = persisted.lastErrorMetadata as Record<string, unknown>;
    const errors = (errorMetadata["errors"] as Array<Record<string, unknown>>) ?? [];
    expect(errors[0]?.["step"]).toBe("property");
    expect(persisted.lastFailedSyncAt).toBeTruthy();
    expect(persisted.latestErrorMessage).toContain("ESPM property fetch failed");
  });

  it("marks malformed property payloads as non-retryable property failures", async () => {
    const malformedClient = {
      property: {
        getProperty: async () => ({}),
      },
      meter: {
        listMeters: async () => ({ response: { links: { link: [] } } }),
        getMeter: async () => ({ meter: {} }),
      },
      consumption: {
        getConsumptionData: async () => ({ meterData: { meterConsumption: [] } }),
      },
      metrics: {
        getLatestAvailablePropertyMetrics: async () => {
          throw new Error("metrics should not run");
        },
        getReasonsForNoScore: async () => [],
      },
    };

    const result = await runLegacyBenchmarkCompatibilitySync({
      organizationId: orgA.id,
      buildingId: buildingFailure.id,
      reportingYear: 2025,
      producedById: userA.authUserId,
      espmClient: malformedClient,
    });

    expect(result.syncState.status).toBe("FAILED");
    expect(result.syncState.diagnostics?.failedStep).toBe("property");
    expect(result.syncState.diagnostics?.retryable).toBe(false);
  });

  it("surfaces malformed meter list payloads as partial sync diagnostics", async () => {
    const meterFailureClient = {
      property: {
        getProperty: async () => ({
          property: [
            {
              "@_id": 222222,
              name: "Failure Property",
              primaryFunction: "Office",
              grossFloorArea: { value: 42000 },
              yearBuilt: 2004,
            },
          ],
        }),
      },
      meter: {
        listMeters: async () => ({
          bogus: true,
        }),
        getMeter: async () => ({ meter: {} }),
      },
      consumption: {
        getConsumptionData: async () => ({ meterData: { meterConsumption: [] } }),
      },
      metrics: {
        getLatestAvailablePropertyMetrics: async () => ({
          propertyId: 222222,
          year: 2025,
          month: 12,
          score: 68,
          siteTotal: 1000000,
          sourceTotal: 2100000,
          siteIntensity: 72,
          sourceIntensity: 151,
          weatherNormalizedSiteIntensity: 70,
          weatherNormalizedSourceIntensity: 148,
          directGHGEmissions: 0,
          medianScore: 50,
        }),
        getReasonsForNoScore: async () => [],
      },
    };

    const result = await runLegacyBenchmarkCompatibilitySync({
      organizationId: orgA.id,
      buildingId: buildingFailure.id,
      reportingYear: 2025,
      producedById: userA.authUserId,
      espmClient: meterFailureClient,
    });

    expect(result.syncState.status).toBe("PARTIAL");
    expect(result.syncState.diagnostics?.failedStep).toBe("meters");
    expect(result.syncState.diagnostics?.retryable).toBe(false);
  });

  it("produces QA findings for missing PM sharing state, missing meters, and coverage gaps", async () => {
    const qaClient = {
      property: {
        getProperty: async () => ({
          property: [
            {
              "@_id": 333333,
              name: "QA Property",
              primaryFunction: "Office",
              grossFloorArea: { value: 35000 },
              yearBuilt: 1998,
            },
          ],
        }),
      },
      meter: {
        listMeters: async () => ({
          response: {
            links: {
              link: [],
            },
          },
        }),
        getMeter: async () => ({ meter: {} }),
      },
      consumption: {
        getConsumptionData: async () => ({ meterData: { meterConsumption: [] } }),
      },
      metrics: {
        getLatestAvailablePropertyMetrics: async () => ({
          propertyId: 333333,
          year: 2025,
          month: 12,
          score: 70,
          siteTotal: 1000000,
          sourceTotal: 2200000,
          siteIntensity: 72,
          sourceIntensity: 160,
          weatherNormalizedSiteIntensity: 70,
          weatherNormalizedSourceIntensity: 155,
          directGHGEmissions: 0,
          medianScore: 50,
        }),
        getReasonsForNoScore: async () => [],
      },
    };

    const caller = createCaller({
      authUserId: userA.authUserId,
      activeOrganizationId: orgA.id,
      espmFactory: () => qaClient,
    });

    const result = await runLegacyBenchmarkCompatibilitySync({
      organizationId: orgA.id,
      buildingId: buildingQa.id,
      reportingYear: 2025,
      producedById: userA.authUserId,
      espmClient: qaClient,
    });

    expect(result.syncState.status).toBe("SUCCEEDED");

    const qaPayload = await caller.benchmarking.getLegacyPortfolioManagerQaFindings({
      buildingId: buildingQa.id,
    });
    const findings = ((qaPayload as Record<string, unknown>)["findings"] as Array<Record<string, unknown>>) ?? [];
    const codes = findings
      .filter((finding) => finding["status"] === "FAIL")
      .map((finding) => finding["code"]);

    expect(codes).toContain("MISSING_PM_SHARING_STATE");
    expect(codes).toContain("MISSING_REQUIRED_METERS");
    expect(codes).toContain("MISSING_COVERAGE");
  });

  it("preserves the last successful sync timestamp when metrics are partial", async () => {
    const partialMetricsClient = {
      property: {
        getProperty: async () => ({
          property: [
            {
              "@_id": 111111,
              name: "Ready Property",
              primaryFunction: "Office",
              grossFloorArea: { value: 40000 },
              yearBuilt: 2001,
            },
          ],
        }),
      },
      meter: {
        listMeters: async () => ({
          response: {
            links: {
              link: [{ "@_id": 2001, "@_link": "/meter/2001" }],
            },
          },
        }),
        getMeter: async () => ({
          meter: [
            {
              "@_id": 2001,
              type: "Electric",
              name: "Main Electric",
              unitOfMeasure: "kWh",
              inUse: true,
            },
          ],
        }),
      },
      consumption: {
        getConsumptionData: async () => ({
          meterData: {
            meterConsumption: monthConsumptions(),
          },
        }),
      },
      metrics: {
        getLatestAvailablePropertyMetrics: async () => ({
          propertyId: 111111,
          year: 2025,
          month: 12,
          score: 82,
          siteTotal: 1200000,
          sourceTotal: 3000000,
          siteIntensity: null,
          sourceIntensity: null,
          weatherNormalizedSiteIntensity: null,
          weatherNormalizedSourceIntensity: null,
          directGHGEmissions: 0,
          medianScore: 50,
        }),
        getReasonsForNoScore: async () => [],
      },
    };

    const before = await prisma.portfolioManagerSyncState.findUnique({
      where: { buildingId: buildingReady.id },
      select: { lastSuccessfulSyncAt: true },
    });

    const result = await runLegacyBenchmarkCompatibilitySync({
      organizationId: orgA.id,
      buildingId: buildingReady.id,
      reportingYear: 2025,
      producedById: userA.authUserId,
      espmClient: partialMetricsClient,
    });

    expect(result.syncState.status).toBe("PARTIAL");
    expect(result.syncState.lastSuccessfulSyncAt?.toISOString()).toBe(
      before?.lastSuccessfulSyncAt?.toISOString(),
    );
    expect(result.syncState.diagnostics?.failedStep).toBe("metrics");
  });

  it("lists benchmark compatibility readiness and enforces tenant isolation", async () => {
    const successClient = {
      property: {
        getProperty: async () => ({
          property: [
            {
              "@_id": 111111,
              name: "Ready Property",
              primaryFunction: "Office",
              grossFloorArea: { value: 40000 },
              yearBuilt: 2001,
            },
          ],
        }),
      },
      meter: {
        listMeters: async () => ({
          response: {
            links: {
              link: [{ "@_id": 2001, "@_link": "/meter/2001" }],
            },
          },
        }),
        getMeter: async () => ({
          meter: [
            {
              "@_id": 2001,
              type: "Electric",
              name: "Main Electric",
              unitOfMeasure: "kWh",
              inUse: true,
            },
          ],
        }),
      },
      consumption: {
        getConsumptionData: async () => ({
          meterData: {
            meterConsumption: monthConsumptions(),
          },
        }),
      },
      metrics: {
        getLatestAvailablePropertyMetrics: async () => ({
          propertyId: 111111,
          year: 2025,
          month: 12,
          score: 82,
          siteTotal: 1200000,
          sourceTotal: 3000000,
          siteIntensity: 60,
          sourceIntensity: 140,
          weatherNormalizedSiteIntensity: 58,
          weatherNormalizedSourceIntensity: 136,
          directGHGEmissions: 0,
          medianScore: 50,
        }),
        getReasonsForNoScore: async () => [],
      },
    };

    const callerA = createCaller({
      authUserId: userA.authUserId,
      activeOrganizationId: orgA.id,
      espmFactory: () => successClient,
    });
    const callerB = createCaller({
      authUserId: userB.authUserId,
      activeOrganizationId: orgB.id,
    });

    await runLegacyBenchmarkCompatibilitySync({
      organizationId: orgA.id,
      buildingId: buildingReady.id,
      reportingYear: 2025,
      producedById: userA.authUserId,
      espmClient: successClient,
    });

    const portfolio = await callerA.benchmarking.listLegacyPortfolioBenchmarkReadiness({
      reportingYear: 2025,
      limit: 10,
    });
    const readyEntry = portfolio.find(
      (entry) => (entry.building as { id: string }).id === buildingReady.id,
    );
    expect(readyEntry).toBeTruthy();
    expect(readyEntry?.syncState?.status).toBe("SUCCEEDED");
    expect(readyEntry?.benchmarkSubmission).toBeTruthy();

    await expect(
      callerB.benchmarking.getLegacyPortfolioManagerBenchmarkStatus({
        buildingId: buildingReady.id,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("recovers cleanly after a failed sync retry without corrupting imported data", async () => {
    const recoveryClient = {
      property: {
        getProperty: async () => ({
          property: [
            {
              "@_id": 222222,
              name: "Failure Property",
              primaryFunction: "Office",
              grossFloorArea: { value: 42000 },
              yearBuilt: 2004,
            },
          ],
        }),
      },
      meter: {
        listMeters: async () => ({
          response: {
            links: {
              link: [{ "@_id": 2201, "@_link": "/meter/2201" }],
            },
          },
        }),
        getMeter: async () => ({
          meter: [
            {
              "@_id": 2201,
              type: "Electric",
              name: "Recovered Electric",
              unitOfMeasure: "kWh",
              inUse: true,
            },
          ],
        }),
      },
      consumption: {
        getConsumptionData: async () => ({
          meterData: {
            meterConsumption: monthConsumptions(),
          },
        }),
      },
      metrics: {
        getLatestAvailablePropertyMetrics: async () => ({
          propertyId: 222222,
          year: 2025,
          month: 12,
          score: 74,
          siteTotal: 1100000,
          sourceTotal: 2300000,
          siteIntensity: 65,
          sourceIntensity: 138,
          weatherNormalizedSiteIntensity: 63,
          weatherNormalizedSourceIntensity: 134,
          directGHGEmissions: 0,
          medianScore: 50,
        }),
        getReasonsForNoScore: async () => [],
      },
    };

    const result = await runLegacyBenchmarkCompatibilitySync({
      organizationId: orgA.id,
      buildingId: buildingFailure.id,
      reportingYear: 2025,
      producedById: userA.authUserId,
      espmClient: recoveryClient,
    });

    const readingCount = await prisma.energyReading.count({
      where: {
        buildingId: buildingFailure.id,
        source: "ESPM_SYNC",
      },
    });
    const meterCount = await prisma.meter.count({
      where: {
        buildingId: buildingFailure.id,
      },
    });

    expect(result.syncState.status).toBe("SUCCEEDED");
    expect(readingCount).toBe(12);
    expect(meterCount).toBe(1);
  });

  it("pushes local electric and gas readings to Portfolio Manager and refreshes readiness", async () => {
    await prisma.energyReading.createMany({
      data: [
        {
          buildingId: buildingPush.id,
          organizationId: orgA.id,
          source: "CSV_UPLOAD",
          meterType: "ELECTRIC",
          periodStart: new Date("2025-01-01T00:00:00.000Z"),
          periodEnd: new Date("2025-01-31T00:00:00.000Z"),
          consumption: 12000,
          unit: "KWH",
          consumptionKbtu: 12000 * 3.412,
          cost: 1800,
        },
        {
          buildingId: buildingPush.id,
          organizationId: orgA.id,
          source: "MANUAL",
          meterType: "GAS",
          periodStart: new Date("2025-01-01T00:00:00.000Z"),
          periodEnd: new Date("2025-01-31T00:00:00.000Z"),
          consumption: 240,
          unit: "THERMS",
          consumptionKbtu: 240 * 100,
          cost: 320,
        },
      ],
    });

    const createdMeters: number[] = [];
    const pushedEntries: Array<{ meterId: number; count: number }> = [];
    const updatedEntries: Array<{ consumptionId: number; usage: number }> = [];

    const pushClient = {
      property: {
        getProperty: async () => ({
          property: [
            {
              "@_id": 444444,
              name: "Push Property",
              primaryFunction: "Office",
              grossFloorArea: { value: 28000 },
              yearBuilt: 2005,
              address: {
                "@_address1": "400 Push Ave NW",
                "@_city": "Washington",
                "@_state": "DC",
                "@_postalCode": "20001",
              },
            },
          ],
        }),
      },
      meter: {
        listMeters: async () => ({
          response: {
            links: {
              link: createdMeters.map((meterId) => ({ "@_id": meterId, "@_link": `/meter/${meterId}` })),
            },
          },
        }),
        getMeter: async (meterId: number) => ({
          meter: [
            {
              "@_id": meterId,
              type: meterId === 5001 ? "Electric" : "Natural Gas",
              name: meterId === 5001 ? "Quoin Electric Meter" : "Quoin Natural Gas Meter",
              unitOfMeasure: meterId === 5001 ? "kWh" : "therms",
              inUse: true,
            },
          ],
        }),
        createMeter: async (_propertyId: number, meter: { type: string }) => {
          const meterId = meter.type === "Electric" ? 5001 : 5002;
          if (!createdMeters.includes(meterId)) {
            createdMeters.push(meterId);
          }
          return {
            meter: [
              {
                "@_id": meterId,
                type: meter.type,
                name: meter.type === "Electric" ? "Quoin Electric Meter" : "Quoin Natural Gas Meter",
                unitOfMeasure: meter.type === "Electric" ? "kWh" : "therms",
                inUse: true,
              },
            ],
          };
        },
      },
      consumption: {
        getConsumptionData: async (meterId: number) => ({
          meterData: {
            meterConsumption:
              meterId === 5001
                ? [
                    {
                      id: 9001,
                      startDate: "2025-01-01",
                      endDate: "2025-01-31",
                      usage: 9999,
                    },
                  ]
                : [],
          },
        }),
        pushConsumptionData: async (meterId: number, entries: Array<{ startDate: string; endDate: string }>) => {
          pushedEntries.push({ meterId, count: entries.length });
          return { ok: true };
        },
        updateConsumptionData: async (
          consumptionId: number,
          entry: { usage: number },
        ) => {
          updatedEntries.push({ consumptionId, usage: entry.usage });
          return { ok: true };
        },
      },
      metrics: {
        getLatestAvailablePropertyMetrics: async () => ({
          propertyId: 444444,
          year: 2025,
          month: 12,
          score: 73,
          siteTotal: 900000,
          sourceTotal: 1900000,
          siteIntensity: 68,
          sourceIntensity: 145,
          weatherNormalizedSiteIntensity: 66,
          weatherNormalizedSourceIntensity: 141,
          directGHGEmissions: 0,
          medianScore: 50,
        }),
        getReasonsForNoScore: async () => [],
      },
    };

    const caller = createCaller({
      authUserId: userA.authUserId,
      activeOrganizationId: orgA.id,
      espmFactory: () => pushClient,
    });

    const result = await runLegacyBenchmarkCompatibilityPush({
      organizationId: orgA.id,
      buildingId: buildingPush.id,
      reportingYear: 2025,
      producedById: userA.authUserId,
      espmClient: pushClient,
    });

    expect(result.metersCreated).toBe(2);
    expect(result.totals.readingsPrepared).toBe(2);
    expect(result.totals.readingsPushed).toBe(1);
    expect(result.totals.readingsUpdated).toBe(1);
    expect(result.totals.readingsSkippedExisting).toBe(0);
    expect(result.syncState.status).toBe("SUCCEEDED");
    expect(createdMeters.sort()).toEqual([5001, 5002]);
    expect(pushedEntries).toEqual([{ meterId: 5002, count: 1 }]);
    expect(updatedEntries).toEqual([{ consumptionId: 9001, usage: 12000 }]);

    const localMeters = await prisma.meter.findMany({
      where: { buildingId: buildingPush.id },
      orderBy: { meterType: "asc" },
    });
    expect(localMeters).toHaveLength(2);
    expect(localMeters.map((meter) => meter.espmMeterId?.toString())).toEqual(["5001", "5002"]);

    const syncState = await caller.benchmarking.getLegacyPortfolioManagerBenchmarkStatus({
      buildingId: buildingPush.id,
    });
    expect(syncState.status).toBe("SUCCEEDED");
  });
});


