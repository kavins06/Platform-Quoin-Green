import type { NormalizedReading, ValidationResult, MeterType } from "./types";

/**
 * Expected monthly consumption ranges by meter type (in kBtu per 1000 SF).
 * Based on CBECS data for DC commercial buildings.
 */
const EXPECTED_RANGES: Record<
  MeterType,
  { minPerKSF: number; maxPerKSF: number }
> = {
  ELECTRIC: { minPerKSF: 0.5, maxPerKSF: 50 },
  GAS: { minPerKSF: 0.1, maxPerKSF: 30 },
  STEAM: { minPerKSF: 0.1, maxPerKSF: 40 },
  WATER_INDOOR: { minPerKSF: 0, maxPerKSF: 0 },
  WATER_OUTDOOR: { minPerKSF: 0, maxPerKSF: 0 },
  WATER_RECYCLED: { minPerKSF: 0, maxPerKSF: 0 },
  OTHER: { minPerKSF: 0, maxPerKSF: 100 },
};

/**
 * Validate a single normalized reading.
 * Returns blocking errors and non-blocking warnings.
 */
export function validateReading(
  reading: NormalizedReading,
  buildingGSF: number,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (reading.consumptionKbtu < 0) {
    errors.push(`Negative consumption: ${reading.consumptionKbtu} kBtu`);
  }

  if (reading.consumptionKbtu === 0) {
    errors.push("Zero consumption — likely missing data");
  }

  const now = new Date();
  if (reading.periodStart > now) {
    errors.push(
      `Start date is in the future: ${reading.periodStart.toISOString()}`,
    );
  }
  if (reading.periodEnd > now) {
    warnings.push(
      `End date is in the future: ${reading.periodEnd.toISOString()}`,
    );
  }

  if (reading.periodEnd <= reading.periodStart) {
    errors.push("End date must be after start date");
  }

  const periodDays =
    (reading.periodEnd.getTime() - reading.periodStart.getTime()) /
    (1000 * 60 * 60 * 24);
  if (periodDays > 45) {
    warnings.push(
      `Billing period is ${Math.round(periodDays)} days (expected ~30)`,
    );
  }
  if (periodDays < 20) {
    warnings.push(
      `Billing period is only ${Math.round(periodDays)} days (expected ~30)`,
    );
  }

  if (buildingGSF > 0) {
    const kbtuPerKSF = reading.consumptionKbtu / (buildingGSF / 1000);
    const range = EXPECTED_RANGES[reading.meterType];
    if (kbtuPerKSF > range.maxPerKSF) {
      warnings.push(
        `Unusually high consumption: ${Math.round(kbtuPerKSF)} kBtu/1000SF ` +
          `(expected max ~${range.maxPerKSF} for ${reading.meterType})`,
      );
    }
    if (kbtuPerKSF < range.minPerKSF && reading.consumptionKbtu > 0) {
      warnings.push(
        `Unusually low consumption: ${kbtuPerKSF.toFixed(1)} kBtu/1000SF ` +
          `(expected min ~${range.minPerKSF} for ${reading.meterType})`,
      );
    }
  }

  if (reading.cost !== null && reading.cost < 0) {
    warnings.push(`Negative cost: $${reading.cost}`);
  }

  if (reading.periodStart.getFullYear() < 2010) {
    errors.push(
      `Date too old for BEPS compliance: ${reading.periodStart.getFullYear()}`,
    );
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Check for duplicate/overlapping periods in a set of readings.
 * Returns indices of rows that overlap with earlier rows.
 */
export function findDuplicatePeriods(readings: NormalizedReading[]): number[] {
  const duplicateIndices: number[] = [];
  for (let i = 0; i < readings.length; i++) {
    for (let j = i + 1; j < readings.length; j++) {
      const a = readings[i];
      const b = readings[j];
      if (a.periodStart < b.periodEnd && b.periodStart < a.periodEnd) {
        if (!duplicateIndices.includes(j)) duplicateIndices.push(j);
      }
    }
  }
  return duplicateIndices;
}
