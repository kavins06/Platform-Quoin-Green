import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("onboarding flow", () => {
  it("renders a three-step onboarding wizard", () => {
    const pageSource = readRepoFile("src/app/(onboarding)/onboarding/page.tsx");
    const shellSource = readRepoFile("src/components/onboarding/wizard-shell.tsx");
    const stepConnectSource = readRepoFile("src/components/onboarding/step-connect.tsx");
    const panelSource = readRepoFile("src/components/portfolio-manager/existing-account-panel.tsx");

    expect(pageSource).toContain('import { StepOrg }');
    expect(pageSource).toContain('import { StepConnect }');
    expect(pageSource).toContain('import { StepDone }');
    expect(pageSource).not.toContain('import { StepBuilding }');
    expect(pageSource).not.toContain('import { StepData }');
    expect(pageSource).toContain("Math.min(s + 1, 3)");
    expect(pageSource).toContain("{step === 1 && <StepOrg onNext={next} />}");
    expect(pageSource).toContain("{step === 2 && <StepConnect onNext={next} onSkip={next} />}");
    expect(pageSource).toContain("{step === 3 && <StepDone />}");
    expect(shellSource).toContain('const STEP_LABELS = ["Organization", "ESPM", "Done"]');
    expect(stepConnectSource).toContain("Portfolio Manager");
    expect(stepConnectSource).toContain("showHeader={false}");
    expect(stepConnectSource).toContain('presentationMode="onboarding"');
    expect(stepConnectSource).toContain('usernameLabel="Customer ESPM username"');
    expect(stepConnectSource).toContain('saveLabel="Save username"');
    expect(stepConnectSource).toContain('refreshLabel="Check connection and shares"');
    expect(panelSource).toContain("getProviderConnectionStatus.useQuery");
    expect(panelSource).toContain("configureProviderConnection.useMutation");
    expect(panelSource).toContain("refreshProviderConnection.useMutation");
    expect(panelSource).toContain('presentationMode = "settings"');
    expect(panelSource).toContain('const isOnboarding = presentationMode === "onboarding"');
    expect(panelSource).toContain("Connect through Quoin");
    expect(panelSource).toContain("Provider account: {providerUsername}");
    expect(panelSource).toContain("Shared ESPM properties");
    expect(panelSource).toContain("Save the username, then have the customer share with");
    expect(panelSource).not.toContain("type=\"password\"");
    expect(panelSource).toContain('className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none"');
    expect(panelSource).toContain('className="btn-primary px-4 py-2.5 text-sm disabled:opacity-50"');
  });

  it("defines onboarding completion from organization setup, not building count", () => {
    const buildingRouterSource = readRepoFile("src/server/trpc/routers/building.ts");

    expect(buildingRouterSource).toContain("hasBuilding: buildingCount > 0");
    expect(buildingRouterSource).toContain("buildingCount,");
    expect(buildingRouterSource).toContain("isComplete: hasOrg && orgExists");
    expect(buildingRouterSource).not.toContain(
      "isComplete: hasOrg && orgExists && buildingCount > 0",
    );
  });

  it("renders done-state copy that works without any buildings", () => {
    const doneSource = readRepoFile("src/components/onboarding/step-done.tsx");

    expect(doneSource).toContain("Your workspace is ready.");
    expect(doneSource).toContain("Head to the dashboard to add buildings,");
    expect(doneSource).toContain("review your Portfolio Manager connection, and continue setup.");
    expect(doneSource).toContain("You can add buildings and finish setup later from the dashboard");
    expect(doneSource).toContain('href="/dashboard"');
  });
});
