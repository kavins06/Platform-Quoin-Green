import { describe, expect, it } from "vitest";
import {
  formatPeriodDate,
  formatPeriodDateInputValue,
  formatPeriodDateRange,
  parsePeriodDate,
} from "@/lib/period-date";

describe("period date utilities", () => {
  it("parses date-only strings as UTC calendar dates", () => {
    expect(parsePeriodDate("2025-12-14")?.toISOString()).toBe("2025-12-14T00:00:00.000Z");
    expect(parsePeriodDate("2025-08-14")?.toISOString()).toBe("2025-08-14T00:00:00.000Z");
  });

  it("formats period dates without timezone drift", () => {
    expect(formatPeriodDate("2025-12-14T00:00:00.000Z")).toBe("Dec 14, 2025");
    expect(formatPeriodDate("2025-08-14T00:00:00.000Z")).toBe("Aug 14, 2025");
    expect(formatPeriodDateRange("2025-12-14T00:00:00.000Z", "2026-01-13T00:00:00.000Z")).toBe(
      "Dec 14, 2025 to Jan 13, 2026",
    );
  });

  it("produces stable date input values from UTC period dates", () => {
    expect(formatPeriodDateInputValue("2025-12-14T00:00:00.000Z")).toBe("2025-12-14");
    expect(formatPeriodDateInputValue("2025-08-14T00:00:00.000Z")).toBe("2025-08-14");
  });
});
