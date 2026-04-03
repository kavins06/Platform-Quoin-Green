/**
 * Golden Datasets — Hand-verified expected outputs for deterministic pipelines.
 *
 * These are the source of truth. If code disagrees with this file, the code is wrong.
 *
 * Penalty formula:
 *   maxPenalty = min(grossSquareFeet × $10, $7,500,000)
 *
 * Progress by pathway:
 *   Performance:  euiReductionPct / 20 → penalty = maxPenalty × (1 - progress)
 *   Standard Target (two-step, BEPS Guidebook Table 23):
 *     initialAdj = max(0, 1 - baselineGap / maxGapForPropertyType)  [default maxGap=15]
 *     gapClosure = min(pointsGained / baselineGap, 1)
 *     totalReduction = 1 - (1 - initialAdj) × (1 - gapClosure)
 *     penalty = maxPenalty × (1 - totalReduction)
 *   Prescriptive: pointsEarned / pointsNeeded → penalty = maxPenalty × (1 - progress)
 */

export interface GoldenBuilding {
  id: string;
  name: string;
  propertyType: string;
  grossSquareFeet: number;
  maxPenalty: number;
  currentScore: number;
  targetScore: number;
  baselineScore: number;
  baselineEui: number;
  currentEui: number;
  euiReductionPct: number;
  prescriptivePointsEarned: number;
  complianceStatus: "COMPLIANT" | "AT_RISK" | "NON_COMPLIANT";
  bestPathway: string;
  affordablePct?: number;
  units?: number;
  penalties: {
    standard: number;
    performance: number;
    prescriptive: number;
  };
  eligibility: {
    ahra: boolean;
    cleer: boolean;
    cpace: boolean;
    ira: boolean;
  };
}

// ── Building A: Office, 150K SF, Non-Compliant ──────────────────────────

export const BUILDING_A: GoldenBuilding = {
  id: "golden-a",
  name: "Office Tower Alpha",
  propertyType: "OFFICE",
  grossSquareFeet: 150_000,
  maxPenalty: 1_500_000, // min(150000 × 10, 7500000)
  currentScore: 45,
  targetScore: 71,
  baselineScore: 42,
  baselineEui: 120,
  currentEui: 108,
  euiReductionPct: 10, // (120 - 108) / 120 × 100
  prescriptivePointsEarned: 10,
  complianceStatus: "NON_COMPLIANT",
  bestPathway: "PERFORMANCE",
  penalties: {
    // Standard: progress = (45-42)/(71-42) = 3/29 ≈ 0.10345
    //   penalty = 1,500,000 × (1 - 0.10345) = 1,344,828
    standard: 1_344_828,
    // Performance: progress = 10/20 = 0.5
    //   penalty = 1,500,000 × (1 - 0.5) = 750,000
    performance: 750_000,
    // Prescriptive: progress = 10/25 = 0.4
    //   penalty = 1,500,000 × (1 - 0.4) = 900,000
    prescriptive: 900_000,
  },
  eligibility: {
    ahra: false, // Not multifamily
    cleer: true, // DC commercial building
    cpace: true, // Commercial property
    ira: true, // Available to all
  },
};

// ── Building B: Multifamily, 80K SF, At-Risk, 55% Affordable ───────────

export const BUILDING_B: GoldenBuilding = {
  id: "golden-b",
  name: "Affordable Apartments Beta",
  propertyType: "MULTIFAMILY",
  grossSquareFeet: 80_000,
  maxPenalty: 800_000, // min(80000 × 10, 7500000)
  currentScore: 62,
  targetScore: 66,
  baselineScore: 58,
  baselineEui: 85,
  currentEui: 78,
  euiReductionPct: (7 / 85) * 100, // (85 - 78) / 85 × 100 = 8.235294...
  prescriptivePointsEarned: 15,
  complianceStatus: "AT_RISK",
  bestPathway: "STANDARD", // Only 4 points to close, most achievable
  affordablePct: 55,
  units: 120,
  penalties: {
    // Standard Target (two-step): baselineGap=8, maxGap=15
    //   initialAdj = 1 - 8/15 = 0.46667
    //   gapClosure = 4/8 = 0.5
    //   totalReduction = 1 - 0.53333*0.5 = 0.73333
    //   penalty = round(800,000 × 0.26667) = 213,333
    standard: 213_333,
    // Performance: progress = 8.235/20 = 0.41176
    //   penalty = 800,000 × (1 - 0.41176) = 470,588
    performance: 470_588,
    // Prescriptive: progress = 15/25 = 0.6
    //   penalty = 800,000 × (1 - 0.6) = 320,000
    prescriptive: 320_000,
  },
  eligibility: {
    ahra: true, // Multifamily, 55% affordable, ≥ 5 units
    cleer: true, // DC building
    cpace: true, // Commercial property
    ira: true, // Available to all
  },
};

// ── Building C: Hotel, 200K SF, Compliant ──────────────────────────────

export const BUILDING_C: GoldenBuilding = {
  id: "golden-c",
  name: "Grand Hotel Charlie",
  propertyType: "OTHER", // Hotel
  grossSquareFeet: 200_000,
  maxPenalty: 2_000_000, // min(200000 × 10, 7500000)
  currentScore: 68,
  targetScore: 61,
  baselineScore: 55,
  baselineEui: 95,
  currentEui: 82,
  euiReductionPct: 13.68, // (95 - 82) / 95 × 100
  prescriptivePointsEarned: 20,
  complianceStatus: "COMPLIANT",
  bestPathway: "NONE", // Already compliant
  penalties: {
    standard: 0,
    performance: 0,
    prescriptive: 0,
  },
  eligibility: {
    ahra: false, // Not multifamily
    cleer: true, // DC building
    cpace: true, // Commercial property
    ira: true, // Available to all
  },
};

export const ALL_BUILDINGS: GoldenBuilding[] = [
  BUILDING_A,
  BUILDING_B,
  BUILDING_C,
];

/**
 * Reference penalty calculation — the canonical formula.
 * All pipeline implementations must produce identical results.
 *
 * Standard Target uses the two-step formula from BEPS Compliance Guidebook Table 23.
 */
export function referencePenaltyCalc(params: {
  maxPenalty: number;
  pathway: "standard" | "performance" | "prescriptive";
  currentScore: number;
  targetScore: number;
  baselineScore: number;
  euiReductionPct: number;
  prescriptivePointsEarned: number;
  maxGapForPropertyType?: number;
}): number {
  // Compliant buildings have $0 penalty
  if (params.currentScore >= params.targetScore) return 0;

  if (params.pathway === "standard") {
    // Two-step: initial performance adjustment + gap closure
    const maxGap = params.maxGapForPropertyType ?? 15;
    const baselineGap = params.targetScore - params.baselineScore;
    const initialAdj =
      baselineGap > 0 ? Math.max(0, 1 - baselineGap / maxGap) : 1;
    const pointsGained = Math.max(
      0,
      params.currentScore - params.baselineScore,
    );
    const gapClosure =
      baselineGap > 0 ? Math.min(pointsGained / baselineGap, 1) : 0;
    const totalReduction = 1 - (1 - initialAdj) * (1 - gapClosure);
    return Math.round(params.maxPenalty * (1 - totalReduction));
  }

  let progress: number;
  switch (params.pathway) {
    case "performance":
      progress = params.euiReductionPct / 20;
      break;
    case "prescriptive":
      progress = params.prescriptivePointsEarned / 25;
      break;
  }

  progress = Math.max(0, Math.min(1, progress));
  return Math.round(params.maxPenalty * (1 - progress));
}

/**
 * Reference AHRA eligibility check.
 * AHRA = Affordable Housing Retrofit Accelerator
 * Requirements: multifamily, ≥ 50% affordable units, ≥ 5 units
 */
export function referenceAHRAScreener(building: {
  propertyType: string;
  affordablePct?: number;
  units?: number;
}): boolean {
  return (
    building.propertyType === "MULTIFAMILY" &&
    (building.affordablePct ?? 0) >= 50 &&
    (building.units ?? 0) >= 5
  );
}

/** Self-verification: checks golden data internal consistency. */
export function verifyGoldenDatasets(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const b of ALL_BUILDINGS) {
    // Verify maxPenalty formula
    const expectedMax = Math.min(b.grossSquareFeet * 10, 7_500_000);
    if (b.maxPenalty !== expectedMax) {
      errors.push(`${b.name}: maxPenalty ${b.maxPenalty} !== ${expectedMax}`);
    }

    // Verify EUI reduction
    const expectedReduction =
      ((b.baselineEui - b.currentEui) / b.baselineEui) * 100;
    if (Math.abs(b.euiReductionPct - expectedReduction) > 0.01) {
      errors.push(
        `${b.name}: euiReductionPct ${b.euiReductionPct} !== ${expectedReduction.toFixed(3)}`,
      );
    }

    // Verify penalty amounts via reference calc
    for (const pathway of ["standard", "performance", "prescriptive"] as const) {
      const ref = referencePenaltyCalc({
        maxPenalty: b.maxPenalty,
        pathway,
        currentScore: b.currentScore,
        targetScore: b.targetScore,
        baselineScore: b.baselineScore,
        euiReductionPct: b.euiReductionPct,
        prescriptivePointsEarned: b.prescriptivePointsEarned,
      });
      const expected = b.penalties[pathway];
      if (Math.abs(ref - expected) > 1) {
        errors.push(
          `${b.name}: ${pathway} penalty ref=${ref} !== golden=${expected}`,
        );
      }
    }

    // Verify AHRA eligibility for Building B
    if (b.affordablePct !== undefined) {
      const ahraResult = referenceAHRAScreener(b);
      if (ahraResult !== b.eligibility.ahra) {
        errors.push(
          `${b.name}: AHRA ref=${ahraResult} !== golden=${b.eligibility.ahra}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
