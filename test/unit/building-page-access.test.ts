import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("building page access", () => {
  it("uses org-scoped prisma reads for building detail and related tabs", () => {
    const buildingRouterSource = readRepoFile("src/server/trpc/routers/building.ts");

    expect(buildingRouterSource).toContain("async function ensureOrganizationBuilding");
    expect(buildingRouterSource).toContain("organizationId: ctx.organizationId");
    expect(buildingRouterSource).toContain("prisma.building.findFirst({");
    expect(buildingRouterSource).toContain("prisma.pipelineRun.findMany({");
    expect(buildingRouterSource).toContain("prisma.energyReading.findMany({");
    expect(buildingRouterSource).toContain("prisma.complianceSnapshot.findMany({");
    expect(buildingRouterSource).toContain("getLatestComplianceSnapshot(prisma");
    expect(buildingRouterSource).not.toContain("ctx.tenantDb.building.findUnique({");
    expect(buildingRouterSource).not.toContain("ctx.tenantDb.pipelineRun.findMany({");
    expect(buildingRouterSource).not.toContain("ctx.tenantDb.energyReading.findMany({");
  });
});
