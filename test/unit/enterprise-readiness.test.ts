import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("benchmarking-only enterprise readiness contract", () => {
  it("adds approval requests and governance visibility to the active organization surface", () => {
    const organizationRouter = readRepoFile("src/server/trpc/routers/organization.ts");
    const governancePanel = readRepoFile(
      "src/components/settings/enterprise-governance-panel.tsx",
    );
    const approvalService = readRepoFile("src/server/lib/approval-requests.ts");

    expect(organizationRouter).toContain("governanceOverview");
    expect(organizationRouter).toContain("reviewApprovalRequest");
    expect(governancePanel).toContain("Pending approvals");
    expect(governancePanel).toContain("Runtime health");
    expect(governancePanel).toContain("Recent audit trail");
    expect(approvalService).toContain("APPROVAL_REQUEST_CREATED");
    expect(approvalService).toContain("APPROVAL_REQUEST_APPROVED");
    expect(approvalService).toContain("APPROVAL_REQUEST_REJECTED");
  });

  it("expands runtime health and hardens public integration routes", () => {
    const runtimeHealth = readRepoFile("src/server/lib/runtime-health.ts");
    const healthRoute = readRepoFile("src/app/api/health/route.ts");
    const activeOrgRoute = readRepoFile("src/app/api/auth/active-organization/route.ts");
    const greenButtonAuthorize = readRepoFile(
      "src/app/api/green-button/authorize/route.ts",
    );
    const greenButtonCallback = readRepoFile(
      "src/app/api/green-button/callback/route.ts",
    );

    expect(runtimeHealth).toContain("getPlatformRuntimeHealth");
    expect(runtimeHealth).toContain("ACTIVE_QUEUE_NAMES");
    expect(healthRoute).toContain("getPlatformRuntimeHealth");
    expect(activeOrgRoute).toContain("applyRateLimit");
    expect(activeOrgRoute).toContain("AUTH_ACTIVE_ORGANIZATION_SET");
    expect(greenButtonAuthorize).toContain("GREEN_BUTTON_STATE_COOKIE");
    expect(greenButtonAuthorize).toContain("applyRateLimit");
    expect(greenButtonCallback).toContain("expectedState");
    expect(greenButtonCallback).toContain("clearStateCookie");
  });

  it("locks CI onto the Supabase auth contract and enterprise docs", () => {
    const ciWorkflow = readRepoFile(".github/workflows/ci.yml");
    const platformContractScript = readRepoFile("scripts/validate-platform-contract.mjs");
    const middleware = readRepoFile("src/middleware.ts");
    const architectureDoc = readRepoFile("docs/active-architecture.md");
    const securityPacket = readRepoFile("docs/security-packet.md");
    const runbooks = readRepoFile("docs/runbooks.md");

    expect(ciWorkflow).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(ciWorkflow).toContain("validate-platform-contract");
    expect(platformContractScript).toContain('ensureEnv("NEXT_PUBLIC_SUPABASE_URL")');
    expect(platformContractScript).toContain("Clerk environment variable");
    expect(middleware).not.toContain("Clerk/Supabase compatibility");
    expect(architectureDoc).toContain("benchmarking-only");
    expect(securityPacket).toContain("Approval-gated actions");
    expect(runbooks).toContain("Redis or worker outage");
  });
});
