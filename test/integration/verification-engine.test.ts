import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/server/lib/db";
import { appRouter } from "@/server/trpc/routers";

describe("digital verification engine", () => {
  const scope = `${Date.now()}`;

  let orgA: { id: string };
  let orgB: { id: string };
  let userA: { id: string; authUserId: string };
  let userB: { id: string; authUserId: string };
  let sourceArtifactId: string;
  let passBuilding: { id: string };
  let missingGfaBuilding: { id: string };
  let gapBuilding: { id: string };
  let missingEvidenceBuilding: { id: string };

  beforeAll(async () => {
    orgA = await prisma.organization.create({
      data: {
        name: `Verification Org A ${scope}`,
        slug: `verification-org-a-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    orgB = await prisma.organization.create({
      data: {
        name: `Verification Org B ${scope}`,
        slug: `verification-org-b-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    userA = await prisma.user.create({
      data: {
        authUserId: `supabase_verification_user_a_${scope}`,
        email: `verification_a_${scope}@test.com`,
        name: "Verification User A",
      },
      select: { id: true, authUserId: true },
    });

    userB = await prisma.user.create({
      data: {
        authUserId: `supabase_verification_user_b_${scope}`,
        email: `verification_b_${scope}@test.com`,
        name: "Verification User B",
      },
      select: { id: true, authUserId: true },
    });

    await prisma.organizationMembership.createMany({
      data: [
        { organizationId: orgA.id, userId: userA.id, role: "ADMIN" },
        { organizationId: orgB.id, userId: userB.id, role: "ADMIN" },
      ],
    });

    const sourceArtifact = await prisma.sourceArtifact.create({
      data: {
        organizationId: orgA.id,
        artifactType: "GUIDE",
        name: `Verification source ${scope}`,
        externalUrl: `https://example.com/verification-${scope}`,
        metadata: { scope },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });
    sourceArtifactId = sourceArtifact.id;

    passBuilding = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `Verification Pass ${scope}`,
        address: "200 Verification Way NW, Washington, DC 20001",
        latitude: 38.9,
        longitude: -77.03,
        grossSquareFeet: 88000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        bepsTargetScore: 71,
        doeeBuildingId: "RPUID-100001",
        espmPropertyId: BigInt(19879255),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    missingGfaBuilding = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `Verification Missing GFA ${scope}`,
        address: "201 Verification Way NW, Washington, DC 20001",
        latitude: 38.901,
        longitude: -77.031,
        grossSquareFeet: 0,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        bepsTargetScore: 71,
        doeeBuildingId: "RPUID-100002",
        espmPropertyId: BigInt(19879256),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    gapBuilding = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `Verification Gap ${scope}`,
        address: "202 Verification Way NW, Washington, DC 20001",
        latitude: 38.902,
        longitude: -77.032,
        grossSquareFeet: 72000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        bepsTargetScore: 71,
        doeeBuildingId: "RPUID-100003",
        espmPropertyId: BigInt(19879257),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    missingEvidenceBuilding = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `Verification Needs Review ${scope}`,
        address: "203 Verification Way NW, Washington, DC 20001",
        latitude: 38.903,
        longitude: -77.033,
        grossSquareFeet: 76000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        bepsTargetScore: 71,
        doeeBuildingId: "RPUID-100004",
        espmPropertyId: BigInt(19879258),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    await seedVerificationBuilding({
      organizationId: orgA.id,
      buildingId: passBuilding.id,
      propertyId: "19879255",
      includeFullYearCoverage: true,
      includeGfaEvidence: true,
      includeDqcEvidence: true,
    });

    await seedVerificationBuilding({
      organizationId: orgA.id,
      buildingId: missingGfaBuilding.id,
      propertyId: "19879256",
      includeFullYearCoverage: true,
      includeGfaEvidence: true,
      includeDqcEvidence: true,
    });

    await seedVerificationBuilding({
      organizationId: orgA.id,
      buildingId: gapBuilding.id,
      propertyId: "19879257",
      includeFullYearCoverage: false,
      includeGfaEvidence: true,
      includeDqcEvidence: true,
    });

    await seedVerificationBuilding({
      organizationId: orgA.id,
      buildingId: missingEvidenceBuilding.id,
      propertyId: "19879258",
      includeFullYearCoverage: true,
      includeGfaEvidence: false,
      includeDqcEvidence: false,
    });
  });

  afterAll(async () => {
    await prisma.verificationItemResult.deleteMany({
      where: {
        organizationId: orgA.id,
      },
    });
    await prisma.evidenceArtifact.deleteMany({
      where: {
        organizationId: orgA.id,
      },
    });
    await prisma.complianceSnapshot.deleteMany({
      where: {
        organizationId: orgA.id,
      },
    });
    await prisma.energyReading.deleteMany({
      where: {
        organizationId: orgA.id,
      },
    });
    await prisma.portfolioManagerSyncState.deleteMany({
      where: {
        organizationId: orgA.id,
      },
    });
    await prisma.meter.deleteMany({
      where: {
        organizationId: orgA.id,
      },
    });
    await prisma.building.deleteMany({
      where: {
        organizationId: orgA.id,
      },
    });
    await prisma.organizationMembership.deleteMany({
      where: {
        organizationId: { in: [orgA.id, orgB.id] },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [userA.id, userB.id] },
      },
    });
    await prisma.organization.deleteMany({
      where: {
        id: { in: [orgA.id, orgB.id] },
      },
    });
    await prisma.sourceArtifact.deleteMany({
      where: {
        id: sourceArtifactId,
      },
    });
  });

  function createCaller(authUserId: string, activeOrganizationId: string) {
    return appRouter.createCaller({
      authUserId,
      activeOrganizationId,
      prisma,
    });
  }

  it("returns a full PASS verification checklist when all deterministic checks are satisfied", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    const checklist = await caller.benchmarking.getVerificationChecklist({
      buildingId: passBuilding.id,
      reportingYear: 2025,
    });

    expect(checklist.summary).toEqual({
      passedCount: 7,
      failedCount: 0,
      needsReviewCount: 0,
    });
    expect(checklist.items.every((item) => item.status === "PASS")).toBe(true);

    const persisted = await prisma.verificationItemResult.findMany({
      where: {
        organizationId: orgA.id,
        buildingId: passBuilding.id,
        reportingYear: 2025,
      },
    });

    expect(persisted).toHaveLength(7);
  });

  it("fails GFA verification when gross floor area is missing", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    const checklist = await caller.benchmarking.getVerificationChecklist({
      buildingId: missingGfaBuilding.id,
      reportingYear: 2025,
    });

    const gfa = checklist.items.find((item) => item.category === "GFA");
    expect(gfa?.status).toBe("FAIL");
    expect(gfa?.explanation).toContain("Gross floor area is missing or invalid");
  });

  it("fails annual data coverage when gaps exist in the reporting year", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    const checklist = await caller.benchmarking.getVerificationChecklist({
      buildingId: gapBuilding.id,
      reportingYear: 2025,
    });

    const coverage = checklist.items.find((item) => item.category === "DATA_COVERAGE");
    expect(coverage?.status).toBe("FAIL");
    expect(coverage?.explanation).toContain("Annual data coverage is incomplete");
  });

  it("marks missing evidence as NEEDS_REVIEW instead of passing silently", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    const checklist = await caller.benchmarking.getVerificationChecklist({
      buildingId: missingEvidenceBuilding.id,
      reportingYear: 2025,
    });

    const gfa = checklist.items.find((item) => item.category === "GFA");
    const dqc = checklist.items.find((item) => item.category === "DQC");

    expect(gfa?.status).toBe("NEEDS_REVIEW");
    expect(dqc?.status).toBe("NEEDS_REVIEW");
    expect(checklist.summary.needsReviewCount).toBeGreaterThan(0);
  });

  it("enforces tenant-safe access for verification results", async () => {
    const caller = createCaller(userB.authUserId, orgB.id);

    await expect(
      caller.benchmarking.getVerificationChecklist({
        buildingId: passBuilding.id,
        reportingYear: 2025,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  async function seedVerificationBuilding(input: {
    organizationId: string;
    buildingId: string;
    propertyId: string;
    includeFullYearCoverage: boolean;
    includeGfaEvidence: boolean;
    includeDqcEvidence: boolean;
  }) {
    await prisma.meter.createMany({
      data: [
        {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          espmMeterId: BigInt(`${input.propertyId}01`),
          meterType: "ELECTRIC",
          name: `${input.propertyId} Electric`,
          unit: "KWH",
        },
        {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          espmMeterId: BigInt(`${input.propertyId}02`),
          meterType: "GAS",
          name: `${input.propertyId} Gas`,
          unit: "THERMS",
        },
      ],
    });

    const meters = await prisma.meter.findMany({
      where: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
      },
      select: {
        id: true,
        meterType: true,
      },
    });

    const monthlyRanges = [
      ["2025-01-01T00:00:00.000Z", "2025-01-31T00:00:00.000Z"],
      ["2025-02-01T00:00:00.000Z", "2025-02-28T00:00:00.000Z"],
      ["2025-03-01T00:00:00.000Z", "2025-03-31T00:00:00.000Z"],
      ["2025-04-01T00:00:00.000Z", "2025-04-30T00:00:00.000Z"],
      ["2025-05-01T00:00:00.000Z", "2025-05-31T00:00:00.000Z"],
      ["2025-06-01T00:00:00.000Z", "2025-06-30T00:00:00.000Z"],
      ["2025-07-01T00:00:00.000Z", "2025-07-31T00:00:00.000Z"],
      ["2025-08-01T00:00:00.000Z", "2025-08-31T00:00:00.000Z"],
      ["2025-09-01T00:00:00.000Z", "2025-09-30T00:00:00.000Z"],
      ["2025-10-01T00:00:00.000Z", "2025-10-31T00:00:00.000Z"],
      ["2025-11-01T00:00:00.000Z", "2025-11-30T00:00:00.000Z"],
      ["2025-12-01T00:00:00.000Z", "2025-12-31T00:00:00.000Z"],
    ] as const;

    const usedRanges = input.includeFullYearCoverage ? monthlyRanges : monthlyRanges.slice(0, 11);

    await prisma.energyReading.createMany({
      data: meters.flatMap((meter) =>
        usedRanges.map(([periodStart, periodEnd], index) => ({
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          meterId: meter.id,
          source: "ESPM_SYNC",
          meterType: meter.meterType,
          periodStart: new Date(periodStart),
          periodEnd: new Date(periodEnd),
          consumption: meter.meterType === "ELECTRIC" ? 1000 + index : 500 + index,
          unit: meter.meterType === "ELECTRIC" ? "KWH" : "THERMS",
          consumptionKbtu: meter.meterType === "ELECTRIC" ? 3412 + index : 50000 + index,
          isVerified: true,
        })),
      ),
    });

    await prisma.portfolioManagerSyncState.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        status: "SUCCEEDED",
        lastAttemptedSyncAt: new Date("2026-03-10T00:00:00.000Z"),
        lastSuccessfulSyncAt: new Date("2026-03-10T00:00:00.000Z"),
        sourceMetadata: {
          system: "ENERGY_STAR_PORTFOLIO_MANAGER",
          propertyId: input.propertyId,
        },
      },
    });

    await prisma.complianceSnapshot.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        snapshotDate: new Date("2026-02-01T00:00:00.000Z"),
        triggerType: "ESPM_SYNC",
        energyStarScore: 76,
        sourceEui: 135.4,
        complianceStatus: "AT_RISK",
        estimatedPenalty: 12345,
      },
    });

    if (input.includeGfaEvidence) {
      await prisma.evidenceArtifact.create({
        data: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          sourceArtifactId,
          artifactType: "OWNER_ATTESTATION",
          name: `GFA Support ${input.propertyId}`,
          artifactRef: `gfa:${input.propertyId}`,
          metadata: {
            benchmarking: {
              kind: "GFA_SUPPORT",
            },
          },
          createdByType: "SYSTEM",
          createdById: "test",
        },
      });
    }

    if (input.includeDqcEvidence) {
      await prisma.evidenceArtifact.create({
        data: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          sourceArtifactId,
          artifactType: "PM_REPORT",
          name: `DQC ${input.propertyId}`,
          artifactRef: `dqc:${input.propertyId}`,
          metadata: {
            benchmarking: {
              kind: "DQC_REPORT",
            },
          },
          createdByType: "SYSTEM",
          createdById: "test",
        },
      });
    }
  }
});



