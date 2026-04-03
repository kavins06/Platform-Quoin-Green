import { resolveAlternativeComplianceConfig, resolvePrescriptiveConfig } from "./config";
import {
  calculateMaximumAlternativeComplianceAmount,
  calculatePrescriptivePenaltyAdjustment,
} from "./formulas";
import { BEPS_REASON_CODES } from "./reason-codes";
import type {
  BepsBuildingInput,
  BepsFactorConfig,
  BepsFinding,
  BepsPathwayResult,
  BepsRuleConfig,
} from "./types";

export function evaluatePrescriptivePathway(input: {
  eligible: boolean;
  building: BepsBuildingInput;
  pointsEarned: number | null;
  pointsNeeded?: number | null;
  requirementsMet?: boolean | null;
  ruleConfig?: BepsRuleConfig;
  factorConfig?: BepsFactorConfig;
}): BepsPathwayResult {
  const findings: BepsFinding[] = [];

  if (!input.eligible) {
    findings.push({
      code: BEPS_REASON_CODES.prescriptivePathwayEligible,
      status: "FAIL",
      severity: "ERROR",
      message: "Prescriptive pathway is not eligible for this building.",
    });
    return {
      pathway: "PRESCRIPTIVE",
      evaluationStatus: "INELIGIBLE",
      eligible: false,
      compliant: false,
      metricBasis: null,
      progressPct: null,
      reductionPct: null,
      reasonCodes: findings.map((finding) => finding.code),
      findings,
      calculation: {
        formulaKey: "DC_BEPS_CYCLE_1_PRESCRIPTIVE_ADJUSTMENT",
        rawInputs: {},
        intermediateValues: {},
        remainingPenaltyFraction: null,
        adjustedAmount: null,
        maxAmount: null,
      },
      metrics: {},
    };
  }

  const prescriptiveConfig = resolvePrescriptiveConfig(
    input.building.complianceCycle,
    input.building.propertyType,
    input.ruleConfig ?? {},
    input.factorConfig ?? {},
    input.pointsNeeded,
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

  if (input.pointsEarned == null) {
    findings.push({
      code: BEPS_REASON_CODES.missingEvaluationInput,
      status: "FAIL",
      severity: "ERROR",
      message: "Prescriptive points earned are required for exact penalty adjustment.",
    });
    findings.push({
      code: BEPS_REASON_CODES.missingPrescriptivePointsEarned,
      status: "FAIL",
      severity: "ERROR",
      message: "Prescriptive pathway points earned are required.",
    });
  }

  if (input.requirementsMet == null) {
    findings.push({
      code: BEPS_REASON_CODES.missingEvaluationInput,
      status: "FAIL",
      severity: "ERROR",
      message:
        "Prescriptive requirements status is required because pathway compliance is milestone-based, not points-only.",
      metadata: {
        complianceBasis: prescriptiveConfig.complianceBasis,
      },
    });
    findings.push({
      code: BEPS_REASON_CODES.missingPrescriptiveRequirements,
      status: "FAIL",
      severity: "ERROR",
      message: "Prescriptive pathway requirements status is missing.",
      metadata: {
        complianceBasis: prescriptiveConfig.complianceBasis,
      },
    });
  }

  if (findings.length > 0) {
    return {
      pathway: "PRESCRIPTIVE",
      evaluationStatus: "PENDING_DATA",
      eligible: true,
      compliant: false,
      metricBasis: null,
      progressPct: null,
      reductionPct: null,
      reasonCodes: findings.map((finding) => finding.code),
      findings,
      calculation: {
        formulaKey: "DC_BEPS_CYCLE_1_PRESCRIPTIVE_ADJUSTMENT",
        rawInputs: {
          pointsEarned: input.pointsEarned,
          pointsNeeded: prescriptiveConfig.pointsNeededForPropertyType,
        },
        intermediateValues: {
          complianceBasis: prescriptiveConfig.complianceBasis,
        },
        remainingPenaltyFraction: null,
        adjustedAmount: null,
        maxAmount: null,
      },
      metrics: {
        pointsEarned: input.pointsEarned,
        pointsNeeded: prescriptiveConfig.pointsNeededForPropertyType,
        complianceBasis: prescriptiveConfig.complianceBasis,
      },
    };
  }

  const adjustment = calculatePrescriptivePenaltyAdjustment({
    maxAmount: maxPenalty.maxAmount,
    pointsEarned: input.pointsEarned!,
    pointsNeeded: prescriptiveConfig.pointsNeededForPropertyType,
  });

  findings.push({
    code: input.requirementsMet
      ? BEPS_REASON_CODES.prescriptiveRequirementsMet
      : BEPS_REASON_CODES.prescriptiveRequirementsNotMet,
    status: input.requirementsMet ? "PASS" : "FAIL",
    severity: input.requirementsMet ? "INFO" : "ERROR",
    message: input.requirementsMet
      ? "Prescriptive pathway approved measures and milestones are satisfied."
      : "Prescriptive pathway approved measures and milestones are not satisfied.",
    metadata: {
      pointsEarned: input.pointsEarned,
      pointsNeeded: prescriptiveConfig.pointsNeededForPropertyType,
      complianceBasis: prescriptiveConfig.complianceBasis,
      remainingPenaltyFraction: adjustment.remainingPenaltyFraction,
      adjustedAmount: adjustment.adjustedAmount,
    },
  });

  return {
    pathway: "PRESCRIPTIVE",
    evaluationStatus: input.requirementsMet ? "COMPLIANT" : "NON_COMPLIANT",
    eligible: true,
    compliant: Boolean(input.requirementsMet),
    metricBasis: null,
    progressPct: (1 - adjustment.remainingPenaltyFraction) * 100,
    reductionPct: (1 - adjustment.remainingPenaltyFraction) * 100,
    reasonCodes: findings
      .filter((finding) => finding.status === "FAIL")
      .map((finding) => finding.code),
    findings,
    calculation: {
      formulaKey: adjustment.formulaKey,
      rawInputs: {
        pointsEarned: input.pointsEarned,
        pointsNeeded: prescriptiveConfig.pointsNeededForPropertyType,
      },
      intermediateValues: {
        penaltyReductionFraction: adjustment.penaltyReductionFraction,
        complianceBasis: prescriptiveConfig.complianceBasis,
      },
      remainingPenaltyFraction: adjustment.remainingPenaltyFraction,
      adjustedAmount: adjustment.adjustedAmount,
      maxAmount: maxPenalty.maxAmount,
    },
    metrics: {
      pointsEarned: input.pointsEarned,
      pointsNeeded: prescriptiveConfig.pointsNeededForPropertyType,
      complianceBasis: prescriptiveConfig.complianceBasis,
      pMax: maxPenalty.maxAmount,
    },
  };
}
