import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("benchmarking router access", () => {
  it("uses org-scoped prisma reads instead of tenantDb role switching on building workflow routes", () => {
    const benchmarkingRouterSource = readRepoFile("src/server/trpc/routers/benchmarking.ts");

    expect(benchmarkingRouterSource).toContain("async function ensureOrganizationBuilding");
    expect(benchmarkingRouterSource).toContain("prisma.building.findFirst({");
    expect(benchmarkingRouterSource).toContain("organizationId: ctx.organizationId");
    expect(benchmarkingRouterSource).toContain("prisma.benchmarkSubmission.findUnique({");
    expect(benchmarkingRouterSource).toContain("prisma.benchmarkSubmission.findMany({");
    expect(benchmarkingRouterSource).not.toContain("ctx.tenantDb.benchmarkSubmission.findUnique({");
    expect(benchmarkingRouterSource).not.toContain("ctx.tenantDb.benchmarkSubmission.findMany({");
    expect(benchmarkingRouterSource).not.toContain("ensureTenantBuilding(ctx.tenantDb");
  });
});
