import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/routers";
import { prisma } from "@/server/lib/db";

describe("building delete", () => {
  const scope = `${Date.now()}`;

  let org: { id: string };
  let user: { id: string; authUserId: string };
  let building: { id: string };
  let globalSource: { id: string };
  let buildingSource: { id: string };
  let ruleVersion: { id: string };
  let factorSetVersion: { id: string };
  let complianceRun: { id: string };
  let complianceSnapshot: { id: string };
  let benchmarkSubmission: { id: string };
  let filingRecord: { id: string };
  let retrofitCandidate: { id: string };
  let financingCase: { id: string };
  let pipelineRun: { id: string };
  let meter: { id: string };
  let reportArtifact: { id: string };
  let job: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: {
        name: `Delete Org ${scope}`,
        slug: `delete-org-${scope}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    user = await prisma.user.create({
      data: {
        authUserId: `supabase_delete_user_${scope}`,
        email: `delete_${scope}@test.com`,
        name: "Delete User",
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
        name: `Delete Building ${scope}`,
        address: "100 Delete Test St NW, Washington, DC 20001",
        latitude: 38.91,
        longitude: -77.03,
        grossSquareFeet: 75000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        bepsTargetScore: 71,
        maxPenaltyExposure: 750000,
      },
      select: { id: true },
    });

    globalSource = await prisma.sourceArtifact.create({
      data: {
        artifactType: "LAW",
        name: `Delete global source ${scope}`,
        externalUrl: `https://example.com/delete-global-${scope}`,
        metadata: { scope },
        createdByType: "SYSTEM",
        createdById: "test",
      },
      select: { id: true },
    });

    buildingSource = await prisma.sourceArtifact.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        artifactType: "PM_EXPORT",
        name: `Delete building source ${scope}`,
        externalUrl: `https://example.com/delete-building-${scope}`,
        metadata: { scope },
        createdByType: "SYSTEM",
        createdById: "test",
      },
      select: { id: true },
    });

    const rulePackage = await prisma.rulePackage.create({
      data: {
        key: `DELETE_RULE_PACKAGE_${scope}`,
        name: `Delete Rule Package ${scope}`,
      },
    });

    ruleVersion = await prisma.ruleVersion.create({
      data: {
        rulePackageId: rulePackage.id,
        sourceArtifactId: globalSource.id,
        version: "v1",
        status: "ACTIVE",
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        implementationKey: "delete/test",
        configJson: { scope },
      },
      select: { id: true },
    });

    factorSetVersion = await prisma.factorSetVersion.create({
      data: {
        key: `DELETE_FACTOR_SET_${scope}`,
        sourceArtifactId: globalSource.id,
        version: "v1",
        status: "ACTIVE",
        effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
        factorsJson: { scope },
      },
      select: { id: true },
    });

    pipelineRun = await prisma.pipelineRun.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        pipelineType: "DATA_INGESTION",
        triggerType: "MANUAL",
        status: "COMPLETED",
        inputSummary: { scope },
      },
      select: { id: true },
    });

    meter = await prisma.meter.create({
      data: {
        buildingId: building.id,
        organizationId: org.id,
        meterType: "ELECTRIC",
        name: `Delete Meter ${scope}`,
        unit: "KWH",
      },
      select: { id: true },
    });

    await prisma.energyReading.create({
      data: {
        buildingId: building.id,
        organizationId: org.id,
        source: "MANUAL",
        meterType: "ELECTRIC",
        meterId: meter.id,
        periodStart: new Date("2025-01-01T00:00:00.000Z"),
        periodEnd: new Date("2025-01-31T00:00:00.000Z"),
        consumption: 1000,
        unit: "KWH",
        consumptionKbtu: 3412,
      },
    });

    complianceRun = await prisma.complianceRun.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        ruleVersionId: ruleVersion.id,
        factorSetVersionId: factorSetVersion.id,
        pipelineRunId: pipelineRun.id,
        runType: "BEPS_EVALUATION",
        status: "SUCCEEDED",
        inputSnapshotRef: `delete-input-${scope}`,
        inputSnapshotHash: `delete-hash-${scope}`,
        resultPayload: { scope },
        producedByType: "SYSTEM",
        producedById: "test",
      },
      select: { id: true },
    });

    complianceSnapshot = await prisma.complianceSnapshot.create({
      data: {
        buildingId: building.id,
        organizationId: org.id,
        triggerType: "MANUAL",
        pipelineRunId: pipelineRun.id,
        complianceRunId: complianceRun.id,
        energyStarScore: 61,
        complianceStatus: "AT_RISK",
        estimatedPenalty: 500000,
      },
      select: { id: true },
    });

    benchmarkSubmission = await prisma.benchmarkSubmission.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        reportingYear: 2025,
        ruleVersionId: ruleVersion.id,
        factorSetVersionId: factorSetVersion.id,
        complianceRunId: complianceRun.id,
        status: "BLOCKED",
        createdByType: "SYSTEM",
        createdById: "test",
      },
      select: { id: true },
    });

    filingRecord = await prisma.filingRecord.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        filingType: "BEPS_COMPLIANCE",
        filingYear: 2026,
        complianceCycle: "CYCLE_1",
        benchmarkSubmissionId: benchmarkSubmission.id,
        complianceRunId: complianceRun.id,
        status: "GENERATED",
        createdByType: "SYSTEM",
        createdById: "test",
      },
      select: { id: true },
    });

    await prisma.filingPacket.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        filingRecordId: filingRecord.id,
        filingYear: 2026,
        complianceCycle: "CYCLE_1",
        version: 1,
        packetHash: `filing-packet-${scope}`,
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

    await prisma.filingRecordEvent.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        filingRecordId: filingRecord.id,
        action: "CREATED",
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

    await prisma.evidenceArtifact.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        complianceRunId: complianceRun.id,
        benchmarkSubmissionId: benchmarkSubmission.id,
        filingRecordId: filingRecord.id,
        sourceArtifactId: buildingSource.id,
        artifactType: "PM_REPORT",
        name: `Delete evidence ${scope}`,
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

    await prisma.verificationItemResult.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        reportingYear: 2025,
        category: "DQC",
        key: `delete-verification-${scope}`,
        status: "PASS",
        explanation: "Delete verification result",
      },
    });

    await prisma.auditLog.create({
      data: {
        actorType: "SYSTEM",
        actorId: "test",
        organizationId: org.id,
        buildingId: building.id,
        action: "DELETE_TEST_AUDIT",
        inputSnapshot: { scope },
      },
    });

    await prisma.bepsMetricInput.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        complianceCycle: "CYCLE_1",
        filingYear: 2026,
        evaluationSnapshotId: complianceSnapshot.id,
        sourceArtifactId: buildingSource.id,
      },
    });

    await prisma.bepsPrescriptiveItem.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        complianceCycle: "CYCLE_1",
        filingYear: 2026,
        itemKey: "delete-prescriptive",
        name: "Delete Prescriptive Item",
        sourceArtifactId: buildingSource.id,
      },
    });

    await prisma.bepsAlternativeComplianceAgreement.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        complianceCycle: "CYCLE_1",
        filingYear: 2026,
        agreementIdentifier: `DELETE-ACP-${scope}`,
        pathway: "PERFORMANCE",
        multiplier: 0.8,
        status: "ACTIVE",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        sourceArtifactId: buildingSource.id,
      },
    });

    await prisma.portfolioManagerSyncState.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        status: "FAILED",
        sourceMetadata: { scope },
        lastErrorMetadata: { scope, reason: "test" },
      },
    });

    await prisma.operationalAnomaly.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        anomalyType: "ABNORMAL_BASELOAD",
        severity: "HIGH",
        detectionHash: `delete-anomaly-${scope}`,
        title: "Delete anomaly",
        summary: "Delete anomaly summary",
        detectionWindowStart: new Date("2025-01-01T00:00:00.000Z"),
        detectionWindowEnd: new Date("2025-01-31T00:00:00.000Z"),
      },
    });

    retrofitCandidate = await prisma.retrofitCandidate.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        sourceArtifactId: buildingSource.id,
        projectType: "LED_LIGHTING_RETROFIT",
        name: "Delete retrofit",
        estimatedCapex: 100000,
      },
      select: { id: true },
    });

    financingCase = await prisma.financingCase.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        name: "Delete financing case",
        caseType: "SINGLE_CANDIDATE",
        createdByType: "SYSTEM",
        createdById: "test",
      },
      select: { id: true },
    });

    await prisma.financingCaseCandidate.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        financingCaseId: financingCase.id,
        retrofitCandidateId: retrofitCandidate.id,
      },
    });

    await prisma.financingPacket.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        financingCaseId: financingCase.id,
        version: 1,
        packetHash: `financing-packet-${scope}`,
        createdByType: "SYSTEM",
        createdById: "test",
      },
    });

    await prisma.greenButtonConnection.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
    });

    reportArtifact = await prisma.reportArtifact.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        reportType: "COMPLIANCE_REPORT",
        version: 1,
        reportHash: `report-hash-${scope}`,
        sourceSummaryHash: `summary-hash-${scope}`,
        sourceLineage: { scope },
        payload: { scope },
        createdByType: "SYSTEM",
        createdById: "test",
      },
      select: { id: true },
    });

    job = await prisma.job.create({
      data: {
        type: "BUILDING_DELETE_TEST",
        status: "QUEUED",
        organizationId: org.id,
        buildingId: building.id,
      },
      select: { id: true },
    });

    await prisma.driftAlert.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        pipelineRunId: pipelineRun.id,
        ruleId: "delete-rule",
        severity: "MEDIUM",
        title: "Delete alert",
        description: "Delete drift alert",
        currentValue: 10,
        threshold: 20,
      },
    });
  });

  afterAll(async () => {
    await prisma.financingPacket.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.financingCaseCandidate.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.financingCase.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.retrofitCandidate.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.operationalAnomaly.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.portfolioManagerSyncState.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.verificationItemResult.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.auditLog.deleteMany({
      where: { organizationId: org?.id, buildingId: building?.id },
    });
    await prisma.reportArtifact.deleteMany({
      where: { organizationId: org?.id, buildingId: building?.id },
    });
    await prisma.job.deleteMany({
      where: { organizationId: org?.id, buildingId: building?.id },
    });
    await prisma.bepsAlternativeComplianceAgreement.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.bepsPrescriptiveItem.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.bepsMetricInput.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.evidenceArtifact.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.filingPacket.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.filingRecordEvent.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.filingRecord.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.benchmarkSubmission.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.complianceSnapshot.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.complianceRun.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.energyReading.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.driftAlert.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.greenButtonConnection.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.meter.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.pipelineRun.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.sourceArtifact.deleteMany({
      where: {
        OR: [
          { organizationId: org?.id },
          { id: globalSource?.id },
        ],
      },
    });
    await prisma.building.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.user.deleteMany({
      where: { id: user?.id },
    });
    await prisma.organization.deleteMany({
      where: { id: org?.id },
    });
    await prisma.ruleVersion.deleteMany({
      where: { id: ruleVersion?.id },
    });
    await prisma.factorSetVersion.deleteMany({
      where: { id: factorSetVersion?.id },
    });
    await prisma.rulePackage.deleteMany({
      where: { key: `DELETE_RULE_PACKAGE_${scope}` },
    });
  });

  function createCaller() {
    return appRouter.createCaller({
      authUserId: user.authUserId,
      activeOrganizationId: org.id,
      prisma,
    });
  }

  it("deletes a building and its governed child records", async () => {
    const caller = createCaller();

    const result = await caller.building.delete({
      id: building.id,
    });

    expect(result).toEqual({
      success: true,
      deleteMode: "UNLINK_ONLY",
      outcome: "EXECUTED",
      approvalRequestId: null,
      message: "Building deleted in Quoin.",
    });

    const [
      buildingCount,
      metricCount,
      prescriptiveCount,
      agreementCount,
      filingCount,
      benchmarkCount,
      syncCount,
      anomalyCount,
      retrofitCount,
      financingCaseCount,
      sourceArtifactCount,
      snapshotCount,
      complianceRunCount,
      verificationCount,
      auditLogCount,
      reportArtifactCount,
      jobCount,
    ] = await Promise.all([
      prisma.building.count({ where: { id: building.id } }),
      prisma.bepsMetricInput.count({ where: { buildingId: building.id } }),
      prisma.bepsPrescriptiveItem.count({ where: { buildingId: building.id } }),
      prisma.bepsAlternativeComplianceAgreement.count({
        where: { buildingId: building.id },
      }),
      prisma.filingRecord.count({ where: { buildingId: building.id } }),
      prisma.benchmarkSubmission.count({ where: { buildingId: building.id } }),
      prisma.portfolioManagerSyncState.count({ where: { buildingId: building.id } }),
      prisma.operationalAnomaly.count({ where: { buildingId: building.id } }),
      prisma.retrofitCandidate.count({ where: { buildingId: building.id } }),
      prisma.financingCase.count({ where: { buildingId: building.id } }),
      prisma.sourceArtifact.count({ where: { buildingId: building.id } }),
      prisma.complianceSnapshot.count({ where: { buildingId: building.id } }),
      prisma.complianceRun.count({ where: { buildingId: building.id } }),
      prisma.verificationItemResult.count({ where: { buildingId: building.id } }),
      prisma.auditLog.count({ where: { buildingId: building.id } }),
      prisma.reportArtifact.count({ where: { buildingId: building.id } }),
      prisma.job.count({ where: { buildingId: building.id } }),
    ]);

    expect(buildingCount).toBe(0);
    expect(metricCount).toBe(0);
    expect(prescriptiveCount).toBe(0);
    expect(agreementCount).toBe(0);
    expect(filingCount).toBe(0);
    expect(benchmarkCount).toBe(0);
    expect(syncCount).toBe(0);
    expect(anomalyCount).toBe(0);
    expect(retrofitCount).toBe(0);
    expect(financingCaseCount).toBe(0);
    expect(sourceArtifactCount).toBe(0);
    expect(snapshotCount).toBe(0);
    expect(complianceRunCount).toBe(0);
    expect(verificationCount).toBe(0);
    expect(auditLogCount).toBe(0);
    expect(reportArtifactCount).toBe(0);
    expect(jobCount).toBe(0);
  });
});


