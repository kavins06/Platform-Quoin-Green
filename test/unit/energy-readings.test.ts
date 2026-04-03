import { describe, expect, it } from "vitest";
import { collapseDisplayEnergyReadings } from "@/server/lib/energy-readings";

describe("energy reading display collapse", () => {
  it("hides an overridden imported row when a manual override exists", () => {
    const baseStart = new Date("2025-01-01T00:00:00.000Z");
    const baseEnd = new Date("2025-01-31T00:00:00.000Z");

    const rows = collapseDisplayEnergyReadings([
      {
        id: "imported-1",
        meterId: "meter-1",
        meterType: "ELECTRIC",
        source: "ESPM_SYNC",
        periodStart: baseStart,
        periodEnd: baseEnd,
        ingestedAt: new Date("2026-04-02T18:00:00.000Z"),
      },
      {
        id: "manual-1",
        meterId: "meter-1",
        meterType: "ELECTRIC",
        source: "MANUAL",
        periodStart: new Date("2025-01-03T00:00:00.000Z"),
        periodEnd: new Date("2025-01-29T00:00:00.000Z"),
        ingestedAt: new Date("2026-04-02T18:05:00.000Z"),
        rawPayload: {
          overrideOfReadingId: "imported-1",
          overrideSource: "ESPM_SYNC",
        },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("manual-1");
  });
});
