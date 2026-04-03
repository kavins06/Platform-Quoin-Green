import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("portfolio manager full pull workflow", () => {
  it("runs the full PM pull chain from provider-share import and manual retry", () => {
    const fullPullSource = readRepoFile("src/server/portfolio-manager/full-pull.ts");
    const setupSource = readRepoFile("src/server/portfolio-manager/setup.ts");
    const providerShareSource = readRepoFile(
      "src/server/portfolio-manager/provider-share.ts",
    );
    const routerSource = readRepoFile("src/server/trpc/routers/portfolio-manager.ts");

    expect(fullPullSource).toContain("buildDefaultPropertyUseInputs");
    expect(fullPullSource).toContain("hasPersistedPortfolioManagerSetupInputs");
    expect(setupSource).toContain("export async function hasPersistedPortfolioManagerSetupInputs");
    expect(fullPullSource).toContain("runPortfolioManagerSetupApply");
    expect(fullPullSource).toContain("runPortfolioManagerMeterSetupApply");
    expect(fullPullSource).toContain("runPortfolioManagerMeterAssociationsApply");
    expect(fullPullSource).toContain("runPortfolioManagerUsageApply");
    expect(fullPullSource).toContain("PortfolioManagerUsageDirection.IMPORT_PM_TO_LOCAL");
    expect(fullPullSource).toContain('outcome: "NEEDS_MANUAL_SETUP" as const');
    expect(fullPullSource).toContain("const stages: FullPullStageMap");
    expect(providerShareSource).toContain("runPortfolioManagerFullPullForBuilding");
    expect(providerShareSource).toContain("Property linked successfully, but the full PM sync needs a retry.");
    expect(routerSource).toContain("refreshBuildingPull");
    expect(routerSource).toContain("refreshProviderConnection");
  });

  it("treats provider-share as the active ESPM operating model", () => {
    const routerSource = readRepoFile("src/server/trpc/routers/portfolio-manager.ts");
    const providerShareSource = readRepoFile("src/server/portfolio-manager/provider-share.ts");
    const cardSource = readRepoFile("src/components/dashboard/espm-connect-card.tsx");

    expect(routerSource).toContain("getProviderConnectionStatus");
    expect(routerSource).toContain("configureProviderConnection");
    expect(routerSource).toContain("refreshProviderConnection");
    expect(routerSource).toContain("restoreRemoteProperty");
    expect(routerSource).toContain("getRemotePropertyDetail");
    expect(providerShareSource).toContain('"WAITING_FOR_REQUEST"');
    expect(providerShareSource).toContain('"WAITING_FOR_SHARES"');
    expect(providerShareSource).toContain("suppressedInQuoin");
    expect(providerShareSource).toContain("restoreSuppressedPortfolioManagerRemotePropertyForOrganization");
    expect(cardSource).toContain("provider-share sync needs attention");
  });

  it("creates PM-backed compliance snapshots when usage import refreshes metrics", () => {
    const usageSource = readRepoFile("src/server/portfolio-manager/usage.ts");
    const fullPullSource = readRepoFile("src/server/portfolio-manager/full-pull.ts");

    expect(usageSource).toContain("createComplianceSnapshotFromMetrics");
    expect(usageSource).toContain("snapshotSummary");
    expect(usageSource).toContain('input.direction === "IMPORT_PM_TO_LOCAL"');
    expect(usageSource).toContain("const createdSnapshot =");
    expect(usageSource).toContain('triggerType: "ESPM_SYNC"');
    expect(usageSource).toContain('sourceSystem: "ENERGY_STAR_PORTFOLIO_MANAGER"');
    expect(fullPullSource).toContain("usageResult.snapshotSummary?.status");
    expect(fullPullSource).toContain("usageResult?.snapshotSummary?.snapshotId");
  });

  it("replaces the building PM experience with sync and push sections", () => {
    const syncPanelSource = readRepoFile(
      "src/components/building/portfolio-manager-sync-panel.tsx",
    );
    const toolsSource = readRepoFile("src/components/building/secondary-tools-tab.tsx");
    const overviewSource = readRepoFile("src/components/building/building-overview-tab.tsx");

    expect(syncPanelSource).toContain("Sync from PM");
    expect(syncPanelSource).toContain("Push to PM");
    expect(syncPanelSource).toContain("Technical details");
    expect(syncPanelSource).toContain("refreshBuildingPull.useMutation");
    expect(syncPanelSource).toContain("PortfolioManagerPushReviewDialog");
    expect(syncPanelSource).toContain("Needs manual setup");
    expect(syncPanelSource).toContain("Preparing setup");
    expect(syncPanelSource).toContain("Partial sync");
    expect(syncPanelSource).toContain("skippedMeterCount");
    expect(toolsSource).toContain("PortfolioManagerSyncPanel");
    expect(overviewSource).not.toContain("loaded in later PM setup steps from Additional tools");
    expect(overviewSource).toContain("Use Sync from PM");
  });
});
