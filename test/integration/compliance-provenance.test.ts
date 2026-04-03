import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { prisma } from "@/server/lib/db";
import { appRouter } from "@/server/trpc/routers";
import {
  ComplianceProvenanceError,
  createBenchmarkSubmissionRecord,
  createFactorSetVersion,
  createFilingRecord,
  createRuleVersion,
  recordComplianceEvaluation,
} from "@/server/compliance/provenance";

describe("compliance provenance core", () => {
  const scope = `${Date.now()}`;

  let orgA: { id: string };
  let orgB: { id: string };
  let userA: { id: string; authUserId: string };
  let userB: { id: string; authUserId: string };
  let buildingA: { id: string };
  let buildingB: { id: string };
  let sharedRuleVersion: { id: string };
  let sharedFactorSetVersion: { id: string };

  beforeAll(async () => {
    orgA = await prisma.organization.create({
      data: {
        name: `Provenance Org A ${scope}`,
        slug: `provenance-org-a-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    orgB = await prisma.organization.create({
      data: {
        name: `Provenance Org B ${scope}`,
        slug: `provenance-org-b-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    userA = await prisma.user.create({
      data: {
        authUserId: `supabase_provenance_user_a_${scope}`,
        email: `provenance_a_${scope}@test.com`,
        name: "Provenance User A",
      },
      select: { id: true, authUserId: true },
    });

    userB = await prisma.user.create({
      data: {
        authUserId: `supabase_provenance_user_b_${scope}`,
        email: `provenance_b_${scope}@test.com`,
        name: "Provenance User B",
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
        name: `Provenance Building A ${scope}`,
        address: "501 Test St NW, Washington, DC 20001",
        latitude: 38.91,
        longitude: -77.02,
        grossSquareFeet: 100000,
        propertyType: "OFFICE",
        bepsTargetScore: 71,
        maxPenaltyExposure: 1000000,
      },
      select: { id: true },
    });

    buildingB = await prisma.building.create({
      data: {
        organizationId: orgB.id,
        name: `Provenance Building B ${scope}`,
        address: "601 Test St NW, Washington, DC 20001",
        latitude: 38.92,
        longitude: -77.03,
        grossSquareFeet: 85000,
        propertyType: "MULTIFAMILY",
        bepsTargetScore: 66,
        maxPenaltyExposure: 850000,
      },
      select: { id: true },
    });

    const sourceArtifact = await prisma.sourceArtifact.create({
      data: {
        artifactType: "GUIDE",
        name: `Shared provenance source ${scope}`,
        externalUrl: "https://example.com/provenance-test",
        metadata: { scope },
        createdByType: "SYSTEM",
        createdById: "test",
      },
      select: { id: true },
    });

    const sharedRulePackage = await prisma.rulePackage.create({
      data: {
        key: `TEST_BEPS_${scope}`,
        name: "Shared Test Rule Package",
        description: "Shared rule package for compliance provenance tests.",
      },
      select: { id: true },
    });

    sharedRuleVersion = await createRuleVersion({
      rulePackageId: sharedRulePackage.id,
      sourceArtifactId: sourceArtifact.id,
      version: "v1",
      status: "ACTIVE",
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      implementationKey: "tests/shared-rule-v1",
      sourceMetadata: { scope, bootstrap: false },
      configJson: { targetScore: 71 },
    });

    sharedFactorSetVersion = await createFactorSetVersion({
      key: `TEST_FACTORS_${scope}`,
      sourceArtifactId: sourceArtifact.id,
      version: "v1",
      status: "ACTIVE",
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      sourceMetadata: { scope, bootstrap: false },
      factorsJson: {
        penaltyPerSquareFoot: 10,
      },
    });
  });

  afterAll(async () => {
    await prisma.evidenceArtifact.deleteMany({
      where: {
        buildingId: { in: [buildingA.id, buildingB.id] },
      },
    });
    await prisma.filingRecord.deleteMany({
      where: {
        buildingId: { in: [buildingA.id, buildingB.id] },
      },
    });
    await prisma.benchmarkSubmission.deleteMany({
      where: {
        buildingId: { in: [buildingA.id, buildingB.id] },
      },
    });
    await prisma.complianceSnapshot.deleteMany({
      where: {
        buildingId: { in: [buildingA.id, buildingB.id] },
      },
    });
    await prisma.complianceRun.deleteMany({
      where: {
        buildingId: { in: [buildingA.id, buildingB.id] },
      },
    });
    await prisma.factorSetVersion.deleteMany({
      where: {
        key: { startsWith: "TEST_FACTORS_" },
      },
    });
    await prisma.ruleVersion.deleteMany({
      where: {
        rulePackage: {
          key: { startsWith: "TEST_" },
        },
      },
    });
    await prisma.rulePackage.deleteMany({
      where: {
        key: { startsWith: "TEST_" },
      },
    });
    await prisma.sourceArtifact.deleteMany({
      where: {
        OR: [
          { name: { contains: scope } },
          { externalUrl: "https://example.com/provenance-test" },
        ],
      },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await prisma.user.deleteMany({
      where: {
        authUserId: {
          startsWith: "supabase_provenance_user_",
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

  async function createRunForBuilding(
    organizationId: string,
    buildingId: string,
    inputRef: string,
  ) {
    return recordComplianceEvaluation({
      organizationId,
      buildingId,
      ruleVersionId: sharedRuleVersion.id,
      factorSetVersionId: sharedFactorSetVersion.id,
      runType: "BEPS_EVALUATION",
      status: "SUCCEEDED",
      inputSnapshotRef: inputRef,
      inputSnapshotPayload: {
        scope,
        buildingId,
        inputRef,
      },
      resultPayload: {
        complianceStatus: "AT_RISK",
        estimatedPenalty: 123000,
      },
      producedByType: "SYSTEM",
      producedById: "test-system",
      manifest: {
        implementationKey: "tests/provenance-record-v1",
        codeVersion: "test-sha",
        payload: {
          scope,
        },
      },
      snapshotData: {
        triggerType: "MANUAL",
        complianceStatus: "AT_RISK",
        energyStarScore: 68,
        siteEui: 72.5,
        sourceEui: 146.3,
        complianceGap: -3,
        estimatedPenalty: 123000,
        dataQualityScore: 95,
        penaltyInputsJson: {
          scope,
        },
      },
      evidenceArtifacts: [
        {
          artifactType: "SYSTEM_NOTE",
          name: `Evidence note ${inputRef}`,
          artifactRef: inputRef,
          metadata: {
            scope,
          },
        },
      ],
    });
  }

  it("keeps prior rule version content immutable when activating a new version", async () => {
    const sourceArtifact = await prisma.sourceArtifact.create({
      data: {
        artifactType: "GUIDE",
        name: `Immutable rule source ${scope}`,
        externalUrl: "https://example.com/provenance-test",
        metadata: { scope, purpose: "immutability" },
        createdByType: "SYSTEM",
        createdById: "test",
      },
      select: { id: true },
    });

    const rulePackage = await prisma.rulePackage.create({
      data: {
        key: `TEST_IMMUTABLE_${scope}`,
        name: "Immutable Rule Package",
      },
      select: { id: true },
    });

    const v1 = await createRuleVersion({
      rulePackageId: rulePackage.id,
      sourceArtifactId: sourceArtifact.id,
      version: "v1",
      status: "ACTIVE",
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      implementationKey: "tests/immutable/v1",
      configJson: { targetScore: 71 },
    });

    const v2 = await createRuleVersion({
      rulePackageId: rulePackage.id,
      sourceArtifactId: sourceArtifact.id,
      version: "v2",
      status: "ACTIVE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      implementationKey: "tests/immutable/v2",
      configJson: { targetScore: 74 },
    });

    const persistedVersions = await prisma.ruleVersion.findMany({
      where: { rulePackageId: rulePackage.id },
      orderBy: { version: "asc" },
    });

    expect(persistedVersions).toHaveLength(2);
    expect(persistedVersions[0]?.id).toBe(v1.id);
    expect(persistedVersions[0]?.status).toBe("SUPERSEDED");
    expect(persistedVersions[0]?.configJson).toMatchObject({ targetScore: 71 });
    expect(persistedVersions[1]?.id).toBe(v2.id);
    expect(persistedVersions[1]?.status).toBe("ACTIVE");
    expect(persistedVersions[1]?.configJson).toMatchObject({ targetScore: 74 });
  });

  it("creates a compliance run with manifest, refs, snapshot, and evidence", async () => {
    const result = await createRunForBuilding(
      orgA.id,
      buildingA.id,
      `run-${scope}-a`,
    );

    expect(result.complianceRun.ruleVersionId).toBe(sharedRuleVersion.id);
    expect(result.complianceRun.factorSetVersionId).toBe(sharedFactorSetVersion.id);
    expect(result.manifest.complianceRunId).toBe(result.complianceRun.id);
    expect(result.manifest.inputSnapshotRef).toBe(`run-${scope}-a`);
    expect(result.complianceSnapshot?.complianceRunId).toBe(result.complianceRun.id);

    const artifacts = await prisma.evidenceArtifact.findMany({
      where: { complianceRunId: result.complianceRun.id },
      orderBy: { createdAt: "asc" },
    });

    expect(artifacts).toHaveLength(2);
    expect(artifacts.some((artifact) => artifact.artifactType === "CALCULATION_OUTPUT")).toBe(
      true,
    );
    expect(artifacts.some((artifact) => artifact.artifactType === "SYSTEM_NOTE")).toBe(true);
  });

  it("creates a benchmark submission record", async () => {
    const run = await createRunForBuilding(orgA.id, buildingA.id, `benchmark-${scope}`);

    const submission = await createBenchmarkSubmissionRecord({
      organizationId: orgA.id,
      buildingId: buildingA.id,
      reportingYear: 2025,
      ruleVersionId: sharedRuleVersion.id,
      factorSetVersionId: sharedFactorSetVersion.id,
      complianceRunId: run.complianceRun.id,
      status: "IN_REVIEW",
      submissionPayload: {
        scope,
        type: "benchmark",
      },
      createdByType: "USER",
      createdById: "tester",
    });

    expect(submission.reportingYear).toBe(2025);
    expect(submission.status).toBe("IN_REVIEW");
    expect(submission.complianceRunId).toBe(run.complianceRun.id);
  });

  it("creates a filing record", async () => {
    const run = await createRunForBuilding(orgA.id, buildingA.id, `filing-${scope}`);
    const submission = await createBenchmarkSubmissionRecord({
      organizationId: orgA.id,
      buildingId: buildingA.id,
      reportingYear: 2026,
      ruleVersionId: sharedRuleVersion.id,
      factorSetVersionId: sharedFactorSetVersion.id,
      complianceRunId: run.complianceRun.id,
      status: "SUBMITTED",
      submissionPayload: {
        scope,
        type: "benchmark",
      },
      createdByType: "USER",
      createdById: "tester",
    });

    const filing = await createFilingRecord({
      organizationId: orgA.id,
      buildingId: buildingA.id,
      filingType: "BEPS_COMPLIANCE",
      filingYear: 2026,
      complianceCycle: "CYCLE_1",
      benchmarkSubmissionId: submission.id,
      complianceRunId: run.complianceRun.id,
      status: "GENERATED",
      filingPayload: {
        scope,
        packet: "generated",
      },
      packetUri: "s3://test/packet.pdf",
      createdByType: "USER",
      createdById: "tester",
    });

    expect(filing.filingType).toBe("BEPS_COMPLIANCE");
    expect(filing.status).toBe("GENERATED");
    expect(filing.benchmarkSubmissionId).toBe(submission.id);
    expect(filing.complianceRunId).toBe(run.complianceRun.id);
  });

  it("rejects missing provenance references", async () => {
    await expect(
      recordComplianceEvaluation({
        organizationId: orgA.id,
        buildingId: buildingA.id,
        ruleVersionId: "missing-rule",
        factorSetVersionId: sharedFactorSetVersion.id,
        runType: "BEPS_EVALUATION",
        inputSnapshotRef: `missing-${scope}`,
        inputSnapshotPayload: { scope },
        resultPayload: { scope },
        producedByType: "SYSTEM",
        producedById: "test-system",
        manifest: {
          implementationKey: "tests/missing-ref",
        },
      }),
    ).rejects.toBeInstanceOf(ComplianceProvenanceError);
  });

  it("retrieves provenance records only within the authenticated tenant", async () => {
    const runA = await createRunForBuilding(orgA.id, buildingA.id, `tenant-a-${scope}`);
    const runB = await createRunForBuilding(orgB.id, buildingB.id, `tenant-b-${scope}`);

    await createBenchmarkSubmissionRecord({
      organizationId: orgA.id,
      buildingId: buildingA.id,
      reportingYear: 2027,
      ruleVersionId: sharedRuleVersion.id,
      factorSetVersionId: sharedFactorSetVersion.id,
      complianceRunId: runA.complianceRun.id,
      status: "IN_REVIEW",
      submissionPayload: { scope, tenant: "A" },
      createdByType: "USER",
      createdById: "tester",
    });

    await createFilingRecord({
      organizationId: orgA.id,
      buildingId: buildingA.id,
      filingType: "BENCHMARKING",
      filingYear: 2027,
      complianceRunId: runA.complianceRun.id,
      status: "GENERATED",
      filingPayload: { scope, tenant: "A" },
      createdByType: "USER",
      createdById: "tester",
    });

    await createBenchmarkSubmissionRecord({
      organizationId: orgB.id,
      buildingId: buildingB.id,
      reportingYear: 2028,
      ruleVersionId: sharedRuleVersion.id,
      factorSetVersionId: sharedFactorSetVersion.id,
      complianceRunId: runB.complianceRun.id,
      status: "IN_REVIEW",
      submissionPayload: { scope, tenant: "B" },
      createdByType: "USER",
      createdById: "tester",
    });

    await createFilingRecord({
      organizationId: orgB.id,
      buildingId: buildingB.id,
      filingType: "BENCHMARKING",
      filingYear: 2028,
      complianceRunId: runB.complianceRun.id,
      status: "GENERATED",
      filingPayload: { scope, tenant: "B" },
      createdByType: "USER",
      createdById: "tester",
    });

    const callerA = createCaller(userA.authUserId, orgA.id);
    const callerB = createCaller(userB.authUserId, orgB.id);

    const runsForA = await callerA.provenance.complianceRuns({
      buildingId: buildingA.id,
      limit: 20,
    });
    const submissionsForA = await callerA.provenance.benchmarkSubmissions({
      buildingId: buildingA.id,
      limit: 20,
    });
    const filingsForA = await callerA.provenance.filingRecords({
      buildingId: buildingA.id,
      limit: 20,
    });

    expect(runsForA.some((run) => run.id === runA.complianceRun.id)).toBe(true);
    expect(runsForA.some((run) => run.id === runB.complianceRun.id)).toBe(false);
    expect(submissionsForA.length).toBeGreaterThan(0);
    expect(filingsForA.length).toBeGreaterThan(0);

    await expect(
      callerA.provenance.complianceRuns({
        buildingId: buildingB.id,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    const runsForB = await callerB.provenance.complianceRuns({
      buildingId: buildingB.id,
      limit: 20,
    });
    expect(runsForB.some((run) => run.id === runB.complianceRun.id)).toBe(true);
    expect(runsForB.some((run) => run.id === runA.complianceRun.id)).toBe(false);
  });
});



