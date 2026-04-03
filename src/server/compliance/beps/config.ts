import type { ComplianceCycle } from "@/generated/prisma/client";
import { BEPS_REASON_CODES } from "./reason-codes";
import type {
  BepsFactorConfig,
  BepsMetricBasis,
  BepsPathwayType,
  BepsRuleConfig,
} from "./types";

function toJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getNestedObject(value: Record<string, unknown>, key: string) {
  const nested = value[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : {};
}

const SUPPORTED_BEPS_FACTOR_SET_KEYS: Partial<Record<ComplianceCycle, string>> = {
  CYCLE_1: "DC_BEPS_CYCLE_1_FACTORS_V1",
  CYCLE_2: "DC_BEPS_CYCLE_2_FACTORS_V1",
};

export class BepsConfigurationError extends Error {
  reasonCode?: string;

  constructor(message: string, reasonCode?: string) {
    super(message);
    this.name = "BepsConfigurationError";
    this.reasonCode = reasonCode;
  }
}

export function assertSupportedBepsCycle(cycle: ComplianceCycle) {
  if (cycle === "CYCLE_3") {
    throw new BepsConfigurationError(
      `Cycle ${cycle} is recognized in the product taxonomy but not yet supported by governed BEPS records`,
      BEPS_REASON_CODES.unsupportedCycle,
    );
  }
}

export function normalizeBepsRuleConfig(value: unknown): BepsRuleConfig {
  const config = toJsonObject(value);
  return {
    ...config,
    applicability: getNestedObject(config, "applicability"),
    pathwayRouting: getNestedObject(config, "pathwayRouting"),
    performance: getNestedObject(config, "performance"),
    standardTarget: getNestedObject(config, "standardTarget"),
    prescriptive: getNestedObject(config, "prescriptive"),
    trajectory: getNestedObject(config, "trajectory"),
  } as BepsRuleConfig;
}

export function normalizeBepsFactorConfig(value: unknown): BepsFactorConfig {
  const config = toJsonObject(value);
  const beps = getNestedObject(config, "beps");
  const source = Object.keys(beps).length > 0 ? beps : config;

  return {
    cycle: getNestedObject(source, "cycle"),
    applicability: getNestedObject(source, "applicability"),
    pathwayRouting: getNestedObject(source, "pathwayRouting"),
    performance: getNestedObject(source, "performance"),
    standardTarget: getNestedObject(source, "standardTarget"),
    prescriptive: getNestedObject(source, "prescriptive"),
    trajectory: getNestedObject(source, "trajectory"),
    standardsTable: Array.isArray(source.standardsTable)
      ? source.standardsTable
      : null,
    alternativeCompliance: getNestedObject(source, "alternativeCompliance"),
  } as BepsFactorConfig;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMetricBasis(value: unknown): value is BepsMetricBasis {
  return (
    value === "ENERGY_STAR_SCORE" ||
    value === "ADJUSTED_SITE_EUI_AVERAGE" ||
    value === "WEATHER_NORMALIZED_SITE_EUI_AVERAGE" ||
    value === "WEATHER_NORMALIZED_SOURCE_EUI"
  );
}

function requireNumber(label: string, factorValue: unknown, ruleValue?: unknown): number {
  if (isFiniteNumber(factorValue)) {
    return factorValue;
  }

  if (isFiniteNumber(ruleValue)) {
    return ruleValue;
  }

  throw new BepsConfigurationError(`Missing governed BEPS numeric config: ${label}`);
}

function requireBoolean(label: string, factorValue: unknown, ruleValue?: unknown): boolean {
  if (typeof factorValue === "boolean") {
    return factorValue;
  }

  if (typeof ruleValue === "boolean") {
    return ruleValue;
  }

  throw new BepsConfigurationError(`Missing governed BEPS boolean config: ${label}`);
}

function requireMetricBasis(
  label: string,
  factorValue: unknown,
  ruleValue?: unknown,
): BepsMetricBasis {
  if (isMetricBasis(factorValue)) {
    return factorValue;
  }

  if (isMetricBasis(ruleValue)) {
    return ruleValue;
  }

  throw new BepsConfigurationError(`Missing governed BEPS metric basis config: ${label}`);
}

function requirePathwayList(
  label: string,
  factorValue: unknown,
  ruleValue?: unknown,
): BepsPathwayType[] {
  const candidate = Array.isArray(factorValue)
    ? factorValue
    : Array.isArray(ruleValue)
      ? ruleValue
      : null;

  if (!candidate) {
    throw new BepsConfigurationError(`Missing governed BEPS pathway config: ${label}`);
  }

  const pathways = candidate.filter(
    (value): value is BepsPathwayType =>
      value === "PERFORMANCE" ||
      value === "STANDARD_TARGET" ||
      value === "PRESCRIPTIVE" ||
      value === "TRAJECTORY",
  );

  if (pathways.length === 0) {
    throw new BepsConfigurationError(`Missing governed BEPS pathway config: ${label}`);
  }

  return pathways;
}

function requireYearList(label: string, value: unknown, fallback?: unknown): number[] {
  const candidate = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : null;
  if (!candidate) {
    throw new BepsConfigurationError(`Missing governed BEPS period config: ${label}`);
  }

  const years = candidate.filter((entry): entry is number => isFiniteNumber(entry));
  if (years.length === 0) {
    throw new BepsConfigurationError(`Missing governed BEPS period config: ${label}`);
  }

  return years;
}

export function getBepsFactorSetKeyForCycle(cycle: ComplianceCycle) {
  assertSupportedBepsCycle(cycle);

  const key = SUPPORTED_BEPS_FACTOR_SET_KEYS[cycle];
  if (!key) {
    throw new BepsConfigurationError(
      `No governed BEPS factors are configured for cycle ${cycle}`,
      BEPS_REASON_CODES.unsupportedCycle,
    );
  }

  return key;
}

export function resolveGovernedFilingYear(
  cycle: ComplianceCycle,
  ruleConfig: BepsRuleConfig,
  factorConfig: BepsFactorConfig,
  overrideYear?: number | null,
): number {
  if (isFiniteNumber(overrideYear)) {
    return overrideYear;
  }

  return requireNumber(
    `filingYear:${cycle}`,
    factorConfig.cycle?.filingYear ?? factorConfig.applicability?.filingYear,
    ruleConfig.filingYear,
  );
}

export function resolveApplicabilityConfig(
  cycle: ComplianceCycle,
  ruleConfig: BepsRuleConfig,
  factorConfig: BepsFactorConfig,
) {
  const minGrossSquareFeetPrivate = requireNumber(
    `applicability.minGrossSquareFeetPrivate:${cycle}`,
    factorConfig.applicability?.minGrossSquareFeetPrivate ??
      factorConfig.applicability?.minGrossSquareFeet,
    ruleConfig.applicability?.minGrossSquareFeetPrivate ??
      ruleConfig.applicability?.minGrossSquareFeet,
  );
  const minGrossSquareFeetDistrict = requireNumber(
    `applicability.minGrossSquareFeetDistrict:${cycle}`,
    factorConfig.applicability?.minGrossSquareFeetDistrict,
    ruleConfig.applicability?.minGrossSquareFeetDistrict,
  );
  const recentConstructionExemptionYears = requireNumber(
    `applicability.recentConstructionExemptionYears:${cycle}`,
    factorConfig.applicability?.recentConstructionExemptionYears,
    ruleConfig.applicability?.recentConstructionExemptionYears,
  );
  const cycleStartYear = requireNumber(
    `applicability.cycleStartYear:${cycle}`,
    factorConfig.applicability?.cycleStartYear ?? factorConfig.cycle?.cycleStartYear,
    ruleConfig.applicability?.cycleStartYear,
  );
  const cycleEndYear = requireNumber(
    `applicability.cycleEndYear:${cycle}`,
    factorConfig.applicability?.cycleEndYear ?? factorConfig.cycle?.cycleEndYear,
    ruleConfig.applicability?.cycleEndYear ?? ruleConfig.filingYear,
  );
  const coveredPropertyTypes = Array.isArray(factorConfig.applicability?.coveredPropertyTypes)
    ? factorConfig.applicability.coveredPropertyTypes
    : Array.isArray(ruleConfig.applicability?.coveredPropertyTypes)
      ? ruleConfig.applicability.coveredPropertyTypes
      : null;

  if (!coveredPropertyTypes || coveredPropertyTypes.length === 0) {
    throw new BepsConfigurationError(
      `Missing governed BEPS property type coverage config for cycle ${cycle}`,
    );
  }

  const ownershipClassFallback =
    factorConfig.applicability?.ownershipClassFallback ??
    ruleConfig.applicability?.ownershipClassFallback ??
    "PRIVATE";

  return {
    minGrossSquareFeetPrivate,
    minGrossSquareFeetDistrict,
    ownershipClassFallback,
    coveredPropertyTypes,
    recentConstructionExemptionYears,
    cycleStartYear,
    cycleEndYear,
  };
}

export function resolveApplicabilityThresholdForOwnership(input: {
  ownershipType: "PRIVATE" | "DISTRICT";
  minGrossSquareFeetPrivate: number;
  minGrossSquareFeetDistrict: number;
}) {
  return input.ownershipType === "DISTRICT"
    ? input.minGrossSquareFeetDistrict
    : input.minGrossSquareFeetPrivate;
}

export function resolvePathwayRoutingConfig(
  cycle: ComplianceCycle,
  ruleConfig: BepsRuleConfig,
  factorConfig: BepsFactorConfig,
) {
  return {
    performanceScoreThreshold: requireNumber(
      `pathwayRouting.performanceScoreThreshold:${cycle}`,
      factorConfig.pathwayRouting?.performanceScoreThreshold,
      ruleConfig.pathwayRouting?.performanceScoreThreshold,
    ),
    prescriptiveAlwaysEligible: requireBoolean(
      `pathwayRouting.prescriptiveAlwaysEligible:${cycle}`,
      factorConfig.pathwayRouting?.prescriptiveAlwaysEligible,
      ruleConfig.pathwayRouting?.prescriptiveAlwaysEligible,
    ),
    preferredPathway:
      factorConfig.pathwayRouting?.preferredPathway ??
      ruleConfig.pathwayRouting?.preferredPathway ??
      null,
    supportedPathways: requirePathwayList(
      `pathwayRouting.supportedPathways:${cycle}`,
      factorConfig.pathwayRouting?.supportedPathways,
      ruleConfig.pathwayRouting?.supportedPathways,
    ),
  };
}

function getStandardsEntries(
  cycle: ComplianceCycle,
  propertyType: string,
  factorConfig: BepsFactorConfig,
  pathway?: BepsPathwayType,
  metricType?: BepsMetricBasis,
) {
  return (factorConfig.standardsTable ?? [])
    .filter((entry) => {
      const entryCycle = entry.cycle ?? cycle;
      if (entryCycle !== cycle) {
        return false;
      }
      if ((entry.propertyType ?? null) !== propertyType) {
        return false;
      }
      if (pathway && entry.pathway !== pathway) {
        return false;
      }
      if (metricType && entry.metricType !== metricType) {
        return false;
      }
      return true;
    })
    .filter(
      (entry): entry is NonNullable<BepsFactorConfig["standardsTable"]>[number] =>
        typeof entry.targetValue === "number" && Number.isFinite(entry.targetValue),
    );
}

export function resolvePerformanceConfig(
  cycle: ComplianceCycle,
  ruleConfig: BepsRuleConfig,
  factorConfig: BepsFactorConfig,
) {
  return {
    requiredReductionFraction: requireNumber(
      `performance.requiredReductionFraction:${cycle}`,
      factorConfig.performance?.requiredReductionFraction,
      ruleConfig.performance?.requiredReductionFraction,
    ),
    scoreEligibleMetric: requireMetricBasis(
      `performance.scoreEligibleMetric:${cycle}`,
      factorConfig.performance?.scoreEligibleMetric,
      ruleConfig.performance?.scoreEligibleMetric,
    ),
    nonScoreEligibleMetric: requireMetricBasis(
      `performance.nonScoreEligibleMetric:${cycle}`,
      factorConfig.performance?.nonScoreEligibleMetric,
      ruleConfig.performance?.nonScoreEligibleMetric,
    ),
    defaultBaselineYears: requireYearList(
      `performance.defaultBaselineYears:${cycle}`,
      factorConfig.performance?.defaultBaselineYears ?? factorConfig.cycle?.baselineYears,
    ),
    defaultEvaluationYears: requireYearList(
      `performance.defaultEvaluationYears:${cycle}`,
      factorConfig.performance?.defaultEvaluationYears ?? factorConfig.cycle?.evaluationYears,
    ),
    delayedCycle1Option:
      factorConfig.performance?.delayedCycle1Option ?? factorConfig.cycle?.delayedCycle1Option
        ? {
            baselineYears: requireYearList(
              `performance.delayedCycle1Option.baselineYears:${cycle}`,
              factorConfig.performance?.delayedCycle1Option?.baselineYears ??
                factorConfig.cycle?.delayedCycle1Option?.baselineYears,
            ),
            evaluationYears: requireYearList(
              `performance.delayedCycle1Option.evaluationYears:${cycle}`,
              factorConfig.performance?.delayedCycle1Option?.evaluationYears ??
                factorConfig.cycle?.delayedCycle1Option?.evaluationYears,
            ),
            comparisonYear: requireNumber(
              `performance.delayedCycle1Option.comparisonYear:${cycle}`,
              factorConfig.performance?.delayedCycle1Option?.comparisonYear ??
                factorConfig.cycle?.delayedCycle1Option?.comparisonYear,
            ),
            optionYear: requireNumber(
              `performance.delayedCycle1Option.optionYear:${cycle}`,
              factorConfig.performance?.delayedCycle1Option?.optionYear ??
                factorConfig.cycle?.delayedCycle1Option?.optionYear,
            ),
          }
        : null,
  };
}

export function resolveStandardTargetConfig(
  cycle: ComplianceCycle,
  propertyType: string,
  buildingTargetScore: number,
  ruleConfig: BepsRuleConfig,
  factorConfig: BepsFactorConfig,
  overrideValue?: number | null,
) {
  const scoreTargetEntry = getStandardsEntries(
    cycle,
    propertyType,
    factorConfig,
    "STANDARD_TARGET",
    "ENERGY_STAR_SCORE",
  )[0];
  const noScoreTargetEntry = getStandardsEntries(
    cycle,
    propertyType,
    factorConfig,
    "STANDARD_TARGET",
    "WEATHER_NORMALIZED_SOURCE_EUI",
  )[0];
  const defaultMaxGap = requireNumber(
    `standardTarget.defaultMaxGap:${cycle}`,
    factorConfig.standardTarget?.defaultMaxGap,
    ruleConfig.standardTarget?.defaultMaxGap,
  );

  return {
    maxGapForPropertyType:
      overrideValue ??
      scoreTargetEntry?.maxGap ??
      factorConfig.standardTarget?.maxGapByPropertyType?.[propertyType] ??
      ruleConfig.standardTarget?.maxGapByPropertyType?.[propertyType] ??
      defaultMaxGap,
    maxGapForPropertyTypeNoScore:
      noScoreTargetEntry?.maxGap ??
      factorConfig.standardTarget?.maxGapByPropertyTypeNoScore?.[propertyType] ?? null,
    buildingTargetScore:
      scoreTargetEntry?.targetValue ?? buildingTargetScore,
    exactTargetScoreForPropertyType:
      scoreTargetEntry?.targetValue ??
      factorConfig.standardTarget?.exactTargetScoresByPropertyType?.[propertyType] ??
      ruleConfig.standardTarget?.exactTargetScoresByPropertyType?.[propertyType] ??
      null,
    exactTargetEuiForPropertyTypeNoScore: noScoreTargetEntry?.targetValue ?? null,
    propertyTypeMappingConstraint:
      factorConfig.standardTarget?.propertyTypeMappingConstraints?.[propertyType] ??
      ruleConfig.standardTarget?.propertyTypeMappingConstraints?.[propertyType] ??
      null,
    scoreEligibleMetric: requireMetricBasis(
      `standardTarget.scoreEligibleMetric:${cycle}`,
      factorConfig.standardTarget?.scoreEligibleMetric,
      ruleConfig.standardTarget?.scoreEligibleMetric,
    ),
    nonScoreEligibleMetric: requireMetricBasis(
      `standardTarget.nonScoreEligibleMetric:${cycle}`,
      factorConfig.standardTarget?.nonScoreEligibleMetric,
      ruleConfig.standardTarget?.nonScoreEligibleMetric,
    ),
  };
}

export function resolvePrescriptiveConfig(
  cycle: ComplianceCycle,
  propertyType: string,
  ruleConfig: BepsRuleConfig,
  factorConfig: BepsFactorConfig,
  overrideValue?: number | null,
) {
  const defaultPointsNeeded = requireNumber(
    `prescriptive.defaultPointsNeeded:${cycle}`,
    factorConfig.prescriptive?.defaultPointsNeeded,
    ruleConfig.prescriptive?.defaultPointsNeeded,
  );

  return {
    pointsNeededForPropertyType:
      overrideValue ??
      factorConfig.prescriptive?.pointsNeededByPropertyType?.[propertyType] ??
      ruleConfig.prescriptive?.pointsNeededByPropertyType?.[propertyType] ??
      defaultPointsNeeded,
    complianceBasis:
      factorConfig.prescriptive?.complianceBasis ??
      ruleConfig.prescriptive?.complianceBasis ??
      "APPROVED_MEASURES_AND_MILESTONES",
  };
}

export function resolveTrajectoryConfig(
  cycle: ComplianceCycle,
  propertyType: string,
  ruleConfig: BepsRuleConfig,
  factorConfig: BepsFactorConfig,
) {
  const trajectoryTargets = getStandardsEntries(
    cycle,
    propertyType,
    factorConfig,
    "TRAJECTORY",
  )
    .filter((entry) => typeof entry.year === "number")
    .sort((left, right) => (left.year ?? 0) - (right.year ?? 0))
    .map((entry) => ({
      year: entry.year as number,
      targetValue: entry.targetValue as number,
    }));

  if (trajectoryTargets.length === 0) {
    throw new BepsConfigurationError(
      `Missing governed BEPS trajectory target table for ${cycle}:${propertyType}`,
    );
  }

  const targetYears = requireYearList(
    `trajectory.targetYears:${cycle}`,
    factorConfig.trajectory?.targetYears ??
      trajectoryTargets.map((entry) => entry.year),
    ruleConfig.trajectory?.targetYears,
  );
  const finalTargetYear = requireNumber(
    `trajectory.finalTargetYear:${cycle}`,
    factorConfig.trajectory?.finalTargetYear ?? targetYears[targetYears.length - 1],
    ruleConfig.trajectory?.finalTargetYear,
  );

  return {
    metricBasis: requireMetricBasis(
      `trajectory.metricBasis:${cycle}`,
      factorConfig.trajectory?.metricBasis ?? "ADJUSTED_SITE_EUI_AVERAGE",
      ruleConfig.trajectory?.metricBasis,
    ),
    targetYears,
    finalTargetYear,
    targets: trajectoryTargets,
  };
}

export function resolveAlternativeComplianceConfig(
  cycle: ComplianceCycle,
  factorConfig: BepsFactorConfig,
) {
  return {
    penaltyPerSquareFoot: requireNumber(
      `alternativeCompliance.penaltyPerSquareFoot:${cycle}`,
      factorConfig.alternativeCompliance?.penaltyPerSquareFoot,
    ),
    maxPenaltyCap: requireNumber(
      `alternativeCompliance.maxPenaltyCap:${cycle}`,
      factorConfig.alternativeCompliance?.maxPenaltyCap,
    ),
    agreementRequired: requireBoolean(
      `alternativeCompliance.agreementRequired:${cycle}`,
      factorConfig.alternativeCompliance?.agreementRequired,
      true,
    ),
    allowedAgreementPathways: requirePathwayList(
      `alternativeCompliance.allowedAgreementPathways:${cycle}`,
      factorConfig.alternativeCompliance?.allowedAgreementPathways,
      ["PERFORMANCE", "STANDARD_TARGET", "PRESCRIPTIVE"],
    ),
  };
}
