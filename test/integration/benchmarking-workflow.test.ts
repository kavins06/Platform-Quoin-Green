import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/server/lib/db";
import { appRouter } from "@/server/trpc/routers";

describe("benchmarking workflow", () => {
  const scope = `${Date.now()}`;
  const activeEffectiveFrom = new Date(Date.now() - 60_000);
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
  let buildingA: { id: string };
  let buildingB: { id: string };

  beforeAll(async () => {
    const sourceArtifact = await prisma.sourceArtifact.create({
      data: {
        artifactType: "LAW",
        name: `Benchmark workflow source ${scope}`,
        externalUrl: "https://example.com/benchmarking-test",
        metadata: { scope },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

    const guidanceArtifact = await prisma.sourceArtifact.create({
      data: {
        artifactType: "GUIDE",
        name: `Benchmark workflow guidance ${scope}`,
        externalUrl: "https://example.com/benchmarking-guidance-test",
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
        sourceMetadata: {
          authority: {
            type: "binding",
            sourceArtifactId: sourceArtifact.id,
          },
          guidance: [{ sourceArtifactId: guidanceArtifact.id }],
        },
        configJson: {
          requirements: {
            propertyIdPattern: "^RPUID-[0-9]{6}$",
            dqcFreshnessDays: 30,
            verification: {
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
        effectiveFrom: activeEffectiveFrom,
        implementationKey: "benchmarking/readiness-v1",
        sourceMetadata: {
          authority: {
            type: "binding",
            sourceArtifactId: sourceArtifact.id,
          },
          guidance: [{ sourceArtifactId: guidanceArtifact.id }],
        },
        configJson: {
          requirements: {
            propertyIdPattern: "^RPUID-[0-9]{6}$",
            dqcFreshnessDays: 30,
            verification: {
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
        effectiveFrom: activeEffectiveFrom,
        sourceMetadata: { scope },
        factorsJson: {
          benchmarking: {
            dqcFreshnessDays: 30,
            applicabilityBands: benchmarkingApplicabilityBands,
          },
          beps: {
            applicability: {
              minGrossSquareFeet: 50000,
              coveredPropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
              recentConstructionExemptionYears: 5,
              cycleStartYear: 2021,
            },
            performance: {
              targetReductionPct: 20,
            },
            standardTarget: {
              defaultMaxGap: 15,
              maxGapByPropertyType: {
                OFFICE: 15,
                MULTIFAMILY: 15,
                MIXED_USE: 15,
                OTHER: 15,
              },
            },
            prescriptive: {
              defaultPointsNeeded: 25,
              pointsNeededByPropertyType: {
                OFFICE: 25,
                MULTIFAMILY: 25,
                MIXED_USE: 25,
                OTHER: 25,
              },
            },
            alternativeCompliance: {
              penaltyPerSquareFoot: 10,
              maxPenaltyCap: 7500000,
            },
          },
        },
      },
      create: {
        key: "DC_CURRENT_STANDARDS",
        sourceArtifactId: guidanceArtifact.id,
        version: "test-v1",
        status: "ACTIVE",
        effectiveFrom: activeEffectiveFrom,
        sourceMetadata: { scope },
        factorsJson: {
          benchmarking: {
            dqcFreshnessDays: 30,
            applicabilityBands: benchmarkingApplicabilityBands,
          },
          beps: {
            applicability: {
              minGrossSquareFeet: 50000,
              coveredPropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
              recentConstructionExemptionYears: 5,
              cycleStartYear: 2021,
            },
            performance: {
              targetReductionPct: 20,
            },
            standardTarget: {
              defaultMaxGap: 15,
              maxGapByPropertyType: {
                OFFICE: 15,
                MULTIFAMILY: 15,
                MIXED_USE: 15,
                OTHER: 15,
              },
            },
            prescriptive: {
              defaultPointsNeeded: 25,
              pointsNeededByPropertyType: {
                OFFICE: 25,
                MULTIFAMILY: 25,
                MIXED_USE: 25,
                OTHER: 25,
              },
            },
            alternativeCompliance: {
              penaltyPerSquareFoot: 10,
              maxPenaltyCap: 7500000,
            },
          },
        },
      },
    });

    orgA = await prisma.organization.create({
      data: {
        name: `Benchmark Org A ${scope}`,
        slug: `benchmark-org-a-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    orgB = await prisma.organization.create({
      data: {
        name: `Benchmark Org B ${scope}`,
        slug: `benchmark-org-b-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    userA = await prisma.user.create({
      data: {
        authUserId: `supabase_benchmark_user_a_${scope}`,
        email: `benchmark_a_${scope}@test.com`,
        name: "Benchmark User A",
      },
      select: { id: true, authUserId: true },
    });

    userB = await prisma.user.create({
      data: {
        authUserId: `supabase_benchmark_user_b_${scope}`,
        email: `benchmark_b_${scope}@test.com`,
        name: "Benchmark User B",
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

    buildingA = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `Benchmark Building A ${scope}`,
        address: "700 Test St NW, Washington, DC 20001",
        latitude: 38.9,
        longitude: -77.03,
        grossSquareFeet: 120000,
        propertyType: "OFFICE",
        bepsTargetScore: 71,
        maxPenaltyExposure: 1200000,
        doeeBuildingId: "RPUID-123456",
        espmPropertyId: BigInt(123456),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    buildingB = await prisma.building.create({
      data: {
        organizationId: orgB.id,
        name: `Benchmark Building B ${scope}`,
        address: "800 Test St NW, Washington, DC 20001",
        latitude: 38.91,
        longitude: -77.04,
        grossSquareFeet: 90000,
        propertyType: "OFFICE",
        bepsTargetScore: 71,
        maxPenaltyExposure: 900000,
        doeeBuildingId: "RPUID-654321",
        espmPropertyId: BigInt(654321),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    const readings = [
      ["2025-01-01", "2025-01-31"],
      ["2025-02-01", "2025-02-28"],
      ["2025-03-01", "2025-03-31"],
      ["2025-04-01", "2025-04-30"],
      ["2025-05-01", "2025-05-31"],
      ["2025-06-01", "2025-06-30"],
      ["2025-07-01", "2025-07-31"],
      ["2025-08-01", "2025-08-31"],
      ["2025-09-01", "2025-09-30"],
      ["2025-10-01", "2025-10-31"],
      ["2025-11-01", "2025-11-30"],
      ["2025-12-01", "2025-12-31"],
    ] as const;

    for (const [periodStart, periodEnd] of readings) {
      await prisma.energyReading.createMany({
        data: [
          {
            buildingId: buildingA.id,
            organizationId: orgA.id,
            source: "CSV_UPLOAD",
            meterType: "ELECTRIC",
            periodStart: new Date(`${periodStart}T00:00:00.000Z`),
            periodEnd: new Date(`${periodEnd}T00:00:00.000Z`),
            consumption: 100,
            unit: "KWH",
            consumptionKbtu: 341.2,
          },
          {
            buildingId: buildingB.id,
            organizationId: orgB.id,
            source: "CSV_UPLOAD",
            meterType: "ELECTRIC",
            periodStart: new Date(`${periodStart}T00:00:00.000Z`),
            periodEnd: new Date(`${periodEnd}T00:00:00.000Z`),
            consumption: 120,
            unit: "KWH",
            consumptionKbtu: 409.44,
          },
        ],
      });
    }

    await prisma.evidenceArtifact.createMany({
      data: [
        {
          organizationId: orgA.id,
          buildingId: buildingA.id,
          artifactType: "PM_REPORT",
          name: `DQC A ${scope}`,
          artifactRef: "dqc-a",
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
        {
          organizationId: orgA.id,
          buildingId: buildingA.id,
          artifactType: "OWNER_ATTESTATION",
          name: `Verification A ${scope}`,
          artifactRef: "verification-a",
          metadata: {
            benchmarking: {
              kind: "VERIFICATION",
              reportingYear: 2025,
            },
          },
          createdByType: "SYSTEM",
          createdById: "test",
        },
        {
          organizationId: orgB.id,
          buildingId: buildingB.id,
          artifactType: "PM_REPORT",
          name: `DQC B ${scope}`,
          artifactRef: "dqc-b",
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
        {
          organizationId: orgB.id,
          buildingId: buildingB.id,
          artifactType: "OWNER_ATTESTATION",
          name: `Verification B ${scope}`,
          artifactRef: "verification-b",
          metadata: {
            benchmarking: {
              kind: "VERIFICATION",
              reportingYear: 2025,
            },
          },
          createdByType: "SYSTEM",
          createdById: "test",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.evidenceArtifact.deleteMany({
      where: {
        buildingId: { in: [buildingA.id, buildingB.id] },
      },
    });
    await prisma.benchmarkSubmission.deleteMany({
      where: {
        buildingId: { in: [buildingA.id, buildingB.id] },
      },
    });
    await prisma.complianceRun.deleteMany({
      where: {
        buildingId: { in: [buildingA.id, buildingB.id] },
      },
    });
    await prisma.calculationManifest.deleteMany({
      where: {
        implementationKey: "benchmarking/readiness-v1",
      },
    });
    await prisma.energyReading.deleteMany({
      where: {
        buildingId: { in: [buildingA.id, buildingB.id] },
      },
    });
    await prisma.sourceArtifact.deleteMany({
      where: {
        OR: [
          { name: { contains: scope } },
          { externalUrl: { startsWith: "https://example.com/benchmarking" } },
        ],
      },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await prisma.user.deleteMany({
      where: {
        authUserId: {
          startsWith: "supabase_benchmark_user_",
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

  function createCaller(authUserId: string, activeOrganizationId: string) {
    return appRouter.createCaller({
      authUserId,
      activeOrganizationId,
      prisma,
    });
  }

  it("creates and updates the canonical benchmark submission through the governed workflow", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    const evaluated = await caller.benchmarking.evaluateReadiness({
      buildingId: buildingA.id,
      reportingYear: 2025,
    });

    expect(evaluated.readiness.status).toBe("READY");
    expect(evaluated.benchmarkSubmission.status).toBe("READY");
    expect(evaluated.benchmarkSubmission.complianceRunId).toBeTruthy();
    expect(evaluated.readiness.governance).toMatchObject({
      rulePackageKey: "DC_BENCHMARKING_2025",
      factorSetKey: "DC_CURRENT_STANDARDS",
      ownershipTypeUsed: "PRIVATE",
    });

    const persisted = await caller.benchmarking.getReadiness({
      buildingId: buildingA.id,
      reportingYear: 2025,
    });

    const readinessPayload = persisted.submissionPayload as Record<string, unknown>;
    const readiness = readinessPayload["readiness"] as Record<string, unknown>;
    expect(readiness["status"]).toBe("READY");
    expect(readiness).toMatchObject({
      governance: {
        rulePackageKey: "DC_BENCHMARKING_2025",
        factorSetKey: "DC_CURRENT_STANDARDS",
      },
    });

    const updated = await caller.benchmarking.upsertSubmission({
      buildingId: buildingA.id,
      reportingYear: 2025,
      status: "SUBMITTED",
      submittedAt: "2026-01-20T00:00:00.000Z",
      submissionPayload: {
        submittedBy: "internal-test",
      },
      evidenceArtifacts: [
        {
          artifactType: "PM_REPORT",
          name: "Submission packet cover sheet",
          artifactRef: "submission-cover-sheet",
          metadata: {
            benchmarking: {
              kind: "DQC_REPORT",
              reportingYear: 2025,
              checkedAt: "2026-01-15T00:00:00.000Z",
            },
          },
        },
      ],
    });

    expect(updated.benchmarkSubmission.status).toBe("SUBMITTED");
    expect(updated.benchmarkSubmission.submittedAt?.toISOString()).toBe(
      "2026-01-20T00:00:00.000Z",
    );
  });

  it("retrieves benchmarking records only within the authenticated tenant", async () => {
    const callerA = createCaller(userA.authUserId, orgA.id);
    const callerB = createCaller(userB.authUserId, orgB.id);

    await callerA.benchmarking.evaluateReadiness({
      buildingId: buildingA.id,
      reportingYear: 2025,
    });
    await callerB.benchmarking.evaluateReadiness({
      buildingId: buildingB.id,
      reportingYear: 2025,
    });

    const submissionsForA = await callerA.benchmarking.listSubmissions({
      buildingId: buildingA.id,
      limit: 10,
    });
    expect(submissionsForA).toHaveLength(1);
    expect(submissionsForA[0]?.buildingId).toBe(buildingA.id);

    await expect(
      callerA.benchmarking.getReadiness({
        buildingId: buildingB.id,
        reportingYear: 2025,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("surfaces governed scope and deadline metadata through the router", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    const smallPrivateBuilding = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `Benchmark Small Private ${scope}`,
        address: "710 Test St NW, Washington, DC 20001",
        latitude: 38.901,
        longitude: -77.031,
        grossSquareFeet: 20000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        bepsTargetScore: 71,
        maxPenaltyExposure: 200000,
        doeeBuildingId: "RPUID-222222",
        espmPropertyId: BigInt(222222),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    const districtBuilding = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `Benchmark District ${scope}`,
        address: "720 Test St NW, Washington, DC 20001",
        latitude: 38.902,
        longitude: -77.032,
        grossSquareFeet: 15000,
        propertyType: "OFFICE",
        ownershipType: "DISTRICT",
        bepsTargetScore: 71,
        maxPenaltyExposure: 150000,
        doeeBuildingId: "RPUID-333333",
        espmPropertyId: BigInt(333333),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    try {
      for (const [periodStart, periodEnd] of [
        ["2027-01-01", "2027-01-31"],
        ["2027-02-01", "2027-02-28"],
        ["2027-03-01", "2027-03-31"],
        ["2027-04-01", "2027-04-30"],
        ["2027-05-01", "2027-05-31"],
        ["2027-06-01", "2027-06-30"],
        ["2027-07-01", "2027-07-31"],
        ["2027-08-01", "2027-08-31"],
        ["2027-09-01", "2027-09-30"],
        ["2027-10-01", "2027-10-31"],
        ["2027-11-01", "2027-11-30"],
        ["2027-12-01", "2027-12-31"],
      ] as const) {
        await prisma.energyReading.createMany({
          data: [
            {
              buildingId: smallPrivateBuilding.id,
              organizationId: orgA.id,
              source: "CSV_UPLOAD",
              meterType: "ELECTRIC",
              periodStart: new Date(`${periodStart}T00:00:00.000Z`),
              periodEnd: new Date(`${periodEnd}T00:00:00.000Z`),
              consumption: 100,
              unit: "KWH",
              consumptionKbtu: 341.2,
            },
            {
              buildingId: districtBuilding.id,
              organizationId: orgA.id,
              source: "CSV_UPLOAD",
              meterType: "ELECTRIC",
              periodStart: new Date(`${periodStart}T00:00:00.000Z`),
              periodEnd: new Date(`${periodEnd}T00:00:00.000Z`),
              consumption: 100,
              unit: "KWH",
              consumptionKbtu: 341.2,
            },
          ],
        });
      }

      await prisma.evidenceArtifact.createMany({
        data: [
          {
            organizationId: orgA.id,
            buildingId: smallPrivateBuilding.id,
            artifactType: "PM_REPORT",
            name: `DQC small private ${scope}`,
            artifactRef: "dqc-small-private",
            metadata: {
              benchmarking: {
                kind: "DQC_REPORT",
                reportingYear: 2027,
                checkedAt: freshDqcCheckedAt,
              },
            },
            createdByType: "SYSTEM",
            createdById: "test",
          },
          {
            organizationId: orgA.id,
            buildingId: districtBuilding.id,
            artifactType: "PM_REPORT",
            name: `DQC district ${scope}`,
            artifactRef: "dqc-district",
            metadata: {
              benchmarking: {
                kind: "DQC_REPORT",
                reportingYear: 2027,
                checkedAt: freshDqcCheckedAt,
              },
            },
            createdByType: "SYSTEM",
            createdById: "test",
          },
        ],
      });

      const privateResult = await caller.benchmarking.evaluateReadiness({
        buildingId: smallPrivateBuilding.id,
        reportingYear: 2027,
      });
      const districtResult = await caller.benchmarking.evaluateReadiness({
        buildingId: districtBuilding.id,
        reportingYear: 2027,
      });

      expect(privateResult.readiness.summary.applicabilityBandLabel).toBe(
        "PRIVATE_10K_TO_24_999",
      );
      expect(privateResult.readiness.summary.minimumGrossSquareFeet).toBe(10000);
      expect(privateResult.readiness.summary.maximumGrossSquareFeet).toBe(24999);
      expect(privateResult.readiness.summary.requiredReportingYears).toEqual([2027]);
      expect(privateResult.readiness.summary.verificationCadenceYears).toBe(6);
      expect(privateResult.readiness.summary.deadlineType).toBe("MAY_1_FOLLOWING_YEAR");
      expect(privateResult.readiness.summary.submissionDueDate).toBe(
        "2028-05-01T00:00:00.000Z",
      );
      expect(privateResult.readiness.summary.verificationRequired).toBe(true);
      expect(privateResult.readiness.governance).toMatchObject({
        rulePackageKey: "DC_BENCHMARKING_2025",
        factorSetKey: "DC_CURRENT_STANDARDS",
        ownershipTypeUsed: "PRIVATE",
        applicabilityBandLabel: "PRIVATE_10K_TO_24_999",
        minimumGrossSquareFeet: 10000,
        manualSubmissionAllowedWhenNotBenchmarkable: false,
      });

      expect(districtResult.readiness.summary.applicabilityBandLabel).toBe(
        "DISTRICT_10K_PLUS",
      );
      expect(districtResult.readiness.summary.ownershipTypeUsed).toBe("DISTRICT");
      expect(districtResult.readiness.summary.minimumGrossSquareFeet).toBe(10000);
      expect(districtResult.readiness.summary.deadlineType).toBe(
        "WITHIN_DAYS_OF_BENCHMARK_GENERATION",
      );
      expect(districtResult.readiness.summary.deadlineDaysFromGeneration).toBe(60);
      expect(districtResult.readiness.summary.verificationRequired).toBe(false);
      expect(districtResult.readiness.governance).toMatchObject({
        rulePackageKey: "DC_BENCHMARKING_2025",
        factorSetKey: "DC_CURRENT_STANDARDS",
        ownershipTypeUsed: "DISTRICT",
        applicabilityBandLabel: "DISTRICT_10K_PLUS",
        deadlineType: "WITHIN_DAYS_OF_BENCHMARK_GENERATION",
        manualSubmissionAllowedWhenNotBenchmarkable: true,
      });
    } finally {
      await prisma.evidenceArtifact.deleteMany({
        where: {
          buildingId: { in: [smallPrivateBuilding.id, districtBuilding.id] },
        },
      });
      await prisma.benchmarkSubmission.deleteMany({
        where: {
          buildingId: { in: [smallPrivateBuilding.id, districtBuilding.id] },
        },
      });
      await prisma.complianceRun.deleteMany({
        where: {
          buildingId: { in: [smallPrivateBuilding.id, districtBuilding.id] },
        },
      });
      await prisma.energyReading.deleteMany({
        where: {
          buildingId: { in: [smallPrivateBuilding.id, districtBuilding.id] },
        },
      });
      await prisma.building.deleteMany({
        where: {
          id: { in: [smallPrivateBuilding.id, districtBuilding.id] },
        },
      });
    }
  });
});



