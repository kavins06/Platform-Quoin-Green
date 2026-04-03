import type { ParsedRow, NormalizedReading, MeterType, EnergyUnit } from "./types";

/**
 * Conversion factors from native units to kBtu.
 * Source: ESPM Thermal Energy Conversions Technical Reference (Figure 3).
 *
 * These are the EXACT factors used by ENERGY STAR Portfolio Manager.
 */
const KBTU_FACTORS: Record<
  string,
  { factor: number; meterType: MeterType; energyUnit: EnergyUnit }
> = {
  // Electricity
  kwh: { factor: 3.412, meterType: "ELECTRIC", energyUnit: "KWH" },
  mwh: { factor: 3412, meterType: "ELECTRIC", energyUnit: "KWH" },
  kbtu: { factor: 1, meterType: "ELECTRIC", energyUnit: "KBTU" },
  mbtu: { factor: 1000, meterType: "ELECTRIC", energyUnit: "MMBTU" },
  mmbtu: { factor: 1000, meterType: "ELECTRIC", energyUnit: "MMBTU" },

  // Natural Gas
  therms: { factor: 100, meterType: "GAS", energyUnit: "THERMS" },
  ccf: { factor: 102.6, meterType: "GAS", energyUnit: "THERMS" },
  kcf: { factor: 1026, meterType: "GAS", energyUnit: "THERMS" },
  mcf: { factor: 1_026_000, meterType: "GAS", energyUnit: "THERMS" },
  cf: { factor: 1.026, meterType: "GAS", energyUnit: "THERMS" },
  gaskbtu: { factor: 1, meterType: "GAS", energyUnit: "KBTU" },
  gasmbtu: { factor: 1000, meterType: "GAS", energyUnit: "MMBTU" },
  gasmmbtu: { factor: 1000, meterType: "GAS", energyUnit: "MMBTU" },

  // District Steam
  mlb: { factor: 1_194_000, meterType: "STEAM", energyUnit: "MMBTU" },
  klb: { factor: 1194, meterType: "STEAM", energyUnit: "MMBTU" },
  lbs: { factor: 1.194, meterType: "STEAM", energyUnit: "MMBTU" },
  steamkbtu: { factor: 1, meterType: "STEAM", energyUnit: "KBTU" },
  steammbtu: { factor: 1000, meterType: "STEAM", energyUnit: "MMBTU" },
  steammmbtu: { factor: 1000, meterType: "STEAM", energyUnit: "MMBTU" },
  steamtherms: { factor: 100, meterType: "STEAM", energyUnit: "THERMS" },

  // GJ
  gj: { factor: 947.817, meterType: "OTHER", energyUnit: "KBTU" },
};

/**
 * Normalize a unit string to a lookup key.
 */
export function normalizeUnitKey(unit: string): string {
  const lower = unit.toLowerCase().trim();

  if (
    lower === "kwh" ||
    lower === "kw-h" ||
    lower === "kilowatt-hours" ||
    lower === "kilowatt hours"
  )
    return "kwh";
  if (lower === "mwh" || lower === "megawatt-hours") return "mwh";
  if (lower === "therms" || lower === "therm") return "therms";
  if (lower === "ccf" || lower === "hcf") return "ccf";
  if (lower === "kcf") return "kcf";
  if (lower === "mcf") return "mcf";
  if (lower === "cf" || lower === "cubic feet") return "cf";
  if (lower === "mbtu" || lower === "mmbtu" || lower === "million btu") return "mmbtu";
  if (
    lower === "mlb" ||
    lower === "mlbs" ||
    lower === "million lbs" ||
    lower === "million pounds"
  )
    return "mlb";
  if (
    lower === "klb" ||
    lower === "klbs" ||
    lower === "thousand lbs"
  )
    return "klb";
  if (lower === "lbs" || lower === "pounds") return "lbs";
  if (lower === "kbtu" || lower === "thousand btu") return "kbtu";
  if (lower === "gj" || lower === "gigajoules") return "gj";

  return lower;
}

/**
 * Convert a parsed row to a normalized reading in kBtu.
 * Returns null if the row cannot be normalized.
 */
export function normalizeReading(
  row: ParsedRow,
  defaultUnit: string,
  defaultMeterType: MeterType,
): NormalizedReading | null {
  if (!row.startDate || !row.endDate || row.consumption === null) {
    return null;
  }

  const unit = row.unit || defaultUnit;
  const unitKey = normalizeUnitKey(unit);
  const conversion = KBTU_FACTORS[unitKey];

  if (!conversion) {
    return null;
  }

  return {
    periodStart: row.startDate,
    periodEnd: row.endDate,
    consumptionKbtu: row.consumption * conversion.factor,
    consumption: row.consumption,
    unit: conversion.energyUnit,
    cost: row.cost,
    meterType: conversion.meterType || defaultMeterType,
  };
}

/**
 * Get the kBtu conversion factor for a unit.
 */
export function getConversionFactor(unit: string): number | null {
  const key = normalizeUnitKey(unit);
  return KBTU_FACTORS[key]?.factor ?? null;
}

export function getConversionFactorForMeter(
  unit: string,
  meterType: MeterType,
): number | null {
  const key = normalizeUnitKey(unit);
  if (key === "kbtu" && meterType !== "ELECTRIC") {
    return KBTU_FACTORS[`${meterType.toLowerCase()}kbtu`]?.factor ?? KBTU_FACTORS[key]?.factor ?? null;
  }
  if (key === "mmbtu" && meterType !== "ELECTRIC") {
    return (
      KBTU_FACTORS[`${meterType.toLowerCase()}mmbtu`]?.factor ??
      KBTU_FACTORS[`${meterType.toLowerCase()}mbtu`]?.factor ??
      KBTU_FACTORS[key]?.factor ??
      null
    );
  }
  if (key === "therms" && meterType === "STEAM") {
    return KBTU_FACTORS.steamtherms.factor;
  }

  return KBTU_FACTORS[key]?.factor ?? null;
}

/**
 * Source energy conversion factors (site → source).
 * Source: ESPM Source Energy Technical Reference
 */
export const SOURCE_SITE_RATIOS: Record<MeterType, number> = {
  ELECTRIC: 2.8,
  GAS: 1.05,
  STEAM: 1.45,
  WATER_INDOOR: 0,
  WATER_OUTDOOR: 0,
  WATER_RECYCLED: 0,
  OTHER: 1.0,
};
