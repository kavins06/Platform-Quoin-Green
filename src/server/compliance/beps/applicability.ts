import type { ComplianceCycle } from "@/generated/prisma/client";
import {
  resolveApplicabilityConfig,
  resolveApplicabilityThresholdForOwnership,
  resolveGovernedFilingYear,
} from "./config";
import { BEPS_REASON_CODES } from "./reason-codes";
import type {
  BepsApplicabilityResult,
  BepsBuildingInput,
  BepsFactorConfig,
  BepsFinding,
  BepsRuleConfig,
} from "./types";

export function evaluateBepsApplicability(input: {
  building: BepsBuildingInput;
  cycle: ComplianceCycle;
  ruleConfig?: BepsRuleConfig;
  factorConfig?: BepsFactorConfig;
  filingYear?: number | null;
}): BepsApplicabilityResult {
  const ruleConfig = input.ruleConfig ?? {};
  const factorConfig = input.factorConfig ?? {};
  const filingYear = resolveGovernedFilingYear(
    input.cycle,
    ruleConfig,
    factorConfig,
    input.filingYear,
  );
  const findings: BepsFinding[] = [];
  const applicabilityConfig = resolveApplicabilityConfig(
    input.cycle,
    ruleConfig,
    factorConfig,
  );
  const minGrossSquareFeetApplied = resolveApplicabilityThresholdForOwnership({
    ownershipType: input.building.ownershipType,
    minGrossSquareFeetPrivate: applicabilityConfig.minGrossSquareFeetPrivate,
    minGrossSquareFeetDistrict: applicabilityConfig.minGrossSquareFeetDistrict,
  });
  const recentConstructionThresholdYear =
    applicabilityConfig.cycleStartYear - applicabilityConfig.recentConstructionExemptionYears;

  if (
    input.building.grossSquareFeet < minGrossSquareFeetApplied
  ) {
    findings.push({
      code: BEPS_REASON_CODES.notApplicableUnderSizeThreshold,
      status: "FAIL",
      severity: "ERROR",
      message: "Building is below the BEPS size threshold for this cycle.",
      metadata: {
        grossSquareFeet: input.building.grossSquareFeet,
        minGrossSquareFeetApplied,
        minGrossSquareFeetPrivate: applicabilityConfig.minGrossSquareFeetPrivate,
        minGrossSquareFeetDistrict: applicabilityConfig.minGrossSquareFeetDistrict,
        ownershipClassFallback: applicabilityConfig.ownershipClassFallback,
        ownershipType: input.building.ownershipType,
      },
    });
  }

  if (!applicabilityConfig.coveredPropertyTypes.includes(input.building.propertyType)) {
    findings.push({
      code: BEPS_REASON_CODES.notApplicableUnsupportedPropertyType,
      status: "FAIL",
      severity: "ERROR",
      message: "Building property type is not configured as covered for this BEPS cycle.",
      metadata: {
        propertyType: input.building.propertyType,
        coveredPropertyTypes: applicabilityConfig.coveredPropertyTypes,
      },
    });
  }

  if (
    input.building.yearBuilt != null &&
    input.building.yearBuilt >= recentConstructionThresholdYear
  ) {
    findings.push({
      code: BEPS_REASON_CODES.notApplicableRecentConstruction,
      status: "FAIL",
      severity: "ERROR",
      message: "Building falls under the recent construction exemption window for this cycle.",
      metadata: {
        yearBuilt: input.building.yearBuilt,
        cycleStartYear: applicabilityConfig.cycleStartYear,
        cycleEndYear: applicabilityConfig.cycleEndYear,
        recentConstructionExemptionYears:
          applicabilityConfig.recentConstructionExemptionYears,
        thresholdYear: recentConstructionThresholdYear,
      },
    });
  }

  if (findings.length === 0) {
    findings.push({
      code: BEPS_REASON_CODES.buildingInScope,
      status: "PASS",
      severity: "INFO",
      message: "Building is in scope for BEPS evaluation for the requested cycle.",
      metadata: {
        filingYear,
        cycleStartYear: applicabilityConfig.cycleStartYear,
        cycleEndYear: applicabilityConfig.cycleEndYear,
        minGrossSquareFeetApplied,
        ownershipType: input.building.ownershipType,
      },
    });
  } else {
    findings.unshift({
      code: BEPS_REASON_CODES.bepsNotApplicable,
      status: "FAIL",
      severity: "ERROR",
      message: "Building is not applicable for the requested BEPS cycle.",
      metadata: {
        filingYear,
      },
    });
  }

  return {
    cycle: input.cycle,
    filingYear,
    applicable: findings.every((finding) => finding.status === "PASS"),
    status: findings.every((finding) => finding.status === "PASS")
      ? "APPLICABLE"
      : "NOT_APPLICABLE",
    reasonCodes: findings
      .filter((finding) => finding.status === "FAIL")
      .map((finding) => finding.code),
    findings,
  };
}
