import type {
  BepsPrescriptiveItemStatus,
  BuildingOwnershipType,
  ComplianceCycle,
} from "@/generated/prisma/client";
import type { BepsReasonCode } from "./reason-codes";

export type BepsPathwayType =
  | "PERFORMANCE"
  | "STANDARD_TARGET"
  | "PRESCRIPTIVE"
  | "TRAJECTORY";
export type BepsEvaluationStatus = "COMPLIANT" | "NON_COMPLIANT" | "PENDING_DATA" | "NOT_APPLICABLE";
export type BepsMetricBasis =
  | "ENERGY_STAR_SCORE"
  | "ADJUSTED_SITE_EUI_AVERAGE"
  | "WEATHER_NORMALIZED_SITE_EUI_AVERAGE"
  | "WEATHER_NORMALIZED_SOURCE_EUI";
export type BepsPenaltyOverrideReason =
  | "KNOWINGLY_WITHHELD_INFORMATION"
  | "INCOMPLETE_OR_INACCURATE_REPORTING"
  | "HEALTH_OR_SAFETY_RISK";

export interface BepsFinding {
  code: BepsReasonCode;
  status: "PASS" | "FAIL";
  severity: "INFO" | "ERROR";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface BepsBuildingInput {
  id: string;
  organizationId: string;
  grossSquareFeet: number;
  propertyType: string;
  ownershipType: BuildingOwnershipType;
  yearBuilt: number | null;
  bepsTargetScore: number;
  complianceCycle: ComplianceCycle;
  selectedPathway: string | null;
  baselineYear: number | null;
  targetEui: number | null;
  maxPenaltyExposure: number;
  isEnergyStarScoreEligible: boolean | null;
}

export interface BepsSnapshotInput {
  id: string;
  snapshotDate: Date;
  energyStarScore: number | null;
  siteEui: number | null;
  sourceEui: number | null;
  weatherNormalizedSiteEui: number | null;
  weatherNormalizedSourceEui: number | null;
  complianceStatus: string;
  complianceGap: number | null;
  estimatedPenalty: number | null;
  dataQualityScore: number | null;
  activePathway: string | null;
  targetEui: number | null;
  penaltyInputsJson: Record<string, unknown> | null;
}

export interface BepsHistoricalMetricPoint {
  id: string;
  snapshotDate: Date;
  siteEui: number | null;
  weatherNormalizedSiteEui: number | null;
  weatherNormalizedSourceEui: number | null;
  energyStarScore: number | null;
}

export interface BepsRuleConfig {
  cycle?: ComplianceCycle | null;
  filingYear?: number | null;
  applicability?: {
    minGrossSquareFeet?: number | null;
    minGrossSquareFeetPrivate?: number | null;
    minGrossSquareFeetDistrict?: number | null;
    ownershipClassFallback?: "PRIVATE" | "DISTRICT" | null;
    coveredPropertyTypes?: string[] | null;
    recentConstructionExemptionYears?: number | null;
    cycleStartYear?: number | null;
    cycleEndYear?: number | null;
  } | null;
  pathwayRouting?: {
    performanceScoreThreshold?: number | null;
    prescriptiveAlwaysEligible?: boolean | null;
    preferredPathway?: BepsPathwayType | null;
    supportedPathways?: BepsPathwayType[] | null;
  } | null;
  performance?: {
    requiredReductionFraction?: number | null;
    scoreEligibleMetric?: BepsMetricBasis | null;
    nonScoreEligibleMetric?: BepsMetricBasis | null;
  } | null;
  standardTarget?: {
    maxGapByPropertyType?: Record<string, number> | null;
    maxGapByPropertyTypeNoScore?: Record<string, number> | null;
    defaultMaxGap?: number | null;
    exactTargetScoresByPropertyType?: Record<string, number> | null;
    propertyTypeMappingConstraints?: Record<string, string> | null;
    scoreEligibleMetric?: BepsMetricBasis | null;
    nonScoreEligibleMetric?: BepsMetricBasis | null;
  } | null;
  prescriptive?: {
    pointsNeededByPropertyType?: Record<string, number> | null;
    defaultPointsNeeded?: number | null;
    complianceBasis?: string | null;
  } | null;
  trajectory?: {
    metricBasis?: BepsMetricBasis | null;
    targetYears?: number[] | null;
    finalTargetYear?: number | null;
  } | null;
}

export interface BepsFactorConfig {
  cycle?: {
    filingYear?: number | null;
    cycleStartYear?: number | null;
    cycleEndYear?: number | null;
    baselineYears?: number[] | null;
    evaluationYears?: number[] | null;
    baselineBenchmarkYear?: number | null;
    complianceDeadline?: string | null;
    delayedCycle1Option?: {
      baselineYears?: number[] | null;
      evaluationYears?: number[] | null;
      comparisonYear?: number | null;
      optionYear?: number | null;
    } | null;
  } | null;
  applicability?: {
    minGrossSquareFeet?: number | null;
    minGrossSquareFeetPrivate?: number | null;
    minGrossSquareFeetDistrict?: number | null;
    ownershipClassFallback?: "PRIVATE" | "DISTRICT" | null;
    coveredPropertyTypes?: string[] | null;
    recentConstructionExemptionYears?: number | null;
    cycleStartYear?: number | null;
    cycleEndYear?: number | null;
    filingYear?: number | null;
  } | null;
  pathwayRouting?: {
    performanceScoreThreshold?: number | null;
    prescriptiveAlwaysEligible?: boolean | null;
    preferredPathway?: BepsPathwayType | null;
    supportedPathways?: BepsPathwayType[] | null;
  } | null;
  performance?: {
    requiredReductionFraction?: number | null;
    scoreEligibleMetric?: BepsMetricBasis | null;
    nonScoreEligibleMetric?: BepsMetricBasis | null;
    defaultBaselineYears?: number[] | null;
    defaultEvaluationYears?: number[] | null;
    delayedCycle1Option?: {
      baselineYears?: number[] | null;
      evaluationYears?: number[] | null;
      comparisonYear?: number | null;
      optionYear?: number | null;
    } | null;
  } | null;
  standardTarget?: {
    maxGapByPropertyType?: Record<string, number> | null;
    maxGapByPropertyTypeNoScore?: Record<string, number> | null;
    defaultMaxGap?: number | null;
    exactTargetScoresByPropertyType?: Record<string, number> | null;
    propertyTypeMappingConstraints?: Record<string, string> | null;
    scoreEligibleMetric?: BepsMetricBasis | null;
    nonScoreEligibleMetric?: BepsMetricBasis | null;
  } | null;
  prescriptive?: {
    pointsNeededByPropertyType?: Record<string, number> | null;
    defaultPointsNeeded?: number | null;
    complianceBasis?: string | null;
  } | null;
  trajectory?: {
    metricBasis?: BepsMetricBasis | null;
    targetYears?: number[] | null;
    finalTargetYear?: number | null;
  } | null;
  standardsTable?: Array<{
    cycle?: ComplianceCycle | null;
    pathway?: BepsPathwayType | null;
    propertyType?: string | null;
    metricType?: BepsMetricBasis | null;
    targetValue?: number | null;
    year?: number | null;
    maxGap?: number | null;
    pointsNeeded?: number | null;
  }> | null;
  alternativeCompliance?: {
    penaltyPerSquareFoot?: number | null;
    maxPenaltyCap?: number | null;
    agreementRequired?: boolean | null;
    allowedAgreementPathways?: BepsPathwayType[] | null;
  } | null;
}

export interface BepsEvaluationOverrides {
  filingYear?: number | null;
  selectedPathway?: BepsPathwayType | null;
  isEnergyStarScoreEligible?: boolean | null;
  baselineAdjustedSiteEui?: number | null;
  currentAdjustedSiteEui?: number | null;
  baselineWeatherNormalizedSiteEui?: number | null;
  currentWeatherNormalizedSiteEui?: number | null;
  baselineWeatherNormalizedSourceEui?: number | null;
  currentWeatherNormalizedSourceEui?: number | null;
  baselineScore?: number | null;
  currentScore?: number | null;
  prescriptivePointsEarned?: number | null;
  prescriptivePointsNeeded?: number | null;
  prescriptiveRequirementsMet?: boolean | null;
  maxGapForPropertyType?: number | null;
  delayedCycle1OptionApplied?: boolean | null;
  alternativeComplianceAgreementMultiplier?: number | null;
  alternativeComplianceAgreementPathway?: BepsPathwayType | null;
  requestAlternativeComplianceAgreement?: boolean | null;
  maxPenaltyOverrideReason?: BepsPenaltyOverrideReason | null;
}

export interface BepsMetricInputRecord {
  id: string;
  filingYear: number;
  complianceCycle: ComplianceCycle;
  baselineYearStart: number | null;
  baselineYearEnd: number | null;
  evaluationYearStart: number | null;
  evaluationYearEnd: number | null;
  comparisonYear: number | null;
  delayedCycle1OptionApplied: boolean;
  baselineAdjustedSiteEui: number | null;
  evaluationAdjustedSiteEui: number | null;
  baselineWeatherNormalizedSiteEui: number | null;
  evaluationWeatherNormalizedSiteEui: number | null;
  baselineWeatherNormalizedSourceEui: number | null;
  evaluationWeatherNormalizedSourceEui: number | null;
  baselineEnergyStarScore: number | null;
  evaluationEnergyStarScore: number | null;
  baselineSnapshotId: string | null;
  evaluationSnapshotId: string | null;
  sourceArtifactId: string | null;
  notesJson: Record<string, unknown>;
}

export interface BepsPrescriptiveItemRecord {
  id: string;
  itemKey: string;
  name: string;
  milestoneName: string | null;
  isRequired: boolean;
  pointsPossible: number;
  pointsEarned: number | null;
  status: BepsPrescriptiveItemStatus;
  completedAt: string | null;
  approvedAt: string | null;
  dueAt: string | null;
  sourceArtifactId: string | null;
  metadata: Record<string, unknown>;
}

export interface BepsAlternativeComplianceAgreementRecord {
  id: string;
  agreementIdentifier: string;
  pathway: BepsPathwayType;
  multiplier: number;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceArtifactId: string | null;
  agreementPayload: Record<string, unknown>;
}

export interface BepsPrescriptiveSummary {
  pointsEarned: number | null;
  pointsNeeded: number | null;
  requirementsMet: boolean | null;
  requiredItemCount: number;
  satisfiedRequiredItemCount: number;
  itemsCount: number;
}

export interface BepsCanonicalInputState {
  metricInput: BepsMetricInputRecord | null;
  prescriptiveItems: BepsPrescriptiveItemRecord[];
  prescriptiveSummary: BepsPrescriptiveSummary;
  alternativeComplianceAgreement: BepsAlternativeComplianceAgreementRecord | null;
}

export interface BepsApplicabilityResult {
  cycle: ComplianceCycle;
  filingYear: number;
  applicable: boolean;
  status: "APPLICABLE" | "NOT_APPLICABLE";
  reasonCodes: BepsReasonCode[];
  findings: BepsFinding[];
}

export interface BepsPathwayEligibilityResult {
  supportedPathways: BepsPathwayType[];
  eligiblePathways: BepsPathwayType[];
  preferredPathway: BepsPathwayType | null;
  reasonCodes: BepsReasonCode[];
  findings: BepsFinding[];
}

export interface BepsPathwayResult {
  pathway: BepsPathwayType;
  evaluationStatus: "COMPLIANT" | "NON_COMPLIANT" | "PENDING_DATA" | "INELIGIBLE";
  eligible: boolean;
  compliant: boolean;
  metricBasis: BepsMetricBasis | null;
  progressPct: number | null;
  reductionPct: number | null;
  reasonCodes: BepsReasonCode[];
  findings: BepsFinding[];
  calculation: {
    formulaKey: string;
    rawInputs: Record<string, unknown>;
    intermediateValues: Record<string, unknown>;
    remainingPenaltyFraction: number | null;
    adjustedAmount: number | null;
    maxAmount: number | null;
  };
  metrics: Record<string, unknown>;
}

export interface BepsAlternativeComplianceResult {
  pathway: BepsPathwayType;
  maxAmount: number;
  amountDue: number;
  reductionPct: number;
  remainingPenaltyFraction: number;
  reasonCodes: BepsReasonCode[];
  findings: BepsFinding[];
  calculation: {
    formulaKey: string;
    rawInputs: Record<string, unknown>;
    intermediateValues: Record<string, unknown>;
    remainingPenaltyFraction: number;
    adjustedAmount: number;
    maxAmount: number;
  };
}

export interface BepsEvaluationResult {
  cycle: ComplianceCycle;
  filingYear: number;
  evaluatedAt: string;
  overallStatus: BepsEvaluationStatus;
  applicable: boolean;
  selectedPathway: BepsPathwayType | null;
  reasonCodes: BepsReasonCode[];
  findings: BepsFinding[];
  applicability: BepsApplicabilityResult;
  pathwayEligibility: BepsPathwayEligibilityResult;
  pathwayResults: {
    performance: BepsPathwayResult | null;
    standardTarget: BepsPathwayResult | null;
    prescriptive: BepsPathwayResult | null;
    trajectory: BepsPathwayResult | null;
  };
  alternativeCompliance: {
    performance: BepsAlternativeComplianceResult | null;
    standardTarget: BepsAlternativeComplianceResult | null;
    prescriptive: BepsAlternativeComplianceResult | null;
    trajectory: BepsAlternativeComplianceResult | null;
    recommended: BepsAlternativeComplianceResult | null;
  };
  governedConfig: {
    applicability: {
      minGrossSquareFeetApplied: number;
      minGrossSquareFeetPrivate: number;
      minGrossSquareFeetDistrict: number;
      ownershipClassFallback: "PRIVATE" | "DISTRICT";
      recentConstructionExemptionYears: number;
      cycleStartYear: number;
      cycleEndYear: number;
    };
    pathwayRouting: {
      performanceScoreThreshold: number;
      prescriptiveAlwaysEligible: boolean;
      preferredPathway: BepsPathwayType | null;
      supportedPathways: BepsPathwayType[];
    };
    performance: {
      requiredReductionFraction: number;
      scoreEligibleMetric: BepsMetricBasis;
      nonScoreEligibleMetric: BepsMetricBasis;
      defaultBaselineYears: number[];
      defaultEvaluationYears: number[];
      delayedCycle1Option: {
        baselineYears: number[];
        evaluationYears: number[];
        comparisonYear: number;
        optionYear: number;
      } | null;
    };
    standardTarget: {
      buildingTargetScore: number;
      exactTargetScoreForPropertyType: number | null;
      propertyTypeMappingConstraint: string | null;
      maxGapForPropertyType: number;
      scoreEligibleMetric: BepsMetricBasis;
      nonScoreEligibleMetric: BepsMetricBasis;
    };
    prescriptive: {
      pointsNeededForPropertyType: number;
      complianceBasis: string;
    };
    trajectory: {
      metricBasis: BepsMetricBasis;
      targetYears: number[];
      finalTargetYear: number;
      targetCount: number;
    };
    alternativeCompliance: {
      penaltyPerSquareFoot: number;
      maxPenaltyCap: number;
      agreementRequired: boolean;
      allowedAgreementPathways: BepsPathwayType[];
    };
  };
  governance?: {
    cycleId?: string;
    rulePackageKey: string;
    ruleVersion: string;
    factorSetKey: string;
    factorSetVersion: string;
  };
  inputSummary: {
    ownershipType: BuildingOwnershipType;
    isEnergyStarScoreEligible: boolean | null;
    currentScore: number | null;
    baselineScore: number | null;
    baselineAdjustedSiteEui: number | null;
    currentAdjustedSiteEui: number | null;
    baselineWeatherNormalizedSiteEui: number | null;
    currentWeatherNormalizedSiteEui: number | null;
    baselineWeatherNormalizedSourceEui: number | null;
    currentWeatherNormalizedSourceEui: number | null;
    prescriptivePointsEarned: number | null;
    prescriptivePointsNeeded: number | null;
    prescriptiveRequirementsMet: boolean | null;
    delayedCycle1OptionApplied: boolean | null;
    alternativeComplianceAgreementMultiplier: number | null;
    alternativeComplianceAgreementPathway: BepsPathwayType | null;
    requestAlternativeComplianceAgreement: boolean | null;
    maxPenaltyOverrideReason: BepsPenaltyOverrideReason | null;
    sources: Record<string, string>;
    canonicalRefs: {
      metricInputId: string | null;
      prescriptiveItemIds: string[];
      alternativeComplianceAgreementId: string | null;
    };
  };
}
