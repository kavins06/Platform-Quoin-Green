import type { ActorType, ComplianceCycle } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { getLatestComplianceSnapshot } from "@/server/lib/compliance-snapshots";
import {
  recordComplianceEvaluation,
} from "../provenance";
import { calculateAlternativeComplianceAmount } from "./alternative-compliance";
import { evaluateBepsApplicability } from "./applicability";
import {
  BepsConfigurationError,
  resolveAlternativeComplianceConfig,
  resolveApplicabilityConfig,
  resolveApplicabilityThresholdForOwnership,
  resolveGovernedFilingYear,
  resolvePathwayRoutingConfig,
  resolvePerformanceConfig,
  resolvePrescriptiveConfig,
  resolveStandardTargetConfig,
  resolveTrajectoryConfig,
} from "./config";
import { getCanonicalBepsInputState } from "./canonical-inputs";
import { getActiveBepsCycleContext } from "./cycle-registry";
import { upsertBepsFilingRecordFromEvaluation } from "./filing-workflow";
import { refreshDerivedBepsMetricInput } from "./metric-derivation";
import { evaluateBepsPathwayEligibility } from "./pathway-eligibility";
import { evaluatePerformancePathway } from "./performance-pathway";
import { evaluatePrescriptivePathway } from "./prescriptive-pathway";
import { BEPS_REASON_CODES, type BepsReasonCode } from "./reason-codes";
import { evaluateStandardTargetPathway } from "./standard-target-pathway";
import { evaluateTrajectoryPathway } from "./trajectory-pathway";
import type {
  BepsBuildingInput,
  BepsEvaluationOverrides,
  BepsEvaluationResult,
  BepsFactorConfig,
  BepsHistoricalMetricPoint,
  BepsPathwayType,
  BepsRuleConfig,
  BepsSnapshotInput,
} from "./types";

function toJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toSnapshotInput(snapshot: {
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
  penaltyInputsJson: unknown;
} | null): BepsSnapshotInput | null {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    penaltyInputsJson: toJsonObject(snapshot.penaltyInputsJson),
  };
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getPathway(value: unknown): BepsPathwayType | null {
  return value === "PERFORMANCE" ||
    value === "STANDARD_TARGET" ||
    value === "PRESCRIPTIVE" ||
    value === "TRAJECTORY"
    ? value
    : null;
}

function pickValue<T>(candidates: Array<{ value: T | null | undefined; source: string }>) {
  for (const candidate of candidates) {
    if (candidate.value != null) {
      return {
        value: candidate.value,
        source: candidate.source,
      };
    }
  }

  return {
    value: null,
    source: "NONE",
  };
}

function buildInputSummary(
  building: BepsBuildingInput,
  snapshot: BepsSnapshotInput | null,
  canonicalInputs: Awaited<ReturnType<typeof getCanonicalBepsInputState>>,
  overrides: BepsEvaluationOverrides,
) {
  const penaltyInputs = snapshot?.penaltyInputsJson ?? {};
  const baselineScore = pickValue<number>([
    {
      value: canonicalInputs.metricInput?.baselineEnergyStarScore,
      source: "CANONICAL_METRIC_INPUT",
    },
    {
      value: overrides.baselineScore,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["baselineScore"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const currentScore = pickValue<number>([
    {
      value: canonicalInputs.metricInput?.evaluationEnergyStarScore,
      source: "CANONICAL_METRIC_INPUT",
    },
    {
      value: snapshot?.energyStarScore,
      source: "SNAPSHOT",
    },
    {
      value: overrides.currentScore,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["currentScore"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const scoreEligibility = pickValue<boolean>([
    {
      value: building.isEnergyStarScoreEligible,
      source: "BUILDING",
    },
    {
      value: overrides.isEnergyStarScoreEligible,
      source: "OVERRIDE",
    },
    {
      value: getBoolean(penaltyInputs["isEnergyStarScoreEligible"]),
      source: "LEGACY_PAYLOAD",
    },
    {
      value: currentScore.value != null ? true : null,
      source: "DERIVED_FROM_SCORE",
    },
  ]);
  const baselineAdjustedSiteEui = pickValue<number>([
    {
      value: canonicalInputs.metricInput?.baselineAdjustedSiteEui,
      source: "CANONICAL_METRIC_INPUT",
    },
    {
      value: overrides.baselineAdjustedSiteEui,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["baselineAdjustedSiteEui"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const currentAdjustedSiteEui = pickValue<number>([
    {
      value: canonicalInputs.metricInput?.evaluationAdjustedSiteEui,
      source: "CANONICAL_METRIC_INPUT",
    },
    {
      value: snapshot?.siteEui,
      source: "SNAPSHOT",
    },
    {
      value: overrides.currentAdjustedSiteEui,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["currentAdjustedSiteEui"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const baselineWeatherNormalizedSiteEui = pickValue<number>([
    {
      value: canonicalInputs.metricInput?.baselineWeatherNormalizedSiteEui,
      source: "CANONICAL_METRIC_INPUT",
    },
    {
      value: overrides.baselineWeatherNormalizedSiteEui,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["baselineWeatherNormalizedSiteEui"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const currentWeatherNormalizedSiteEui = pickValue<number>([
    {
      value: canonicalInputs.metricInput?.evaluationWeatherNormalizedSiteEui,
      source: "CANONICAL_METRIC_INPUT",
    },
    {
      value: snapshot?.weatherNormalizedSiteEui,
      source: "SNAPSHOT",
    },
    {
      value: overrides.currentWeatherNormalizedSiteEui,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["currentWeatherNormalizedSiteEui"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const baselineWeatherNormalizedSourceEui = pickValue<number>([
    {
      value: canonicalInputs.metricInput?.baselineWeatherNormalizedSourceEui,
      source: "CANONICAL_METRIC_INPUT",
    },
    {
      value: overrides.baselineWeatherNormalizedSourceEui,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["baselineWeatherNormalizedSourceEui"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const currentWeatherNormalizedSourceEui = pickValue<number>([
    {
      value: canonicalInputs.metricInput?.evaluationWeatherNormalizedSourceEui,
      source: "CANONICAL_METRIC_INPUT",
    },
    {
      value: snapshot?.weatherNormalizedSourceEui,
      source: "SNAPSHOT",
    },
    {
      value: overrides.currentWeatherNormalizedSourceEui,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["currentWeatherNormalizedSourceEui"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const prescriptivePointsEarned = pickValue<number>([
    {
      value: canonicalInputs.prescriptiveSummary.pointsEarned,
      source: "CANONICAL_PRESCRIPTIVE_ITEMS",
    },
    {
      value: overrides.prescriptivePointsEarned,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["prescriptivePointsEarned"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const prescriptivePointsNeeded = pickValue<number>([
    {
      value: canonicalInputs.prescriptiveSummary.pointsNeeded,
      source: "CANONICAL_PRESCRIPTIVE_ITEMS",
    },
    {
      value: overrides.prescriptivePointsNeeded,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["prescriptivePointsNeeded"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const prescriptiveRequirementsMet = pickValue<boolean>([
    {
      value: canonicalInputs.prescriptiveSummary.requirementsMet,
      source: "CANONICAL_PRESCRIPTIVE_ITEMS",
    },
    {
      value: overrides.prescriptiveRequirementsMet,
      source: "OVERRIDE",
    },
    {
      value: getBoolean(penaltyInputs["prescriptiveRequirementsMet"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const delayedCycle1OptionApplied = pickValue<boolean>([
    {
      value: canonicalInputs.metricInput?.delayedCycle1OptionApplied,
      source: "CANONICAL_METRIC_INPUT",
    },
    {
      value: overrides.delayedCycle1OptionApplied,
      source: "OVERRIDE",
    },
    {
      value: getBoolean(penaltyInputs["delayedCycle1OptionApplied"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const alternativeComplianceAgreementMultiplier = pickValue<number>([
    {
      value: canonicalInputs.alternativeComplianceAgreement?.multiplier,
      source: "CANONICAL_AGREEMENT",
    },
    {
      value: overrides.alternativeComplianceAgreementMultiplier,
      source: "OVERRIDE",
    },
    {
      value: getNumber(penaltyInputs["alternativeComplianceAgreementMultiplier"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const alternativeComplianceAgreementPathway = pickValue<BepsPathwayType>([
    {
      value: canonicalInputs.alternativeComplianceAgreement?.pathway,
      source: "CANONICAL_AGREEMENT",
    },
    {
      value: overrides.alternativeComplianceAgreementPathway,
      source: "OVERRIDE",
    },
    {
      value: getPathway(penaltyInputs["alternativeComplianceAgreementPathway"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);
  const requestAlternativeComplianceAgreement = pickValue<boolean>([
    {
      value: canonicalInputs.alternativeComplianceAgreement ? true : null,
      source: canonicalInputs.alternativeComplianceAgreement
        ? "CANONICAL_AGREEMENT"
        : "NONE",
    },
    {
      value: overrides.requestAlternativeComplianceAgreement,
      source: "OVERRIDE",
    },
    {
      value: getBoolean(penaltyInputs["requestAlternativeComplianceAgreement"]),
      source: "LEGACY_PAYLOAD",
    },
  ]);

  return {
    ownershipType: building.ownershipType,
    isEnergyStarScoreEligible: scoreEligibility.value,
    currentScore: currentScore.value,
    baselineScore: baselineScore.value,
    baselineAdjustedSiteEui: baselineAdjustedSiteEui.value,
    currentAdjustedSiteEui: currentAdjustedSiteEui.value,
    baselineWeatherNormalizedSiteEui: baselineWeatherNormalizedSiteEui.value,
    currentWeatherNormalizedSiteEui: currentWeatherNormalizedSiteEui.value,
    baselineWeatherNormalizedSourceEui: baselineWeatherNormalizedSourceEui.value,
    currentWeatherNormalizedSourceEui: currentWeatherNormalizedSourceEui.value,
    prescriptivePointsEarned: prescriptivePointsEarned.value,
    prescriptivePointsNeeded: prescriptivePointsNeeded.value,
    prescriptiveRequirementsMet: prescriptiveRequirementsMet.value,
    delayedCycle1OptionApplied: delayedCycle1OptionApplied.value,
    alternativeComplianceAgreementMultiplier:
      alternativeComplianceAgreementMultiplier.value,
    alternativeComplianceAgreementPathway:
      alternativeComplianceAgreementPathway.value,
    requestAlternativeComplianceAgreement:
      requestAlternativeComplianceAgreement.value,
    maxPenaltyOverrideReason: overrides.maxPenaltyOverrideReason ?? null,
    sources: {
      ownershipType: "BUILDING",
      isEnergyStarScoreEligible: scoreEligibility.source,
      currentScore: currentScore.source,
      baselineScore: baselineScore.source,
      baselineAdjustedSiteEui: baselineAdjustedSiteEui.source,
      currentAdjustedSiteEui: currentAdjustedSiteEui.source,
      baselineWeatherNormalizedSiteEui: baselineWeatherNormalizedSiteEui.source,
      currentWeatherNormalizedSiteEui: currentWeatherNormalizedSiteEui.source,
      baselineWeatherNormalizedSourceEui:
        baselineWeatherNormalizedSourceEui.source,
      currentWeatherNormalizedSourceEui:
        currentWeatherNormalizedSourceEui.source,
      prescriptivePointsEarned: prescriptivePointsEarned.source,
      prescriptivePointsNeeded: prescriptivePointsNeeded.source,
      prescriptiveRequirementsMet: prescriptiveRequirementsMet.source,
      delayedCycle1OptionApplied: delayedCycle1OptionApplied.source,
      alternativeComplianceAgreementMultiplier:
        alternativeComplianceAgreementMultiplier.source,
      alternativeComplianceAgreementPathway:
        alternativeComplianceAgreementPathway.source,
      requestAlternativeComplianceAgreement:
        requestAlternativeComplianceAgreement.source,
      maxPenaltyOverrideReason:
        overrides.maxPenaltyOverrideReason != null ? "OVERRIDE" : "NONE",
    },
    canonicalRefs: {
      metricInputId: canonicalInputs.metricInput?.id ?? null,
      prescriptiveItemIds: canonicalInputs.prescriptiveItems.map((item) => item.id),
      alternativeComplianceAgreementId:
        canonicalInputs.alternativeComplianceAgreement?.id ?? null,
    },
  };
}

function dedupeReasonCodes(reasonCodes: BepsReasonCode[]) {
  return Array.from(new Set(reasonCodes));
}

export async function evaluateBepsData(input: {
  building: BepsBuildingInput;
  cycle: ComplianceCycle;
  snapshot: BepsSnapshotInput | null;
  historicalMetrics?: BepsHistoricalMetricPoint[];
  canonicalInputs?: Awaited<ReturnType<typeof getCanonicalBepsInputState>>;
  ruleConfig?: BepsRuleConfig;
  factorConfig?: BepsFactorConfig;
  overrides?: BepsEvaluationOverrides;
  evaluatedAt?: Date;
}): Promise<BepsEvaluationResult> {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const overrides = input.overrides ?? {};
  const ruleConfig = input.ruleConfig ?? {};
  const factorConfig = input.factorConfig ?? {};
  const canonicalInputs = input.canonicalInputs ?? {
    metricInput: null,
    prescriptiveItems: [],
    prescriptiveSummary: {
      pointsEarned: null,
      pointsNeeded: null,
      requirementsMet: null,
      requiredItemCount: 0,
      satisfiedRequiredItemCount: 0,
      itemsCount: 0,
    },
    alternativeComplianceAgreement: null,
  };
  const filingYear = resolveGovernedFilingYear(
    input.cycle,
    ruleConfig,
    factorConfig,
    overrides.filingYear ?? null,
  );
  const inputSummary = buildInputSummary(
    input.building,
    input.snapshot,
    canonicalInputs,
    overrides,
  );
  const applicabilityConfig = resolveApplicabilityConfig(
    input.cycle,
    ruleConfig,
    factorConfig,
  );
  const pathwayRoutingConfig = resolvePathwayRoutingConfig(
    input.cycle,
    ruleConfig,
    factorConfig,
  );
  const performanceConfig = resolvePerformanceConfig(
    input.cycle,
    ruleConfig,
    factorConfig,
  );
  const standardTargetConfig = resolveStandardTargetConfig(
    input.cycle,
    input.building.propertyType,
    input.building.bepsTargetScore,
    ruleConfig,
    factorConfig,
    overrides.maxGapForPropertyType ?? null,
  );
  const prescriptiveConfig = resolvePrescriptiveConfig(
    input.cycle,
    input.building.propertyType,
    ruleConfig,
    factorConfig,
    inputSummary.prescriptivePointsNeeded,
  );
  const trajectoryConfig = pathwayRoutingConfig.supportedPathways.includes("TRAJECTORY")
    ? resolveTrajectoryConfig(
        input.cycle,
        input.building.propertyType,
        ruleConfig,
        factorConfig,
      )
    : {
        metricBasis: "ADJUSTED_SITE_EUI_AVERAGE" as const,
        targetYears: [],
        finalTargetYear: filingYear,
        targets: [],
      };
  const alternativeComplianceConfig = resolveAlternativeComplianceConfig(
    input.cycle,
    factorConfig,
  );

  const applicability = evaluateBepsApplicability({
    building: input.building,
    cycle: input.cycle,
    ruleConfig,
    factorConfig,
    filingYear,
  });
  const pathwayEligibility = evaluateBepsPathwayEligibility({
    applicability,
    building: input.building,
    snapshot: input.snapshot,
    isEnergyStarScoreEligible: inputSummary.isEnergyStarScoreEligible,
    currentScore: inputSummary.currentScore,
    ruleConfig,
    factorConfig,
  });

  const isEnergyStarScoreEligible = inputSummary.isEnergyStarScoreEligible ?? true;

  const performance = evaluatePerformancePathway({
    eligible: pathwayEligibility.eligiblePathways.includes("PERFORMANCE"),
    building: input.building,
    isEnergyStarScoreEligible,
    baselineAdjustedSiteEui: inputSummary.baselineAdjustedSiteEui,
    currentAdjustedSiteEui: inputSummary.currentAdjustedSiteEui,
    baselineWeatherNormalizedSiteEui: inputSummary.baselineWeatherNormalizedSiteEui,
    currentWeatherNormalizedSiteEui: inputSummary.currentWeatherNormalizedSiteEui,
    delayedCycle1OptionApplied: inputSummary.delayedCycle1OptionApplied,
    ruleConfig,
    factorConfig,
  });

  const standardTarget = evaluateStandardTargetPathway({
    eligible: pathwayEligibility.eligiblePathways.includes("STANDARD_TARGET"),
    building: input.building,
    isEnergyStarScoreEligible,
    baselineScore: inputSummary.baselineScore,
    currentScore: inputSummary.currentScore,
    baselineWeatherNormalizedSourceEui: inputSummary.baselineWeatherNormalizedSourceEui,
    currentWeatherNormalizedSourceEui: inputSummary.currentWeatherNormalizedSourceEui,
    maxGapForPropertyType: standardTargetConfig.maxGapForPropertyType,
    ruleConfig,
    factorConfig,
  });

  const prescriptive = evaluatePrescriptivePathway({
    eligible: pathwayEligibility.eligiblePathways.includes("PRESCRIPTIVE"),
    building: input.building,
    pointsEarned: inputSummary.prescriptivePointsEarned,
    pointsNeeded: prescriptiveConfig.pointsNeededForPropertyType,
    requirementsMet: inputSummary.prescriptiveRequirementsMet,
    ruleConfig,
    factorConfig,
  });
  const trajectory = evaluateTrajectoryPathway({
    eligible: pathwayEligibility.eligiblePathways.includes("TRAJECTORY"),
    cycle: input.cycle,
    building: input.building,
    baselineAdjustedSiteEui: inputSummary.baselineAdjustedSiteEui,
    baselineWeatherNormalizedSiteEui: inputSummary.baselineWeatherNormalizedSiteEui,
    historicalMetrics: input.historicalMetrics ?? [],
    ruleConfig,
    factorConfig,
  });

  const alternativeCompliance = {
    performance: calculateAlternativeComplianceAmount({
      grossSquareFeet: input.building.grossSquareFeet,
      cycle: input.cycle,
      pathwayResult: performance,
      factorConfig,
      agreementMultiplier: inputSummary.alternativeComplianceAgreementMultiplier,
      agreementPathway: inputSummary.alternativeComplianceAgreementPathway,
      requestAgreement: inputSummary.requestAlternativeComplianceAgreement,
      maxPenaltyOverrideReason: inputSummary.maxPenaltyOverrideReason,
    }),
    standardTarget: calculateAlternativeComplianceAmount({
      grossSquareFeet: input.building.grossSquareFeet,
      cycle: input.cycle,
      pathwayResult: standardTarget,
      factorConfig,
      agreementMultiplier: inputSummary.alternativeComplianceAgreementMultiplier,
      agreementPathway: inputSummary.alternativeComplianceAgreementPathway,
      requestAgreement: inputSummary.requestAlternativeComplianceAgreement,
      maxPenaltyOverrideReason: inputSummary.maxPenaltyOverrideReason,
    }),
    prescriptive: calculateAlternativeComplianceAmount({
      grossSquareFeet: input.building.grossSquareFeet,
      cycle: input.cycle,
      pathwayResult: prescriptive,
      factorConfig,
      agreementMultiplier: inputSummary.alternativeComplianceAgreementMultiplier,
      agreementPathway: inputSummary.alternativeComplianceAgreementPathway,
      requestAgreement: inputSummary.requestAlternativeComplianceAgreement,
      maxPenaltyOverrideReason: inputSummary.maxPenaltyOverrideReason,
    }),
    trajectory: calculateAlternativeComplianceAmount({
      grossSquareFeet: input.building.grossSquareFeet,
      cycle: input.cycle,
      pathwayResult: trajectory,
      factorConfig,
      agreementMultiplier: inputSummary.alternativeComplianceAgreementMultiplier,
      agreementPathway: inputSummary.alternativeComplianceAgreementPathway,
      requestAgreement: inputSummary.requestAlternativeComplianceAgreement,
      maxPenaltyOverrideReason: inputSummary.maxPenaltyOverrideReason,
    }),
    recommended: null as ReturnType<typeof calculateAlternativeComplianceAmount>,
  };

  const recommendedOptions = [
    alternativeCompliance.performance,
    alternativeCompliance.standardTarget,
    alternativeCompliance.prescriptive,
    alternativeCompliance.trajectory,
  ].filter((option): option is NonNullable<typeof option> => option !== null);
  alternativeCompliance.recommended =
    recommendedOptions.length > 0
      ? recommendedOptions.reduce((best, current) =>
          current.amountDue < best.amountDue ? current : best,
        )
      : null;

  const findings = [
    ...applicability.findings,
    ...pathwayEligibility.findings,
    ...performance.findings,
    ...standardTarget.findings,
    ...prescriptive.findings,
    ...trajectory.findings,
    ...(alternativeCompliance.performance?.findings ?? []),
    ...(alternativeCompliance.standardTarget?.findings ?? []),
    ...(alternativeCompliance.prescriptive?.findings ?? []),
    ...(alternativeCompliance.trajectory?.findings ?? []),
  ];
  const reasonCodes = dedupeReasonCodes(
    findings
      .filter((finding) => finding.status === "FAIL")
      .map((finding) => finding.code),
  );

  const compliantPathways = [performance, standardTarget, prescriptive, trajectory].filter(
    (result) => result.eligible && result.compliant,
  );
  const pendingPathways = [performance, standardTarget, prescriptive, trajectory].filter(
    (result) => result.eligible && result.evaluationStatus === "PENDING_DATA",
  );

  const selectedPathway =
    overrides.selectedPathway ??
    pathwayEligibility.preferredPathway ??
    alternativeCompliance.recommended?.pathway ??
    null;

  let overallStatus: BepsEvaluationResult["overallStatus"];
  if (reasonCodes.includes(BEPS_REASON_CODES.maxPenaltyOverrideApplied)) {
    overallStatus = "NON_COMPLIANT";
  } else if (!applicability.applicable) {
    overallStatus = "NOT_APPLICABLE";
  } else if (compliantPathways.length > 0) {
    overallStatus = "COMPLIANT";
  } else if (pendingPathways.length > 0) {
    overallStatus = "PENDING_DATA";
  } else {
    overallStatus = "NON_COMPLIANT";
  }

  return {
    cycle: input.cycle,
    filingYear: applicability.filingYear,
    evaluatedAt: evaluatedAt.toISOString(),
    overallStatus,
    applicable: applicability.applicable,
    selectedPathway,
    reasonCodes,
    findings,
    applicability,
    pathwayEligibility,
    pathwayResults: {
      performance,
      standardTarget,
      prescriptive,
      trajectory,
    },
    alternativeCompliance,
    governedConfig: {
      applicability: {
        minGrossSquareFeetApplied: resolveApplicabilityThresholdForOwnership({
          ownershipType: input.building.ownershipType,
          minGrossSquareFeetPrivate: applicabilityConfig.minGrossSquareFeetPrivate,
          minGrossSquareFeetDistrict: applicabilityConfig.minGrossSquareFeetDistrict,
        }),
        minGrossSquareFeetPrivate: applicabilityConfig.minGrossSquareFeetPrivate,
        minGrossSquareFeetDistrict: applicabilityConfig.minGrossSquareFeetDistrict,
        ownershipClassFallback: applicabilityConfig.ownershipClassFallback,
        recentConstructionExemptionYears:
          applicabilityConfig.recentConstructionExemptionYears,
        cycleStartYear: applicabilityConfig.cycleStartYear,
        cycleEndYear: applicabilityConfig.cycleEndYear,
      },
      pathwayRouting: {
        performanceScoreThreshold: pathwayRoutingConfig.performanceScoreThreshold,
        prescriptiveAlwaysEligible: pathwayRoutingConfig.prescriptiveAlwaysEligible,
        preferredPathway: pathwayRoutingConfig.preferredPathway,
        supportedPathways: pathwayRoutingConfig.supportedPathways,
      },
      performance: {
        requiredReductionFraction: performanceConfig.requiredReductionFraction,
        scoreEligibleMetric: performanceConfig.scoreEligibleMetric,
        nonScoreEligibleMetric: performanceConfig.nonScoreEligibleMetric,
        defaultBaselineYears: performanceConfig.defaultBaselineYears,
        defaultEvaluationYears: performanceConfig.defaultEvaluationYears,
        delayedCycle1Option: performanceConfig.delayedCycle1Option,
      },
      standardTarget: {
        buildingTargetScore: standardTargetConfig.buildingTargetScore,
        exactTargetScoreForPropertyType:
          standardTargetConfig.exactTargetScoreForPropertyType,
        propertyTypeMappingConstraint:
          standardTargetConfig.propertyTypeMappingConstraint,
        maxGapForPropertyType: standardTargetConfig.maxGapForPropertyType,
        scoreEligibleMetric: standardTargetConfig.scoreEligibleMetric,
        nonScoreEligibleMetric: standardTargetConfig.nonScoreEligibleMetric,
      },
      prescriptive: {
        pointsNeededForPropertyType: prescriptiveConfig.pointsNeededForPropertyType,
        complianceBasis: prescriptiveConfig.complianceBasis,
      },
      trajectory: {
        metricBasis: trajectoryConfig.metricBasis,
        targetYears: trajectoryConfig.targetYears,
        finalTargetYear: trajectoryConfig.finalTargetYear,
        targetCount: trajectoryConfig.targets.length,
      },
      alternativeCompliance: {
        penaltyPerSquareFoot: alternativeComplianceConfig.penaltyPerSquareFoot,
        maxPenaltyCap: alternativeComplianceConfig.maxPenaltyCap,
        agreementRequired: alternativeComplianceConfig.agreementRequired,
        allowedAgreementPathways:
          alternativeComplianceConfig.allowedAgreementPathways,
      },
    },
    inputSummary,
  };
}

export async function evaluateBepsForBuilding(params: {
  organizationId: string;
  buildingId: string;
  cycle: ComplianceCycle;
  overrides?: BepsEvaluationOverrides;
  producedByType: ActorType;
  producedById?: string | null;
}) {
  const [building, latestSnapshot, historicalMetrics, cycleContext] = await Promise.all([
    prisma.building.findFirst({
      where: {
        id: params.buildingId,
        organizationId: params.organizationId,
      },
      select: {
        id: true,
        organizationId: true,
        grossSquareFeet: true,
        propertyType: true,
        ownershipType: true,
        yearBuilt: true,
        bepsTargetScore: true,
        complianceCycle: true,
        selectedPathway: true,
        baselineYear: true,
        targetEui: true,
        maxPenaltyExposure: true,
        isEnergyStarScoreEligible: true,
      },
    }),
    getLatestComplianceSnapshot(prisma, {
      buildingId: params.buildingId,
      organizationId: params.organizationId,
      select: {
        id: true,
        snapshotDate: true,
        energyStarScore: true,
        siteEui: true,
        sourceEui: true,
        weatherNormalizedSiteEui: true,
        weatherNormalizedSourceEui: true,
        complianceStatus: true,
        complianceGap: true,
        estimatedPenalty: true,
        dataQualityScore: true,
        activePathway: true,
        targetEui: true,
        penaltyInputsJson: true,
      },
    }),
    prisma.complianceSnapshot.findMany({
      where: {
        buildingId: params.buildingId,
        organizationId: params.organizationId,
      },
      orderBy: [{ snapshotDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        snapshotDate: true,
        siteEui: true,
        weatherNormalizedSiteEui: true,
        weatherNormalizedSourceEui: true,
        energyStarScore: true,
      },
    }),
    getActiveBepsCycleContext(params.cycle),
  ]);

  if (!building) {
    throw new Error("Building not found for BEPS evaluation");
  }

  const ruleConfig = cycleContext.ruleConfig;
  const factorConfig = cycleContext.factorConfig;
  const filingYear = resolveGovernedFilingYear(
    params.cycle,
    ruleConfig,
    factorConfig,
    params.overrides?.filingYear ?? null,
  );
  await refreshDerivedBepsMetricInput({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    cycle: params.cycle,
    filingYear,
    ruleConfig,
    factorConfig,
  });
  const canonicalInputs = await getCanonicalBepsInputState({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    cycle: params.cycle,
    filingYear,
  });

  const evaluation = await evaluateBepsData({
    building,
    cycle: params.cycle,
    snapshot: toSnapshotInput(latestSnapshot),
    historicalMetrics,
    canonicalInputs,
    ruleConfig,
    factorConfig,
    overrides: params.overrides ?? {},
  });

  const governance = {
    cycleId: cycleContext.registry.cycleId,
    rulePackageKey: cycleContext.rulePackage.key,
    ruleVersion: cycleContext.ruleVersion.version,
    factorSetKey: cycleContext.factorSetVersion.key,
    factorSetVersion: cycleContext.factorSetVersion.version,
  };
  evaluation.governance = governance;

  const provenance = await recordComplianceEvaluation({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    ruleVersionId: cycleContext.ruleVersion.id,
    factorSetVersionId: cycleContext.factorSetVersion.id,
    runType: "BEPS_EVALUATION",
    status: "SUCCEEDED",
    inputSnapshotRef: `beps:${params.cycle}:${evaluation.filingYear}`,
    inputSnapshotPayload: {
      building,
      latestSnapshot: toSnapshotInput(latestSnapshot),
      canonicalInputs,
      historicalMetrics,
      cycle: params.cycle,
      overrides: params.overrides ?? {},
      filingYear: evaluation.filingYear,
    },
    resultPayload: {
      evaluation,
      governance,
    },
    producedByType: params.producedByType,
    producedById: params.producedById ?? null,
    manifest: {
      implementationKey: cycleContext.ruleVersion.implementationKey,
      payload: {
        cycle: params.cycle,
        cycleId: cycleContext.registry.cycleId,
        filingYear: evaluation.filingYear,
        selectedPathway: evaluation.selectedPathway,
        rulePackageKey: governance.rulePackageKey,
        ruleVersion: governance.ruleVersion,
        factorSetKey: governance.factorSetKey,
        factorSetVersion: governance.factorSetVersion,
        governedConfig: evaluation.governedConfig,
      },
    },
    snapshotData: {
      triggerType: "MANUAL",
      complianceStatus:
        evaluation.overallStatus === "COMPLIANT"
          ? "COMPLIANT"
          : evaluation.overallStatus === "NOT_APPLICABLE"
            ? "EXEMPT"
            : evaluation.overallStatus === "PENDING_DATA"
              ? "PENDING_DATA"
              : "NON_COMPLIANT",
      energyStarScore: evaluation.inputSummary.currentScore,
      siteEui: latestSnapshot?.siteEui ?? evaluation.inputSummary.currentAdjustedSiteEui,
      sourceEui: latestSnapshot?.sourceEui ?? null,
        weatherNormalizedSiteEui:
          evaluation.inputSummary.currentWeatherNormalizedSiteEui ??
          latestSnapshot?.weatherNormalizedSiteEui ??
          null,
        weatherNormalizedSourceEui:
          evaluation.inputSummary.currentWeatherNormalizedSourceEui ??
          latestSnapshot?.weatherNormalizedSourceEui ??
          null,
        complianceGap:
        evaluation.inputSummary.currentScore != null
          ? evaluation.inputSummary.currentScore - building.bepsTargetScore
          : null,
      estimatedPenalty: evaluation.alternativeCompliance.recommended?.amountDue ?? null,
      dataQualityScore: latestSnapshot?.dataQualityScore ?? null,
      activePathway:
        evaluation.selectedPathway === "STANDARD_TARGET"
          ? "STANDARD"
          : evaluation.selectedPathway ?? null,
      targetScore: building.bepsTargetScore,
      targetEui: building.targetEui,
      penaltyInputsJson: {
        cycle: params.cycle,
        filingYear: evaluation.filingYear,
        ruleVersion: governance.ruleVersion,
        factorSetVersion: governance.factorSetVersion,
        ...evaluation.inputSummary,
      },
    },
    evidenceArtifacts: [
      {
        artifactType: "CALCULATION_OUTPUT",
        name: `BEPS evaluation ${params.cycle} ${evaluation.filingYear}`,
        artifactRef: `beps_evaluation:${params.cycle}:${evaluation.filingYear}`,
        metadata: {
          beps: {
            cycle: params.cycle,
            filingYear: evaluation.filingYear,
            overallStatus: evaluation.overallStatus,
            selectedPathway: evaluation.selectedPathway,
            reasonCodes: evaluation.reasonCodes,
            governance,
            governedConfig: evaluation.governedConfig,
          },
        },
      },
    ],
  });

  const filingRecord = await upsertBepsFilingRecordFromEvaluation({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    filingYear: evaluation.filingYear,
    complianceCycle: params.cycle,
    complianceRunId: provenance.complianceRun.id,
    filingPayload: {
      bepsEvaluation: evaluation,
    },
    packetUri: null,
    createdByType: params.producedByType,
    createdById: params.producedById ?? null,
  });

  return {
    evaluation,
    provenance,
    filingRecord,
    ruleVersion: cycleContext.ruleVersion,
    factorSetVersion: cycleContext.factorSetVersion,
  };
}

export async function getLatestBepsFilingRecord(params: {
  organizationId: string;
  buildingId: string;
  cycle: ComplianceCycle;
  filingYear: number;
}) {
  return prisma.filingRecord.findFirst({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      filingType: "BEPS_COMPLIANCE",
      complianceCycle: params.cycle,
      filingYear: params.filingYear,
    },
    orderBy: { updatedAt: "desc" },
    include: {
      complianceRun: {
        include: {
          calculationManifest: true,
        },
      },
      evidenceArtifacts: {
        orderBy: { createdAt: "desc" },
      },
      events: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}
