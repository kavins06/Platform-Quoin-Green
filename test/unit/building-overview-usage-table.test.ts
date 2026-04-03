import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("building overview monthly usage table", () => {
  it("shows imported reading columns on the overview tab", () => {
    const overviewSource = readRepoFile("src/components/building/building-overview-tab.tsx");
    const buildingRouterSource = readRepoFile("src/server/trpc/routers/building.ts");

    expect(overviewSource).toContain("Imported readings");
    expect(overviewSource).toContain("Electricity");
    expect(overviewSource).toContain("Gas");
    expect(overviewSource).toContain("Water");
    expect(overviewSource).toContain("formatPeriodDate");
    expect(overviewSource).toContain("formatPeriodDateInputValue");
    expect(overviewSource).not.toContain("formatDate(row.periodStart)");
    expect(overviewSource).not.toContain("formatDate(row.periodEnd)");
    expect(overviewSource).toContain("Start date");
    expect(overviewSource).toContain("End date");
    expect(overviewSource).toContain("Usage");
    expect(overviewSource).toContain("Source");
    expect(overviewSource).toContain("Meter");
    expect(overviewSource).toContain("Edit reading");
    expect(overviewSource).toContain("Original source:");
    expect(overviewSource).toContain('return "Edited";');
    expect(overviewSource).toContain('useState<ReadingTabKey>("electricity")');
    expect(overviewSource).toContain('selectedReadingTab === "water"');
    expect(overviewSource).toContain("latestPortfolioManagerMetrics");
    expect(overviewSource).toContain("const latestMetrics =");
    expect(buildingRouterSource).toContain("periodStart: input.periodStart");
    expect(buildingRouterSource).toContain("periodEnd: input.periodEnd");
    expect(buildingRouterSource).toContain("overrideOfReadingId: sourceReading.id");
    expect(buildingRouterSource).toContain("meterName: reading.meter?.name ?? null");
    expect(buildingRouterSource).toContain(
      "const readings = collapseDisplayEnergyReadings(dedupeEnergyReadings(meter.energyReadings))",
    );
    expect(buildingRouterSource).toContain("normalizePortfolioManagerOverviewMetrics");
    expect(buildingRouterSource).toContain("latestPortfolioManagerMetrics:");
  });
});
