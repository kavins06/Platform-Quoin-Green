import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { appRouter } from "@/server/trpc/routers";
import {
  finalizeBenchmarkPacket,
  generateBenchmarkPacket,
} from "@/server/compliance/benchmark-packets";

describe("submission workflows", () => {
  const scope = `submission-workflows-${Date.now()}`;

  let org: { id: string };
  let user: { id: string; authUserId: string };
  let building: { id: string };
  let benchmarkRuleVersionId: string;
  let benchmarkFactorSetVersionId: string;

  function toInputJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  function createCaller(requestId: string) {
    return appRouter.createCaller({
      requestId,
      authUserId: user.authUserId,
      activeOrganizationId: org.id,
      prisma,
    });
  }

  function createBenchmarkPayload(reportingYear: number) {
    return {
      complianceEngine: {
        engineVersion: "v1",
        scope: "BENCHMARKING",
        status: "COMPUTED",
        applicability: "APPLICABLE",
        reportingYear,
        rulePackageKey: "DC_BENCHMARKING_2025",
        ruleVersionId: benchmarkRuleVersionId,
        ruleVersion: "submission-workflows-v1",
        factorSetKey: "DC_CURRENT_STANDARDS",
        factorSetVersionId: benchmarkFactorSetVersionId,
        factorSetVersion: "submission-workflows-v1",
        metricUsed: "ANNUAL_BENCHMARKING_READINESS",
        qa: {
          verdict: "PASS",
          gate: "PASSED",
          targetYear: reportingYear,
          issues: [],
        },
        reasonCodes: ["BENCHMARK_READY"],
        decision: {
          meetsStandard: true,
          blocked: false,
          insufficientData: false,
        },
        domainResult: {
          readiness: {
            status: "READY",
          },
        },
      },
      readiness: {
        status: "READY",
        summary: {
          coverageComplete: true,
          pmShareState: "READY",
        },
      },
    };
  }

  beforeAll(async () => {
    const sourceArtifact = await prisma.sourceArtifact.create({
      data: {
        artifactType: "LAW",
        name: `Submission workflow source ${scope}`,
        externalUrl: `https://example.com/submission-workflows/${scope}`,
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

    benchmarkRuleVersionId = (
      await prisma.ruleVersion.upsert({
        where: {
          rulePackageId_version: {
            rulePackageId: benchmarkRulePackage.id,
            version: "submission-workflows-v1",
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
          version: "submission-workflows-v1",
          status: "ACTIVE",
          effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
          implementationKey: "benchmarking/readiness-v1",
          sourceArtifactId: sourceArtifact.id,
          configJson: {},
        },
        select: { id: true },
      })
    ).id;

    benchmarkFactorSetVersionId = (
      await prisma.factorSetVersion.upsert({
        where: {
          key_version: {
            key: "DC_CURRENT_STANDARDS",
            version: "submission-workflows-v1",
          },
        },
        update: {
          sourceArtifactId: sourceArtifact.id,
          status: "ACTIVE",
          factorsJson: {},
        },
        create: {
          key: "DC_CURRENT_STANDARDS",
          version: "submission-workflows-v1",
          status: "ACTIVE",
          effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
          sourceArtifactId: sourceArtifact.id,
          factorsJson: {},
        },
        select: { id: true },
      })
    ).id;

    org = await prisma.organization.create({
      data: {
        name: `Submission Workflow Org ${scope}`,
        slug: `submission-workflow-${scope}`,
      },
      select: { id: true },
    });

    user = await prisma.user.create({
      data: {
        authUserId: `user_${scope}`,
        email: `${scope}@example.com`,
        name: "Submission Workflow User",
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

    building = await prisma.building.create({
      data: {
        organizationId: org.id,
        name: `Submission Workflow Building ${scope}`,
        address: "500 Submission Way NW, Washington, DC 20001",
        latitude: 38.91,
        longitude: -77.02,
        grossSquareFeet: 85000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        doeeBuildingId: `RPUID-${scope}`,
        espmPropertyId: BigInt(333444555),
        espmShareStatus: "LINKED",
        bepsTargetScore: 75,
      },
      select: { id: true },
    });

    const meter = await prisma.meter.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        meterType: "ELECTRIC",
        name: "Main electric meter",
        unit: "KWH",
      },
      select: { id: true },
    });

    await prisma.energyReading.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        source: "MANUAL",
        meterId: meter.id,
        meterType: "ELECTRIC",
        periodStart: new Date("2025-01-01T00:00:00.000Z"),
        periodEnd: new Date("2025-12-31T00:00:00.000Z"),
        consumption: 100000,
        unit: "KWH",
        consumptionKbtu: 341214,
        isVerified: true,
      },
    });

    await prisma.complianceSnapshot.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        snapshotDate: new Date("2026-03-18T08:00:00.000Z"),
        triggerType: "MANUAL",
        energyStarScore: 81,
        siteEui: 48,
        sourceEui: 92,
        complianceStatus: "COMPLIANT",
      },
    });

    await prisma.portfolioManagerSyncState.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        status: "SUCCEEDED",
        lastAttemptedSyncAt: new Date("2026-03-18T07:00:00.000Z"),
        lastSuccessfulSyncAt: new Date("2026-03-18T07:05:00.000Z"),
      },
    });

    const benchmarkRun = await prisma.complianceRun.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        ruleVersionId: benchmarkRuleVersionId,
        factorSetVersionId: benchmarkFactorSetVersionId,
        runType: "BENCHMARKING_EVALUATION",
        status: "SUCCEEDED",
        inputSnapshotRef: "submission-workflow:benchmark",
        inputSnapshotHash: `submission-workflow-benchmark:${scope}`,
        resultPayload: {},
        producedByType: "SYSTEM",
        producedById: "test",
        executedAt: new Date("2026-03-18T10:00:00.000Z"),
      },
      select: { id: true },
    });

    await prisma.benchmarkSubmission.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        reportingYear: 2025,
        ruleVersionId: benchmarkRuleVersionId,
        factorSetVersionId: benchmarkFactorSetVersionId,
        complianceRunId: benchmarkRun.id,
        status: "READY",
        readinessEvaluatedAt: new Date("2026-03-18T09:00:00.000Z"),
        submissionPayload: toInputJson(createBenchmarkPayload(2025)),
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: org?.id } });
    await prisma.submissionWorkflowEvent.deleteMany({ where: { organizationId: org?.id } });
    await prisma.submissionWorkflow.deleteMany({ where: { organizationId: org?.id } });
    await prisma.bepsRequestItem.deleteMany({ where: { organizationId: org?.id } });
    await prisma.portfolioManagerSyncState.deleteMany({ where: { organizationId: org?.id } });
    await prisma.complianceSnapshot.deleteMany({ where: { organizationId: org?.id } });
    await prisma.energyReading.deleteMany({ where: { organizationId: org?.id } });
    await prisma.meter.deleteMany({ where: { organizationId: org?.id } });
    await prisma.filingPacket.deleteMany({ where: { organizationId: org?.id } });
    await prisma.benchmarkPacket.deleteMany({ where: { organizationId: org?.id } });
    await prisma.filingRecord.deleteMany({ where: { organizationId: org?.id } });
    await prisma.benchmarkSubmission.deleteMany({ where: { organizationId: org?.id } });
    await prisma.complianceRun.deleteMany({ where: { organizationId: org?.id } });
    await prisma.organizationMembership.deleteMany({ where: { organizationId: org?.id } });
    await prisma.user.deleteMany({ where: { id: user?.id } });
    await prisma.building.deleteMany({ where: { organizationId: org?.id } });
    await prisma.organization.deleteMany({ where: { id: org?.id } });
    await prisma.sourceArtifact.deleteMany({
      where: {
        metadata: {
          path: ["scope"],
          equals: scope,
        },
      },
    });
  });

  it("reconciles benchmark workflows into review and enforces valid manual transitions", async () => {
    await generateBenchmarkPacket({
      organizationId: org.id,
      buildingId: building.id,
      reportingYear: 2025,
      createdByType: "USER",
      createdById: user.authUserId,
      requestId: `benchmark-generate-${scope}`,
    });

    await finalizeBenchmarkPacket({
      organizationId: org.id,
      buildingId: building.id,
      reportingYear: 2025,
      createdByType: "USER",
      createdById: user.authUserId,
      requestId: `benchmark-finalize-${scope}`,
    });

    const caller = createCaller(`benchmark-workflow-${scope}`);
    const workspace = await caller.building.getArtifactWorkspace({
      buildingId: building.id,
    });
    const workflowId = workspace.benchmarkVerification.submissionWorkflow?.id;

    expect(workspace.benchmarkVerification.submissionWorkflow).toMatchObject({
      state: "READY_FOR_REVIEW",
    });
    expect(workspace.benchmarkVerification.submissionWorkflow?.allowedTransitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nextState: "APPROVED_FOR_SUBMISSION" }),
      ]),
    );
    expect(workflowId).toBeTruthy();

    const approved = await caller.building.transitionSubmissionWorkflow({
      buildingId: building.id,
      workflowId: workflowId!,
      nextState: "APPROVED_FOR_SUBMISSION",
    });

    expect(approved).toMatchObject({
      state: "APPROVED_FOR_SUBMISSION",
    });
    expect(approved?.history[0]?.toState).toBe("APPROVED_FOR_SUBMISSION");

    const [buildingDetail, worklist] = await Promise.all([
      caller.building.get({ id: building.id }),
      caller.building.portfolioWorklist({
        search: "Submission Workflow Building",
      }),
    ]);

    expect(buildingDetail.governedSummary.submissionSummary.benchmark?.state).toBe(
      "APPROVED_FOR_SUBMISSION",
    );
    expect(worklist.items[0]?.submission.benchmark.state).toBe("APPROVED_FOR_SUBMISSION");
  });

});


