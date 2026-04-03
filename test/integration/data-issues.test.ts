import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { appRouter } from "@/server/trpc/routers";
import { refreshBuildingIssuesAfterDataChange } from "@/server/compliance/data-issues";

describe("data issue resolution workflow", () => {
  const scope = `data-issues-${Date.now()}`;

  let org: { id: string };
  let user: { id: string; authUserId: string };
  let benchmarkRuleVersion: { id: string };
  let benchmarkFactorSetVersion: { id: string };
  let blockingBuilding: { id: string };
  let warningBuilding: { id: string };

  function createCaller(requestId: string) {
    return appRouter.createCaller({
      requestId,
      authUserId: user.authUserId,
      activeOrganizationId: org.id,
      prisma,
    });
  }

  function toInputJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  function createBenchmarkPayload(input: {
    reportingYear: number;
    qaVerdict: "PASS" | "WARN" | "FAIL";
    qaIssues: Array<{
      issueType: string;
      message: string;
      details?: Record<string, unknown>;
    }>;
  }) {
    return {
      complianceEngine: {
        engineVersion: "v1",
        scope: "BENCHMARKING",
        status: input.qaVerdict === "FAIL" ? "BLOCKED" : "COMPUTED",
        applicability: "APPLICABLE",
        reportingYear: input.reportingYear,
        rulePackageKey: "DC_BENCHMARKING_2025",
        ruleVersionId: benchmarkRuleVersion.id,
        ruleVersion: "data-issues-test-v1",
        factorSetKey: "DC_CURRENT_STANDARDS",
        factorSetVersionId: benchmarkFactorSetVersion.id,
        factorSetVersion: "data-issues-test-v1",
        metricUsed: "ANNUAL_BENCHMARKING_READINESS",
        qa: {
          verdict: input.qaVerdict,
          gate:
            input.qaVerdict === "PASS"
              ? "PASSED"
              : input.qaVerdict === "WARN"
                ? "PROCEEDED_WITH_WARNINGS"
                : "BLOCKED",
          targetYear: input.reportingYear,
          issues: input.qaIssues.map((issue) => ({
            issueType: issue.issueType,
            message: issue.message,
            details: issue.details ?? {},
          })),
        },
        reasonCodes: input.qaIssues.map((issue) => issue.issueType),
        decision: {
          meetsStandard: input.qaVerdict === "PASS",
          blocked: input.qaVerdict === "FAIL",
          insufficientData: input.qaVerdict === "FAIL",
        },
        domainResult: {
          readiness: {
            status: input.qaVerdict === "FAIL" ? "BLOCKED" : "READY",
          },
        },
      },
    };
  }

  async function seedPassingVerificationItems(buildingId: string, reportingYear: number) {
    const now = new Date();
    await prisma.verificationItemResult.createMany({
      data: [
        {
          organizationId: org.id,
          buildingId,
          reportingYear,
          category: "PROPERTY_METADATA",
          key: "property_metadata",
          status: "PASS",
          explanation: "Property metadata is present.",
          evidenceRefs: [],
          createdAt: now,
        },
        {
          organizationId: org.id,
          buildingId,
          reportingYear,
          category: "GFA",
          key: "gross_floor_area",
          status: "PASS",
          explanation: "Gross floor area support is linked.",
          evidenceRefs: [],
          createdAt: now,
        },
        {
          organizationId: org.id,
          buildingId,
          reportingYear,
          category: "METER_COMPLETENESS",
          key: "meter_completeness",
          status: "PASS",
          explanation: "All active meters have annual readings.",
          evidenceRefs: [],
          createdAt: now,
        },
        {
          organizationId: org.id,
          buildingId,
          reportingYear,
          category: "DATA_COVERAGE",
          key: "data_coverage",
          status: "PASS",
          explanation: "Annual coverage is complete.",
          evidenceRefs: [],
          createdAt: now,
        },
        {
          organizationId: org.id,
          buildingId,
          reportingYear,
          category: "METRIC_AVAILABILITY",
          key: "metric_availability",
          status: "PASS",
          explanation: "Benchmarking metrics are available.",
          evidenceRefs: [],
          createdAt: now,
        },
        {
          organizationId: org.id,
          buildingId,
          reportingYear,
          category: "PM_LINKAGE",
          key: "portfolio_manager_linkage",
          status: "PASS",
          explanation: "Portfolio Manager linkage is active.",
          evidenceRefs: [],
          createdAt: now,
        },
        {
          organizationId: org.id,
          buildingId,
          reportingYear,
          category: "DQC",
          key: "data_quality_checker",
          status: "PASS",
          explanation: "DQC support is linked.",
          evidenceRefs: [],
          createdAt: now,
        },
      ],
    });
  }

  beforeAll(async () => {
    const sourceArtifact = await prisma.sourceArtifact.create({
      data: {
        artifactType: "LAW",
        name: `Data issue law ${scope}`,
        externalUrl: "https://example.com/data-issues-law",
        metadata: { scope },
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

    const benchmarkRulePackage = await prisma.rulePackage.upsert({
      where: { key: "DC_BENCHMARKING_2025" },
      update: {
        name: "DC Benchmarking Annual Submission Workflow",
      },
      create: {
        key: "DC_BENCHMARKING_2025",
        name: "DC Benchmarking Annual Submission Workflow",
      },
    });

    benchmarkRuleVersion = await prisma.ruleVersion.upsert({
      where: {
        rulePackageId_version: {
          rulePackageId: benchmarkRulePackage.id,
          version: "data-issues-test-v1",
        },
      },
      update: {
        sourceArtifactId: sourceArtifact.id,
        status: "ACTIVE",
        implementationKey: "benchmarking/readiness-v1",
        configJson: {},
      },
      create: {
        rulePackageId: benchmarkRulePackage.id,
        version: "data-issues-test-v1",
        status: "ACTIVE",
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        implementationKey: "benchmarking/readiness-v1",
        sourceArtifactId: sourceArtifact.id,
        configJson: {},
      },
      select: { id: true },
    });

    benchmarkFactorSetVersion = await prisma.factorSetVersion.upsert({
      where: {
        key_version: {
          key: "DC_CURRENT_STANDARDS",
          version: "data-issues-test-v1",
        },
      },
      update: {
        sourceArtifactId: sourceArtifact.id,
        status: "ACTIVE",
        factorsJson: {},
      },
      create: {
        key: "DC_CURRENT_STANDARDS",
        version: "data-issues-test-v1",
        status: "ACTIVE",
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        sourceArtifactId: sourceArtifact.id,
        factorsJson: {},
      },
      select: { id: true },
    });

    org = await prisma.organization.create({
      data: {
        name: `Data Issues Org ${scope}`,
        slug: `data-issues-${scope}`,
      },
      select: { id: true },
    });

    user = await prisma.user.create({
      data: {
        authUserId: `user_${scope}`,
        email: `${scope}@example.com`,
        name: "Data Issues User",
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

    blockingBuilding = await prisma.building.create({
      data: {
        organizationId: org.id,
        name: `Blocking Building ${scope}`,
        address: "101 Resolution Ave NW, Washington, DC 20001",
        latitude: 38.91,
        longitude: -77.02,
        grossSquareFeet: 40000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        doeeBuildingId: "RPUID-111111",
        espmPropertyId: BigInt(111111),
        espmShareStatus: "LINKED",
        bepsTargetScore: 71,
      },
      select: { id: true },
    });

    warningBuilding = await prisma.building.create({
      data: {
        organizationId: org.id,
        name: `Warning Building ${scope}`,
        address: "102 Resolution Ave NW, Washington, DC 20001",
        latitude: 38.92,
        longitude: -77.03,
        grossSquareFeet: 40000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        doeeBuildingId: "RPUID-222222",
        espmPropertyId: BigInt(222222),
        espmShareStatus: "LINKED",
        bepsTargetScore: 71,
      },
      select: { id: true },
    });

    await prisma.portfolioManagerSyncState.createMany({
      data: [
        {
          organizationId: org.id,
          buildingId: blockingBuilding.id,
          status: "SUCCEEDED",
          lastSuccessfulSyncAt: new Date("2026-03-18T12:00:00.000Z"),
          sourceMetadata: {},
          syncMetadata: {},
          qaPayload: {},
        },
        {
          organizationId: org.id,
          buildingId: warningBuilding.id,
          status: "SUCCEEDED",
          lastSuccessfulSyncAt: new Date("2026-03-18T12:00:00.000Z"),
          sourceMetadata: {},
          syncMetadata: {},
          qaPayload: {},
        },
      ],
    });

    await prisma.complianceSnapshot.createMany({
      data: [
        {
          organizationId: org.id,
          buildingId: blockingBuilding.id,
          snapshotDate: new Date("2025-12-31T00:00:00.000Z"),
          triggerType: "MANUAL",
          complianceStatus: "PENDING_DATA",
          energyStarScore: 75,
          sourceEui: 120,
        },
        {
          organizationId: org.id,
          buildingId: warningBuilding.id,
          snapshotDate: new Date("2025-12-31T00:00:00.000Z"),
          triggerType: "MANUAL",
          complianceStatus: "PENDING_DATA",
          energyStarScore: 72,
          sourceEui: 118,
        },
      ],
    });

    await seedPassingVerificationItems(blockingBuilding.id, 2025);
    await seedPassingVerificationItems(warningBuilding.id, 2025);

    await prisma.benchmarkSubmission.createMany({
      data: [
        {
          organizationId: org.id,
          buildingId: blockingBuilding.id,
          reportingYear: 2025,
          ruleVersionId: benchmarkRuleVersion.id,
          factorSetVersionId: benchmarkFactorSetVersion.id,
          status: "BLOCKED",
          submissionPayload: toInputJson(
            createBenchmarkPayload({
              reportingYear: 2025,
              qaVerdict: "FAIL",
              qaIssues: [
                {
                  issueType: "MISSING_MONTHS",
                  message: "Utility data is missing one reporting month.",
                  details: { missingMonths: ["2025-12"] },
                },
              ],
            }),
          ),
          createdByType: "SYSTEM",
          createdById: "test",
        },
        {
          organizationId: org.id,
          buildingId: warningBuilding.id,
          reportingYear: 2025,
          ruleVersionId: benchmarkRuleVersion.id,
          factorSetVersionId: benchmarkFactorSetVersion.id,
          status: "READY",
          submissionPayload: toInputJson(
            createBenchmarkPayload({
              reportingYear: 2025,
              qaVerdict: "WARN",
              qaIssues: [
                {
                  issueType: "NO_DIRECT_YEAR_READINGS",
                  message: "Direct annual readings are missing.",
                },
              ],
            }),
          ),
          createdByType: "SYSTEM",
          createdById: "test",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.meterSourceReconciliation.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.buildingSourceReconciliation.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.greenButtonConnection.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.dataIssue.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.verificationItemResult.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.benchmarkSubmission.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.complianceSnapshot.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.benchmarkPacket.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.complianceRun.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.portfolioManagerSyncState.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.building.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.organizationMembership.deleteMany({
      where: {
        organizationId: org?.id,
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: user?.id,
      },
    });
    await prisma.organization.deleteMany({
      where: {
        id: org?.id,
      },
    });
    await prisma.sourceArtifact.deleteMany({
      where: {
        metadata: {
          path: ["scope"],
          equals: scope,
        },
      },
    });
  });

  it("creates blocking issues from QA output without duplicating them on refresh", async () => {
    const first = await refreshBuildingIssuesAfterDataChange({
      organizationId: org.id,
      buildingId: blockingBuilding.id,
      actorType: "SYSTEM",
      actorId: "test",
      requestId: `blocking-refresh-1-${scope}`,
    });

    expect(first.state).toBe("DATA_INCOMPLETE");
    expect(first.blockingIssueCount).toBe(1);
    expect(
      first.openIssues.filter(
        (issue) => issue.issueType === "MISSING_MONTHS" && issue.status === "OPEN",
      ),
    ).toHaveLength(1);
    expect(first.openIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueType: "MISSING_MONTHS",
          severity: "BLOCKING",
          status: "OPEN",
        }),
        expect.objectContaining({
          issueType: "PM_SYNC_REQUIRED",
          severity: "WARNING",
          status: "OPEN",
        }),
      ]),
    );

    const second = await refreshBuildingIssuesAfterDataChange({
      organizationId: org.id,
      buildingId: blockingBuilding.id,
      actorType: "SYSTEM",
      actorId: "test",
      requestId: `blocking-refresh-2-${scope}`,
    });

    expect(second.state).toBe("DATA_INCOMPLETE");
    expect(
      await prisma.dataIssue.count({
        where: {
          organizationId: org.id,
          buildingId: blockingBuilding.id,
          issueType: "MISSING_MONTHS",
        },
      }),
    ).toBe(1);

    const building = await createCaller(`building-get-${scope}`).building.get({
      id: blockingBuilding.id,
    });

    expect(building.issueSummary.openIssues).toHaveLength(2);
    expect(building.issueSummary.openIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueType: "MISSING_MONTHS",
        }),
        expect.objectContaining({
          issueType: "PM_SYNC_REQUIRED",
        }),
      ]),
    );
    expect(building.readinessSummary).toMatchObject({
      state: "DATA_INCOMPLETE",
      primaryStatus: "DATA_INCOMPLETE",
      qaVerdict: "FAIL",
      reasonSummary: "Missing Months",
    });
    expect(building.readinessSummary.evaluations.benchmark).toMatchObject({
      reportingYear: 2025,
      ruleVersion: "data-issues-test-v1",
      metricUsed: "ANNUAL_BENCHMARKING_READINESS",
      qaVerdict: "FAIL",
    });
    expect(building.readinessSummary.artifacts.benchmarkSubmission?.id).toBeTruthy();
    expect(building.readinessSummary.lastReadinessEvaluatedAt).toBeNull();
    expect(building.readinessSummary.lastComplianceEvaluatedAt).toBeNull();
    expect(building.governedSummary.readinessSummary).toEqual(building.readinessSummary);
    expect((building as Record<string, unknown>).latestBenchmarkSubmission).toBeUndefined();
    expect((building as Record<string, unknown>).latestBepsFiling).toBeUndefined();

    const list = await createCaller(`building-list-${scope}`).building.list({
      page: 1,
      pageSize: 10,
      sortBy: "name",
      sortOrder: "asc",
    });
    const listedBuilding = list.buildings.find(
      (candidate) => candidate.id === blockingBuilding.id,
    );

    expect(listedBuilding?.readinessSummary.state).toBe("DATA_INCOMPLETE");
    expect(listedBuilding?.readinessSummary.primaryStatus).toBe("DATA_INCOMPLETE");
    expect(listedBuilding?.readinessSummary).toEqual(building.readinessSummary);
    expect(listedBuilding?.governedSummary.readinessSummary).toEqual(
      building.governedSummary.readinessSummary,
    );
    expect((listedBuilding as Record<string, unknown>)?.latestBenchmarkSubmission).toBeUndefined();
    expect((listedBuilding as Record<string, unknown>)?.latestBepsFiling).toBeUndefined();
  });

  it("resolves blocking issues and moves to ready to submit when the data condition is fixed", async () => {
    await prisma.benchmarkSubmission.update({
      where: {
        buildingId_reportingYear: {
          buildingId: blockingBuilding.id,
          reportingYear: 2025,
        },
      },
      data: {
        status: "READY",
        submissionPayload: toInputJson(
          createBenchmarkPayload({
            reportingYear: 2025,
            qaVerdict: "PASS",
            qaIssues: [],
          }),
        ),
      },
    });

    const summary = await refreshBuildingIssuesAfterDataChange({
      organizationId: org.id,
      buildingId: blockingBuilding.id,
      actorType: "SYSTEM",
      actorId: "test",
      requestId: `blocking-refresh-fixed-${scope}`,
    });

    expect(summary.state).toBe("READY_TO_SUBMIT");
    expect(summary.blockingIssueCount).toBe(0);

    const issue = await prisma.dataIssue.findFirstOrThrow({
      where: {
        organizationId: org.id,
        buildingId: blockingBuilding.id,
        issueType: "MISSING_MONTHS",
      },
    });

    expect(issue.status).toBe("RESOLVED");
    expect(issue.resolvedAt).not.toBeNull();
  });

  it("allows warning issues to be dismissed and reopens them if reevaluation still finds the same condition", async () => {
    await refreshBuildingIssuesAfterDataChange({
      organizationId: org.id,
      buildingId: warningBuilding.id,
      actorType: "SYSTEM",
      actorId: "test",
      requestId: `warning-refresh-${scope}`,
    });

    const issue = await prisma.dataIssue.findFirstOrThrow({
      where: {
        organizationId: org.id,
        buildingId: warningBuilding.id,
        issueType: "DIRECT_READINGS_MISSING",
      },
    });

    const caller = createCaller(`warning-update-${scope}`);
    await caller.building.updateIssueStatus({
      buildingId: warningBuilding.id,
      issueId: issue.id,
      nextStatus: "DISMISSED",
    });

    const dismissed = await prisma.dataIssue.findUniqueOrThrow({
      where: { id: issue.id },
    });
    expect(dismissed.status).toBe("DISMISSED");

    const refreshed = await refreshBuildingIssuesAfterDataChange({
      organizationId: org.id,
      buildingId: warningBuilding.id,
      actorType: "SYSTEM",
      actorId: "test",
      requestId: `warning-reopen-${scope}`,
    });

    const reopened = await prisma.dataIssue.findUniqueOrThrow({
      where: { id: issue.id },
    });
    expect(reopened.status).toBe("OPEN");
    expect(refreshed.state).toBe("READY_TO_SUBMIT");
    expect(refreshed.warningIssueCount).toBe(2);
  });

  it("keeps readiness timestamps distinct and stable", async () => {
    const executedAt = new Date("2026-03-18T10:30:00.000Z");
    const readinessEvaluatedAt = new Date("2026-03-18T09:15:00.000Z");
    const packetGeneratedAt = new Date("2026-03-18T11:00:00.000Z");
    const packetFinalizedAt = new Date("2026-03-18T11:30:00.000Z");

    const complianceRun = await prisma.complianceRun.create({
      data: {
        organizationId: org.id,
        buildingId: warningBuilding.id,
        ruleVersionId: benchmarkRuleVersion.id,
        factorSetVersionId: benchmarkFactorSetVersion.id,
        runType: "BENCHMARKING_EVALUATION",
        status: "SUCCEEDED",
        inputSnapshotRef: "test:data-issues",
        inputSnapshotHash: `hash-${scope}`,
        resultPayload: {},
        producedByType: "SYSTEM",
        producedById: "test",
        executedAt,
      },
      select: { id: true },
    });

    await prisma.benchmarkSubmission.update({
      where: {
        buildingId_reportingYear: {
          buildingId: warningBuilding.id,
          reportingYear: 2025,
        },
      },
      data: {
        complianceRunId: complianceRun.id,
        readinessEvaluatedAt,
      },
    });

    const submission = await prisma.benchmarkSubmission.findUniqueOrThrow({
      where: {
        buildingId_reportingYear: {
          buildingId: warningBuilding.id,
          reportingYear: 2025,
        },
      },
      select: { id: true },
    });

    await prisma.benchmarkPacket.create({
      data: {
        organizationId: org.id,
        buildingId: warningBuilding.id,
        benchmarkSubmissionId: submission.id,
        reportingYear: 2025,
        version: 1,
        status: "FINALIZED",
        packetHash: `hash-${scope}`,
        packetPayload: {},
        generatedAt: packetGeneratedAt,
        finalizedAt: packetFinalizedAt,
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

    const building = await createCaller(`building-get-timestamps-${scope}`).building.get({
      id: warningBuilding.id,
    });

    expect(building.readinessSummary.lastReadinessEvaluatedAt).toBe(
      readinessEvaluatedAt.toISOString(),
    );
    expect(building.readinessSummary.lastComplianceEvaluatedAt).toBe(
      executedAt.toISOString(),
    );
    expect(building.readinessSummary.lastPacketGeneratedAt).toBe(
      packetGeneratedAt.toISOString(),
    );
    expect(building.readinessSummary.lastPacketFinalizedAt).toBe(
      packetFinalizedAt.toISOString(),
    );
    expect(
      building.readinessSummary.evaluations.benchmark?.lastComplianceEvaluatedAt,
    ).toBe(executedAt.toISOString());
    expect(
      building.readinessSummary.artifacts.benchmarkSubmission?.lastReadinessEvaluatedAt,
    ).toBe(readinessEvaluatedAt.toISOString());
    expect(building.readinessSummary.artifacts.benchmarkPacket?.generatedAt).toBe(
      packetGeneratedAt.toISOString(),
    );
  });
});


