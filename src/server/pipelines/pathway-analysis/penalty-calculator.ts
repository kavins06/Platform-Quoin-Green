import type {
  PerformancePathwayInput,
  StandardTargetInput,
  PrescriptivePathwayInput,
  PenaltyResult,
  AllPathwaysResult,
} from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

const PENALTY_PER_SQFT = 10;
const MAX_PENALTY_CAP = 7_500_000;
const PERFORMANCE_TARGET_PCT = 20;

/**
 * Default max gap for Standard Target two-step calculation.
 * Represents the ENERGY STAR score gap at which a building would need
 * a 20% Source EUI reduction to meet BEPS. Property-type-specific.
 * From BEPS Compliance Guidebook Table 23 explanation.
 */
const DEFAULT_MAX_GAP = 15;

// ─── Max Penalty ─────────────────────────────────────────────────────────────

/**
 * Calculate maximum penalty: min(GSF × $10, $7,500,000).
 */
export function calculateMaxPenalty(grossSquareFeet: number): number {
  if (grossSquareFeet <= 0) return 0;
  return Math.min(grossSquareFeet * PENALTY_PER_SQFT, MAX_PENALTY_CAP);
}

// ─── Performance Pathway ─────────────────────────────────────────────────────

/**
 * Performance Pathway penalty — proportional to % of 20% Site EUI reduction achieved.
 *
 * BEPS Compliance Guidebook Table 23:
 * "The penalty shall be adjusted by calculating the percent of Site EUI reduction
 *  achieved divided by twenty percent (20%)."
 *
 * Formula:
 *   reductionAchieved = (baselineEUI - currentEUI) / baselineEUI × 100
 *   progress = reductionAchieved / 20
 *   adjustedPenalty = maxPenalty × (1 - progress)
 */
export function calculatePerformancePenalty(
  input: PerformancePathwayInput,
): PenaltyResult {
  const maxPenalty = calculateMaxPenalty(input.grossSquareFeet);

  if (input.baselineAdjustedSiteEui <= 0) {
    return {
      maxPenalty,
      adjustedPenalty: maxPenalty,
      reductionPct: 0,
      pathway: "PERFORMANCE",
      compliant: false,
      details:
        "No baseline Adjusted Site EUI available — cannot calculate Performance Pathway.",
    };
  }

  const reductionPct =
    ((input.baselineAdjustedSiteEui - input.currentAdjustedSiteEui) / input.baselineAdjustedSiteEui) *
    100;
  const targetPct = input.targetReductionPct || PERFORMANCE_TARGET_PCT;

  if (reductionPct >= targetPct) {
    return {
      maxPenalty,
      adjustedPenalty: 0,
      reductionPct: 100,
      pathway: "PERFORMANCE",
      compliant: true,
      details: `Achieved ${reductionPct.toFixed(1)}% Site EUI reduction (target: ${targetPct}%). Compliant.`,
    };
  }

  const progress = Math.max(0, reductionPct) / targetPct;
  const penaltyReductionPct = progress * 100;
  const adjustedPenalty = Math.round(maxPenalty * (1 - progress));

  return {
    maxPenalty,
    adjustedPenalty,
    reductionPct: penaltyReductionPct,
    pathway: "PERFORMANCE",
    compliant: false,
    details: `Achieved ${reductionPct.toFixed(1)}% of ${targetPct}% target. Penalty reduced by ${penaltyReductionPct.toFixed(1)}%.`,
  };
}

// ─── Standard Target Pathway ─────────────────────────────────────────────────

/**
 * Standard Target Pathway — TWO-STEP adjustment from BEPS Guidebook Table 23.
 *
 * Step 1 (Initial Performance Adjustment):
 *   initialAdj = 1 - (baselineGap / maxGapForPropertyType)
 *
 * Step 2 (Gap Closure):
 *   gapClosure = pointsGained / totalGapToClose
 *
 * Combined:
 *   totalReduction = 1 - (1 - initialAdj) × (1 - gapClosure)
 *   adjustedPenalty = maxPenalty × (1 - totalReduction)
 *
 * Guidebook Example (Building B):
 *   Baseline gap 10, maxGap 15, gained 4 of 10.
 *   initialAdj = 1 - 10/15 = 33.3%
 *   gapClosure = 4/10 = 40%
 *   totalReduction = 1 - 0.667×0.6 = 60%
 *   Penalty = 40% of max.
 */
export function calculateStandardTargetPenalty(
  input: StandardTargetInput,
): PenaltyResult {
  const maxPenalty = calculateMaxPenalty(input.grossSquareFeet);

  if (input.currentScore >= input.bepsTargetScore) {
    return {
      maxPenalty,
      adjustedPenalty: 0,
      reductionPct: 100,
      pathway: "STANDARD_TARGET",
      compliant: true,
      details: `Score ${input.currentScore} meets or exceeds target ${input.bepsTargetScore}. Compliant.`,
    };
  }

  const baselineGap = input.bepsTargetScore - input.baselineScore;
  const maxGap = input.maxGapForPropertyType ?? DEFAULT_MAX_GAP;

  // Step 1: Initial performance adjustment
  const initialAdjustment =
    baselineGap > 0 ? Math.max(0, 1 - baselineGap / maxGap) : 1;

  // Step 2: Gap closure
  const pointsGained = Math.max(0, input.currentScore - input.baselineScore);
  const gapClosure =
    baselineGap > 0 ? Math.min(pointsGained / baselineGap, 1) : 0;

  // Combined
  const totalReduction =
    1 - (1 - initialAdjustment) * (1 - gapClosure);
  const reductionPct = totalReduction * 100;
  const adjustedPenalty = Math.round(maxPenalty * (1 - totalReduction));

  return {
    maxPenalty,
    adjustedPenalty,
    reductionPct,
    pathway: "STANDARD_TARGET",
    compliant: false,
    details:
      `Baseline gap: ${baselineGap} pts (adj: ${(initialAdjustment * 100).toFixed(0)}%). ` +
      `Gained ${pointsGained} of ${baselineGap} pts (closure: ${(gapClosure * 100).toFixed(0)}%). ` +
      `Total reduction: ${reductionPct.toFixed(1)}%.`,
  };
}

// ─── Prescriptive Pathway ────────────────────────────────────────────────────

/**
 * Prescriptive Pathway — simple ratio of points earned to points needed.
 *
 * BEPS Guidebook Table 23:
 * "The penalty shall be adjusted by calculating the number of Prescriptive Pathway
 *  points actually earned divided by total needed."
 */
export function calculatePrescriptivePenalty(
  input: PrescriptivePathwayInput,
): PenaltyResult {
  const maxPenalty = calculateMaxPenalty(input.grossSquareFeet);

  if (input.pointsNeeded <= 0) {
    return {
      maxPenalty,
      adjustedPenalty: 0,
      reductionPct: 100,
      pathway: "PRESCRIPTIVE",
      compliant: true,
      details: "No prescriptive points needed. Compliant.",
    };
  }

  if (input.pointsEarned >= input.pointsNeeded) {
    return {
      maxPenalty,
      adjustedPenalty: 0,
      reductionPct: 100,
      pathway: "PRESCRIPTIVE",
      compliant: true,
      details: `Earned ${input.pointsEarned} of ${input.pointsNeeded} points. Compliant.`,
    };
  }

  const progress = Math.max(0, input.pointsEarned) / input.pointsNeeded;
  const reductionPct = progress * 100;
  const adjustedPenalty = Math.round(maxPenalty * (1 - progress));

  return {
    maxPenalty,
    adjustedPenalty,
    reductionPct,
    pathway: "PRESCRIPTIVE",
    compliant: false,
    details: `Earned ${input.pointsEarned} of ${input.pointsNeeded} points. Penalty reduced by ${reductionPct.toFixed(1)}%.`,
  };
}

// ─── Pathway Routing ────────────────────────────────────────────────────────

/**
 * Determine applicable compliance pathway based on ENERGY STAR score.
 *
 * DC BEPS rules:
 * - Score >= target: COMPLIANT (no pathway needed)
 * - Score > 55 and < target: Standard Target Pathway (score-based gap closure)
 * - Score <= 55: Performance Pathway (20% Site EUI reduction target, ignores score)
 *
 * Buildings can always opt for Prescriptive as an alternative.
 */
export function determineApplicablePathway(
  currentScore: number | null,
  bepsTargetScore: number,
): "COMPLIANT" | "STANDARD_TARGET" | "PERFORMANCE" | "PENDING_DATA" {
  if (currentScore === null) return "PENDING_DATA";
  if (currentScore >= bepsTargetScore) return "COMPLIANT";
  if (currentScore > 55) return "STANDARD_TARGET";
  return "PERFORMANCE";
}

// ─── All Pathways Comparison ─────────────────────────────────────────────────

/**
 * Calculate penalties for all applicable pathways and recommend the lowest.
 */
export function calculateAllPathways(input: {
  grossSquareFeet: number;
  propertyType: string;
  bepsTargetScore: number;
  baselineAdjustedSiteEui?: number;
  currentAdjustedSiteEui?: number;
  baselineScore?: number;
  currentScore?: number;
  maxGapForPropertyType?: number;
  prescriptivePointsEarned?: number;
  prescriptivePointsNeeded?: number;
}): AllPathwaysResult {
  let performance: PenaltyResult | null = null;
  let standardTarget: PenaltyResult | null = null;
  let prescriptive: PenaltyResult | null = null;

  if (input.baselineAdjustedSiteEui != null && input.currentAdjustedSiteEui != null) {
    performance = calculatePerformancePenalty({
      grossSquareFeet: input.grossSquareFeet,
      propertyType: input.propertyType,
      bepsTargetScore: input.bepsTargetScore,
      baselineAdjustedSiteEui: input.baselineAdjustedSiteEui,
      currentAdjustedSiteEui: input.currentAdjustedSiteEui,
      targetReductionPct: PERFORMANCE_TARGET_PCT,
    });
  }

  if (input.baselineScore != null && input.currentScore != null) {
    standardTarget = calculateStandardTargetPenalty({
      grossSquareFeet: input.grossSquareFeet,
      propertyType: input.propertyType,
      bepsTargetScore: input.bepsTargetScore,
      baselineScore: input.baselineScore,
      currentScore: input.currentScore,
      maxGapForPropertyType: input.maxGapForPropertyType,
    });
  }

  if (
    input.prescriptivePointsEarned != null &&
    input.prescriptivePointsNeeded != null
  ) {
    prescriptive = calculatePrescriptivePenalty({
      grossSquareFeet: input.grossSquareFeet,
      propertyType: input.propertyType,
      bepsTargetScore: input.bepsTargetScore,
      pointsEarned: input.prescriptivePointsEarned,
      pointsNeeded: input.prescriptivePointsNeeded,
    });
  }

  const options = [performance, standardTarget, prescriptive].filter(
    (r): r is PenaltyResult => r !== null,
  );

  let recommended: PenaltyResult | null = null;
  if (options.length > 0) {
    recommended = options.reduce((best, current) =>
      current.adjustedPenalty < best.adjustedPenalty ? current : best,
    );
  }

  return {
    performance,
    standardTarget,
    prescriptive,
    recommended,
    recommendedPathway: recommended?.pathway ?? null,
  };
}
