import {
  resolveAlternativeComplianceConfig,
  resolveTrajectoryConfig,
} from "./config";
import {
  calculateMaximumAlternativeComplianceAmount,
  calculateTrajectoryPenaltyAdjustment,
} from "./formulas";
import { BEPS_REASON_CODES } from "./reason-codes";
import type {
  BepsBuildingInput,
  BepsFactorConfig,
  BepsFinding,
  BepsHistoricalMetricPoint,
  BepsMetricBasis,
  BepsPathwayResult,
  BepsRuleConfig,
} from "./types";

function getMetricValue(
  point: BepsHistoricalMetricPoint,
  metricBasis: BepsMetricBasis,
) {
  switch (metricBasis) {
    case "WEATHER_NORMALIZED_SITE_EUI_AVERAGE":
      return point.weatherNormalizedSiteEui;
    case "WEATHER_NORMALIZED_SOURCE_EUI":
      return point.weatherNormalizedSourceEui;
    case "ENERGY_STAR_SCORE":
      return point.energyStarScore;
    case "ADJUSTED_SITE_EUI_AVERAGE":
    default:
      return point.siteEui;
  }
}

function average(values: Array<number | null | undefined>) {
  const numbers = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (numbers.length === 0) {
    return null;
  }

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function buildYearlyMetricMap(
  historicalMetrics: BepsHistoricalMetricPoint[],
  metricBasis: BepsMetricBasis,
) {
  const values = new Map<number, number[]>();

  for (const point of historicalMetrics) {
    const year = point.snapshotDate.getUTCFullYear();
    const metricValue = getMetricValue(point, metricBasis);
    if (metricValue == null) {
      continue;
    }

    values.set(year, [...(values.get(year) ?? []), metricValue]);
  }

  return new Map(
    Array.from(values.entries()).map(([year, yearValues]) => [year, average(yearValues)]),
  );
}

export function evaluateTrajectoryPathway(input: {
  eligible: boolean;
  cycle: "CYCLE_1" | "CYCLE_2" | "CYCLE_3";
  building: BepsBuildingInput;
  baselineAdjustedSiteEui: number | null;
  baselineWeatherNormalizedSiteEui: number | null;
  historicalMetrics: BepsHistoricalMetricPoint[];
  ruleConfig?: BepsRuleConfig;
  factorConfig?: BepsFactorConfig;
}): BepsPathwayResult {
  const findings: BepsFinding[] = [];

  if (!input.eligible) {
    findings.push({
      code: BEPS_REASON_CODES.trajectoryPathwayIneligible,
      status: "FAIL",
      severity: "ERROR",
      message: "Trajectory pathway is not eligible for this building under current routing.",
    });

    return {
      pathway: "TRAJECTORY",
      evaluationStatus: "INELIGIBLE",
      eligible: false,
      compliant: false,
      metricBasis: null,
      progressPct: null,
      reductionPct: null,
      reasonCodes: findings.map((finding) => finding.code),
      findings,
      calculation: {
        formulaKey: "DC_BEPS_TRAJECTORY_ADJUSTMENT",
        rawInputs: {},
        intermediateValues: {},
        remainingPenaltyFraction: null,
        adjustedAmount: null,
        maxAmount: null,
      },
      metrics: {},
    };
  }

  const factorConfig = input.factorConfig ?? {};
  const trajectoryConfig = resolveTrajectoryConfig(
    input.cycle,
    input.building.propertyType,
    input.ruleConfig ?? {},
    factorConfig,
  );
  const alternativeComplianceConfig = resolveAlternativeComplianceConfig(
    input.cycle,
    factorConfig,
  );
  const maxPenalty = calculateMaximumAlternativeComplianceAmount({
    grossSquareFeet: input.building.grossSquareFeet,
    penaltyPerSquareFoot: alternativeComplianceConfig.penaltyPerSquareFoot,
    maxPenaltyCap: alternativeComplianceConfig.maxPenaltyCap,
  });

  const baselineValue =
    trajectoryConfig.metricBasis === "WEATHER_NORMALIZED_SITE_EUI_AVERAGE"
      ? input.baselineWeatherNormalizedSiteEui
      : input.baselineAdjustedSiteEui;

  if (baselineValue == null) {
    findings.push({
      code: BEPS_REASON_CODES.missingBaselineInput,
      status: "FAIL",
      severity: "ERROR",
      message: "Baseline EUI is required for trajectory pathway evaluation.",
      metadata: {
        metricBasis: trajectoryConfig.metricBasis,
      },
    });
  }

  const yearlyMetricMap = buildYearlyMetricMap(
    input.historicalMetrics,
    trajectoryConfig.metricBasis,
  );
  const yearlyResults = trajectoryConfig.targets.map((target) => ({
    year: target.year,
    targetValue: target.targetValue,
    actualValue: yearlyMetricMap.get(target.year) ?? null,
    met:
      yearlyMetricMap.get(target.year) != null &&
      (yearlyMetricMap.get(target.year) as number) <= target.targetValue,
  }));
  const missingYears = yearlyResults
    .filter((entry) => entry.actualValue == null)
    .map((entry) => entry.year);

  if (missingYears.length > 0) {
    findings.push({
      code: BEPS_REASON_CODES.missingTrajectoryInputs,
      status: "FAIL",
      severity: "ERROR",
      message: "Year-by-year EUI values are required for all trajectory target years.",
      metadata: {
        missingYears,
        targetYears: trajectoryConfig.targetYears,
        metricBasis: trajectoryConfig.metricBasis,
      },
    });
  }

  if (findings.length > 0) {
    return {
      pathway: "TRAJECTORY",
      evaluationStatus: "PENDING_DATA",
      eligible: true,
      compliant: false,
      metricBasis: trajectoryConfig.metricBasis,
      progressPct: null,
      reductionPct: null,
      reasonCodes: findings.map((finding) => finding.code),
      findings,
      calculation: {
        formulaKey: "DC_BEPS_TRAJECTORY_ADJUSTMENT",
        rawInputs: {
          baselineValue,
          targetTrajectory: trajectoryConfig.targets,
          yearlyValues: Object.fromEntries(yearlyMetricMap.entries()),
        },
        intermediateValues: {},
        remainingPenaltyFraction: null,
        adjustedAmount: null,
        maxAmount: null,
      },
      metrics: {
        baselineValue,
        metricBasis: trajectoryConfig.metricBasis,
        yearlyResults,
      },
    };
  }

  const metTargetYears = yearlyResults.filter((entry) => entry.met).length;
  const finalTarget =
    yearlyResults.find((entry) => entry.year === trajectoryConfig.finalTargetYear) ??
    yearlyResults[yearlyResults.length - 1]!;
  const finalTargetMet = finalTarget.met;
  const adjustment = calculateTrajectoryPenaltyAdjustment({
    maxAmount: maxPenalty.maxAmount,
    metTargetYears,
    totalTargetYears: yearlyResults.length,
    finalTargetMet,
  });
  const compliant = finalTargetMet && metTargetYears === yearlyResults.length;

  findings.push({
    code: compliant
      ? BEPS_REASON_CODES.trajectoryTargetMet
      : BEPS_REASON_CODES.trajectoryTargetNotMet,
    status: compliant ? "PASS" : "FAIL",
    severity: compliant ? "INFO" : "ERROR",
    message: compliant
      ? "Trajectory pathway met all annual targets and the final target."
      : "Trajectory pathway did not meet all annual targets and final target requirements.",
    metadata: {
      metricBasis: trajectoryConfig.metricBasis,
      baselineValue,
      yearlyResults,
      metTargetYears,
      totalTargetYears: yearlyResults.length,
      finalTargetYear: trajectoryConfig.finalTargetYear,
      finalTargetMet,
      remainingPenaltyFraction: adjustment.remainingPenaltyFraction,
    },
  });

  return {
    pathway: "TRAJECTORY",
    evaluationStatus: compliant ? "COMPLIANT" : "NON_COMPLIANT",
    eligible: true,
    compliant,
    metricBasis: trajectoryConfig.metricBasis,
    progressPct: adjustment.annualProgressFraction * 100,
    reductionPct: (1 - adjustment.remainingPenaltyFraction) * 100,
    reasonCodes: findings
      .filter((finding) => finding.status === "FAIL")
      .map((finding) => finding.code),
    findings,
    calculation: {
      formulaKey: adjustment.formulaKey,
      rawInputs: {
        baselineValue,
        targetTrajectory: trajectoryConfig.targets,
        yearlyValues: Object.fromEntries(yearlyMetricMap.entries()),
      },
      intermediateValues: {
        metTargetYears,
        totalTargetYears: yearlyResults.length,
        annualProgressFraction: adjustment.annualProgressFraction,
        finalTargetYear: trajectoryConfig.finalTargetYear,
        finalTargetMet,
        yearlyResults,
      },
      remainingPenaltyFraction: adjustment.remainingPenaltyFraction,
      adjustedAmount: adjustment.adjustedAmount,
      maxAmount: maxPenalty.maxAmount,
    },
    metrics: {
      baselineValue,
      metricBasis: trajectoryConfig.metricBasis,
      targetTrajectory: trajectoryConfig.targets,
      yearlyResults,
      pMax: maxPenalty.maxAmount,
      capApplied: maxPenalty.capApplied,
    },
  };
}
