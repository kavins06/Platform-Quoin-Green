import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("provider-share operating model", () => {
  it("uses provider-share procedures on the active PM router", () => {
    const routerSource = readRepoFile("src/server/trpc/routers/portfolio-manager.ts");

    expect(routerSource).toContain("getProviderConnectionStatus");
    expect(routerSource).toContain("configureProviderConnection");
    expect(routerSource).toContain("refreshProviderConnection");
    expect(routerSource).toContain("getRemotePropertyDetail");
    expect(routerSource).not.toContain("connectExistingAccount:");
    expect(routerSource).not.toContain("refreshExistingAccountProperties:");
    expect(routerSource).not.toContain("importExistingAccountProperties:");
  });

  it("starts provider-share workers and poller in the active worker process", () => {
    const workerEntrypointSource = readRepoFile("src/server/worker-entrypoint.ts");

    expect(workerEntrypointSource).toContain("startPortfolioManagerProviderSyncWorker");
    expect(workerEntrypointSource).toContain("startPortfolioManagerProviderSyncPollingLoop");
    expect(workerEntrypointSource).toContain('"portfolio-manager-provider-sync"');
  });

  it("surfaces customer and provider identities in the active PM surfaces", () => {
    const panelSource = readRepoFile("src/components/portfolio-manager/existing-account-panel.tsx");
    const cardSource = readRepoFile("src/components/dashboard/espm-connect-card.tsx");
    const existingAccountSource = readRepoFile(
      "src/server/portfolio-manager/existing-account.ts",
    );

    expect(panelSource).toContain("Connect through Quoin");
    expect(panelSource).toContain("Provider account:");
    expect(panelSource).toContain("Customer username:");
    expect(panelSource).toContain("Shared ESPM properties");
    expect(panelSource).toContain("configureProviderConnection.useMutation");
    expect(panelSource).toContain("refreshProviderConnection.useMutation");
    expect(panelSource).toContain("restoreRemoteProperty.useMutation");
    expect(cardSource).toContain("Customer ESPM account:");
    expect(cardSource).toContain("Provider:");
    expect(existingAccountSource).toContain('management?.managementMode === "PROVIDER_SHARED"');
    expect(existingAccountSource).toContain("finish the provider-share connection");
  });

  it("offers unlink vs remote-delete building deletion", () => {
    const dialogSource = readRepoFile("src/components/building/building-delete-dialog.tsx");
    const routerSource = readRepoFile("src/server/trpc/routers/building.ts");
    const propertySource = readRepoFile("src/server/integrations/espm/property.ts");

    expect(dialogSource).toContain("Type Delete to confirm");
    expect(dialogSource).toContain("Delete from Quoin");
    expect(dialogSource).toContain('deleteMode: "UNLINK_ONLY"');
    expect(routerSource).toContain('const buildingDeleteModeSchema = z.enum([');
    expect(routerSource).toContain('"UNLINK_ONLY"');
    expect(routerSource).toContain('"DELETE_REMOTE_PROPERTY"');
    expect(routerSource).toContain('kind: "UNSHARE_PROPERTY" as const');
    expect(propertySource).toContain("async deleteProperty(propertyId: number)");
    expect(propertySource).toContain("async unshareProperty(propertyId: number)");
  });
});
