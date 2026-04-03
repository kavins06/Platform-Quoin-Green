import type {
  ComplianceCycle,
  PenaltyCalculationMode,
  PenaltyRun,
} from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { hashDeterministicJson } from "@/server/lib/deterministic-json";
import { createAuditLog } from "@/server/lib/audit-log";
import { createLogger } from "@/server/lib/logger";
import { NotFoundError } from "@/server/lib/errors";
import {
  calculatePerformancePenaltyAdjustment,
  calculatePrescriptivePenaltyAdjustment,
  calculateStandardTargetPenaltyAdjustment,
} from "@/server/compliance/beps/formulas";
import type {
  BepsAlternativeComplianceResult,
  BepsEvaluationResult,
  BepsMetricBasis,
  BepsPathwayResult,
  BepsPathwayType,
} from "@/server/compliance/beps/types";
import {
  getBuildingOperationalState,
  type BuildingOperationalState,
  type BuildingReadinessState,
} from "@/server/compliance/data-issues";

const PENALTY_IMPLEMENTATION_KEY = "penalty-engine/beps-v1";
const PENALTY_CALCULATION_MODE: PenaltyCalculationMode = "CURRENT_BEPS_EXPOSURE";

type JsonRecord = Record<string, unknown>;
type PenaltySummaryStatus = "ESTIMATED" | "NOT_APPLICABLE" | "INSUFFICIENT_CONTEXT";
type PenaltyScenarioCode =
  | "MEET_TARGET"
  | "RESOLVE_CURRENT_PATHWAY_GAP"
  | "IMPROVE_PRIMARY_METRIC_SMALL";

interface PenaltyKeyDriver {
  code: string;
  label: string;
  value: string;
}

interface PenaltyScenarioMetricChange {
  label: string;
  from: number;
  to: number;
}

export interface PenaltyScenarioSummary {
  code: PenaltyScenarioCode;
  label: string;
  description: string;
  estimatedPenalty: number;
  deltaFromCurrent: number;
  metricChange: PenaltyScenarioMetricChange | null;
}

interface PenaltyBaselinePayload {
  status: PenaltySummaryStatus;
  currentEstimatedPenalty: number | null;
  currency: "USD";
  basis: {
    code: string;
    label: string;
    explanation: string;
  };
  governingContext: {
    complianceScope: "BEPS";
    readinessState: BuildingReadinessState;
    primaryStatus: string;
    qaVerdict: string | null;
    filingYear: number | null;
    complianceCycle: ComplianceCycle | null;
    ruleVersion: string | null;
    factorSetVersion: string | null;
    implementationKey: string | null;
    metricUsed: string | null;
    selectedPathway: BepsPathwayType | null;
    basisPathway: BepsPathwayType | null;
    basisPathwaySource: "RECOMMENDED" | "SELECTED" | "NONE";
    reasonCodes: string[];
  };
  artifacts: {
    complianceRunId: string | null;
    filingRecordId: string | null;
    filingPacketId: string | null;
  };
  timestamps: {
    lastReadinessEvaluatedAt: string | null;
    lastComplianceEvaluatedAt: string | null;
    lastPacketGeneratedAt: string | null;
    lastPacketFinalizedAt: string | null;
  };
  keyDrivers: PenaltyKeyDriver[];
}

export interface PenaltySummary extends PenaltyBaselinePayload {
  id: string;
  calculationMode: PenaltyCalculationMode;
  calculatedAt: string;
  scenarios: PenaltyScenarioSummary[];
}

type PathwayContext = {
  pathway: BepsPathwayType;
  pathwayResult: BepsPathwayResult;
  alternativeCompliance: BepsAlternativeComplianceResult | null;
};

type ComplianceRunPenaltyContext = {
  id: string;
  ruleVersionId: string;
  ruleVersion: string;
  factorSetVersionId: string;
  factorSetVersion: string;
  implementationKey: string | null;
  engineResult: {
    metricUsed: string | null;
    reasonCodes: string[];
  };
  evaluation: BepsEvaluationResult | null;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toPathway(value: unknown): BepsPathwayType | null {
  return value === "PERFORMANCE" ||
    value === "STANDARD_TARGET" ||
    value === "PRESCRIPTIVE" ||
    value === "TRAJECTORY"
    ? value
    : null;
}

function toCycle(value: unknown): ComplianceCycle | null {
  return value === "CYCLE_1" || value === "CYCLE_2" || value === "CYCLE_3"
    ? value
    : null;
}

function formatMetricLabel(metricUsed: string | null) {
  return metricUsed ? metricUsed.replaceAll("_", " ") : "Not recorded";
}

function formatMoney(value: number | null) {
  return value == null ? "Not available" : `$${value.toLocaleString()}`;
}

function formatNumber(value: number | null, digits = 2) {
  return value == null ? "Not available" : value.toFixed(digits);
}

function normalizePenaltyBaselinePayload(value: unknown): PenaltyBaselinePayload {
  const baseline = asRecord(value) ?? {};
  const basis = asRecord(baseline["basis"]) ?? {};
  const governingContext = asRecord(baseline["governingContext"]) ?? {};
  const artifacts = asRecord(baseline["artifacts"]) ?? {};
  const timestamps = asRecord(baseline["timestamps"]) ?? {};
  const keyDrivers = Array.isArray(baseline["keyDrivers"])
    ? baseline["keyDrivers"]
        .map((driver) => {
          const record = asRecord(driver);
          if (!record) {
            return null;
          }

          return {
            code: asString(record["code"]) ?? "UNSPECIFIED",
            label: asString(record["label"]) ?? "Unspecified",
            value: asString(record["value"]) ?? "Not available",
          } satisfies PenaltyKeyDriver;
        })
        .filter((driver): driver is PenaltyKeyDriver => driver !== null)
    : [];

  return {
    status:
      baseline["status"] === "ESTIMATED" ||
      baseline["status"] === "NOT_APPLICABLE" ||
      baseline["status"] === "INSUFFICIENT_CONTEXT"
        ? baseline["status"]
        : "INSUFFICIENT_CONTEXT",
    currentEstimatedPenalty: asNumber(baseline["currentEstimatedPenalty"]),
    currency: "USD",
    basis: {
      code: asString(basis["code"]) ?? "UNSPECIFIED",
      label: asString(basis["label"]) ?? "Penalty basis unavailable",
      explanation:
        asString(basis["explanation"]) ??
        "No governed penalty basis was recorded for this run.",
    },
    governingContext: {
      complianceScope: "BEPS",
      readinessState:
        governingContext["readinessState"] === "DATA_INCOMPLETE" ||
        governingContext["readinessState"] === "READY_FOR_REVIEW" ||
        governingContext["readinessState"] === "READY_TO_SUBMIT" ||
        governingContext["readinessState"] === "SUBMITTED"
          ? governingContext["readinessState"]
          : "DATA_INCOMPLETE",
      primaryStatus: asString(governingContext["primaryStatus"]) ?? "DATA_INCOMPLETE",
      qaVerdict: asString(governingContext["qaVerdict"]),
      filingYear: asNumber(governingContext["filingYear"]),
      complianceCycle: toCycle(governingContext["complianceCycle"]),
      ruleVersion: asString(governingContext["ruleVersion"]),
      factorSetVersion: asString(governingContext["factorSetVersion"]),
      implementationKey: asString(governingContext["implementationKey"]),
      metricUsed: asString(governingContext["metricUsed"]),
      selectedPathway: toPathway(governingContext["selectedPathway"]),
      basisPathway: toPathway(governingContext["basisPathway"]),
      basisPathwaySource:
        governingContext["basisPathwaySource"] === "RECOMMENDED" ||
        governingContext["basisPathwaySource"] === "SELECTED"
          ? governingContext["basisPathwaySource"]
          : "NONE",
      reasonCodes: Array.isArray(governingContext["reasonCodes"])
        ? governingContext["reasonCodes"].filter(
            (reasonCode): reasonCode is string => typeof reasonCode === "string",
          )
        : [],
    },
    artifacts: {
      complianceRunId: asString(artifacts["complianceRunId"]),
      filingRecordId: asString(artifacts["filingRecordId"]),
      filingPacketId: asString(artifacts["filingPacketId"]),
    },
    timestamps: {
      lastReadinessEvaluatedAt: asString(timestamps["lastReadinessEvaluatedAt"]),
      lastComplianceEvaluatedAt: asString(timestamps["lastComplianceEvaluatedAt"]),
      lastPacketGeneratedAt: asString(timestamps["lastPacketGeneratedAt"]),
      lastPacketFinalizedAt: asString(timestamps["lastPacketFinalizedAt"]),
    },
    keyDrivers,
  };
}

function normalizePenaltyScenarios(value: unknown): PenaltyScenarioSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((scenario) => {
      const record = asRecord(scenario);
      if (!record) {
        return null;
      }

      const code = asString(record["code"]);
      if (
        code !== "MEET_TARGET" &&
        code !== "RESOLVE_CURRENT_PATHWAY_GAP" &&
        code !== "IMPROVE_PRIMARY_METRIC_SMALL"
      ) {
        return null;
      }

      const metricChangeRecord = asRecord(record["metricChange"]);

      return {
        code,
        label: asString(record["label"]) ?? "Scenario",
        description: asString(record["description"]) ?? "",
        estimatedPenalty: asNumber(record["estimatedPenalty"]) ?? 0,
        deltaFromCurrent: asNumber(record["deltaFromCurrent"]) ?? 0,
        metricChange: metricChangeRecord
          ? {
              label: asString(metricChangeRecord["label"]) ?? "Metric",
              from: asNumber(metricChangeRecord["from"]) ?? 0,
              to: asNumber(metricChangeRecord["to"]) ?? 0,
            }
          : null,
      } satisfies PenaltyScenarioSummary;
    })
    .filter((scenario): scenario is PenaltyScenarioSummary => scenario !== null);
}

function parsePenaltyRun(run: Pick<PenaltyRun, "id" | "calculationMode" | "createdAt" | "baselineResultPayload" | "scenarioResultsPayload">): PenaltySummary {
  const baseline = normalizePenaltyBaselinePayload(run.baselineResultPayload);
  const scenarios = normalizePenaltyScenarios(run.scenarioResultsPayload);

  return {
    id: run.id,
    calculationMode: run.calculationMode,
    calculatedAt: run.createdAt.toISOString(),
    ...baseline,
    scenarios,
  };
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function getPathwayResultFor(
  evaluation: BepsEvaluationResult,
  pathway: BepsPathwayType,
): BepsPathwayResult | null {
  switch (pathway) {
    case "PERFORMANCE":
      return evaluation.pathwayResults.performance;
    case "STANDARD_TARGET":
      return evaluation.pathwayResults.standardTarget;
    case "PRESCRIPTIVE":
      return evaluation.pathwayResults.prescriptive;
    case "TRAJECTORY":
      return evaluation.pathwayResults.trajectory;
  }
}

function getAlternativeComplianceFor(
  evaluation: BepsEvaluationResult,
  pathway: BepsPathwayType,
): BepsAlternativeComplianceResult | null {
  switch (pathway) {
    case "PERFORMANCE":
      return evaluation.alternativeCompliance.performance;
    case "STANDARD_TARGET":
      return evaluation.alternativeCompliance.standardTarget;
    case "PRESCRIPTIVE":
      return evaluation.alternativeCompliance.prescriptive;
    case "TRAJECTORY":
      return evaluation.alternativeCompliance.trajectory;
  }
}

function extractComplianceRunPenaltyContext(run: {
  id: string;
  ruleVersionId: string;
  factorSetVersionId: string;
  resultPayload: unknown;
  ruleVersion: { version: string; implementationKey: string };
  factorSetVersion: { version: string };
  calculationManifest: { implementationKey: string } | null;
}): ComplianceRunPenaltyContext {
  const resultPayload = asRecord(run.resultPayload);
  const engineResultRecord = asRecord(resultPayload?.engineResult);
  const evaluationRecord = asRecord(resultPayload?.evaluation);

  return {
    id: run.id,
    ruleVersionId: run.ruleVersionId,
    ruleVersion: run.ruleVersion.version,
    factorSetVersionId: run.factorSetVersionId,
    factorSetVersion: run.factorSetVersion.version,
    implementationKey:
      run.calculationManifest?.implementationKey ?? run.ruleVersion.implementationKey,
    engineResult: {
      metricUsed: asString(engineResultRecord?.metricUsed),
      reasonCodes: Array.isArray(engineResultRecord?.reasonCodes)
        ? engineResultRecord.reasonCodes.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    },
    evaluation: evaluationRecord as unknown as BepsEvaluationResult | null,
  };
}

function resolveBasisPathway(evaluation: BepsEvaluationResult | null): {
  pathway: BepsPathwayType | null;
  source: "RECOMMENDED" | "SELECTED" | "NONE";
} {
  const recommendedPathway = evaluation?.alternativeCompliance.recommended?.pathway ?? null;
  if (recommendedPathway) {
    return {
      pathway: recommendedPathway,
      source: "RECOMMENDED",
    };
  }

  if (evaluation?.selectedPathway) {
    return {
      pathway: evaluation.selectedPathway,
      source: "SELECTED",
    };
  }

  return {
    pathway: null,
    source: "NONE",
  };
}

function resolvePathwayContext(evaluation: BepsEvaluationResult | null): PathwayContext | null {
  if (!evaluation) {
    return null;
  }

  const basisPathway = resolveBasisPathway(evaluation).pathway;
  if (!basisPathway) {
    return null;
  }

  const pathwayResult = getPathwayResultFor(evaluation, basisPathway);
  if (!pathwayResult) {
    return null;
  }

  return {
    pathway: basisPathway,
    pathwayResult,
    alternativeCompliance: getAlternativeComplianceFor(evaluation, basisPathway),
  };
}

function buildKeyDrivers(input: {
  baselinePenalty: number | null;
  readiness: BuildingOperationalState["readinessSummary"];
  evaluation: BepsEvaluationResult | null;
  pathwayContext: PathwayContext | null;
  metricUsed: string | null;
}): PenaltyKeyDriver[] {
  const drivers: PenaltyKeyDriver[] = [
    {
      code: "READINESS_STATE",
      label: "Readiness state",
      value: input.readiness.state.replaceAll("_", " "),
    },
    {
      code: "METRIC_USED",
      label: "Metric used",
      value: formatMetricLabel(input.metricUsed),
    },
    {
      code: "CURRENT_ESTIMATE",
      label: "Current estimate",
      value: formatMoney(input.baselinePenalty),
    },
  ];

  if (!input.pathwayContext) {
    return drivers;
  }

  const pathwayResult = input.pathwayContext.pathwayResult;
  const rawInputs = asRecord(pathwayResult.calculation.rawInputs) ?? {};
  const metrics = asRecord(pathwayResult.metrics) ?? {};
  const maxAmount =
    input.pathwayContext.alternativeCompliance?.maxAmount ??
    asNumber(pathwayResult.calculation.maxAmount);

  drivers.push({
    code: "PATHWAY",
    label: "Penalty basis pathway",
    value: input.pathwayContext.pathway.replaceAll("_", " "),
  });

  if (maxAmount != null) {
    drivers.push({
      code: "MAX_AMOUNT",
      label: "Governed max amount",
      value: formatMoney(maxAmount),
    });
  }

  if (input.pathwayContext.pathway === "STANDARD_TARGET") {
    if (pathwayResult.metricBasis === "ENERGY_STAR_SCORE") {
      drivers.push({
        code: "CURRENT_SCORE",
        label: "Current score",
        value: formatNumber(asNumber(rawInputs.currentScore), 0),
      });
      drivers.push({
        code: "TARGET_SCORE",
        label: "Target score",
        value: formatNumber(asNumber(rawInputs.targetScore), 0),
      });
    } else {
      drivers.push({
        code: "CURRENT_SOURCE_EUI",
        label: "Current source EUI",
        value: formatNumber(asNumber(rawInputs.currentWeatherNormalizedSourceEui)),
      });
      drivers.push({
        code: "TARGET_SOURCE_EUI",
        label: "Target source EUI",
        value: formatNumber(asNumber(rawInputs.targetEui)),
      });
    }
  }

  if (input.pathwayContext.pathway === "PERFORMANCE") {
    drivers.push({
      code: "CURRENT_PERFORMANCE_VALUE",
      label: "Current pathway value",
      value: formatNumber(asNumber(rawInputs.currentValue)),
    });
    drivers.push({
      code: "REQUIRED_REDUCTION",
      label: "Required reduction fraction",
      value: formatNumber(asNumber(rawInputs.requiredReductionFraction)),
    });
  }

  if (input.pathwayContext.pathway === "PRESCRIPTIVE") {
    drivers.push({
      code: "POINTS_EARNED",
      label: "Points earned",
      value: formatNumber(asNumber(rawInputs.pointsEarned), 0),
    });
    drivers.push({
      code: "POINTS_NEEDED",
      label: "Points needed",
      value: formatNumber(asNumber(rawInputs.pointsNeeded), 0),
    });
  }

  if (input.pathwayContext.pathway === "TRAJECTORY") {
    const yearlyResults = Array.isArray(metrics.yearlyResults)
      ? metrics.yearlyResults.length
      : null;
    drivers.push({
      code: "TRAJECTORY_TARGET_YEARS",
      label: "Tracked target years",
      value: formatNumber(yearlyResults, 0),
    });
  }

  return drivers;
}

function buildSmallImprovementScenario(
  baselinePenalty: number,
  pathwayContext: PathwayContext,
): PenaltyScenarioSummary | null {
  const pathwayResult = pathwayContext.pathwayResult;
  const rawInputs = asRecord(pathwayResult.calculation.rawInputs) ?? {};
  const maxAmount = asNumber(pathwayResult.calculation.maxAmount);

  if (maxAmount == null) {
    return null;
  }

  if (pathwayContext.pathway === "PERFORMANCE") {
    const baselineValue = asNumber(rawInputs.baselineValue);
    const currentValue = asNumber(rawInputs.currentValue);
    const requiredReductionFraction = asNumber(rawInputs.requiredReductionFraction);

    if (
      baselineValue == null ||
      currentValue == null ||
      requiredReductionFraction == null ||
      currentValue <= 0
    ) {
      return null;
    }

    const improvedValue = Math.max(0, currentValue - 1);
    if (improvedValue === currentValue) {
      return null;
    }

    const achievedReductionFraction = (baselineValue - improvedValue) / baselineValue;
    const adjustment = calculatePerformancePenaltyAdjustment({
      maxAmount,
      achievedReductionFraction,
      requiredReductionFraction,
    });

    return {
      code: "IMPROVE_PRIMARY_METRIC_SMALL",
      label: "Improve primary metric by 1 unit",
      description:
        "Applies a small one-unit improvement to the pathway metric driving the current estimate.",
      estimatedPenalty: adjustment.adjustedAmount,
      deltaFromCurrent: adjustment.adjustedAmount - baselinePenalty,
      metricChange: {
        label: formatMetricLabel(pathwayResult.metricBasis),
        from: currentValue,
        to: improvedValue,
      },
    };
  }

  if (pathwayContext.pathway === "STANDARD_TARGET") {
    if (pathwayResult.metricBasis === "ENERGY_STAR_SCORE") {
      const baselineScore = asNumber(rawInputs.baselineScore);
      const currentScore = asNumber(rawInputs.currentScore);
      const targetScore = asNumber(rawInputs.targetScore);
      const maxGap = asNumber(rawInputs.maxGap);

      if (
        baselineScore == null ||
        currentScore == null ||
        targetScore == null ||
        maxGap == null
      ) {
        return null;
      }

      const improvedScore = currentScore + 1;
      const initialGap = Math.max(0, targetScore - baselineScore);
      const achievedSavings = Math.max(0, improvedScore - baselineScore);
      const requiredSavings = Math.max(0, targetScore - baselineScore);
      const adjustment = calculateStandardTargetPenaltyAdjustment({
        maxAmount,
        initialGap,
        maxGap,
        achievedSavings,
        requiredSavings,
      });

      return {
        code: "IMPROVE_PRIMARY_METRIC_SMALL",
        label: "Increase score by 1 point",
        description:
          "Applies a one-point ENERGY STAR score improvement against the governed standard-target calculation.",
        estimatedPenalty: adjustment.adjustedAmount,
        deltaFromCurrent: adjustment.adjustedAmount - baselinePenalty,
        metricChange: {
          label: "ENERGY STAR score",
          from: currentScore,
          to: improvedScore,
        },
      };
    }

    const baselineSourceEui = asNumber(rawInputs.baselineWeatherNormalizedSourceEui);
    const currentSourceEui = asNumber(rawInputs.currentWeatherNormalizedSourceEui);
    const targetEui = asNumber(rawInputs.targetEui);
    const maxGap = asNumber(rawInputs.maxGap);

    if (
      baselineSourceEui == null ||
      currentSourceEui == null ||
      targetEui == null ||
      maxGap == null ||
      currentSourceEui <= 0
    ) {
      return null;
    }

    const improvedSourceEui = Math.max(0, currentSourceEui - 1);
    const initialGap = baselineSourceEui - targetEui;
    const achievedSavings = baselineSourceEui - improvedSourceEui;
    const requiredSavings = baselineSourceEui - targetEui;
    const adjustment = calculateStandardTargetPenaltyAdjustment({
      maxAmount,
      initialGap,
      maxGap,
      achievedSavings,
      requiredSavings,
    });

    return {
      code: "IMPROVE_PRIMARY_METRIC_SMALL",
      label: "Lower source EUI by 1 point",
      description:
        "Applies a one-point weather-normalized source EUI improvement against the governed standard-target calculation.",
      estimatedPenalty: adjustment.adjustedAmount,
      deltaFromCurrent: adjustment.adjustedAmount - baselinePenalty,
      metricChange: {
        label: "Weather-normalized source EUI",
        from: currentSourceEui,
        to: improvedSourceEui,
      },
    };
  }

  if (pathwayContext.pathway === "PRESCRIPTIVE") {
    const pointsEarned = asNumber(rawInputs.pointsEarned);
    const pointsNeeded = asNumber(rawInputs.pointsNeeded);

    if (pointsEarned == null || pointsNeeded == null || pointsEarned >= pointsNeeded) {
      return null;
    }

    const improvedPoints = Math.min(pointsNeeded, pointsEarned + 1);
    const adjustment = calculatePrescriptivePenaltyAdjustment({
      maxAmount,
      pointsEarned: improvedPoints,
      pointsNeeded,
    });

    return {
      code: "IMPROVE_PRIMARY_METRIC_SMALL",
      label: "Earn 1 additional prescriptive point",
      description:
        "Applies a one-point prescriptive improvement using the governed prescriptive adjustment formula.",
      estimatedPenalty: adjustment.adjustedAmount,
      deltaFromCurrent: adjustment.adjustedAmount - baselinePenalty,
      metricChange: {
        label: "Prescriptive points earned",
        from: pointsEarned,
        to: improvedPoints,
      },
    };
  }

  return null;
}

function buildScenarios(
  baselinePenalty: number | null,
  pathwayContext: PathwayContext | null,
): PenaltyScenarioSummary[] {
  if (baselinePenalty == null || pathwayContext == null) {
    return [];
  }

  const scenarios: PenaltyScenarioSummary[] = [
    {
      code: "MEET_TARGET",
      label: "Meet target",
      description:
        "Assumes the building reaches the governed compliance target and eliminates current penalty exposure.",
      estimatedPenalty: 0,
      deltaFromCurrent: -baselinePenalty,
      metricChange: null,
    },
    {
      code: "RESOLVE_CURRENT_PATHWAY_GAP",
      label: `Resolve current ${pathwayContext.pathway
        .toLowerCase()
        .replaceAll("_", " ")} gap`,
      description:
        "Assumes the pathway currently driving the estimate reaches its governed compliance threshold.",
      estimatedPenalty: 0,
      deltaFromCurrent: -baselinePenalty,
      metricChange: null,
    },
  ];

  const smallImprovement = buildSmallImprovementScenario(baselinePenalty, pathwayContext);
  if (smallImprovement) {
    scenarios.push(smallImprovement);
  }

  return scenarios;
}

function buildBaselinePayload(input: {
  readiness: BuildingOperationalState["readinessSummary"];
  complianceRun: ComplianceRunPenaltyContext | null;
  pathwayContext: PathwayContext | null;
}): PenaltyBaselinePayload {
  const evaluation = input.complianceRun?.evaluation ?? null;
  const basisPathway = resolveBasisPathway(evaluation);
  const baselinePenalty =
    input.pathwayContext?.alternativeCompliance?.amountDue ??
    evaluation?.alternativeCompliance.recommended?.amountDue ??
    (evaluation?.overallStatus === "COMPLIANT" || evaluation?.overallStatus === "NOT_APPLICABLE"
      ? 0
      : null);

  let status: PenaltySummaryStatus;
  let basis: PenaltyBaselinePayload["basis"];

  if (!input.complianceRun || !evaluation) {
    status = "INSUFFICIENT_CONTEXT";
    basis = {
      code: "INSUFFICIENT_BEPS_CONTEXT",
      label: "Insufficient governed context",
      explanation:
        "No persisted BEPS compliance run is available yet for a governed penalty estimate.",
    };
  } else if (evaluation.overallStatus === "NOT_APPLICABLE") {
    status = "NOT_APPLICABLE";
    basis = {
      code: "BEPS_NOT_APPLICABLE",
      label: "Not applicable",
      explanation:
        "The latest governed BEPS evaluation marked the building out of scope, so no penalty exposure is estimated.",
    };
  } else if (baselinePenalty == null) {
    status = "INSUFFICIENT_CONTEXT";
    basis = {
      code: "INSUFFICIENT_PENALTY_BASIS",
      label: "Penalty basis unavailable",
      explanation:
        "The latest governed evaluation does not include enough pathway detail to estimate current penalty exposure.",
    };
  } else {
    status = "ESTIMATED";
    basis = {
      code: "RECOMMENDED_ALTERNATIVE_COMPLIANCE",
      label: "Governed alternative compliance estimate",
      explanation:
        "Estimate is based on the latest persisted BEPS evaluation and the governed alternative compliance amount for the pathway currently driving exposure.",
    };
  }

  return {
    status,
    currentEstimatedPenalty: baselinePenalty,
    currency: "USD",
    basis,
    governingContext: {
      complianceScope: "BEPS",
      readinessState: input.readiness.state,
      primaryStatus: input.readiness.primaryStatus,
      qaVerdict: input.readiness.qaVerdict,
      filingYear: null,
      complianceCycle: null,
      ruleVersion: input.complianceRun?.ruleVersion ?? null,
      factorSetVersion: input.complianceRun?.factorSetVersion ?? null,
      implementationKey: input.complianceRun?.implementationKey ?? null,
      metricUsed: input.complianceRun?.engineResult.metricUsed ?? null,
      selectedPathway: evaluation?.selectedPathway ?? null,
      basisPathway: basisPathway.pathway,
      basisPathwaySource: basisPathway.source,
      reasonCodes: input.complianceRun?.engineResult.reasonCodes ?? input.readiness.reasonCodes,
    },
    artifacts: {
      complianceRunId: input.complianceRun?.id ?? null,
      filingRecordId: null,
      filingPacketId: null,
    },
    timestamps: {
      lastReadinessEvaluatedAt: input.readiness.lastReadinessEvaluatedAt,
      lastComplianceEvaluatedAt: input.readiness.lastComplianceEvaluatedAt,
      lastPacketGeneratedAt: input.readiness.lastPacketGeneratedAt,
      lastPacketFinalizedAt: input.readiness.lastPacketFinalizedAt,
    },
    keyDrivers: buildKeyDrivers({
      baselinePenalty,
      readiness: input.readiness,
      evaluation,
      pathwayContext: input.pathwayContext,
      metricUsed: input.complianceRun?.engineResult.metricUsed ?? null,
    }),
  };
}

function buildInputHash(input: {
  readiness: BuildingOperationalState["readinessSummary"];
  complianceRunId: string | null;
}) {
  return hashDeterministicJson({
    calculationMode: PENALTY_CALCULATION_MODE,
    readiness: {
      state: input.readiness.state,
      primaryStatus: input.readiness.primaryStatus,
      qaVerdict: input.readiness.qaVerdict,
      reasonCodes: input.readiness.reasonCodes,
      lastReadinessEvaluatedAt: input.readiness.lastReadinessEvaluatedAt,
      lastComplianceEvaluatedAt: input.readiness.lastComplianceEvaluatedAt,
      lastPacketGeneratedAt: input.readiness.lastPacketGeneratedAt,
      lastPacketFinalizedAt: input.readiness.lastPacketFinalizedAt,
      bepsFilingId: null,
      bepsFilingStatus: null,
      bepsPacketId: null,
      bepsPacketStatus: null,
      complianceRunId: input.complianceRunId,
    },
  });
}

async function loadComplianceRunPenaltyContext(params: {
  organizationId: string;
  buildingId: string;
  complianceRunId: string | null;
}): Promise<ComplianceRunPenaltyContext | null> {
  if (!params.complianceRunId) {
    return null;
  }

  const complianceRun = await prisma.complianceRun.findFirst({
    where: {
      id: params.complianceRunId,
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    },
    select: {
      id: true,
      ruleVersionId: true,
      factorSetVersionId: true,
      resultPayload: true,
      ruleVersion: {
        select: {
          version: true,
          implementationKey: true,
        },
      },
      factorSetVersion: {
        select: {
          version: true,
        },
      },
      calculationManifest: {
        select: {
          implementationKey: true,
        },
      },
    },
  });

  return complianceRun ? extractComplianceRunPenaltyContext(complianceRun) : null;
}

export async function getOrCreatePenaltySummary(params: {
  organizationId: string;
  buildingId: string;
  requestId?: string | null;
}) {
  const logger = createLogger({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    requestId: params.requestId ?? null,
    procedure: "penalties.getOrCreatePenaltySummary",
  });

  const building = await prisma.building.findFirst({
    where: {
      id: params.buildingId,
      organizationId: params.organizationId,
    },
    select: { id: true },
  });

  if (!building) {
    throw new NotFoundError("Building not found");
  }

  try {
    const operationalState = await getBuildingOperationalState({
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    });
    const complianceRunContext = await loadComplianceRunPenaltyContext({
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      complianceRunId: null,
    });
    const inputSnapshotHash = buildInputHash({
      readiness: operationalState.readinessSummary,
      complianceRunId: complianceRunContext?.id ?? null,
    });

    const existingRun = await prisma.penaltyRun.findFirst({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        calculationMode: PENALTY_CALCULATION_MODE,
        inputSnapshotHash,
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingRun) {
      logger.info("Reused persisted penalty run", {
        penaltyRunId: existingRun.id,
        complianceRunId: complianceRunContext?.id ?? null,
      });
      return parsePenaltyRun(existingRun);
    }

    const pathwayContext = resolvePathwayContext(complianceRunContext?.evaluation ?? null);
    const baselinePayload = buildBaselinePayload({
      readiness: operationalState.readinessSummary,
      complianceRun: complianceRunContext,
      pathwayContext,
    });
    const scenarios = buildScenarios(baselinePayload.currentEstimatedPenalty, pathwayContext);

    let created: PenaltyRun;
    try {
      created = await prisma.penaltyRun.create({
        data: {
          organizationId: params.organizationId,
          buildingId: params.buildingId,
          complianceRunId: complianceRunContext?.id ?? null,
          ruleVersionId: complianceRunContext?.ruleVersionId ?? null,
          factorSetVersionId: complianceRunContext?.factorSetVersionId ?? null,
          calculationMode: PENALTY_CALCULATION_MODE,
          inputSnapshotRef:
            complianceRunContext && baselinePayload.governingContext.filingYear != null
              ? `penalty:${baselinePayload.governingContext.complianceCycle ?? "UNKNOWN"}:${baselinePayload.governingContext.filingYear}`
              : "penalty:unresolved",
          inputSnapshotHash,
          implementationKey:
            complianceRunContext?.implementationKey ?? PENALTY_IMPLEMENTATION_KEY,
          baselineResultPayload: toInputJsonValue(baselinePayload),
          scenarioResultsPayload: toInputJsonValue(scenarios),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrentRun = await prisma.penaltyRun.findFirst({
          where: {
            organizationId: params.organizationId,
            buildingId: params.buildingId,
            calculationMode: PENALTY_CALCULATION_MODE,
            inputSnapshotHash,
          },
          orderBy: { createdAt: "desc" },
        });

        if (concurrentRun) {
          logger.info("Reused concurrently created penalty run", {
            penaltyRunId: concurrentRun.id,
            complianceRunId: complianceRunContext?.id ?? null,
          });
          return parsePenaltyRun(concurrentRun);
        }
      }

      throw error;
    }

    await createAuditLog({
      actorType: "SYSTEM",
      actorId: "penalty-engine",
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      action: "PENALTY_RUN_COMPUTED",
      inputSnapshot: {
        complianceRunId: complianceRunContext?.id ?? null,
        readinessState: operationalState.readinessSummary.state,
      },
      outputSnapshot: {
        penaltyRunId: created.id,
        status: baselinePayload.status,
        currentEstimatedPenalty: baselinePayload.currentEstimatedPenalty,
        scenarioCount: scenarios.length,
      },
      requestId: params.requestId ?? null,
    });

    logger.info("Computed penalty run", {
      penaltyRunId: created.id,
      status: baselinePayload.status,
      currentEstimatedPenalty: baselinePayload.currentEstimatedPenalty,
      scenarioCount: scenarios.length,
    });

    return parsePenaltyRun(created);
  } catch (error) {
    await createAuditLog({
      actorType: "SYSTEM",
      actorId: "penalty-engine",
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      action: "PENALTY_RUN_FAILED",
      errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      requestId: params.requestId ?? null,
    });
    throw error;
  }
}

export async function listPenaltySummaries(params: {
  organizationId: string;
  buildingIds: string[];
  requestId?: string | null;
}) {
  const uniqueBuildingIds = Array.from(new Set(params.buildingIds)).filter(Boolean);

  const summaries = await Promise.all(
    uniqueBuildingIds.map(async (buildingId) => ({
      buildingId,
      summary: await getOrCreatePenaltySummary({
        organizationId: params.organizationId,
        buildingId,
        requestId: params.requestId ?? null,
      }),
    })),
  );

  return summaries;
}

export async function listStoredPenaltySummaries(params: {
  organizationId: string;
  buildingIds: string[];
}) {
  const uniqueBuildingIds = Array.from(new Set(params.buildingIds)).filter(Boolean);

  if (uniqueBuildingIds.length === 0) {
    return [];
  }

  const runs = await prisma.penaltyRun.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: {
        in: uniqueBuildingIds,
      },
    },
    distinct: ["buildingId"],
    orderBy: [{ buildingId: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      buildingId: true,
      calculationMode: true,
      createdAt: true,
      baselineResultPayload: true,
      scenarioResultsPayload: true,
    },
  });

  return runs.map((run) => ({
    buildingId: run.buildingId,
    summary: parsePenaltyRun(run),
  }));
}

export async function listLatestPenaltyRunIdsByBuilding(params: {
  organizationId: string;
  buildingIds: string[];
}) {
  const uniqueBuildingIds = Array.from(new Set(params.buildingIds)).filter(Boolean);

  if (uniqueBuildingIds.length === 0) {
    return new Map<string, string>();
  }

  const runs = await prisma.penaltyRun.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: {
        in: uniqueBuildingIds,
      },
    },
    distinct: ["buildingId"],
    orderBy: [{ buildingId: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      buildingId: true,
    },
  });

  return new Map(runs.map((run) => [run.buildingId, run.id]));
}
