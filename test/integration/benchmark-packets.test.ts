import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/server/lib/db";
import * as packetDocuments from "@/server/rendering/packet-documents";
import { appRouter } from "@/server/trpc/routers";

describe("benchmark request workflow and benchmark packets", () => {
  const scope = `${Date.now()}`;

  let sourceArtifactId: string;
  let ruleVersionId: string;
  let factorSetVersionId: string;
  let orgA: { id: string };
  let orgB: { id: string };
  let userA: { id: string; authUserId: string };
  let userB: { id: string; authUserId: string };
  let readyBuilding: { id: string };
  let blockedBuilding: { id: string };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeAll(async () => {
    const sourceArtifact = await prisma.sourceArtifact.create({
      data: {
        artifactType: "GUIDE",
        name: `Benchmark packet source ${scope}`,
        externalUrl: `https://example.com/benchmark-packet-${scope}`,
        metadata: { scope },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });
    sourceArtifactId = sourceArtifact.id;

    const rulePackage = await prisma.rulePackage.create({
      data: {
        key: `BENCHMARK_PACKET_RULES_${scope}`,
        name: `Benchmark Packet Rules ${scope}`,
      },
    });

    const ruleVersion = await prisma.ruleVersion.create({
      data: {
        rulePackageId: rulePackage.id,
        sourceArtifactId,
        version: "test-v1",
        status: "ACTIVE",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        implementationKey: "benchmarking/readiness-v1",
        configJson: {
          requirements: {
            propertyIdPattern: "^RPUID-[0-9]{6}$",
            dqcFreshnessDays: 30,
          },
        },
      },
    });
    ruleVersionId = ruleVersion.id;

    const factorSetVersion = await prisma.factorSetVersion.create({
      data: {
        key: `BENCHMARK_PACKET_FACTORS_${scope}`,
        sourceArtifactId,
        version: "test-v1",
        status: "ACTIVE",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        factorsJson: {
          benchmarking: {
            applicabilityBands: [
              {
                ownershipType: "PRIVATE",
                minimumGrossSquareFeet: 10000,
                label: "PRIVATE_10K_PLUS",
                deadlineType: "MAY_1_FOLLOWING_YEAR",
                verificationCadenceYears: 6,
                verificationYears: [2027],
              },
            ],
          },
        },
      },
    });
    factorSetVersionId = factorSetVersion.id;

    orgA = await prisma.organization.create({
      data: {
        name: `Benchmark Packet Org A ${scope}`,
        slug: `benchmark-packet-org-a-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    orgB = await prisma.organization.create({
      data: {
        name: `Benchmark Packet Org B ${scope}`,
        slug: `benchmark-packet-org-b-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    userA = await prisma.user.create({
      data: {
        authUserId: `supabase_benchmark_packet_user_a_${scope}`,
        email: `benchmark_packet_a_${scope}@test.com`,
        name: "Benchmark Packet User A",
      },
      select: { id: true, authUserId: true },
    });

    userB = await prisma.user.create({
      data: {
        authUserId: `supabase_benchmark_packet_user_b_${scope}`,
        email: `benchmark_packet_b_${scope}@test.com`,
        name: "Benchmark Packet User B",
      },
      select: { id: true, authUserId: true },
    });

    await prisma.organizationMembership.createMany({
      data: [
        { organizationId: orgA.id, userId: userA.id, role: "ADMIN" },
        { organizationId: orgB.id, userId: userB.id, role: "ADMIN" },
      ],
    });

    readyBuilding = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `Benchmark Packet Ready ${scope}`,
        address: "100 Benchmark Packet Way NW, Washington, DC 20001",
        latitude: 38.9,
        longitude: -77.03,
        grossSquareFeet: 90000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        bepsTargetScore: 71,
        doeeBuildingId: "RPUID-123456",
        espmPropertyId: BigInt(19879255),
        espmShareStatus: "LINKED",
      },
      select: { id: true },
    });

    blockedBuilding = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: `Benchmark Packet Blocked ${scope}`,
        address: "101 Benchmark Packet Way NW, Washington, DC 20001",
        latitude: 38.901,
        longitude: -77.031,
        grossSquareFeet: 70000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        bepsTargetScore: 71,
      },
      select: { id: true },
    });

    await prisma.meter.createMany({
      data: [
        {
          organizationId: orgA.id,
          buildingId: readyBuilding.id,
          espmMeterId: BigInt(555001),
          meterType: "ELECTRIC",
          name: "Ready Electric",
          unit: "KWH",
        },
        {
          organizationId: orgA.id,
          buildingId: readyBuilding.id,
          espmMeterId: BigInt(555002),
          meterType: "GAS",
          name: "Ready Gas",
          unit: "THERMS",
        },
      ],
    });

    const readyMeters = await prisma.meter.findMany({
      where: {
        organizationId: orgA.id,
        buildingId: readyBuilding.id,
      },
      orderBy: [{ meterType: "asc" }, { name: "asc" }],
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

    await prisma.energyReading.createMany({
      data: readyMeters.flatMap((meter) =>
        monthlyRanges.map(([periodStart, periodEnd], index) => ({
          organizationId: orgA.id,
          buildingId: readyBuilding.id,
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

    await prisma.complianceSnapshot.create({
      data: {
        organizationId: orgA.id,
        buildingId: readyBuilding.id,
        snapshotDate: new Date("2026-02-01T00:00:00.000Z"),
        triggerType: "ESPM_SYNC",
        energyStarScore: 84,
        sourceEui: 121.3,
        complianceStatus: "COMPLIANT",
        estimatedPenalty: 0,
      },
    });

    await prisma.portfolioManagerSyncState.create({
      data: {
        organizationId: orgA.id,
        buildingId: readyBuilding.id,
        status: "SUCCEEDED",
        lastAttemptedSyncAt: new Date("2026-03-10T00:00:00.000Z"),
        lastSuccessfulSyncAt: new Date("2026-03-10T00:00:00.000Z"),
        sourceMetadata: {
          system: "ENERGY_STAR_PORTFOLIO_MANAGER",
          propertyId: "19879255",
        },
        syncMetadata: {
          reportingYear: 2025,
          readingsCreated: 12,
        },
      },
    });

    await prisma.portfolioManagerSyncState.create({
      data: {
        organizationId: orgA.id,
        buildingId: blockedBuilding.id,
        status: "FAILED",
        lastAttemptedSyncAt: new Date("2026-03-10T00:00:00.000Z"),
        sourceMetadata: {
          system: "ENERGY_STAR_PORTFOLIO_MANAGER",
          propertyId: null,
        },
        lastErrorMetadata: {
          message: "Portfolio Manager share is missing.",
          failedStep: "property",
          retryable: false,
        },
      },
    });

    const readySubmission = await prisma.benchmarkSubmission.create({
      data: {
        organizationId: orgA.id,
        buildingId: readyBuilding.id,
        reportingYear: 2025,
        ruleVersionId,
        factorSetVersionId,
        status: "READY",
        readinessEvaluatedAt: new Date("2026-03-01T00:00:00.000Z"),
        submissionPayload: {
          readiness: {
            status: "READY",
            reasonCodes: [],
            findings: [],
            summary: {
              scopeState: "IN_SCOPE",
              ownershipTypeUsed: "PRIVATE",
              applicabilityBandLabel: "PRIVATE_10K_PLUS",
              minimumGrossSquareFeet: 10000,
              maximumGrossSquareFeet: null,
              requiredReportingYears: [2027],
              verificationCadenceYears: 6,
              deadlineType: "MAY_1_FOLLOWING_YEAR",
              submissionDueDate: "2026-05-01T00:00:00.000Z",
              deadlineDaysFromGeneration: null,
              manualSubmissionAllowedWhenNotBenchmarkable: false,
              coverageComplete: true,
              missingCoverageStreams: [],
              overlapStreams: [],
              gapDetails: [],
              overlapDetails: [],
              streamCoverage: [],
              propertyIdState: "PRESENT",
              pmShareState: "READY",
              dqcFreshnessState: "FRESH",
              verificationRequired: false,
              verificationEvidencePresent: true,
              gfaEvidenceRequired: false,
              gfaEvidencePresent: true,
            },
            governance: {
              rulePackageKey: `BENCHMARK_PACKET_RULES_${scope}`,
              ruleVersionId,
              ruleVersion: "test-v1",
              factorSetKey: `BENCHMARK_PACKET_FACTORS_${scope}`,
              factorSetVersionId,
              factorSetVersion: "test-v1",
            },
          },
        },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });
    await prisma.evidenceArtifact.create({
      data: {
        organizationId: orgA.id,
        buildingId: readyBuilding.id,
        benchmarkSubmissionId: readySubmission.id,
        sourceArtifactId,
        artifactType: "PM_REPORT",
        name: "DQC freshness report",
        artifactRef: "dqc:2025",
        metadata: {
          benchmarking: {
            kind: "DQC_REPORT",
            checkedAt: "2026-02-28T00:00:00.000Z",
          },
        },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });
    await prisma.evidenceArtifact.create({
      data: {
        organizationId: orgA.id,
        buildingId: readyBuilding.id,
        benchmarkSubmissionId: readySubmission.id,
        sourceArtifactId,
        artifactType: "OWNER_ATTESTATION",
        name: "Gross floor area support",
        artifactRef: "gfa:2025",
        metadata: {
          benchmarking: {
            kind: "GFA_SUPPORT",
          },
        },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

    await prisma.benchmarkSubmission.create({
      data: {
        organizationId: orgA.id,
        buildingId: blockedBuilding.id,
        reportingYear: 2025,
        ruleVersionId,
        factorSetVersionId,
        status: "BLOCKED",
        readinessEvaluatedAt: new Date("2026-03-01T00:00:00.000Z"),
        submissionPayload: {
          readiness: {
            status: "BLOCKED",
            reasonCodes: ["MISSING_PROPERTY_ID", "PM_NOT_SHARED"],
            findings: [
              {
                code: "MISSING_PROPERTY_ID",
                status: "FAIL",
                message: "DC Real Property Unique ID is missing.",
              },
              {
                code: "PM_NOT_SHARED",
                status: "FAIL",
                message: "Portfolio Manager sharing/exchange is not ready.",
              },
            ],
            summary: {
              scopeState: "IN_SCOPE",
              ownershipTypeUsed: "PRIVATE",
              applicabilityBandLabel: "PRIVATE_10K_PLUS",
              minimumGrossSquareFeet: 10000,
              maximumGrossSquareFeet: null,
              requiredReportingYears: [2027],
              verificationCadenceYears: 6,
              deadlineType: "MAY_1_FOLLOWING_YEAR",
              submissionDueDate: "2026-05-01T00:00:00.000Z",
              deadlineDaysFromGeneration: null,
              manualSubmissionAllowedWhenNotBenchmarkable: false,
              coverageComplete: false,
              missingCoverageStreams: ["all"],
              overlapStreams: [],
              gapDetails: [],
              overlapDetails: [],
              streamCoverage: [],
              propertyIdState: "MISSING",
              pmShareState: "NOT_READY",
              dqcFreshnessState: "MISSING",
              verificationRequired: true,
              verificationEvidencePresent: false,
              gfaEvidenceRequired: false,
              gfaEvidencePresent: false,
            },
            governance: {
              rulePackageKey: `BENCHMARK_PACKET_RULES_${scope}`,
              ruleVersionId,
              ruleVersion: "test-v1",
              factorSetKey: `BENCHMARK_PACKET_FACTORS_${scope}`,
              factorSetVersionId,
              factorSetVersion: "test-v1",
            },
          },
        },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });
  });

  afterAll(async () => {
    await prisma.benchmarkPacket.deleteMany({
      where: {
        organizationId: orgA.id,
      },
    });
    await prisma.benchmarkRequestItem.deleteMany({
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
    await prisma.benchmarkSubmission.deleteMany({
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

    await prisma.factorSetVersion.deleteMany({
      where: { id: factorSetVersionId },
    });
    await prisma.ruleVersion.deleteMany({
      where: { id: ruleVersionId },
    });
    await prisma.rulePackage.deleteMany({
      where: { key: `BENCHMARK_PACKET_RULES_${scope}` },
    });
    await prisma.sourceArtifact.deleteMany({
      where: { id: sourceArtifactId },
    });
  });

  function createCaller(authUserId: string, activeOrganizationId: string) {
    return appRouter.createCaller({
      authUserId,
      activeOrganizationId,
      prisma,
    });
  }

  it("supports the request item lifecycle for a building", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    const created = await caller.benchmarking.upsertRequestItem({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
      category: "UTILITY_BILLS",
      title: "Collect final utility bills",
      status: "REQUESTED",
      isRequired: true,
      requestedFrom: "Client contact",
      notes: "Need final December electric and gas bills.",
    });

    expect(created.status).toBe("REQUESTED");

    const updated = await caller.benchmarking.upsertRequestItem({
      requestItemId: created.id,
      buildingId: readyBuilding.id,
      reportingYear: 2025,
      category: "UTILITY_BILLS",
      title: "Collect final utility bills",
      status: "VERIFIED",
      isRequired: true,
      requestedFrom: "Client contact",
      notes: "Verified against uploaded bills.",
    });

    expect(updated.status).toBe("VERIFIED");

    const items = await caller.benchmarking.listRequestItems({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
    });
    expect(items.some((item) => item.id === created.id && item.status === "VERIFIED")).toBe(true);
  });

  it("supports Data Quality Checker request items", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    const created = await caller.benchmarking.upsertRequestItem({
      buildingId: readyBuilding.id,
      reportingYear: 2026,
      category: "DATA_QUALITY_CHECKER_SUPPORT",
      title: "Collect current Data Quality Checker workbook",
      status: "REQUESTED",
      isRequired: true,
      notes: "Needed before final verifier review.",
    });

    expect(created.category).toBe("DATA_QUALITY_CHECKER_SUPPORT");

    const items = await caller.benchmarking.listRequestItems({
      buildingId: readyBuilding.id,
      reportingYear: 2026,
    });

    expect(
      items.some(
        (item) =>
          item.id === created.id && item.category === "DATA_QUALITY_CHECKER_SUPPORT",
      ),
    ).toBe(true);
  });

  it("generates, stales, and finalizes benchmark packets deterministically", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    const generated = await caller.benchmarking.generateBenchmarkPacket({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
    });

    expect(generated.status).toBe("GENERATED");

    const manifest = await caller.benchmarking.getBenchmarkPacketManifest({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
    });
    expect(manifest?.disposition).toBe("READY");
    expect(manifest?.warnings).toHaveLength(0);

    const requestItem = await caller.benchmarking.upsertRequestItem({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
      category: "PORTFOLIO_MANAGER_ACCESS",
      title: "Confirm PM share acceptance",
      status: "REQUESTED",
      isRequired: true,
    });

    expect(requestItem.status).toBe("REQUESTED");

    const stalePacket = await caller.benchmarking.getLatestBenchmarkPacket({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
    });
    expect(stalePacket?.status).toBe("STALE");

    await caller.benchmarking.upsertRequestItem({
      requestItemId: requestItem.id,
      buildingId: readyBuilding.id,
      reportingYear: 2025,
      category: "PORTFOLIO_MANAGER_ACCESS",
      title: "Confirm PM share acceptance",
      status: "VERIFIED",
      isRequired: true,
    });

    const regenerated = await caller.benchmarking.generateBenchmarkPacket({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
    });
    expect(regenerated.version).toBeGreaterThan(generated.version);

    const finalized = await caller.benchmarking.finalizeBenchmarkPacket({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
    });
    expect(finalized.status).toBe("FINALIZED");

    const exported = await caller.benchmarking.exportBenchmarkPacket({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
      format: "JSON",
    });
    expect(exported.content).toContain("BENCHMARK_VERIFICATION_WORKPAPER");
    expect(exported.content).toContain("\"verificationSummary\"");

    const pdfExport = await caller.benchmarking.exportBenchmarkPacket({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
      format: "PDF",
    });
    const pdfText = Buffer.from(pdfExport.content, "base64").toString("latin1");

    expect(pdfExport.contentType).toBe("application/pdf");
    expect(pdfExport.fileName).toContain("benchmark-packet");
    expect(pdfExport.content.startsWith("JVBER")).toBe(true);
    expect(pdfText).toContain("Benchmark Verification Packet");
  });

  it("surfaces packet warnings and blocks finalization when readiness is blocked", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    const packet = await caller.benchmarking.generateBenchmarkPacket({
      buildingId: blockedBuilding.id,
      reportingYear: 2025,
    });

    expect(packet.status).toBe("GENERATED");

    const manifest = await caller.benchmarking.getBenchmarkPacketManifest({
      buildingId: blockedBuilding.id,
      reportingYear: 2025,
    });

    expect(manifest?.disposition).toBe("BLOCKED");
    expect(JSON.stringify(manifest?.warnings ?? [])).toContain("DC Real Property Unique ID is missing.");

    await expect(
      caller.benchmarking.finalizeBenchmarkPacket({
        buildingId: blockedBuilding.id,
        reportingYear: 2025,
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    const pdfExport = await caller.benchmarking.exportBenchmarkPacket({
      buildingId: blockedBuilding.id,
      reportingYear: 2025,
      format: "PDF",
    });
    const pdfText = Buffer.from(pdfExport.content, "base64").toString("latin1");

    expect(pdfExport.content.startsWith("JVBER")).toBe(true);
    expect(pdfText).toContain("Benchmark Verification Packet");
  });

  it("enforces tenant-safe access for request items and packets", async () => {
    const caller = createCaller(userB.authUserId, orgB.id);

    await expect(
      caller.benchmarking.listRequestItems({
        buildingId: readyBuilding.id,
        reportingYear: 2025,
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    await expect(
      caller.benchmarking.getLatestBenchmarkPacket({
        buildingId: readyBuilding.id,
        reportingYear: 2025,
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    await expect(
      caller.benchmarking.exportBenchmarkPacket({
        buildingId: readyBuilding.id,
        reportingYear: 2025,
        format: "PDF",
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("surfaces PDF export failures as normalized packet export errors", async () => {
    const caller = createCaller(userA.authUserId, orgA.id);

    await caller.benchmarking.generateBenchmarkPacket({
      buildingId: readyBuilding.id,
      reportingYear: 2025,
    });

    vi.spyOn(packetDocuments, "renderPacketDocumentPdfBase64").mockRejectedValueOnce(
      new Error("pdf renderer unavailable"),
    );

    await expect(
      caller.benchmarking.exportBenchmarkPacket({
        buildingId: readyBuilding.id,
        reportingYear: 2025,
        format: "PDF",
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Benchmark packet PDF export failed.",
    });
  });
});



