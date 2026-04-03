import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { appRouter } from "@/server/trpc/routers";
import { refreshSourceReconciliationDataIssues } from "@/server/compliance/data-issues";

function createMonthlyReadings(input: {
  organizationId: string;
  buildingId: string;
  meterId: string;
  source: "ESPM_SYNC" | "GREEN_BUTTON";
  meterType: "ELECTRIC";
  unit: "KWH";
  monthlyConsumption: number;
  rawPayload: Record<string, unknown>;
}) {
  return Array.from({ length: 12 }, (_, index) => {
    const periodStart = new Date(Date.UTC(2025, index, 1));
    const periodEnd = new Date(Date.UTC(2025, index + 1, 0));
    return {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      meterId: input.meterId,
      source: input.source,
      meterType: input.meterType,
      periodStart,
      periodEnd,
      consumption: input.monthlyConsumption,
      unit: input.unit,
      consumptionKbtu: input.monthlyConsumption * 3.412,
      rawPayload: input.rawPayload as Prisma.InputJsonValue,
    };
  });
}

describe("source reconciliation and provenance", () => {
  const scope = `source-reconciliation-${Date.now()}`;

  let org: { id: string };
  let user: { id: string; authUserId: string };
  let building: { id: string };
  let pmMeter: { id: string };
  let greenButtonMeter: { id: string };

  function createCaller(requestId: string) {
    return appRouter.createCaller({
      requestId,
      authUserId: user.authUserId,
      activeOrganizationId: org.id,
      prisma,
    });
  }

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: {
        name: `Source Reconciliation Org ${scope}`,
        slug: `source-reconciliation-${scope}`,
      },
      select: { id: true },
    });

    user = await prisma.user.create({
      data: {
        authUserId: `user_${scope}`,
        email: `${scope}@example.com`,
        name: "Source Reconciliation User",
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
        name: `Source Conflict Tower ${scope}`,
        address: "500 Canonical Ave NW, Washington, DC 20001",
        latitude: 38.91,
        longitude: -77.02,
        grossSquareFeet: 50000,
        propertyType: "OFFICE",
        ownershipType: "PRIVATE",
        yearBuilt: 2003,
        bepsTargetScore: 72,
        doeeBuildingId: "RPUID-555555",
        espmPropertyId: BigInt(555555),
        espmShareStatus: "LINKED",
        greenButtonStatus: "ACTIVE",
      },
      select: { id: true },
    });

    await prisma.portfolioManagerSyncState.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        status: "SUCCEEDED",
        lastSuccessfulSyncAt: new Date("2026-03-18T13:00:00.000Z"),
        sourceMetadata: {},
        syncMetadata: {},
        qaPayload: {},
      },
    });

    await prisma.greenButtonConnection.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        status: "ACTIVE",
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        resourceUri: "/espi/1_1/resource/Batch/RetailCustomer/1/UsagePoint",
        subscriptionId: "subscription-1",
        tokenExpiresAt: new Date("2026-03-19T00:00:00.000Z"),
      },
    });

    pmMeter = await prisma.meter.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        meterType: "ELECTRIC",
        name: "Main Electric",
        unit: "KWH",
        espmMeterId: BigInt(2001),
      },
      select: { id: true },
    });

    greenButtonMeter = await prisma.meter.create({
      data: {
        organizationId: org.id,
        buildingId: building.id,
        meterType: "ELECTRIC",
        name: "Green Button Electric",
        unit: "KWH",
      },
      select: { id: true },
    });

    await prisma.energyReading.createMany({
      data: [
        ...createMonthlyReadings({
          organizationId: org.id,
          buildingId: building.id,
          meterId: pmMeter.id,
          source: "ESPM_SYNC",
          meterType: "ELECTRIC",
          unit: "KWH",
          monthlyConsumption: 10000,
          rawPayload: {
            espmMeterId: "2001",
          },
        }),
        ...createMonthlyReadings({
          organizationId: org.id,
          buildingId: building.id,
          meterId: greenButtonMeter.id,
          source: "GREEN_BUTTON",
          meterType: "ELECTRIC",
          unit: "KWH",
          monthlyConsumption: 12000,
          rawPayload: {
            subscriptionId: "subscription-1",
          },
        }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.dataIssue.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.meterSourceReconciliation.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.buildingSourceReconciliation.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.greenButtonConnection.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.portfolioManagerSyncState.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.energyReading.deleteMany({
      where: { organizationId: org?.id },
    });
    await prisma.meter.deleteMany({
      where: { organizationId: org?.id },
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
  });

  it("selects a deterministic canonical source, persists reconciliation summaries, and raises blocking issues for conflicts", async () => {
    const result = await refreshSourceReconciliationDataIssues({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      actorId: "test",
      requestId: `reconciliation-refresh-${scope}`,
    });

    expect(result.reconciliationSummary).toMatchObject({
      status: "CONFLICTED",
      canonicalSource: "GREEN_BUTTON",
      referenceYear: 2025,
      conflictCount: 1,
      incompleteCount: 0,
    });
    expect(result.reconciliationSummary.sourceRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSystem: "PORTFOLIO_MANAGER",
          state: "AVAILABLE",
          externalRecordId: "555555",
          readingCount: 12,
        }),
        expect.objectContaining({
          sourceSystem: "GREEN_BUTTON",
          state: "AVAILABLE",
          externalRecordId: "subscription-1",
          readingCount: 12,
        }),
      ]),
    );
    expect(result.reconciliationSummary.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONSUMPTION_TOTAL_MISMATCH",
          severity: "BLOCKING",
          meterId: null,
          sourceSystems: expect.arrayContaining([
            "GREEN_BUTTON",
            "PORTFOLIO_MANAGER",
          ]),
        }),
      ]),
    );
    expect(result.readinessSummary.state).toBe("DATA_INCOMPLETE");

    const persistedBuilding = await prisma.buildingSourceReconciliation.findUniqueOrThrow({
      where: {
        buildingId: building.id,
      },
    });
    const persistedMeters = await prisma.meterSourceReconciliation.findMany({
      where: {
        buildingId: building.id,
      },
    });
    const issue = await prisma.dataIssue.findFirstOrThrow({
      where: {
        organizationId: org.id,
        buildingId: building.id,
        issueKey: "system:2025:reconciliation:conflict",
      },
    });

    expect(persistedBuilding.status).toBe("CONFLICTED");
    expect(persistedBuilding.canonicalSource).toBe("GREEN_BUTTON");
    expect(persistedMeters).toHaveLength(2);
    expect(issue).toMatchObject({
      issueType: "METER_MAPPING_MISSING",
      severity: "BLOCKING",
      status: "OPEN",
      source: "SYSTEM",
    });

    const second = await refreshSourceReconciliationDataIssues({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      actorId: "test",
      requestId: `reconciliation-refresh-repeat-${scope}`,
    });

    expect(second.reconciliationSummary.id).toBe(result.reconciliationSummary.id);
    expect(
      await prisma.dataIssue.count({
        where: {
          organizationId: org.id,
          buildingId: building.id,
          issueKey: "system:2025:reconciliation:conflict",
        },
      }),
    ).toBe(1);
  });

  it("returns the persisted reconciliation contract through building detail and governed building summaries", async () => {
    const caller = createCaller(`building-get-${scope}`);
    const buildingDetail = await caller.building.get({
      id: building.id,
    });
    const buildingList = await caller.building.list({
      page: 1,
      pageSize: 10,
      sortBy: "name",
      sortOrder: "asc",
    });
    const listedBuilding = buildingList.buildings.find(
      (candidate) => candidate.id === building.id,
    );

    expect(buildingDetail.sourceReconciliation).toMatchObject({
      status: "CONFLICTED",
      canonicalSource: "GREEN_BUTTON",
      referenceYear: 2025,
      conflictCount: 1,
    });
    expect(buildingDetail.governedSummary.reconciliationSummary).toEqual({
      id: buildingDetail.sourceReconciliation?.id ?? null,
      status: buildingDetail.sourceReconciliation?.status ?? null,
      canonicalSource: buildingDetail.sourceReconciliation?.canonicalSource ?? null,
      referenceYear: buildingDetail.sourceReconciliation?.referenceYear ?? null,
      conflictCount: buildingDetail.sourceReconciliation?.conflictCount ?? 0,
      incompleteCount: buildingDetail.sourceReconciliation?.incompleteCount ?? 0,
      lastReconciledAt: buildingDetail.sourceReconciliation?.lastReconciledAt ?? null,
    });
    expect(listedBuilding?.governedSummary.reconciliationSummary).toEqual(
      buildingDetail.governedSummary.reconciliationSummary,
    );
    expect(buildingDetail.readinessSummary.state).toBe("DATA_INCOMPLETE");
  });

  it("resolves reconciliation issues when the canonical source conflict is removed", async () => {
    await prisma.energyReading.updateMany({
      where: {
        organizationId: org.id,
        buildingId: building.id,
        source: "GREEN_BUTTON",
      },
      data: {
        consumption: 10000,
        consumptionKbtu: 10000 * 3.412,
      },
    });

    const result = await refreshSourceReconciliationDataIssues({
      organizationId: org.id,
      buildingId: building.id,
      actorType: "SYSTEM",
      actorId: "test",
      requestId: `reconciliation-refresh-resolved-${scope}`,
    });

    const issue = await prisma.dataIssue.findFirstOrThrow({
      where: {
        organizationId: org.id,
        buildingId: building.id,
        issueKey: "system:2025:reconciliation:conflict",
      },
    });

    expect(result.reconciliationSummary.status).toBe("CLEAN");
    expect(result.reconciliationSummary.conflictCount).toBe(0);
    expect(issue.status).toBe("RESOLVED");
    expect(issue.resolvedAt).not.toBeNull();
  });
});


