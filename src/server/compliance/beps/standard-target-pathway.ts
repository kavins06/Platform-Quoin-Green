import { resolveAlternativeComplianceConfig, resolveStandardTargetConfig } from "./config";
import {
  calculateMaximumAlternativeComplianceAmount,
  calculateStandardTargetPenaltyAdjustment,
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

function createResult(
  evaluationStatus: BepsPathwayResult["evaluationStatus"],
  metricBasis: BepsMetricBasis | null,
  compliant: boolean,
  findings: BepsFinding[],
  calculation: BepsPathwayResult["calculation"],
  metrics: Record<string, unknown>,
  progressPct: number | null,
  reductionPct: number | null,
): BepsPathwayResult {
  return {
    pathway: "STANDARD_TARGET",
    evaluationStatus,
    eligible: evaluationStatus !== "INELIGIBLE",
    compliant,
    metricBasis,
    progressPct,
    reductionPct,
    reasonCodes: findings
      .filter((finding) => finding.status === "FAIL")
      .map((finding) => finding.code),
    findings,
    calculation,
    metrics,
  };
}

export function evaluateStandardTargetPathway(input: {
  eligible: boolean;
  building: BepsBuildingInput;
  isEnergyStarScoreEligible: boolean;
  baselineScore: number | null;
  currentScore: number | null;
  baselineWeatherNormalizedSourceEui: number | null;
  currentWeatherNormalizedSourceEui: number | null;
  maxGapForPropertyType?: number | null;
  ruleConfig?: BepsRuleConfig;
  factorConfig?: BepsFactorConfig;
}): BepsPathwayResult {
  const findings: BepsFinding[] = [];

  if (!input.eligible) {
    findings.push({
      code: BEPS_REASON_CODES.standardTargetPathwayIneligible,
      status: "FAIL",
      severity: "ERROR",
      message: "Standard target pathway is not eligible for this building under current routing.",
    });
    return createResult(
      "INELIGIBLE",
      null,
      false,
      findings,
      {
        formulaKey: "DC_BEPS_CYCLE_1_STANDARD_TARGET_ADJUSTMENT",
        rawInputs: {},
        intermediateValues: {},
        remainingPenaltyFraction: null,
        adjustedAmount: null,
        maxAmount: null,
      },
      {},
      null,
      null,
    );
  }

  const standardTargetConfig = resolveStandardTargetConfig(
    input.building.complianceCycle,
    input.building.propertyType,
    input.building.bepsTargetScore,
    input.ruleConfig ?? {},
    input.factorConfig ?? {},
    input.maxGapForPropertyType,
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
    ? standardTargetConfig.scoreEligibleMetric
    : standardTargetConfig.nonScoreEligibleMetric;

  if (input.isEnergyStarScoreEligible) {
    if (input.baselineScore == null) {
      findings.push({
        code: BEPS_REASON_CODES.missingBaselineInput,
        status: "FAIL",
        severity: "ERROR",
        message: "Baseline score is required for exact standard target evaluation.",
      });
      findings.push({
        code: BEPS_REASON_CODES.missingBaselineScore,
        status: "FAIL",
        severity: "ERROR",
        message: "Baseline ENERGY STAR score is missing.",
      });
    }

    if (input.currentScore == null) {
      findings.push({
        code: BEPS_REASON_CODES.missingEvaluationInput,
        status: "FAIL",
        severity: "ERROR",
        message: "Current score is required for exact standard target evaluation.",
      });
      findings.push({
        code: BEPS_REASON_CODES.missingCurrentScore,
        status: "FAIL",
        severity: "ERROR",
        message: "Current ENERGY STAR score is missing.",
      });
    }

    if (findings.length > 0) {
      return createResult(
        "PENDING_DATA",
        metricBasis,
        false,
        findings,
        {
          formulaKey: "DC_BEPS_CYCLE_1_STANDARD_TARGET_ADJUSTMENT",
          rawInputs: {
            baselineScore: input.baselineScore,
            currentScore: input.currentScore,
          },
          intermediateValues: {},
          remainingPenaltyFraction: null,
          adjustedAmount: null,
          maxAmount: null,
        },
        {
          baselineScore: input.baselineScore,
          currentScore: input.currentScore,
          metricBasis,
        },
        null,
        null,
      );
    }

    const initialGap = Math.max(
      0,
      standardTargetConfig.buildingTargetScore - input.baselineScore!,
    );
    const achievedSavings = Math.max(0, input.currentScore! - input.baselineScore!);
    const requiredSavings = Math.max(
      0,
      standardTargetConfig.buildingTargetScore - input.baselineScore!,
    );
    const adjustment = calculateStandardTargetPenaltyAdjustment({
      maxAmount: maxPenalty.maxAmount,
      initialGap,
      maxGap: standardTargetConfig.maxGapForPropertyType,
      achievedSavings,
      requiredSavings,
    });
    const compliant = input.currentScore! >= standardTargetConfig.buildingTargetScore;

    findings.push({
      code: compliant
        ? BEPS_REASON_CODES.standardTargetMet
        : BEPS_REASON_CODES.standardTargetNotMet,
      status: compliant ? "PASS" : "FAIL",
      severity: compliant ? "INFO" : "ERROR",
      message: compliant
        ? "Standard target pathway reached the BEPS score standard."
        : "Standard target pathway did not reach the BEPS score standard.",
      metadata: {
        metricBasis,
        targetScore: standardTargetConfig.buildingTargetScore,
        exactTargetScoreForPropertyType:
          standardTargetConfig.exactTargetScoreForPropertyType,
        propertyTypeMappingConstraint:
          standardTargetConfig.propertyTypeMappingConstraint,
        initialGap,
        achievedSavings,
        requiredSavings,
        step1ReductionFraction: adjustment.step1ReductionFraction,
        step2ReductionFraction: adjustment.step2ReductionFraction,
        remainingPenaltyFraction: adjustment.remainingPenaltyFraction,
      },
    });

    return createResult(
      compliant ? "COMPLIANT" : "NON_COMPLIANT",
      metricBasis,
      compliant,
      findings,
      {
        formulaKey: adjustment.formulaKey,
        rawInputs: {
          baselineScore: input.baselineScore,
          currentScore: input.currentScore,
          targetScore: standardTargetConfig.buildingTargetScore,
          maxGap: standardTargetConfig.maxGapForPropertyType,
        },
        intermediateValues: {
          initialGap,
          achievedSavings,
          requiredSavings,
          step1ReductionFraction: adjustment.step1ReductionFraction,
          step2ReductionFraction: adjustment.step2ReductionFraction,
        },
        remainingPenaltyFraction: adjustment.remainingPenaltyFraction,
        adjustedAmount: adjustment.adjustedAmount,
        maxAmount: maxPenalty.maxAmount,
      },
      {
        baselineScore: input.baselineScore,
        currentScore: input.currentScore,
        metricBasis,
        exactTargetScoreForPropertyType:
          standardTargetConfig.exactTargetScoreForPropertyType,
        propertyTypeMappingConstraint:
          standardTargetConfig.propertyTypeMappingConstraint,
        pMax: maxPenalty.maxAmount,
      },
      (1 - adjustment.remainingPenaltyFraction) * 100,
      (1 - adjustment.remainingPenaltyFraction) * 100,
    );
  }

  if (input.currentWeatherNormalizedSourceEui == null) {
    findings.push({
      code: BEPS_REASON_CODES.missingEvaluationInput,
      status: "FAIL",
      severity: "ERROR",
      message:
        "Weather-normalized source EUI is required for non-score-eligible standard target evaluation.",
      metadata: { metricBasis },
    });
  }

  if (
    standardTargetConfig.exactTargetEuiForPropertyTypeNoScore == null &&
    input.building.targetEui == null
  ) {
    findings.push({
      code: BEPS_REASON_CODES.missingEvaluationInput,
      status: "FAIL",
      severity: "ERROR",
      message:
        "Target weather-normalized source EUI is required for non-score-eligible standard target evaluation.",
      metadata: { metricBasis },
    });
  }

  if (input.baselineWeatherNormalizedSourceEui == null) {
    findings.push({
      code: BEPS_REASON_CODES.missingBaselineInput,
      status: "FAIL",
      severity: "ERROR",
      message:
        "Baseline weather-normalized source EUI is required for non-score-eligible standard target evaluation.",
      metadata: { metricBasis },
    });
  }

  if (standardTargetConfig.maxGapForPropertyTypeNoScore == null) {
    findings.push({
      code: BEPS_REASON_CODES.missingEvaluationInput,
      status: "FAIL",
      severity: "ERROR",
      message:
        "Exact non-score standard target max-gap data is not encoded for the current product taxonomy.",
      metadata: {
        propertyType: input.building.propertyType,
        propertyTypeMappingConstraint: standardTargetConfig.propertyTypeMappingConstraint,
      },
    });
  }

  if (findings.length > 0) {
    return createResult(
      "PENDING_DATA",
      metricBasis,
      false,
      findings,
      {
        formulaKey: "DC_BEPS_CYCLE_1_STANDARD_TARGET_ADJUSTMENT",
        rawInputs: {
          baselineWeatherNormalizedSourceEui: input.baselineWeatherNormalizedSourceEui,
          currentWeatherNormalizedSourceEui: input.currentWeatherNormalizedSourceEui,
          targetEui:
            standardTargetConfig.exactTargetEuiForPropertyTypeNoScore ??
            input.building.targetEui,
        },
        intermediateValues: {},
        remainingPenaltyFraction: null,
        adjustedAmount: null,
        maxAmount: null,
      },
      {
        metricBasis,
        propertyTypeMappingConstraint: standardTargetConfig.propertyTypeMappingConstraint,
      },
      null,
      null,
    );
  }

  const targetEui =
    standardTargetConfig.exactTargetEuiForPropertyTypeNoScore ?? input.building.targetEui!;
  const initialGap =
    input.baselineWeatherNormalizedSourceEui! - targetEui;
  const achievedSavings =
    input.baselineWeatherNormalizedSourceEui! - input.currentWeatherNormalizedSourceEui!;
  const requiredSavings =
    input.baselineWeatherNormalizedSourceEui! - targetEui;
  const adjustment = calculateStandardTargetPenaltyAdjustment({
    maxAmount: maxPenalty.maxAmount,
    initialGap,
    maxGap: standardTargetConfig.maxGapForPropertyTypeNoScore!,
    achievedSavings,
    requiredSavings,
  });
  const compliant =
    input.currentWeatherNormalizedSourceEui! <= targetEui;

  findings.push({
    code: compliant
      ? BEPS_REASON_CODES.standardTargetMet
      : BEPS_REASON_CODES.standardTargetNotMet,
    status: compliant ? "PASS" : "FAIL",
    severity: compliant ? "INFO" : "ERROR",
    message: compliant
      ? "Standard target pathway reached the required weather-normalized source EUI standard."
      : "Standard target pathway did not reach the required weather-normalized source EUI standard.",
    metadata: {
      metricBasis,
      targetEui,
      initialGap,
      achievedSavings,
      requiredSavings,
      step1ReductionFraction: adjustment.step1ReductionFraction,
      step2ReductionFraction: adjustment.step2ReductionFraction,
      remainingPenaltyFraction: adjustment.remainingPenaltyFraction,
    },
  });

  return createResult(
    compliant ? "COMPLIANT" : "NON_COMPLIANT",
    metricBasis,
    compliant,
    findings,
    {
      formulaKey: adjustment.formulaKey,
      rawInputs: {
        baselineWeatherNormalizedSourceEui: input.baselineWeatherNormalizedSourceEui,
        currentWeatherNormalizedSourceEui: input.currentWeatherNormalizedSourceEui,
        targetEui,
        maxGap: standardTargetConfig.maxGapForPropertyTypeNoScore,
      },
      intermediateValues: {
        initialGap,
        achievedSavings,
        requiredSavings,
        step1ReductionFraction: adjustment.step1ReductionFraction,
        step2ReductionFraction: adjustment.step2ReductionFraction,
      },
      remainingPenaltyFraction: adjustment.remainingPenaltyFraction,
      adjustedAmount: adjustment.adjustedAmount,
      maxAmount: maxPenalty.maxAmount,
    },
    {
      metricBasis,
      targetEui,
      propertyTypeMappingConstraint: standardTargetConfig.propertyTypeMappingConstraint,
      pMax: maxPenalty.maxAmount,
    },
    (1 - adjustment.remainingPenaltyFraction) * 100,
    (1 - adjustment.remainingPenaltyFraction) * 100,
  );
}
