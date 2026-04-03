import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("dashboard content", () => {
  it("uses the calmer portfolio copy and keeps key navigation intact", () => {
    const source = readRepoFile("src/components/dashboard/dashboard-content.tsx");
    const headerSource = readRepoFile("src/components/layout/page-header.tsx");
    const shellSource = readRepoFile("src/components/layout/sidebar.tsx");
    const topbarSource = readRepoFile("src/components/layout/topbar.tsx");
    const pmCardSource = readRepoFile("src/components/dashboard/espm-connect-card.tsx");

    expect(source).toContain('subtitle="A calm view of what matters today."');
    expect(source).toContain('kicker="Overview"');
    expect(source).toContain('variant="portfolio"');
    expect(source).toContain("Keep it simple.");
    expect(source).toContain("A short list.");
    expect(source).toContain("Open buildings");
    expect(source).toContain('href="/buildings"');
    expect(source).toContain('href={`/buildings/${item.buildingId}`}');
    expect(pmCardSource).toContain('href="/settings"');
    expect(pmCardSource).toContain("Connect in settings");
    expect(pmCardSource).toContain("Open settings");
    expect(source).not.toContain("Keep the portfolio moving");
    expect(source).not.toContain("A short list of what needs work now");
    expect(headerSource).toContain('variant?: "default" | "portfolio"');
    expect(headerSource).toContain('const isPortfolio = variant === "portfolio"');
    expect(shellSource).toContain('fontFamily: "var(--font-dashboard-sans)"');
    expect(topbarSource).toContain('font-dashboard-sans');
  });
});
