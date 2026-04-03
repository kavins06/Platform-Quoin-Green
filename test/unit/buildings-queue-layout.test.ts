import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("buildings queue layout", () => {
  it("moves runtime status into right-side chips and removes PM sync wording", () => {
    const source = readRepoFile("src/components/dashboard/compliance-queue.tsx");

    expect(source).toContain('data-testid="building-runtime-status-chips"');
    expect(source).toContain('{ label: "Data", value: compliance.label }');
    expect(source).toContain('{ label: "Readiness", value: formatDate(item.timestamps.lastReadinessEvaluatedAt) }');
    expect(source).toContain('{ label: "Packet", value: benchmarkArtifact.label }');
    expect(source).toContain('{ label: "Submission", value: submissionState.label }');
    expect(source).toContain('{ label: "Sync", value: syncState.label }');
    expect(source).not.toContain("item.nextAction.title");
    expect(source).not.toContain("Refresh Portfolio Manager sync");
    expect(source).not.toContain("Portfolio Manager is linked but no sync has been recorded yet.");
  });
});
