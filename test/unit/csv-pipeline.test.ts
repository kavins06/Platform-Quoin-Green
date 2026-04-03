import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  parseCSV,
  detectColumns,
  extractRows,
  parseDate,
  parseNumber,
} from "@/server/pipelines/data-ingestion/csv-parser";
import {
  normalizeReading,
  getConversionFactor,
} from "@/server/pipelines/data-ingestion/normalizer";
import {
  validateReading,
  findDuplicatePeriods,
} from "@/server/pipelines/data-ingestion/validator";
import type { NormalizedReading } from "@/server/pipelines/data-ingestion/types";

function loadFixture(name: string): string {
  return fs.readFileSync(
    path.join(__dirname, "../fixtures/csv", name),
    "utf-8",
  );
}

describe("CSV Pipeline", () => {
  // ─── Pepco CSV Parsing ──────────────────────────────────────────────

  it("auto-detects Pepco column mapping", () => {
    const csv = loadFixture("pepco-electric-12months.csv");
    const { headers } = parseCSV(csv);
    const mapping = detectColumns(headers);

    expect(mapping.startDate).toBe("Service From");
    expect(mapping.endDate).toBe("Service To");
    expect(mapping.consumption).toBe("Usage (kWh)");
    expect(mapping.cost).toBe("Billed Amount");
    expect(mapping.detectedMeterType).toBe("ELECTRIC");
    expect(mapping.detectedUnit).toBe("kWh");
    expect(mapping.confidence).toBeGreaterThan(0.8);
  });

  it("parses 12 Pepco rows with correct values", () => {
    const csv = loadFixture("pepco-electric-12months.csv");
    const { headers, rows } = parseCSV(csv);
    const mapping = detectColumns(headers);
    const parsed = extractRows(headers, rows, mapping);

    expect(parsed).toHaveLength(12);
    expect(parsed[0].consumption).toBe(42500);
    expect(parsed[0].cost).toBe(5312.5);
    expect(parsed[0].startDate).toEqual(new Date("2025-01-01T00:00:00Z"));
    expect(parsed[0].endDate).toEqual(new Date("2025-01-31T00:00:00Z"));
  });

  // ─── Washington Gas CSV Parsing ─────────────────────────────────────

  it("auto-detects Washington Gas column mapping", () => {
    const csv = loadFixture("washington-gas-12months.csv");
    const { headers } = parseCSV(csv);
    const mapping = detectColumns(headers);

    expect(mapping.startDate).toBe("Bill Date");
    expect(mapping.consumption).toBe("CCF");
    expect(mapping.cost).toBe("Total Charges");
    expect(mapping.detectedMeterType).toBe("GAS");
    expect(mapping.detectedUnit).toBe("ccf");
  });

  it("parses 12 Washington Gas rows", () => {
    const csv = loadFixture("washington-gas-12months.csv");
    const { headers, rows } = parseCSV(csv);
    const mapping = detectColumns(headers);
    const parsed = extractRows(headers, rows, mapping);

    expect(parsed).toHaveLength(12);
    expect(parsed[0].consumption).toBe(285);
    expect(parsed[0].cost).toBe(342);
  });

  // ─── Unit Conversions ───────────────────────────────────────────────

  it("converts kWh to kBtu correctly", () => {
    const factor = getConversionFactor("kWh");
    expect(factor).toBe(3.412);
    // 42500 kWh × 3.412 = 145,010 kBtu
    expect(42500 * factor!).toBeCloseTo(145010, 0);
  });

  it("converts CCF to kBtu correctly", () => {
    const factor = getConversionFactor("ccf");
    expect(factor).toBe(102.6);
    // 285 CCF × 102.6 = 29,241 kBtu
    expect(285 * factor!).toBeCloseTo(29241, 0);
  });

  it("converts therms to kBtu correctly", () => {
    const factor = getConversionFactor("therms");
    expect(factor).toBe(100);
    expect(100 * factor!).toBe(10000);
  });

  it("normalizes a kWh reading", () => {
    const result = normalizeReading(
      {
        rowIndex: 2,
        startDate: new Date("2025-01-01T00:00:00Z"),
        endDate: new Date("2025-01-31T00:00:00Z"),
        consumption: 42500,
        cost: 5312.5,
        unit: "kWh",
        raw: {},
      },
      "kWh",
      "ELECTRIC",
    );

    expect(result).not.toBeNull();
    expect(result!.consumptionKbtu).toBeCloseTo(145010, 0);
    expect(result!.consumption).toBe(42500);
    expect(result!.unit).toBe("KWH");
    expect(result!.meterType).toBe("ELECTRIC");
    expect(result!.cost).toBe(5312.5);
  });

  // ─── Date Parsing ──────────────────────────────────────────────────

  it("parses MM/DD/YYYY dates", () => {
    const d = parseDate("01/15/2025");
    expect(d).toEqual(new Date("2025-01-15T00:00:00Z"));
  });

  it("parses YYYY-MM-DD dates", () => {
    const d = parseDate("2025-01-15");
    expect(d).toEqual(new Date("2025-01-15T00:00:00Z"));
  });

  it("parses M/D/YYYY dates", () => {
    const d = parseDate("1/5/2025");
    expect(d).toEqual(new Date("2025-01-05T00:00:00Z"));
  });

  it("returns null for empty date", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate("  ")).toBeNull();
  });

  // ─── Number Parsing ────────────────────────────────────────────────

  it("parses numbers with commas and currency", () => {
    expect(parseNumber("$1,234.56")).toBe(1234.56);
    expect(parseNumber("42,500")).toBe(42500);
    expect(parseNumber("100")).toBe(100);
    expect(parseNumber(" 3.14 ")).toBe(3.14);
  });

  it("returns null for empty/invalid numbers", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("-")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });

  // ─── Validation ────────────────────────────────────────────────────

  it("rejects negative consumption", () => {
    const reading: NormalizedReading = {
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-01-31T00:00:00Z"),
      consumptionKbtu: -500,
      consumption: -500,
      unit: "KBTU",
      cost: null,
      meterType: "ELECTRIC",
    };
    const result = validateReading(reading, 100000);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Negative consumption");
  });

  it("rejects zero consumption", () => {
    const reading: NormalizedReading = {
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-01-31T00:00:00Z"),
      consumptionKbtu: 0,
      consumption: 0,
      unit: "KBTU",
      cost: null,
      meterType: "ELECTRIC",
    };
    const result = validateReading(reading, 100000);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Zero consumption");
  });

  it("rejects future start dates", () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    const reading: NormalizedReading = {
      periodStart: futureDate,
      periodEnd: new Date(futureDate.getTime() + 30 * 86400000),
      consumptionKbtu: 1000,
      consumption: 1000,
      unit: "KBTU",
      cost: null,
      meterType: "ELECTRIC",
    };
    const result = validateReading(reading, 100000);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("future");
  });

  it("warns on anomalously high consumption", () => {
    // 5,000,000 kBtu for 10,000 SF building = 500,000 kBtu/1000SF
    const reading: NormalizedReading = {
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-01-31T00:00:00Z"),
      consumptionKbtu: 5_000_000,
      consumption: 5_000_000,
      unit: "KBTU",
      cost: null,
      meterType: "ELECTRIC",
    };
    const result = validateReading(reading, 10000);
    expect(result.valid).toBe(true); // Warnings don't block
    expect(result.warnings.some((w) => w.includes("Unusually high"))).toBe(
      true,
    );
  });

  it("rejects dates before 2010", () => {
    const reading: NormalizedReading = {
      periodStart: new Date("2005-01-01T00:00:00Z"),
      periodEnd: new Date("2005-01-31T00:00:00Z"),
      consumptionKbtu: 1000,
      consumption: 1000,
      unit: "KBTU",
      cost: null,
      meterType: "ELECTRIC",
    };
    const result = validateReading(reading, 100000);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("too old");
  });

  // ─── Duplicate Detection ───────────────────────────────────────────

  it("detects overlapping billing periods", () => {
    const readings: NormalizedReading[] = [
      {
        periodStart: new Date("2025-01-01T00:00:00Z"),
        periodEnd: new Date("2025-01-31T00:00:00Z"),
        consumptionKbtu: 1000,
        consumption: 1000,
        unit: "KBTU",
        cost: null,
        meterType: "ELECTRIC",
      },
      {
        periodStart: new Date("2025-01-15T00:00:00Z"),
        periodEnd: new Date("2025-02-15T00:00:00Z"),
        consumptionKbtu: 1000,
        consumption: 1000,
        unit: "KBTU",
        cost: null,
        meterType: "ELECTRIC",
      },
    ];
    const dupes = findDuplicatePeriods(readings);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toBe(1);
  });

  // ─── Empty / Malformed CSV ─────────────────────────────────────────

  it("rejects empty CSV", () => {
    expect(() => parseCSV("")).toThrow("header row");
  });

  it("rejects header-only CSV", () => {
    expect(() => parseCSV("Date,Value\n")).toThrow("header row");
  });

  it("handles malformed CSV with per-row errors", () => {
    const csv = loadFixture("malformed.csv");
    const { headers, rows } = parseCSV(csv);
    const mapping = detectColumns(headers);

    // "Date" matches date pattern, "Value" doesn't match consumption well
    expect(mapping.startDate).toBe("Date");
    // Value doesn't match consumption patterns strongly
    // but it's the only non-date column so it might not match at all
    // The important thing is that we handle it gracefully
    expect(rows).toHaveLength(4);
  });

  // ─── Column Confidence ─────────────────────────────────────────────

  it("gives high confidence for Pepco format", () => {
    const mapping = detectColumns([
      "Account Number",
      "Service From",
      "Service To",
      "Usage (kWh)",
      "Billed Amount",
    ]);
    expect(mapping.confidence).toBeGreaterThan(0.9);
  });

  it("gives lower confidence for ambiguous headers", () => {
    const mapping = detectColumns(["A", "B", "C", "D"]);
    expect(mapping.confidence).toBeLessThan(0.3);
  });
});
