import { describe, expect, it } from "vitest";
import { validateBenchmarkYearData } from "@/server/compliance/data-quality";

describe("validateBenchmarkYearData", () => {
  it("detects missing months and incomplete annual coverage", () => {
    const result = validateBenchmarkYearData(
      [
        {
          meterId: "meter_1",
          meterType: "ELECTRIC",
          periodStart: new Date("2025-01-01T00:00:00.000Z"),
          periodEnd: new Date("2025-06-30T00:00:00.000Z"),
        },
      ],
      2025,
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.missingMonths).toEqual([7, 8, 9, 10, 11, 12]);
    expect(result.issues.map((issue) => issue.details.issueType)).toEqual(
      expect.arrayContaining(["MISSING_MONTHS", "INCOMPLETE_TWELVE_MONTH_COVERAGE"]),
    );
  });

  it("detects overlapping billing periods", () => {
    const result = validateBenchmarkYearData(
      [
        {
          meterId: "meter_1",
          meterType: "ELECTRIC",
          periodStart: new Date("2025-01-01T00:00:00.000Z"),
          periodEnd: new Date("2025-06-30T00:00:00.000Z"),
        },
        {
          meterId: "meter_1",
          meterType: "ELECTRIC",
          periodStart: new Date("2025-06-15T00:00:00.000Z"),
          periodEnd: new Date("2025-12-31T00:00:00.000Z"),
        },
      ],
      2025,
    );

    expect(result.verdict).toBe("FAIL");
    expect(result.overlapStreams).toEqual(["meter:meter_1"]);
    expect(result.issues.map((issue) => issue.details.issueType)).toContain(
      "OVERLAPPING_PERIODS",
    );
  });

  it("allows periods that touch on the same boundary date", () => {
    const result = validateBenchmarkYearData(
      [
        {
          meterId: "meter_1",
          meterType: "ELECTRIC",
          periodStart: new Date("2025-01-01T00:00:00.000Z"),
          periodEnd: new Date("2025-06-30T00:00:00.000Z"),
        },
        {
          meterId: "meter_1",
          meterType: "ELECTRIC",
          periodStart: new Date("2025-06-30T00:00:00.000Z"),
          periodEnd: new Date("2025-12-31T00:00:00.000Z"),
        },
      ],
      2025,
    );

    expect(result.overlapStreams).toEqual([]);
    expect(result.issues.map((issue) => issue.details.issueType)).not.toContain(
      "OVERLAPPING_PERIODS",
    );
  });

  it("passes clean annual coverage without issues", () => {
    const result = validateBenchmarkYearData(
      [
        {
          meterId: "meter_1",
          meterType: "ELECTRIC",
          periodStart: new Date("2025-01-01T00:00:00.000Z"),
          periodEnd: new Date("2025-12-31T00:00:00.000Z"),
        },
      ],
      2025,
    );

    expect(result.verdict).toBe("PASS");
    expect(result.coverageComplete).toBe(true);
    expect(result.missingMonths).toEqual([]);
    expect(result.issues).toHaveLength(0);
  });
});
