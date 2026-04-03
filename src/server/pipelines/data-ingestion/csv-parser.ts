import Papa from "papaparse";
import type { ParsedRow, ColumnMapping, MeterType } from "./types";

/**
 * Parse CSV content with PapaParse (auto-detect delimiter).
 */
export function parseCSV(content: string): {
  headers: string[];
  rows: string[][];
  delimiter: string;
} {
  if (!content.trim()) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const result = Papa.parse<string[]>(content, {
    header: false,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (result.errors.length > 0) {
    const critical = result.errors.filter(
      (e) => e.type === "Delimiter" || e.type === "FieldMismatch",
    );
    if (critical.length > 0) {
      throw new Error(`CSV parse error: ${critical[0].message}`);
    }
  }

  const data = result.data;
  if (data.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const headers = data[0].map((h) => h.trim());
  const rows = data
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""));

  return { headers, rows, delimiter: result.meta.delimiter };
}

/**
 * Auto-detect column mapping by scoring headers against known patterns.
 */
export function detectColumns(headers: string[]): ColumnMapping {
  const startDatePatterns = [
    { pattern: /^service\s*from$/i, score: 1.0 },
    { pattern: /^start\s*date$/i, score: 0.95 },
    { pattern: /^period\s*start$/i, score: 0.9 },
    { pattern: /^from\s*date$/i, score: 0.9 },
    { pattern: /^bill\s*date$/i, score: 0.6 },
    { pattern: /^read\s*date$/i, score: 0.6 },
    { pattern: /^date$/i, score: 0.5 },
    { pattern: /from/i, score: 0.3 },
    { pattern: /start/i, score: 0.3 },
  ];

  const endDatePatterns = [
    { pattern: /^service\s*to$/i, score: 1.0 },
    { pattern: /^end\s*date$/i, score: 0.95 },
    { pattern: /^period\s*end$/i, score: 0.9 },
    { pattern: /^to\s*date$/i, score: 0.9 },
    { pattern: /^through$/i, score: 0.7 },
    { pattern: /to$/i, score: 0.2 },
    { pattern: /end/i, score: 0.2 },
  ];

  const consumptionPatterns: {
    pattern: RegExp;
    score: number;
    unit: string;
    meter: MeterType;
  }[] = [
    {
      pattern: /^usage\s*\(kwh\)$/i,
      score: 1.0,
      unit: "kWh",
      meter: "ELECTRIC",
    },
    {
      pattern: /^consumption\s*\(kwh\)$/i,
      score: 1.0,
      unit: "kWh",
      meter: "ELECTRIC",
    },
    { pattern: /^kwh$/i, score: 0.95, unit: "kWh", meter: "ELECTRIC" },
    {
      pattern: /^usage\s*\(therms\)$/i,
      score: 1.0,
      unit: "therms",
      meter: "GAS",
    },
    { pattern: /^therms$/i, score: 0.95, unit: "therms", meter: "GAS" },
    { pattern: /^ccf$/i, score: 0.95, unit: "ccf", meter: "GAS" },
    { pattern: /^usage$/i, score: 0.7, unit: "unknown", meter: "ELECTRIC" },
    {
      pattern: /^consumption$/i,
      score: 0.7,
      unit: "unknown",
      meter: "ELECTRIC",
    },
    { pattern: /^energy/i, score: 0.5, unit: "unknown", meter: "ELECTRIC" },
    { pattern: /^quantity/i, score: 0.4, unit: "unknown", meter: "ELECTRIC" },
    { pattern: /kwh/i, score: 0.6, unit: "kWh", meter: "ELECTRIC" },
    { pattern: /therm/i, score: 0.6, unit: "therms", meter: "GAS" },
  ];

  const costPatterns = [
    { pattern: /^billed\s*amount$/i, score: 1.0 },
    { pattern: /^total\s*charges?$/i, score: 0.95 },
    { pattern: /^cost$/i, score: 0.9 },
    { pattern: /^amount$/i, score: 0.8 },
    { pattern: /^\$/, score: 0.7 },
    { pattern: /charge/i, score: 0.5 },
    { pattern: /cost/i, score: 0.5 },
    { pattern: /billed/i, score: 0.4 },
  ];

  function bestMatch(
    patterns: { pattern: RegExp; score: number }[],
  ): { column: string | null; score: number } {
    let best: { column: string | null; score: number } = {
      column: null,
      score: 0,
    };
    for (const header of headers) {
      for (const p of patterns) {
        if (p.pattern.test(header) && p.score > best.score) {
          best = { column: header, score: p.score };
        }
      }
    }
    return best;
  }

  function bestConsumptionMatch(): {
    column: string | null;
    score: number;
    unit: string;
    meter: MeterType;
  } {
    let best = {
      column: null as string | null,
      score: 0,
      unit: "unknown",
      meter: "ELECTRIC" as MeterType,
    };
    for (const header of headers) {
      for (const p of consumptionPatterns) {
        if (p.pattern.test(header) && p.score > best.score) {
          best = { column: header, score: p.score, unit: p.unit, meter: p.meter };
        }
      }
    }
    return best;
  }

  const startDate = bestMatch(startDatePatterns);
  const endDate = bestMatch(endDatePatterns);
  const consumption = bestConsumptionMatch();
  const cost = bestMatch(costPatterns);

  const requiredScores = [startDate.score, consumption.score];
  const avgRequired =
    requiredScores.reduce((a, b) => a + b, 0) / requiredScores.length;

  return {
    startDate: startDate.column,
    endDate: endDate.column,
    consumption: consumption.column,
    cost: cost.column,
    unit: null,
    confidence: avgRequired,
    detectedMeterType: consumption.meter,
    detectedUnit: consumption.unit,
  };
}

/**
 * Parse date from various formats.
 * Handles: MM/DD/YYYY, YYYY-MM-DD, M/D/YYYY
 */
export function parseDate(value: string): Date | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();

  // ISO format: YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
    const d = new Date(trimmed + "T00:00:00Z");
    return isNaN(d.getTime()) ? null : d;
  }

  // US format: MM/DD/YYYY or M/D/YYYY
  const usMatch = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const d = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a numeric value from a CSV cell.
 * Handles: commas, currency symbols, whitespace
 */
export function parseNumber(value: string): number | null {
  if (!value || !value.trim()) return null;
  const cleaned = value.trim().replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Extract ParsedRows from raw CSV data using detected column mapping.
 */
export function extractRows(
  headers: string[],
  rows: string[][],
  mapping: ColumnMapping,
): ParsedRow[] {
  const startIdx = mapping.startDate
    ? headers.indexOf(mapping.startDate)
    : -1;
  const endIdx = mapping.endDate ? headers.indexOf(mapping.endDate) : -1;
  const consumptionIdx = mapping.consumption
    ? headers.indexOf(mapping.consumption)
    : -1;
  const costIdx = mapping.cost ? headers.indexOf(mapping.cost) : -1;

  if (consumptionIdx === -1) {
    throw new Error("Could not find consumption column in CSV");
  }
  if (startIdx === -1) {
    throw new Error("Could not find date column in CSV");
  }

  return rows.map((row, i) => {
    const raw: Record<string, string> = {};
    headers.forEach((h, j) => {
      raw[h] = row[j] ?? "";
    });

    const startDate = parseDate(row[startIdx] ?? "");
    let endDate = endIdx >= 0 ? parseDate(row[endIdx] ?? "") : null;

    // If no end date column, assume end = start + 1 month - 1 day
    if (!endDate && startDate) {
      const end = new Date(startDate);
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCDate(end.getUTCDate() - 1);
      endDate = end;
    }

    return {
      rowIndex: i + 2, // +2 for 1-indexed + header row
      startDate,
      endDate,
      consumption: parseNumber(row[consumptionIdx] ?? ""),
      cost: costIdx >= 0 ? parseNumber(row[costIdx] ?? "") : null,
      unit: mapping.detectedUnit,
      raw,
    };
  });
}
