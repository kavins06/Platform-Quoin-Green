import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("organization management", () => {
  it("exposes active-organization member management on the router", () => {
    const routerSource = readRepoFile("src/server/trpc/routers/organization.ts");
    const teardownSource = readRepoFile("src/server/lifecycle/organization-teardown.ts");

    expect(routerSource).toContain("active: tenantProcedure.query");
    expect(routerSource).toContain("addMember: tenantProcedure");
    expect(routerSource).toContain("removeMember: tenantProcedure");
    expect(routerSource).toContain("deleteActive: tenantProcedure");
    expect(routerSource).toContain("deleteOrganizationLifecycle");
    expect(routerSource).toContain("Only organization admins can manage members.");
    expect(routerSource).toContain("That user has not signed in to Quoin yet.");
    expect(routerSource).toContain("Type the exact organization name to confirm deletion.");
    expect(teardownSource).toContain("portfolioManagerRemoteProperty.updateMany");
    expect(teardownSource).toContain("await tx.building.deleteMany");
    expect(teardownSource).toContain("await tx.organization.delete");
  });

  it("renders a simple organization management panel in settings", () => {
    const panelSource = readRepoFile(
      "src/components/settings/organization-management-panel.tsx",
    );
    const settingsSource = readRepoFile("src/components/settings/settings-page.tsx");

    expect(panelSource).toContain("Manage the current organization");
    expect(panelSource).toContain("Add member");
    expect(panelSource).toContain("Delete organization");
    expect(panelSource).toContain("Add someone who has already signed in to Quoin once.");
    expect(panelSource).toContain("Delete organization");
    expect(panelSource).toContain('trpc.organization.active.useQuery');
    expect(panelSource).toContain('trpc.organization.addMember.useMutation');
    expect(panelSource).toContain('trpc.organization.removeMember.useMutation');
    expect(panelSource).toContain('trpc.organization.deleteActive.useMutation');
    expect(settingsSource).toContain("OrganizationManagementPanel");
  });
});
