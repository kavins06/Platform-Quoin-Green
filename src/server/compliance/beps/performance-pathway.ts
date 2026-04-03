import { resolveAlternativeComplianceConfig, resolvePerformanceConfig } from "./config";
import {
  calculateMaximumAlternativeComplianceAmount,
  calculatePerformancePenaltyAdjustment,
} from "./formulas";
import { BEPS_REASON_CODES } from "./reason-codes";
import type {
  BepsBuildingInput,
  BepsFactorConfig,
  BepsFinding,
  BepsMetricBasis,
  BepsPathwayResult,
  BepsRuleConfig,
} from "./types";

function createIneligibleResult(findings: BepsFinding[]): BepsPathwayResult {
  return {
    pathway: "PERFORMANCE",
    evaluationStatus: "INELIGIBLE",
    eligible: false,
    compliant: false,
    metricBasis: null,
    progressPct: null,
    reductionPct: null,
    reasonCodes: findings.map((finding) => finding.code),
    findings,
    calculation: {
      formulaKey: "DC_BEPS_CYCLE_1_PERFORMANCE_ADJUSTMENT",
      rawInputs: {},
      intermediateValues: {},
      remainingPenaltyFraction: null,
      adjustedAmount: null,
      maxAmount: null,
    },
    metrics: {},
  };
}

function createPendingResult(
  metricBasis: BepsMetricBasis,
  findings: BepsFinding[],
  rawInputs: Record<string, unknown>,
): BepsPathwayResult {
  return {
    pathway: "PERFORMANCE",
    evaluationStatus: "PENDING_DATA",
    eligible: true,
    compliant: false,
    metricBasis,
    progressPct: null,
    reductionPct: null,
    reasonCodes: findings.map((finding) => finding.code),
    findings,
    calculation: {
      formulaKey: "DC_BEPS_CYCLE_1_PERFORMANCE_ADJUSTMENT",
      rawInputs,
      intermediateValues: {},
      remainingPenaltyFraction: null,
      adjustedAmount: null,
      maxAmount: null,
    },
    metrics: rawInputs,
  };
}

export function evaluatePerformancePathway(input: {
  eligible: boolean;
  building: BepsBuildingInput;
  isEnergyStarScoreEligible: boolean;
  baselineAdjustedSiteEui: number | null;
  currentAdjustedSiteEui: number | null;
  baselineWeatherNormalizedSiteEui: number | null;
  currentWeatherNormalizedSiteEui: number | null;
  delayedCycle1OptionApplied?: boolean | null;
  ruleConfig?: BepsRuleConfig;
  factorConfig?: BepsFactorConfig;
}): BepsPathwayResult {
  const findings: BepsFinding[] = [];

  if (!input.eligible) {
    findings.push({
      code: BEPS_REASON_CODES.performancePathwayIneligible,
      status: "FAIL",
      severity: "ERROR",
      message: "Performance pathway is not eligible for this building under current routing.",
    });
    return createIneligibleResult(findings);
  }

  const performanceConfig = resolvePerformanceConfig(
    input.building.complianceCycle,
    input.ruleConfig ?? {},
    input.factorConfig ?? {},
  );
  const alternativeComplianceConfig = resolveAlternativeComplianceConfig(
    input.building.complianceCycle,
    input.factorConfig ?? {},
  );
  const maxPenalty = calculateMaximumAlternativeComplianceAmount({
    grossSquareFeet: input.building.grossSquareFeet,
    penaltyPerSquareFoot: alternativeComplianceConfig.penaltyPerSquareFoot,
    maxPenaltyCap: alternativeComplianceConfig.maxPenaltyCap,
  });

  const metricBasis = input.isEnergyStarScoreEligible
    ? performanceConfig.scoreEligibleMetric
    : performanceConfig.nonScoreEligibleMetric;
  const baselineValue = input.isEnergyStarScoreEligible
    ? input.baselineAdjustedSiteEui
    : input.baselineWeatherNormalizedSiteEui;
  const currentValue = input.isEnergyStarScoreEligible
    ? input.currentAdjustedSiteEui
    : input.currentWeatherNormalizedSiteEui;

  if (baselineValue == null) {
    findings.push({
      code: BEPS_REASON_CODES.missingBaselineInput,
      status: "FAIL",
      severity: "ERROR",
      message: "Baseline input is required for exact performance pathway evaluation.",
      metadata: { metricBasis },
    });
    findings.push({
      code: BEPS_REASON_CODES.missingBaselineAdjustedSiteEui,
      status: "FAIL",
      severity: "ERROR",
      message: "Performance pathway baseline metric is missing.",
      metadata: { metricBasis },
    });
  }

  if (currentValue == null) {
    findings.push({
      code: BEPS_REASON_CODES.missingEvaluationInput,
      status: "FAIL",
      severity: "ERROR",
      message: "Evaluation-period input is required for exact performance pathway evaluation.",
      metadata: { metricBasis },
    });
    findings.push({
      code: BEPS_REASON_CODES.missingCurrentAdjustedSiteEui,
      status: "FAIL",
      severity: "ERROR",
      message: "Performance pathway evaluation metric is missing.",
      metadata: { metricBasis },
    });
  }

  if (findings.length > 0) {
    return createPendingResult(metricBasis, findings, {
      baselineValue,
      currentValue,
      metricBasis,
    });
  }

  const comparisonPeriods =
    input.delayedCycle1OptionApplied && performanceConfig.delayedCycle1Option
      ? performanceConfig.delayedCycle1Option
      : {
          baselineYears: performanceConfig.defaultBaselineYears,
          evaluationYears: performanceConfig.defaultEvaluationYears,
          comparisonYear:
            performanceConfig.defaultEvaluationYears[
              performanceConfig.defaultEvaluationYears.length - 1
            ] ?? null,
          optionYear: null,
        };

  const achievedReductionFraction = (baselineValue! - currentValue!) / baselineValue!;
  const adjustment = calculatePerformancePenaltyAdjustment({
    maxAmount: maxPenalty.maxAmount,
    achievedReductionFraction,
    requiredReductionFraction: performanceConfig.requiredReductionFraction,
  });
  const compliant =
    achievedReductionFraction >= performanceConfig.requiredReductionFraction;

  findings.push({
    code: compliant
      ? BEPS_REASON_CODES.performanceTargetMet
      : BEPS_REASON_CODES.performanceTargetNotMet,
    status: compliant ? "PASS" : "FAIL",
    severity: compliant ? "INFO" : "ERROR",
    message: compliant
      ? "Performance pathway achieved the required Cycle 1 reduction."
      : "Performance pathway did not achieve the required Cycle 1 reduction.",
    metadata: {
      metricBasis,
      achievedReductionFraction,
      requiredReductionFraction: performanceConfig.requiredReductionFraction,
      remainingPenaltyFraction: adjustment.remainingPenaltyFraction,
      adjustedAmount: adjustment.adjustedAmount,
      comparisonPeriods,
    },
  });

  return {
    pathway: "PERFORMANCE",
    evaluationStatus: compliant ? "COMPLIANT" : "NON_COMPLIANT",
    eligible: true,
    compliant,
    metricBasis,
    progressPct: adjustment.penaltyReductionFraction * 100,
    reductionPct: adjustment.penaltyReductionFraction * 100,
    reasonCodes: findings
      .filter((finding) => finding.status === "FAIL")
      .map((finding) => finding.code),
    findings,
    calculation: {
      formulaKey: adjustment.formulaKey,
      rawInputs: {
        grossSquareFeet: input.building.grossSquareFeet,
        baselineValue,
        currentValue,
        metricBasis,
        requiredReductionFraction: performanceConfig.requiredReductionFraction,
      },
      intermediateValues: {
        achievedReductionFraction,
        penaltyReductionFraction: adjustment.penaltyReductionFraction,
        comparisonPeriods,
      },
      remainingPenaltyFraction: adjustment.remainingPenaltyFraction,
      adjustedAmount: adjustment.adjustedAmount,
      maxAmount: maxPenalty.maxAmount,
    },
    metrics: {
      baselineValue,
      currentValue,
      metricBasis,
      requiredReductionFraction: performanceConfig.requiredReductionFraction,
      comparisonPeriods,
      pMax: maxPenalty.maxAmount,
      capApplied: maxPenalty.capApplied,
    },
  };
}
