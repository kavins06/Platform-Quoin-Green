export interface PenaltyInput {
  grossSquareFeet: number;
  propertyType: string;
  bepsTargetScore: number;
}

export interface PerformancePathwayInput extends PenaltyInput {
  baselineAdjustedSiteEui: number;
  currentAdjustedSiteEui: number;
  targetReductionPct: number;
}

export interface StandardTargetInput extends PenaltyInput {
  baselineScore: number;
  currentScore: number;
  maxGapForPropertyType?: number;
}

export interface PrescriptivePathwayInput extends PenaltyInput {
  pointsEarned: number;
  pointsNeeded: number;
}

export interface PenaltyResult {
  maxPenalty: number;
  adjustedPenalty: number;
  reductionPct: number;
  pathway: "PERFORMANCE" | "STANDARD_TARGET" | "PRESCRIPTIVE";
  compliant: boolean;
  details: string;
}

export interface AllPathwaysResult {
  performance: PenaltyResult | null;
  standardTarget: PenaltyResult | null;
  prescriptive: PenaltyResult | null;
  recommended: PenaltyResult | null;
  recommendedPathway: string | null;
}
