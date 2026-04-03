import type { MeterType } from "./types";
import { calculateMaxPenalty } from "../pathway-analysis/penalty-calculator";

/**
 * Source-to-site energy ratios per ENERGY STAR reference.
 * Used to convert site energy to source energy for EUI calculations.
 */
const SOURCE_SITE_RATIOS: Record<MeterType, number> = {
  ELECTRIC: 2.8,
  GAS: 1.05,
  STEAM: 1.45,
  WATER_INDOOR: 0,
  WATER_OUTDOOR: 0,
  WATER_RECYCLED: 0,
  OTHER: 1.0,
};

export interface EUICalculation {
  siteEui: number;
  sourceEui: number;
  totalSiteKBtu: number;
  totalSourceKBtu: number;
  readingCount: number;
  monthsCovered: number;
  fuelBreakdown: Record<string, number>;
}

export interface EUIReading {
  consumptionKbtu: number;
  meterType: MeterType;
  periodStart: Date;
}

/**
 * Calculate site and source EUI from energy readings.
 *
 * Site EUI = total site kBtu / GSF
 * Source EUI = total source kBtu / GSF
 * Source kBtu = sum(fuel_kBtu * source_site_ratio)
 */
export function calculateEUI(
  readings: EUIReading[],
  grossSquareFeet: number,
): EUICalculation {
  if (readings.length === 0 || grossSquareFeet <= 0) {
    return {
      siteEui: 0,
      sourceEui: 0,
      totalSiteKBtu: 0,
      totalSourceKBtu: 0,
      readingCount: 0,
      monthsCovered: 0,
      fuelBreakdown: {},
    };
  }

  let totalSiteKBtu = 0;
  let totalSourceKBtu = 0;
  const fuelBreakdown: Record<string, number> = {};
  const months = new Set<string>();

  for (const reading of readings) {
    if (
      reading.meterType !== "ELECTRIC" &&
      reading.meterType !== "GAS" &&
      reading.meterType !== "STEAM"
    ) {
      continue;
    }

    const kbtu = reading.consumptionKbtu;
    totalSiteKBtu += kbtu;

    const ratio = SOURCE_SITE_RATIOS[reading.meterType] ?? 1.0;
    totalSourceKBtu += kbtu * ratio;

    fuelBreakdown[reading.meterType] =
      (fuelBreakdown[reading.meterType] ?? 0) + kbtu;

    const d = reading.periodStart;
    months.add(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }

  return {
    siteEui: totalSiteKBtu / grossSquareFeet,
    sourceEui: totalSourceKBtu / grossSquareFeet,
    totalSiteKBtu,
    totalSourceKBtu,
    readingCount: readings.length,
    monthsCovered: months.size,
    fuelBreakdown,
  };
}

export type ComplianceStatus =
  | "COMPLIANT"
  | "AT_RISK"
  | "NON_COMPLIANT"
  | "EXEMPT"
  | "PENDING_DATA";

/**
 * Determine compliance status from ENERGY STAR score and target.
 *
 * DC BEPS rules:
 * - Score >= target -> COMPLIANT
 * - Score within 5 points of target -> AT_RISK
 * - Score < target - 5 -> NON_COMPLIANT
 * - No score -> PENDING_DATA
 */
export function determineComplianceStatus(
  energyStarScore: number | null,
  bepsTargetScore: number,
): ComplianceStatus {
  if (energyStarScore === null) return "PENDING_DATA";
  if (energyStarScore >= bepsTargetScore) return "COMPLIANT";
  if (bepsTargetScore - energyStarScore <= 5) return "AT_RISK";
  return "NON_COMPLIANT";
}

/**
 * Calculate the compliance gap (positive = above target, negative = below).
 */
export function calculateComplianceGap(
  energyStarScore: number | null,
  bepsTargetScore: number,
): number | null {
  if (energyStarScore === null) return null;
  return energyStarScore - bepsTargetScore;
}

/**
 * Estimate penalty exposure based on compliance gap.
 * Simplified until full pathway analysis (Step 13).
 *
 * If compliant: $0
 * If not: maxPenalty * (gap / targetScore)
 */
export function estimatePenalty(
  energyStarScore: number | null,
  bepsTargetScore: number,
  maxPenaltyExposure: number,
): number {
  if (energyStarScore === null) return 0;
  if (energyStarScore >= bepsTargetScore) return 0;

  const gap = bepsTargetScore - energyStarScore;
  const penaltyFraction = Math.min(gap / bepsTargetScore, 1.0);
  return Math.round(maxPenaltyExposure * penaltyFraction);
}

/**
 * Compute data quality score (0-100) from validation results.
 */
export function computeDataQualityScore(
  totalReadings: number,
  rejectedReadings: number,
  warningCount: number,
  monthsCovered: number,
): number {
  if (totalReadings === 0) return 0;

  let score = 100;

  const rejectionRate = rejectedReadings / totalReadings;
  score -= rejectionRate * 40;

  const warningRate = warningCount / totalReadings;
  score -= Math.min(warningRate * 20, 20);

  if (monthsCovered < 12) {
    score -= (12 - monthsCovered) * 3;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export interface SnapshotInput {
  buildingId: string;
  organizationId: string;
  grossSquareFeet: number;
  bepsTargetScore: number;
  energyStarScore: number | null;
  siteEui: number;
  sourceEui: number;
  weatherNormalizedSiteEui: number | null;
  weatherNormalizedSourceEui?: number | null;
  dataQualityScore?: number;
}

/**
 * Build ComplianceSnapshot data object (pure function, no persistence).
 * Returns data matching the Prisma ComplianceSnapshot model.
 */
export function buildSnapshotData(input: SnapshotInput) {
  const status = determineComplianceStatus(
    input.energyStarScore,
    input.bepsTargetScore,
  );
  const gap = calculateComplianceGap(
    input.energyStarScore,
    input.bepsTargetScore,
  );
  const maxPenalty = calculateMaxPenalty(input.grossSquareFeet);
  const penalty = estimatePenalty(
    input.energyStarScore,
    input.bepsTargetScore,
    maxPenalty,
  );

  return {
    buildingId: input.buildingId,
    organizationId: input.organizationId,
    triggerType: "PIPELINE_RUN" as const,
    energyStarScore: input.energyStarScore,
    siteEui: input.siteEui,
    sourceEui: input.sourceEui,
    weatherNormalizedSourceEui: input.weatherNormalizedSourceEui ?? null,
    complianceStatus: status,
    complianceGap: gap,
    estimatedPenalty: penalty,
    weatherNormalizedSiteEui: input.weatherNormalizedSiteEui,
    dataQualityScore: input.dataQualityScore ?? null,
  };
}
