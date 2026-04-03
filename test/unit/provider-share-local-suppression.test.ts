import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("provider-share local suppression", () => {
  it("keeps provider-shared local deletes suppressed instead of silently reimporting", () => {
    const schemaSource = readRepoFile("prisma/schema.prisma");
    const providerShareSource = readRepoFile("src/server/portfolio-manager/provider-share.ts");
    const buildingRouterSource = readRepoFile("src/server/trpc/routers/building.ts");

    expect(schemaSource).toContain("localSuppressedAt");
    expect(schemaSource).toContain("localSuppressedByType");
    expect(schemaSource).toContain("localSuppressedById");
    expect(providerShareSource).toContain("suppressedInQuoin");
    expect(providerShareSource).toContain("Property stays hidden in Quoin until restored from Settings.");
    expect(providerShareSource).toContain("restoreSuppressedPortfolioManagerRemotePropertyForOrganization");
    expect(buildingRouterSource).toContain("BUILDING_PROVIDER_SHARED_SUPPRESSED");
    expect(buildingRouterSource).toContain("Removed from Quoin. ESPM access stays connected.");
  });

  it("exposes restore affordances in settings for suppressed shared properties", () => {
    const panelSource = readRepoFile("src/components/portfolio-manager/existing-account-panel.tsx");
    const routerSource = readRepoFile("src/server/trpc/routers/portfolio-manager.ts");

    expect(panelSource).toContain("Hidden in Quoin");
    expect(panelSource).toContain("Restore in Quoin");
    expect(panelSource).toContain("restoreRemoteProperty");
    expect(routerSource).toContain("restoreRemoteProperty");
  });
});
