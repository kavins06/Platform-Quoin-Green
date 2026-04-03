import type { ComplianceCycle } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { getLatestComplianceSnapshot } from "@/server/lib/compliance-snapshots";
import {
  ComplianceProvenanceError,
} from "../provenance";
import {
  resolveGovernedFilingYear,
  resolvePerformanceConfig,
} from "./config";
import { getActiveBepsCycleContext } from "./cycle-registry";
import { upsertBepsMetricInputRecord } from "./canonical-inputs";
import type { BepsFactorConfig, BepsRuleConfig } from "./types";

type SnapshotMetricField =
  | "siteEui"
  | "weatherNormalizedSiteEui"
  | "weatherNormalizedSourceEui"
  | "energyStarScore";

type DerivationSnapshot = {
  id: string;
  snapshotDate: Date;
  siteEui: number | null;
  weatherNormalizedSiteEui: number | null;
  weatherNormalizedSourceEui: number | null;
  energyStarScore: number | null;
  complianceRunId: string | null;
};

function toJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getMetricInputMode(notesJson: unknown) {
  const notes = toJsonRecord(notesJson);
  const inputMode = notes["inputMode"];
  return inputMode === "MANUAL" || inputMode === "DERIVED" ? inputMode : null;
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

function preferExistingNumber(derivedValue: number | null, existingValue: number | null | undefined) {
  return derivedValue ?? existingValue ?? null;
}

function preferExistingString(derivedValue: string | null, existingValue: string | null | undefined) {
  return derivedValue ?? existingValue ?? null;
}

function selectLatestWithMetric(
  snapshots: DerivationSnapshot[],
  metricField: SnapshotMetricField,
) {
  const ordered = [...snapshots].sort(
    (left, right) => right.snapshotDate.getTime() - left.snapshotDate.getTime(),
  );
  return (
    ordered.find((snapshot) => {
      const value = snapshot[metricField];
      return typeof value === "number" && Number.isFinite(value);
    }) ?? null
  );
}

function filterSnapshotsByYears(snapshots: DerivationSnapshot[], years: number[]) {
  const yearSet = new Set(years);
  return snapshots.filter((snapshot) => yearSet.has(snapshot.snapshotDate.getUTCFullYear()));
}

export function derivePeriodMetricsFromSnapshots(input: {
  baselineSnapshots: DerivationSnapshot[];
  evaluationSnapshots: DerivationSnapshot[];
}) {
  const baselineAdjustedSiteEui = average(
    input.baselineSnapshots.map((snapshot) => snapshot.siteEui),
  );
  const evaluationAdjustedSiteEui = average(
    input.evaluationSnapshots.map((snapshot) => snapshot.siteEui),
  );
  const baselineWeatherNormalizedSiteEui = average(
    input.baselineSnapshots.map((snapshot) => snapshot.weatherNormalizedSiteEui),
  );
  const evaluationWeatherNormalizedSiteEui = average(
    input.evaluationSnapshots.map((snapshot) => snapshot.weatherNormalizedSiteEui),
  );
  const baselineWeatherNormalizedSourceEui = average(
    input.baselineSnapshots.map((snapshot) => snapshot.weatherNormalizedSourceEui),
  );
  const evaluationWeatherNormalizedSourceEui = average(
    input.evaluationSnapshots.map((snapshot) => snapshot.weatherNormalizedSourceEui),
  );
  const baselineScoreSnapshot = selectLatestWithMetric(
    input.baselineSnapshots,
    "energyStarScore",
  );
  const evaluationScoreSnapshot = selectLatestWithMetric(
    input.evaluationSnapshots,
    "energyStarScore",
  );

  return {
    baselineAdjustedSiteEui,
    evaluationAdjustedSiteEui,
    baselineWeatherNormalizedSiteEui,
    evaluationWeatherNormalizedSiteEui,
    baselineWeatherNormalizedSourceEui,
    evaluationWeatherNormalizedSourceEui,
    baselineEnergyStarScore: baselineScoreSnapshot?.energyStarScore ?? null,
    evaluationEnergyStarScore: evaluationScoreSnapshot?.energyStarScore ?? null,
    baselineSnapshotId: baselineScoreSnapshot?.id ?? input.baselineSnapshots.at(-1)?.id ?? null,
    evaluationSnapshotId:
      evaluationScoreSnapshot?.id ?? input.evaluationSnapshots.at(-1)?.id ?? null,
    baselineSnapshotIds: input.baselineSnapshots.map((snapshot) => snapshot.id),
    evaluationSnapshotIds: input.evaluationSnapshots.map((snapshot) => snapshot.id),
    sourceComplianceRunIds: Array.from(
      new Set(
        [...input.baselineSnapshots, ...input.evaluationSnapshots]
          .map((snapshot) => snapshot.complianceRunId)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    ),
  };
}

function resolveDelayedCycle1OptionApplied(input: {
  cycle: ComplianceCycle;
  buildingBaselineYear: number | null;
  existingDelayedCycle1OptionApplied: boolean | null;
  latestSnapshotPenaltyInputsJson: unknown;
  performanceConfig: ReturnType<typeof resolvePerformanceConfig>;
}) {
  if (input.existingDelayedCycle1OptionApplied != null) {
    return input.existingDelayedCycle1OptionApplied;
  }

  const snapshotPenaltyInputs = toJsonRecord(input.latestSnapshotPenaltyInputsJson);
  const snapshotFlag = getBoolean(snapshotPenaltyInputs["delayedCycle1OptionApplied"]);
  if (snapshotFlag != null) {
    return snapshotFlag;
  }

  if (
    input.cycle === "CYCLE_1" &&
    input.performanceConfig.delayedCycle1Option &&
    input.buildingBaselineYear === input.performanceConfig.delayedCycle1Option.optionYear
  ) {
    return true;
  }

  return false;
}

export async function refreshDerivedBepsMetricInput(params: {
  organizationId: string;
  buildingId: string;
  cycle: ComplianceCycle;
  filingYear?: number;
  force?: boolean;
  ruleConfig?: BepsRuleConfig;
  factorConfig?: BepsFactorConfig;
}) {
  const building = await prisma.building.findFirst({
    where: {
      id: params.buildingId,
      organizationId: params.organizationId,
    },
    select: {
      id: true,
      baselineYear: true,
      complianceCycle: true,
    },
  });

  if (!building) {
    throw new ComplianceProvenanceError("Building not found for BEPS metric derivation");
  }

  const cycleContext =
    params.ruleConfig && params.factorConfig
      ? null
      : await getActiveBepsCycleContext(params.cycle);

  const ruleConfig = params.ruleConfig ?? cycleContext?.ruleConfig ?? {};
  const factorConfig = params.factorConfig ?? cycleContext?.factorConfig ?? {};
  const filingYear = resolveGovernedFilingYear(
    params.cycle,
    ruleConfig,
    factorConfig,
    params.filingYear ?? null,
  );

  const [existingMetricInput, latestSnapshot, snapshots] = await Promise.all([
    prisma.bepsMetricInput.findFirst({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        complianceCycle: params.cycle,
        filingYear,
      },
    }),
    getLatestComplianceSnapshot(prisma, {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      select: {
        id: true,
        penaltyInputsJson: true,
      },
    }),
    prisma.complianceSnapshot.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
      },
      orderBy: { snapshotDate: "asc" },
      select: {
        id: true,
        snapshotDate: true,
        siteEui: true,
        weatherNormalizedSiteEui: true,
        weatherNormalizedSourceEui: true,
        energyStarScore: true,
        complianceRunId: true,
      },
    }),
  ]);

  if (getMetricInputMode(existingMetricInput?.notesJson) === "MANUAL" && !params.force) {
    return {
      filingYear,
      metricInput: existingMetricInput,
      updated: false,
      skippedReason: "MANUAL_INPUT_LOCKED",
    };
  }

  const performanceConfig = resolvePerformanceConfig(params.cycle, ruleConfig, factorConfig);
  const delayedCycle1OptionApplied = resolveDelayedCycle1OptionApplied({
    cycle: params.cycle,
    buildingBaselineYear: building.baselineYear,
    existingDelayedCycle1OptionApplied:
      existingMetricInput?.delayedCycle1OptionApplied ?? null,
    latestSnapshotPenaltyInputsJson: latestSnapshot?.penaltyInputsJson ?? null,
    performanceConfig,
  });

  const baselineYears =
    delayedCycle1OptionApplied && performanceConfig.delayedCycle1Option
      ? performanceConfig.delayedCycle1Option.baselineYears
      : performanceConfig.defaultBaselineYears;
  const evaluationYears =
    delayedCycle1OptionApplied && performanceConfig.delayedCycle1Option
      ? performanceConfig.delayedCycle1Option.evaluationYears
      : performanceConfig.defaultEvaluationYears;
  const comparisonYear =
    delayedCycle1OptionApplied && performanceConfig.delayedCycle1Option
      ? performanceConfig.delayedCycle1Option.comparisonYear
      : evaluationYears.at(-1) ?? null;

  const baselineSnapshots = filterSnapshotsByYears(snapshots, baselineYears);
  const evaluationSnapshots = filterSnapshotsByYears(snapshots, evaluationYears);
  const derivedMetrics = derivePeriodMetricsFromSnapshots({
    baselineSnapshots,
    evaluationSnapshots,
  });
  const now = new Date();

  const metricInput = await upsertBepsMetricInputRecord({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    complianceCycle: params.cycle,
    filingYear,
    baselineYearStart: existingMetricInput?.baselineYearStart ?? baselineYears[0] ?? null,
    baselineYearEnd: existingMetricInput?.baselineYearEnd ?? baselineYears.at(-1) ?? null,
    evaluationYearStart:
      existingMetricInput?.evaluationYearStart ?? evaluationYears[0] ?? null,
    evaluationYearEnd:
      existingMetricInput?.evaluationYearEnd ?? evaluationYears.at(-1) ?? null,
    comparisonYear: existingMetricInput?.comparisonYear ?? comparisonYear,
    delayedCycle1OptionApplied,
    baselineAdjustedSiteEui: preferExistingNumber(
      derivedMetrics.baselineAdjustedSiteEui,
      existingMetricInput?.baselineAdjustedSiteEui,
    ),
    evaluationAdjustedSiteEui: preferExistingNumber(
      derivedMetrics.evaluationAdjustedSiteEui,
      existingMetricInput?.evaluationAdjustedSiteEui,
    ),
    baselineWeatherNormalizedSiteEui: preferExistingNumber(
      derivedMetrics.baselineWeatherNormalizedSiteEui,
      existingMetricInput?.baselineWeatherNormalizedSiteEui,
    ),
    evaluationWeatherNormalizedSiteEui: preferExistingNumber(
      derivedMetrics.evaluationWeatherNormalizedSiteEui,
      existingMetricInput?.evaluationWeatherNormalizedSiteEui,
    ),
    baselineWeatherNormalizedSourceEui: preferExistingNumber(
      derivedMetrics.baselineWeatherNormalizedSourceEui,
      existingMetricInput?.baselineWeatherNormalizedSourceEui,
    ),
    evaluationWeatherNormalizedSourceEui: preferExistingNumber(
      derivedMetrics.evaluationWeatherNormalizedSourceEui,
      existingMetricInput?.evaluationWeatherNormalizedSourceEui,
    ),
    baselineEnergyStarScore: preferExistingNumber(
      derivedMetrics.baselineEnergyStarScore,
      existingMetricInput?.baselineEnergyStarScore,
    ),
    evaluationEnergyStarScore: preferExistingNumber(
      derivedMetrics.evaluationEnergyStarScore,
      existingMetricInput?.evaluationEnergyStarScore,
    ),
    baselineSnapshotId: preferExistingString(
      derivedMetrics.baselineSnapshotId,
      existingMetricInput?.baselineSnapshotId,
    ),
    evaluationSnapshotId: preferExistingString(
      derivedMetrics.evaluationSnapshotId,
      existingMetricInput?.evaluationSnapshotId,
    ),
    sourceArtifactId: existingMetricInput?.sourceArtifactId ?? null,
    notesJson: {
      ...(existingMetricInput?.notesJson &&
      typeof existingMetricInput.notesJson === "object" &&
      !Array.isArray(existingMetricInput.notesJson)
        ? (existingMetricInput.notesJson as Record<string, unknown>)
        : {}),
      inputMode: "DERIVED",
      derivedAt: now.toISOString(),
      derivationStrategy: "COMPLIANCE_SNAPSHOT_PERIOD_ROLLUP_V1",
      forceApplied: params.force ?? false,
      delayedCycle1OptionApplied,
      baselineYears,
      evaluationYears,
      comparisonYear,
      sourceSnapshotIds: {
        baseline: derivedMetrics.baselineSnapshotIds,
        evaluation: derivedMetrics.evaluationSnapshotIds,
      },
      sourceComplianceRunIds: derivedMetrics.sourceComplianceRunIds,
    },
  });

  return {
    filingYear,
    metricInput,
    updated: true,
    skippedReason: null,
  };
}
