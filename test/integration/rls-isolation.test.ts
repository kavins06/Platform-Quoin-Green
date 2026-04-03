import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTenantClient, prisma } from "@/server/lib/db";

describe("RLS tenant isolation", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let buildingA: { id: string };
  let buildingB: { id: string };

  beforeAll(async () => {
    const ts = Date.now();

    orgA = await prisma.organization.create({
      data: {
        name: "Test Org A",
        slug: `test-org-a-${ts}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    orgB = await prisma.organization.create({
      data: {
        name: "Test Org B",
        slug: `test-org-b-${ts}`,
        tier: "FREE",
      },
      select: { id: true },
    });

    buildingA = await prisma.building.create({
      data: {
        organizationId: orgA.id,
        name: "Building Alpha",
        address: "100 Test St NW, Washington, DC 20001",
        latitude: 38.9,
        longitude: -77.0,
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
        name: "Building Beta",
        address: "200 Test St NW, Washington, DC 20001",
        latitude: 38.91,
        longitude: -77.01,
        grossSquareFeet: 80000,
        propertyType: "MULTIFAMILY",
        bepsTargetScore: 66,
        maxPenaltyExposure: 800000,
      },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await prisma.driftAlert.deleteMany({
      where: { buildingId: { in: [buildingA.id, buildingB.id] } },
    });
    await prisma.greenButtonConnection.deleteMany({
      where: { buildingId: { in: [buildingA.id, buildingB.id] } },
    });
    await prisma.energyReading.deleteMany({
      where: { buildingId: { in: [buildingA.id, buildingB.id] } },
    });
    await prisma.complianceSnapshot.deleteMany({
      where: { buildingId: { in: [buildingA.id, buildingB.id] } },
    });
    await prisma.pipelineRun.deleteMany({
      where: { buildingId: { in: [buildingA.id, buildingB.id] } },
    });
    await prisma.meter.deleteMany({
      where: { buildingId: { in: [buildingA.id, buildingB.id] } },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await prisma.user.deleteMany({
      where: {
        authUserId: {
          startsWith: "supabase_test_user_",
        },
      },
    });
    await prisma.building.deleteMany({
      where: { id: { in: [buildingA.id, buildingB.id] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA.id, orgB.id] } },
    });

    await prisma.$disconnect();
  });

  it("org A sees only its own buildings", async () => {
    const clientA = getTenantClient(orgA.id);
    const buildings = await clientA.building.findMany();

    expect(buildings.map((building) => building.name)).toEqual(["Building Alpha"]);
  });

  it("org B sees only its own buildings", async () => {
    const clientB = getTenantClient(orgB.id);
    const buildings = await clientB.building.findMany();

    expect(buildings.map((building) => building.name)).toEqual(["Building Beta"]);
  });

  it("direct ID lookup across tenants returns null", async () => {
    const clientA = getTenantClient(orgA.id);
    const building = await clientA.building.findUnique({
      where: { id: buildingB.id },
    });

    expect(building).toBeNull();
  });

  it("invalid organization IDs are rejected", () => {
    expect(() => getTenantClient("")).toThrow("Invalid organizationId format");
    expect(() => getTenantClient("not-a-valid-cuid")).toThrow(
      "Invalid organizationId format",
    );
    expect(() => getTenantClient("'; DROP TABLE organizations; --")).toThrow(
      "Invalid organizationId format",
    );
  });

  it("RLS isolates compliance snapshots", async () => {
    await prisma.complianceSnapshot.create({
      data: {
        buildingId: buildingA.id,
        organizationId: orgA.id,
        triggerType: "MANUAL",
        complianceStatus: "NON_COMPLIANT",
        energyStarScore: 45,
        siteEui: 120,
      },
    });

    const clientB = getTenantClient(orgB.id);
    const snapshots = await clientB.complianceSnapshot.findMany();

    expect(snapshots.map((snapshot) => snapshot.buildingId)).not.toContain(buildingA.id);
  });

  it("RLS isolates organization memberships", async () => {
    const ts = Date.now();
    const userA = await prisma.user.create({
      data: {
        authUserId: `supabase_test_user_a_${ts}`,
        email: `testa_${ts}@test.com`,
        name: "Test User A",
      },
      select: { id: true },
    });

    const userB = await prisma.user.create({
      data: {
        authUserId: `supabase_test_user_b_${ts}`,
        email: `testb_${ts}@test.com`,
        name: "Test User B",
      },
      select: { id: true },
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

    const clientA = getTenantClient(orgA.id);
    const membershipsA = await clientA.organizationMembership.findMany({
      include: { user: true },
    });
    expect(membershipsA.map((membership) => membership.user.name)).toContain("Test User A");
    expect(membershipsA.map((membership) => membership.user.name)).not.toContain("Test User B");

    const clientB = getTenantClient(orgB.id);
    const membershipsB = await clientB.organizationMembership.findMany({
      include: { user: true },
    });
    expect(membershipsB.map((membership) => membership.user.name)).toContain("Test User B");
    expect(membershipsB.map((membership) => membership.user.name)).not.toContain("Test User A");
  });

  it("db rejects child rows whose organizationId does not match the building tenant", async () => {
    await expect(
      prisma.energyReading.create({
        data: {
          buildingId: buildingA.id,
          organizationId: orgB.id,
          source: "CSV_UPLOAD",
          meterType: "ELECTRIC",
          periodStart: new Date("2025-01-01T00:00:00.000Z"),
          periodEnd: new Date("2025-01-31T00:00:00.000Z"),
          consumption: 100,
          unit: "KWH",
          consumptionKbtu: 341.2,
        },
      }),
    ).rejects.toThrow();
  });
});


