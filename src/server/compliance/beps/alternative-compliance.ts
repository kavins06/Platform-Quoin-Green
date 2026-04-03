import { resolveAlternativeComplianceConfig } from "./config";
import {
  calculateAgreementAdjustedAmount,
  calculateMaximumAlternativeComplianceAmount,
} from "./formulas";
import { BEPS_REASON_CODES } from "./reason-codes";
import type {
  BepsAlternativeComplianceResult,
  BepsFactorConfig,
  BepsFinding,
  BepsPathwayResult,
} from "./types";

function createResult(input: {
  pathway: BepsPathwayResult["pathway"];
  maxAmount: number;
  amountDue: number;
  reductionPct: number;
  remainingPenaltyFraction: number;
  findings: BepsFinding[];
  calculation: BepsAlternativeComplianceResult["calculation"];
}): BepsAlternativeComplianceResult {
  return {
    pathway: input.pathway,
    maxAmount: input.maxAmount,
    amountDue: input.amountDue,
    reductionPct: input.reductionPct,
    remainingPenaltyFraction: input.remainingPenaltyFraction,
    reasonCodes: input.findings
      .filter((finding) => finding.status === "FAIL")
      .map((finding) => finding.code),
    findings: input.findings,
    calculation: input.calculation,
  };
}

export function calculateAlternativeComplianceAmount(input: {
  grossSquareFeet: number;
  cycle: "CYCLE_1" | "CYCLE_2" | "CYCLE_3";
  pathwayResult: BepsPathwayResult;
  factorConfig?: BepsFactorConfig;
  agreementMultiplier?: number | null;
  agreementPathway?: BepsPathwayResult["pathway"] | null;
  requestAgreement?: boolean | null;
  maxPenaltyOverrideReason?:
    | "KNOWINGLY_WITHHELD_INFORMATION"
    | "INCOMPLETE_OR_INACCURATE_REPORTING"
    | "HEALTH_OR_SAFETY_RISK"
    | null;
}): BepsAlternativeComplianceResult | null {
  if (!input.pathwayResult.eligible) {
    return null;
  }

  const factorConfig = input.factorConfig ?? {};
  const alternativeComplianceConfig = resolveAlternativeComplianceConfig(
    input.cycle,
    factorConfig,
  );
  const maxPenalty = calculateMaximumAlternativeComplianceAmount({
    grossSquareFeet: input.grossSquareFeet,
    penaltyPerSquareFoot: alternativeComplianceConfig.penaltyPerSquareFoot,
    maxPenaltyCap: alternativeComplianceConfig.maxPenaltyCap,
  });
  const findings: BepsFinding[] = [];

  if (input.maxPenaltyOverrideReason) {
    findings.push({
      code: BEPS_REASON_CODES.maxPenaltyOverrideApplied,
      status: "FAIL",
      severity: "ERROR",
      message:
        "Maximum penalty override was applied because the evaluation includes an explicit 20 DCMR § 3521.3 condition.",
      metadata: {
        overrideReason: input.maxPenaltyOverrideReason,
        maxAmount: maxPenalty.maxAmount,
      },
    });

    return createResult({
      pathway: input.pathwayResult.pathway,
      maxAmount: maxPenalty.maxAmount,
      amountDue: maxPenalty.maxAmount,
      reductionPct: 0,
      remainingPenaltyFraction: 1,
      findings,
      calculation: {
        formulaKey: "DC_BEPS_CYCLE_1_MAX_PENALTY_OVERRIDE",
        rawInputs: {
          grossSquareFeet: input.grossSquareFeet,
          overrideReason: input.maxPenaltyOverrideReason,
        },
        intermediateValues: {},
        remainingPenaltyFraction: 1,
        adjustedAmount: maxPenalty.maxAmount,
        maxAmount: maxPenalty.maxAmount,
      },
    });
  }

  let remainingPenaltyFraction = input.pathwayResult.calculation.remainingPenaltyFraction ?? 1;
  let amountDue = input.pathwayResult.calculation.adjustedAmount ?? maxPenalty.maxAmount;
  let formulaKey = input.pathwayResult.calculation.formulaKey;
  const intermediateValues: Record<string, unknown> = {
    derivedFromPathway: input.pathwayResult.pathway,
  };

  if (input.requestAgreement) {
    if (
      input.agreementMultiplier == null ||
      input.agreementPathway == null ||
      !alternativeComplianceConfig.allowedAgreementPathways.includes(
        input.agreementPathway,
      )
    ) {
      findings.push({
        code: BEPS_REASON_CODES.acpAgreementRequired,
        status: "FAIL",
        severity: "ERROR",
        message:
          "Alternative compliance agreement inputs are required before an agreement-based adjustment can be evaluated.",
        metadata: {
          allowedAgreementPathways:
            alternativeComplianceConfig.allowedAgreementPathways,
        },
      });
    } else if (input.agreementPathway === input.pathwayResult.pathway) {
      const agreementAdjustment = calculateAgreementAdjustedAmount({
        maxAmount: maxPenalty.maxAmount,
        agreementMultiplier: input.agreementMultiplier,
        floorAmount: amountDue,
      });

      remainingPenaltyFraction = agreementAdjustment.adjustedAmount / maxPenalty.maxAmount;
      amountDue = agreementAdjustment.adjustedAmount;
      formulaKey = agreementAdjustment.formulaKey;
      intermediateValues["agreementRemainingPenaltyFraction"] =
        agreementAdjustment.agreementRemainingPenaltyFraction;
      intermediateValues["agreementAmount"] = agreementAdjustment.agreementAmount;
      intermediateValues["floorAmount"] = agreementAdjustment.floorAmount;
    } else {
      intermediateValues["agreementPathwayMismatch"] = {
        requestedPathway: input.agreementPathway,
        evaluatedPathway: input.pathwayResult.pathway,
      };
    }
  }

  findings.push({
    code: BEPS_REASON_CODES.alternativeComplianceCalculated,
    status: "PASS",
    severity: "INFO",
    message:
      "Alternative compliance amount was calculated from governed BEPS pathway and factor inputs.",
    metadata: {
      pathway: input.pathwayResult.pathway,
      maxAmount: maxPenalty.maxAmount,
      amountDue,
      remainingPenaltyFraction,
      penaltyPerSquareFoot: alternativeComplianceConfig.penaltyPerSquareFoot,
      maxPenaltyCap: alternativeComplianceConfig.maxPenaltyCap,
    },
  });

  return createResult({
    pathway: input.pathwayResult.pathway,
    maxAmount: maxPenalty.maxAmount,
    amountDue,
    reductionPct: (1 - remainingPenaltyFraction) * 100,
    remainingPenaltyFraction,
    findings,
    calculation: {
      formulaKey,
      rawInputs: {
        grossSquareFeet: input.grossSquareFeet,
        pathway: input.pathwayResult.pathway,
        agreementMultiplier: input.agreementMultiplier,
        agreementPathway: input.agreementPathway,
      },
      intermediateValues,
      remainingPenaltyFraction,
      adjustedAmount: amountDue,
      maxAmount: maxPenalty.maxAmount,
    },
  });
}
