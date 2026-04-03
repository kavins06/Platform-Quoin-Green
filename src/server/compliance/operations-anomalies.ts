import { createHash } from "node:crypto";
import type {
  ActorType,
  AlertSeverity,
  ComplianceCycle,
  MeterType,
  OperationalAnomalyConfidenceBand,
  OperationalAnomalyPenaltyImpactStatus,
  OperationalAnomalyStatus,
  OperationalAnomalyType,
  Prisma,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { getLatestComplianceSnapshot } from "@/server/lib/compliance-snapshots";
import { getBuildingOperationalState, type BuildingReadinessSummary } from "@/server/compliance/data-issues";
import { listStoredPenaltySummaries, type PenaltySummary } from "@/server/compliance/penalties";

const DAY_MS = 24 * 60 * 60 * 1000;

export const OPERATIONAL_ANOMALY_REASON_CODES = {
  elevatedBaseload: "ELEVATED_BASELOAD",
  flatterLoadProfile: "FLATTER_LOAD_PROFILE",
  scheduleDriftProxy: "SCHEDULE_DRIFT_PROXY",
  consumptionSpike: "CONSUMPTION_SPIKE",
  consumptionDrop: "CONSUMPTION_DROP",
  noActiveMeters: "NO_ACTIVE_METERS",
  meterReadingsMissing: "METER_READINGS_MISSING",
  insufficientReadingHistory: "INSUFFICIENT_READING_HISTORY",
  coverageGap: "READING_COVERAGE_GAP",
  overlappingPeriods: "OVERLAPPING_PERIODS",
  suspectZeroUsage: "SUSPECT_ZERO_OR_NEGATIVE_USAGE",
  meterDivergesFromBuildingTrend: "METER_DIVERGES_FROM_BUILDING_TREND",
} as const;

export type OperationalAnomalyReasonCode =
  (typeof OPERATIONAL_ANOMALY_REASON_CODES)[keyof typeof OPERATIONAL_ANOMALY_REASON_CODES];

export type OperationalPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface OperationalAnomalySourceRef {
  recordType:
    | "BUILDING"
    | "METER"
    | "ENERGY_READING"
    | "COMPLIANCE_SNAPSHOT"
    | "PORTFOLIO_MANAGER_SYNC_STATE";
  recordId: string;
  label: string;
}

export interface OperationalAnomalyAttribution {
  estimatedEnergyImpactKbtu: number | null;
  estimatedSiteEuiDelta: number | null;
  estimatedPenaltyImpactUsd: number | null;
  penaltyImpactStatus: OperationalAnomalyPenaltyImpactStatus;
  penaltyImpactExplanation: string;
  likelyBepsImpact:
    | "LIKELY_HIGHER_EUI_AND_WORSE_TRAJECTORY"
    | "LIKELY_LOWER_EUI"
    | "DATA_QUALITY_RISK"
    | "METER_REVIEW_REQUIRED"
    | "NONE";
  likelyBenchmarkingImpact:
    | "LIKELY_READINESS_BLOCKER"
    | "MAY_CHANGE_REPORTED_METRICS"
    | "NONE";
  operationalPriority: OperationalPriority;
  latestSnapshotDate: string | null;
  latestSiteEui: number | null;
}

export interface OperationalAnomalyCandidate {
  anomalyType: OperationalAnomalyType;
  severity: AlertSeverity;
  confidenceBand: OperationalAnomalyConfidenceBand;
  confidenceScore: number;
  detectionHash: string;
  meterId: string | null;
  title: string;
  summary: string;
  detectionWindowStart: Date;
  detectionWindowEnd: Date;
  comparisonWindowStart: Date | null;
  comparisonWindowEnd: Date | null;
  basis: Record<string, unknown>;
  reasonCodes: OperationalAnomalyReasonCode[];
  estimatedEnergyImpactKbtu: number | null;
  attribution: OperationalAnomalyAttribution;
  metadata: Record<string, unknown>;
}

export interface OperationalAnomalyRecord {
  id: string;
  buildingId: string;
  meterId: string | null;
  anomalyType: OperationalAnomalyType;
  severity: AlertSeverity;
  status: OperationalAnomalyStatus;
  confidenceBand: OperationalAnomalyConfidenceBand;
  confidenceScore: number | null;
  title: string;
  summary: string;
  explanation: string;
  causeHypothesis: string | null;
  detectionWindowStart: string;
  detectionWindowEnd: string;
  comparisonWindowStart: string | null;
  comparisonWindowEnd: string | null;
  reasonCodes: OperationalAnomalyReasonCode[];
  estimatedEnergyImpactKbtu: number | null;
  estimatedPenaltyImpactUsd: number | null;
  penaltyImpactStatus: OperationalAnomalyPenaltyImpactStatus;
  attribution: OperationalAnomalyAttribution;
  sourceRefs: OperationalAnomalySourceRef[];
  updatedAt: string;
  createdAt: string;
  building: {
    id: string;
    name: string;
    complianceCycle: ComplianceCycle;
  };
  meter: {
    id: string;
    name: string;
    meterType: MeterType;
  } | null;
}

export interface BuildingOperationalAnomalySummary {
  activeCount: number;
  highSeverityCount: number;
  totalEstimatedEnergyImpactKbtu: number | null;
  totalEstimatedPenaltyImpactUsd: number | null;
  penaltyImpactStatus: OperationalAnomalyPenaltyImpactStatus;
  highestPriority: OperationalPriority | null;
  latestDetectedAt: string | null;
  needsAttention: boolean;
  topAnomalies: Array<{
    id: string;
    anomalyType: OperationalAnomalyType;
    severity: AlertSeverity;
    confidenceBand: OperationalAnomalyConfidenceBand;
    title: string;
    explanation: string;
    estimatedEnergyImpactKbtu: number | null;
    estimatedPenaltyImpactUsd: number | null;
    penaltyImpactStatus: OperationalAnomalyPenaltyImpactStatus;
  }>;
}

interface BuildingInput {
  id: string;
  organizationId: string;
  name: string;
  grossSquareFeet: number;
  complianceCycle: ComplianceCycle;
}

interface MeterInput {
  id: string;
  name: string;
  meterType: MeterType;
  isActive: boolean;
}

interface EnergyReadingInput {
  id: string;
  meterId: string | null;
  meterType: MeterType;
  periodStart: Date;
  periodEnd: Date;
  consumptionKbtu: number;
}

interface ComplianceSnapshotInput {
  id: string;
  snapshotDate: Date;
  siteEui: number | null;
}

interface SyncStateInput {
  id: string;
}

interface DetectionInput {
  building: BuildingInput;
  meters: MeterInput[];
  readings: EnergyReadingInput[];
  latestSnapshot: ComplianceSnapshotInput | null;
  syncState: SyncStateInput | null;
  readinessSummary?: Pick<
    BuildingReadinessSummary,
    "state" | "primaryStatus" | "lastComplianceEvaluatedAt"
  > | null;
  penaltySummary?: Pick<
    PenaltySummary,
    "status" | "currentEstimatedPenalty" | "calculatedAt"
  > | null;
  now?: Date;
}

interface MonthlyBucket {
  key: string;
  start: Date;
  end: Date;
  totalKbtu: number;
  dailyKbtu: number;
  readingIds: string[];
  meterIds: string[];
}

function startOfUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex, 1));
}

function endOfUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
}

function addUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

function utcMonthKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(value: Date) {
  return {
    start: startOfUtcMonth(value.getUTCFullYear(), value.getUTCMonth()),
    end: endOfUtcMonth(value.getUTCFullYear(), value.getUTCMonth()),
  };
}

function daysBetweenInclusive(start: Date, end: Date) {
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1);
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function severityFromRatio(ratio: number): AlertSeverity {
  if (ratio >= 1.5) return "HIGH";
  if (ratio >= 1.25) return "MEDIUM";
  return "LOW";
}

function priorityFromSeverity(severity: AlertSeverity): OperationalPriority {
  if (severity === "CRITICAL") return "CRITICAL";
  if (severity === "HIGH") return "HIGH";
  if (severity === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function confidenceBandFromSeverity(
  severity: AlertSeverity,
): OperationalAnomalyConfidenceBand {
  if (severity === "CRITICAL" || severity === "HIGH") {
    return "HIGH";
  }
  if (severity === "MEDIUM") {
    return "MEDIUM";
  }
  return "LOW";
}

function confidenceScoreFromBand(band: OperationalAnomalyConfidenceBand) {
  switch (band) {
    case "HIGH":
      return 0.9;
    case "MEDIUM":
      return 0.72;
    default:
      return 0.55;
  }
}

function penaltyImpactFromContext(input: {
  estimatedSiteEuiDelta: number | null;
  latestSnapshot: ComplianceSnapshotInput | null;
  penaltySummary?: Pick<
    PenaltySummary,
    "status" | "currentEstimatedPenalty" | "calculatedAt"
  > | null;
}) {
  if (!input.penaltySummary || input.penaltySummary.status === "INSUFFICIENT_CONTEXT") {
    return {
      estimatedPenaltyImpactUsd: null,
      penaltyImpactStatus: "INSUFFICIENT_CONTEXT" as const,
      penaltyImpactExplanation:
        "No governed penalty run is available yet, so anomaly-to-penalty impact cannot be estimated.",
    };
  }

  if (input.penaltySummary.status === "NOT_APPLICABLE") {
    return {
      estimatedPenaltyImpactUsd: null,
      penaltyImpactStatus: "NOT_APPLICABLE" as const,
      penaltyImpactExplanation:
        "The latest governed penalty context is not applicable for this building, so anomaly penalty impact is not estimated.",
    };
  }

  const currentPenalty = input.penaltySummary.currentEstimatedPenalty;
  const latestSiteEui = input.latestSnapshot?.siteEui ?? null;
  if (
    currentPenalty == null ||
    currentPenalty <= 0 ||
    input.estimatedSiteEuiDelta == null ||
    input.estimatedSiteEuiDelta <= 0 ||
    latestSiteEui == null ||
    latestSiteEui <= 0
  ) {
    return {
      estimatedPenaltyImpactUsd: null,
      penaltyImpactStatus: "INSUFFICIENT_CONTEXT" as const,
      penaltyImpactExplanation:
        "The latest governed penalty run exists, but there is not enough positive EUI context to estimate incremental penalty impact from this anomaly.",
    };
  }

  const estimatedPenaltyImpactUsd = round(
    currentPenalty * Math.min(1, input.estimatedSiteEuiDelta / latestSiteEui),
    2,
  );

  return {
    estimatedPenaltyImpactUsd,
    penaltyImpactStatus: "ESTIMATED" as const,
    penaltyImpactExplanation:
      "Estimated by scaling the latest governed BEPS penalty exposure by the anomaly's implied site-EUI share of the latest compliance snapshot.",
  };
}

function buildDetectionHash(input: {
  anomalyType: OperationalAnomalyType;
  meterId: string | null;
  detectionWindowStart: Date;
  detectionWindowEnd: Date;
  reasonCodes: OperationalAnomalyReasonCode[];
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        anomalyType: input.anomalyType,
        meterId: input.meterId,
        detectionWindowStart: input.detectionWindowStart.toISOString(),
        detectionWindowEnd: input.detectionWindowEnd.toISOString(),
        reasonCodes: [...input.reasonCodes].sort(),
      }),
    )
    .digest("hex");
}

function buildAttribution(input: {
  building: BuildingInput;
  severity: AlertSeverity;
  estimatedEnergyImpactKbtu: number | null;
  anomalyType: OperationalAnomalyType;
  latestSnapshot: ComplianceSnapshotInput | null;
  readinessSummary?: Pick<
    BuildingReadinessSummary,
    "state" | "primaryStatus" | "lastComplianceEvaluatedAt"
  > | null;
  penaltySummary?: Pick<
    PenaltySummary,
    "status" | "currentEstimatedPenalty" | "calculatedAt"
  > | null;
}): OperationalAnomalyAttribution {
  const estimatedSiteEuiDelta =
    input.estimatedEnergyImpactKbtu != null && input.building.grossSquareFeet > 0
      ? round(input.estimatedEnergyImpactKbtu / input.building.grossSquareFeet, 4)
      : null;
  const penaltyImpact = penaltyImpactFromContext({
    estimatedSiteEuiDelta,
    latestSnapshot: input.latestSnapshot,
    penaltySummary: input.penaltySummary,
  });

  const dataQualityRisk =
    input.anomalyType === "MISSING_OR_SUSPECT_METER_DATA" ||
    input.anomalyType === "INCONSISTENT_METER_BEHAVIOR";

  return {
    estimatedEnergyImpactKbtu:
      input.estimatedEnergyImpactKbtu != null
        ? round(input.estimatedEnergyImpactKbtu, 2)
        : null,
    estimatedSiteEuiDelta,
    estimatedPenaltyImpactUsd: penaltyImpact.estimatedPenaltyImpactUsd,
    penaltyImpactStatus: penaltyImpact.penaltyImpactStatus,
    penaltyImpactExplanation: penaltyImpact.penaltyImpactExplanation,
    likelyBepsImpact: dataQualityRisk
      ? input.anomalyType === "INCONSISTENT_METER_BEHAVIOR"
        ? "METER_REVIEW_REQUIRED"
        : "DATA_QUALITY_RISK"
      : (input.estimatedEnergyImpactKbtu ?? 0) > 0
        ? "LIKELY_HIGHER_EUI_AND_WORSE_TRAJECTORY"
        : (input.estimatedEnergyImpactKbtu ?? 0) < 0
          ? "LIKELY_LOWER_EUI"
          : "NONE",
    likelyBenchmarkingImpact: dataQualityRisk
      ? "LIKELY_READINESS_BLOCKER"
      : input.anomalyType === "UNUSUAL_CONSUMPTION_SPIKE" ||
          input.anomalyType === "UNUSUAL_CONSUMPTION_DROP" ||
          input.anomalyType === "ABNORMAL_BASELOAD" ||
          input.anomalyType === "OFF_HOURS_SCHEDULE_DRIFT"
        ? "MAY_CHANGE_REPORTED_METRICS"
        : "NONE",
    operationalPriority: priorityFromSeverity(input.severity),
    latestSnapshotDate: input.latestSnapshot?.snapshotDate.toISOString() ?? null,
    latestSiteEui: input.latestSnapshot?.siteEui ?? null,
  };
}

function aggregateMonthlyBuckets(readings: EnergyReadingInput[]): MonthlyBucket[] {
  const buckets = new Map<string, MonthlyBucket>();

  for (const reading of readings) {
    const key = utcMonthKey(reading.periodEnd);
    const bounds = monthBounds(reading.periodEnd);
    const existing = buckets.get(key) ?? {
      key,
      start: bounds.start,
      end: bounds.end,
      totalKbtu: 0,
      dailyKbtu: 0,
      readingIds: [],
      meterIds: [],
    };

    existing.totalKbtu += reading.consumptionKbtu;
    existing.readingIds.push(reading.id);
    if (reading.meterId && !existing.meterIds.includes(reading.meterId)) {
      existing.meterIds.push(reading.meterId);
    }
    buckets.set(key, existing);
  }

  return Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      dailyKbtu: bucket.totalKbtu / daysBetweenInclusive(bucket.start, bucket.end),
    }))
    .sort((left, right) => left.start.getTime() - right.start.getTime());
}

function summarizeReadingCoverage(readings: EnergyReadingInput[]) {
  const sorted = [...readings].sort(
    (left, right) => left.periodStart.getTime() - right.periodStart.getTime(),
  );
  const gaps: Array<{ start: string; end: string; days: number }> = [];
  const overlaps: Array<{ start: string; end: string; days: number }> = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) {
      continue;
    }

    // Treat an exact boundary match as continuous coverage.
    if (current.periodStart < previous.periodEnd) {
      overlaps.push({
        start: current.periodStart.toISOString(),
        end: previous.periodEnd.toISOString(),
        days: daysBetweenInclusive(current.periodStart, previous.periodEnd),
      });
      continue;
    }

    const gapDays =
      Math.floor(
        (current.periodStart.getTime() - addUtcDays(previous.periodEnd, 1).getTime()) / DAY_MS,
      ) + 1;
    if (gapDays > 7) {
      gaps.push({
        start: addUtcDays(previous.periodEnd, 1).toISOString(),
        end: addUtcDays(current.periodStart, -1).toISOString(),
        days: gapDays,
      });
    }
  }

  return { gaps, overlaps };
}

function buildSourceRefs(input: {
  buildingId: string;
  meterId?: string | null;
  readingIds?: string[];
  latestSnapshotId?: string | null;
  syncStateId?: string | null;
}): OperationalAnomalySourceRef[] {
  const refs: OperationalAnomalySourceRef[] = [
    {
      recordType: "BUILDING",
      recordId: input.buildingId,
      label: "Building",
    },
  ];

  if (input.meterId) {
    refs.push({
      recordType: "METER",
      recordId: input.meterId,
      label: "Meter",
    });
  }

  for (const readingId of input.readingIds ?? []) {
    refs.push({
      recordType: "ENERGY_READING",
      recordId: readingId,
      label: "Energy reading",
    });
  }

  if (input.latestSnapshotId) {
    refs.push({
      recordType: "COMPLIANCE_SNAPSHOT",
      recordId: input.latestSnapshotId,
      label: "Latest compliance snapshot",
    });
  }

  if (input.syncStateId) {
    refs.push({
      recordType: "PORTFOLIO_MANAGER_SYNC_STATE",
      recordId: input.syncStateId,
      label: "Portfolio Manager sync state",
    });
  }

  return refs;
}

function pushCandidate(
  candidates: OperationalAnomalyCandidate[],
  input: Omit<
    OperationalAnomalyCandidate,
    "detectionHash" | "confidenceBand" | "confidenceScore"
  > & {
    confidenceBand?: OperationalAnomalyConfidenceBand;
    confidenceScore?: number;
  },
) {
  const confidenceBand = input.confidenceBand ?? confidenceBandFromSeverity(input.severity);
  candidates.push({
    ...input,
    confidenceBand,
    confidenceScore:
      input.confidenceScore ?? confidenceScoreFromBand(confidenceBand),
    detectionHash: buildDetectionHash({
      anomalyType: input.anomalyType,
      meterId: input.meterId,
      detectionWindowStart: input.detectionWindowStart,
      detectionWindowEnd: input.detectionWindowEnd,
      reasonCodes: input.reasonCodes,
    }),
  });
}

export function detectOperationalAnomaliesData(input: DetectionInput) {
  const now = input.now ?? new Date();
  const candidates: OperationalAnomalyCandidate[] = [];
  const activeMeters = input.meters.filter((meter) => meter.isActive);
  const buildingSeries = aggregateMonthlyBuckets(input.readings);
  const sharedAttributionContext = {
    building: input.building,
    latestSnapshot: input.latestSnapshot,
    readinessSummary: input.readinessSummary,
    penaltySummary: input.penaltySummary,
  };

  if (activeMeters.length === 0) {
    const detectionWindowStart = addUtcDays(now, -365);
    const detectionWindowEnd = now;
    const severity: AlertSeverity = "HIGH";
    pushCandidate(candidates, {
      anomalyType: "MISSING_OR_SUSPECT_METER_DATA",
      severity,
      meterId: null,
      title: "No active meters are linked to the building",
      summary:
        "Operational anomaly detection cannot rely on meter data because the building has no active linked meters.",
      detectionWindowStart,
      detectionWindowEnd,
      comparisonWindowStart: null,
      comparisonWindowEnd: null,
      basis: {
        activeMeterCount: 0,
        lookbackDays: 365,
      },
      reasonCodes: [OPERATIONAL_ANOMALY_REASON_CODES.noActiveMeters],
      estimatedEnergyImpactKbtu: null,
      attribution: buildAttribution({
        ...sharedAttributionContext,
        severity,
        estimatedEnergyImpactKbtu: null,
        anomalyType: "MISSING_OR_SUSPECT_METER_DATA",
      }),
      metadata: {
        explanation:
          "No active meter linkage exists, so the building cannot support reliable energy anomaly detection or meter-backed compliance review.",
        confidence: "HIGH",
        sourceRefs: buildSourceRefs({
          buildingId: input.building.id,
          latestSnapshotId: input.latestSnapshot?.id ?? null,
          syncStateId: input.syncState?.id ?? null,
        }),
      },
    });
  }

  for (const meter of activeMeters) {
    const meterReadings = input.readings.filter((reading) => reading.meterId === meter.id);
    const coverage = summarizeReadingCoverage(meterReadings);
    const reasonCodes: OperationalAnomalyReasonCode[] = [];

    if (meterReadings.length === 0) {
      reasonCodes.push(OPERATIONAL_ANOMALY_REASON_CODES.meterReadingsMissing);
    } else {
      if (meterReadings.length < 6) {
        reasonCodes.push(OPERATIONAL_ANOMALY_REASON_CODES.insufficientReadingHistory);
      }
      if (coverage.gaps.length > 0) {
        reasonCodes.push(OPERATIONAL_ANOMALY_REASON_CODES.coverageGap);
      }
      if (coverage.overlaps.length > 0) {
        reasonCodes.push(OPERATIONAL_ANOMALY_REASON_CODES.overlappingPeriods);
      }
      if (meterReadings.some((reading) => reading.consumptionKbtu <= 0)) {
        reasonCodes.push(OPERATIONAL_ANOMALY_REASON_CODES.suspectZeroUsage);
      }
    }

    if (reasonCodes.length > 0) {
      const detectionWindowStart =
        meterReadings[0]?.periodStart ?? addUtcDays(now, -365);
      const detectionWindowEnd = meterReadings.at(-1)?.periodEnd ?? now;
      const severity: AlertSeverity =
        reasonCodes.includes(OPERATIONAL_ANOMALY_REASON_CODES.coverageGap) ||
        reasonCodes.includes(OPERATIONAL_ANOMALY_REASON_CODES.overlappingPeriods) ||
        reasonCodes.includes(OPERATIONAL_ANOMALY_REASON_CODES.meterReadingsMissing)
          ? "HIGH"
          : "MEDIUM";

      pushCandidate(candidates, {
        anomalyType: "MISSING_OR_SUSPECT_METER_DATA",
        severity,
        meterId: meter.id,
        title: `${meter.name} has missing or suspect meter data`,
        summary:
          "The meter has incomplete, overlapping, or suspect billing-period readings that can distort operational and compliance analysis.",
        detectionWindowStart,
        detectionWindowEnd,
        comparisonWindowStart: null,
        comparisonWindowEnd: null,
        basis: {
          meterType: meter.meterType,
          readingCount: meterReadings.length,
          gapCount: coverage.gaps.length,
          overlapCount: coverage.overlaps.length,
          hasZeroOrNegativeUsage: meterReadings.some((reading) => reading.consumptionKbtu <= 0),
          gaps: coverage.gaps,
          overlaps: coverage.overlaps,
        },
        reasonCodes,
        estimatedEnergyImpactKbtu: null,
        attribution: buildAttribution({
          ...sharedAttributionContext,
          severity,
          estimatedEnergyImpactKbtu: null,
          anomalyType: "MISSING_OR_SUSPECT_METER_DATA",
        }),
        metadata: {
          explanation:
            "The anomaly is based on deterministic reading-quality checks over the meter's billing-period history.",
          confidence: "HIGH",
          sourceRefs: buildSourceRefs({
            buildingId: input.building.id,
            meterId: meter.id,
            readingIds: meterReadings.map((reading) => reading.id),
            latestSnapshotId: input.latestSnapshot?.id ?? null,
            syncStateId: input.syncState?.id ?? null,
          }),
        },
      });
    }
  }

  if (buildingSeries.length >= 4) {
    const latest = buildingSeries.at(-1) ?? null;
    const previous = buildingSeries.slice(-4, -1);

    if (latest && previous.length === 3) {
      const trailingAverage = average(previous.map((bucket) => bucket.dailyKbtu));
      if (trailingAverage != null && trailingAverage > 0) {
        const latestDailyKbtu = latest.dailyKbtu;
        const ratio = latestDailyKbtu / trailingAverage;
        const energyImpactKbtu =
          (latestDailyKbtu - trailingAverage) *
          daysBetweenInclusive(latest.start, latest.end);

        if (ratio >= 1.25 && energyImpactKbtu >= 1000) {
          const severity = severityFromRatio(ratio);
          pushCandidate(candidates, {
            anomalyType: "UNUSUAL_CONSUMPTION_SPIKE",
            severity,
            meterId: null,
            title: "Recent building energy use spiked above trend",
            summary:
              "The latest month of building energy use is materially above the trailing three-month billing-period average.",
            detectionWindowStart: latest.start,
            detectionWindowEnd: latest.end,
            comparisonWindowStart: previous[0]?.start ?? null,
            comparisonWindowEnd: previous.at(-1)?.end ?? null,
            basis: {
              latestMonth: latest.key,
              latestDailyKbtu: round(latestDailyKbtu, 2),
              trailingAverageDailyKbtu: round(trailingAverage, 2),
              ratio: round(ratio, 3),
            },
            reasonCodes: [OPERATIONAL_ANOMALY_REASON_CODES.consumptionSpike],
            estimatedEnergyImpactKbtu: round(energyImpactKbtu, 2),
            attribution: buildAttribution({
              ...sharedAttributionContext,
              severity,
              estimatedEnergyImpactKbtu: energyImpactKbtu,
              anomalyType: "UNUSUAL_CONSUMPTION_SPIKE",
            }),
            metadata: {
              explanation:
                "The detector compares the latest building-month daily-normalized kBtu against the prior three monthly buckets.",
              confidence: "HIGH",
              sourceRefs: buildSourceRefs({
                buildingId: input.building.id,
                readingIds: [
                  ...latest.readingIds,
                  ...previous.flatMap((bucket) => bucket.readingIds),
                ],
                latestSnapshotId: input.latestSnapshot?.id ?? null,
                syncStateId: input.syncState?.id ?? null,
              }),
            },
          });
        } else if (ratio <= 0.75 && Math.abs(energyImpactKbtu) >= 1000) {
          const severity: AlertSeverity = ratio <= 0.5 ? "HIGH" : "MEDIUM";
          pushCandidate(candidates, {
            anomalyType: "UNUSUAL_CONSUMPTION_DROP",
            severity,
            meterId: null,
            title: "Recent building energy use dropped below trend",
            summary:
              "The latest month of building energy use is materially below the trailing three-month billing-period average.",
            detectionWindowStart: latest.start,
            detectionWindowEnd: latest.end,
            comparisonWindowStart: previous[0]?.start ?? null,
            comparisonWindowEnd: previous.at(-1)?.end ?? null,
            basis: {
              latestMonth: latest.key,
              latestDailyKbtu: round(latestDailyKbtu, 2),
              trailingAverageDailyKbtu: round(trailingAverage, 2),
              ratio: round(ratio, 3),
            },
            reasonCodes: [OPERATIONAL_ANOMALY_REASON_CODES.consumptionDrop],
            estimatedEnergyImpactKbtu: round(energyImpactKbtu, 2),
            attribution: buildAttribution({
              ...sharedAttributionContext,
              severity,
              estimatedEnergyImpactKbtu: energyImpactKbtu,
              anomalyType: "UNUSUAL_CONSUMPTION_DROP",
            }),
            metadata: {
              explanation:
                "The detector compares the latest building-month daily-normalized kBtu against the prior three monthly buckets.",
              confidence: "HIGH",
              sourceRefs: buildSourceRefs({
                buildingId: input.building.id,
                readingIds: [
                  ...latest.readingIds,
                  ...previous.flatMap((bucket) => bucket.readingIds),
                ],
                latestSnapshotId: input.latestSnapshot?.id ?? null,
                syncStateId: input.syncState?.id ?? null,
              }),
            },
          });
        }
      }
    }
  }

  if (buildingSeries.length >= 12) {
    const comparison = buildingSeries.slice(-12, -6);
    const current = buildingSeries.slice(-6);
    const baselineLow = average(
      [...comparison]
        .sort((left, right) => left.dailyKbtu - right.dailyKbtu)
        .slice(0, 3)
        .map((bucket) => bucket.dailyKbtu),
    );
    const currentLow = average(
      [...current]
        .sort((left, right) => left.dailyKbtu - right.dailyKbtu)
        .slice(0, 3)
        .map((bucket) => bucket.dailyKbtu),
    );
    const baselineHigh = average(
      [...comparison]
        .sort((left, right) => right.dailyKbtu - left.dailyKbtu)
        .slice(0, 3)
        .map((bucket) => bucket.dailyKbtu),
    );
    const currentHigh = average(
      [...current]
        .sort((left, right) => right.dailyKbtu - left.dailyKbtu)
        .slice(0, 3)
        .map((bucket) => bucket.dailyKbtu),
    );

    if (
      baselineLow != null &&
      currentLow != null &&
      baselineHigh != null &&
      currentHigh != null &&
      baselineLow > 0 &&
      baselineHigh > 0 &&
      currentHigh > 0
    ) {
      const baseloadRatio = currentLow / baselineLow;
      const currentWindowDays = current.reduce(
        (sum, bucket) => sum + daysBetweenInclusive(bucket.start, bucket.end),
        0,
      );
      const baseloadImpactKbtu = (currentLow - baselineLow) * currentWindowDays;

      if (baseloadRatio >= 1.15 && baseloadImpactKbtu >= 5000) {
        const severity = severityFromRatio(baseloadRatio);
        pushCandidate(candidates, {
          anomalyType: "ABNORMAL_BASELOAD",
          severity,
          meterId: null,
          title: "Persistent baseload increased above prior operating pattern",
          summary:
            "Recent low-load months sit materially above the prior six-month low-load baseline, suggesting elevated persistent usage.",
          detectionWindowStart: current[0]?.start ?? now,
          detectionWindowEnd: current.at(-1)?.end ?? now,
          comparisonWindowStart: comparison[0]?.start ?? null,
          comparisonWindowEnd: comparison.at(-1)?.end ?? null,
          basis: {
            currentLowDailyKbtu: round(currentLow, 2),
            baselineLowDailyKbtu: round(baselineLow, 2),
            ratio: round(baseloadRatio, 3),
            currentWindowMonths: current.map((bucket) => bucket.key),
            comparisonWindowMonths: comparison.map((bucket) => bucket.key),
          },
          reasonCodes: [OPERATIONAL_ANOMALY_REASON_CODES.elevatedBaseload],
          estimatedEnergyImpactKbtu: round(baseloadImpactKbtu, 2),
          attribution: buildAttribution({
            ...sharedAttributionContext,
            severity,
            estimatedEnergyImpactKbtu: baseloadImpactKbtu,
            anomalyType: "ABNORMAL_BASELOAD",
          }),
          metadata: {
            explanation:
              "This is a persistent-baseload proxy derived from monthly billing periods because interval telemetry is not available in the current data model.",
            confidence: "MEDIUM",
            sourceRefs: buildSourceRefs({
              buildingId: input.building.id,
              readingIds: [
                ...comparison.flatMap((bucket) => bucket.readingIds),
                ...current.flatMap((bucket) => bucket.readingIds),
              ],
              latestSnapshotId: input.latestSnapshot?.id ?? null,
              syncStateId: input.syncState?.id ?? null,
            }),
          },
        });
      }

      const baselineProfileRatio = baselineLow / baselineHigh;
      const currentProfileRatio = currentLow / currentHigh;
      const scheduleDriftImpactKbtu = (currentLow - baselineLow) * currentWindowDays;

      if (
        currentProfileRatio >= 0.8 &&
        currentProfileRatio >= baselineProfileRatio + 0.15 &&
        currentLow >= baselineLow * 1.1 &&
        scheduleDriftImpactKbtu >= 5000
      ) {
        const severity: AlertSeverity = currentProfileRatio >= 0.9 ? "HIGH" : "MEDIUM";
        pushCandidate(candidates, {
          anomalyType: "OFF_HOURS_SCHEDULE_DRIFT",
          severity,
          meterId: null,
          title: "Load profile flattened in a way consistent with schedule drift",
          summary:
            "The recent monthly load profile is materially flatter than the prior six-month pattern, a proxy for off-hours or schedule-drift usage under billing-period data.",
          detectionWindowStart: current[0]?.start ?? now,
          detectionWindowEnd: current.at(-1)?.end ?? now,
          comparisonWindowStart: comparison[0]?.start ?? null,
          comparisonWindowEnd: comparison.at(-1)?.end ?? null,
          basis: {
            baselineProfileRatio: round(baselineProfileRatio, 3),
            currentProfileRatio: round(currentProfileRatio, 3),
            baselineLowDailyKbtu: round(baselineLow, 2),
            currentLowDailyKbtu: round(currentLow, 2),
            baselineHighDailyKbtu: round(baselineHigh, 2),
            currentHighDailyKbtu: round(currentHigh, 2),
          },
          reasonCodes: [
            OPERATIONAL_ANOMALY_REASON_CODES.flatterLoadProfile,
            OPERATIONAL_ANOMALY_REASON_CODES.scheduleDriftProxy,
          ],
          estimatedEnergyImpactKbtu: round(scheduleDriftImpactKbtu, 2),
          attribution: buildAttribution({
            ...sharedAttributionContext,
            severity,
            estimatedEnergyImpactKbtu: scheduleDriftImpactKbtu,
            anomalyType: "OFF_HOURS_SCHEDULE_DRIFT",
          }),
          metadata: {
            explanation:
              "Because the platform currently stores billing-period data instead of interval telemetry, this anomaly is an explicit schedule-drift proxy based on a flatter recent load profile.",
            confidence: "MEDIUM",
            sourceRefs: buildSourceRefs({
              buildingId: input.building.id,
              readingIds: [
                ...comparison.flatMap((bucket) => bucket.readingIds),
                ...current.flatMap((bucket) => bucket.readingIds),
              ],
              latestSnapshotId: input.latestSnapshot?.id ?? null,
              syncStateId: input.syncState?.id ?? null,
            }),
          },
        });
      }
    }
  }

  if (buildingSeries.length >= 4) {
    const buildingLatest = buildingSeries.at(-1) ?? null;
    const buildingTrailingAverage = average(
      buildingSeries.slice(-4, -1).map((bucket) => bucket.dailyKbtu),
    );

    if (buildingLatest && buildingTrailingAverage != null && buildingTrailingAverage > 0) {
      const buildingDeviation = Math.abs(
        (buildingLatest.dailyKbtu - buildingTrailingAverage) / buildingTrailingAverage,
      );

      for (const meter of activeMeters) {
        const meterSeries = aggregateMonthlyBuckets(
          input.readings.filter((reading) => reading.meterId === meter.id),
        );
        if (meterSeries.length < 4) {
          continue;
        }

        const meterLatest = meterSeries.at(-1) ?? null;
        const meterTrailingAverage = average(
          meterSeries.slice(-4, -1).map((bucket) => bucket.dailyKbtu),
        );

        if (!meterLatest || meterTrailingAverage == null || meterTrailingAverage <= 0) {
          continue;
        }

        const meterDeviation =
          (meterLatest.dailyKbtu - meterTrailingAverage) / meterTrailingAverage;

        if (Math.abs(meterDeviation) >= 0.6 && buildingDeviation <= 0.2) {
          const energyImpactKbtu =
            (meterLatest.dailyKbtu - meterTrailingAverage) *
            daysBetweenInclusive(meterLatest.start, meterLatest.end);
          const severity: AlertSeverity = Math.abs(meterDeviation) >= 1 ? "HIGH" : "MEDIUM";
          pushCandidate(candidates, {
            anomalyType: "INCONSISTENT_METER_BEHAVIOR",
            severity,
            meterId: meter.id,
            title: `${meter.name} diverged from the building trend`,
            summary:
              "One meter moved sharply away from its recent pattern while the building's aggregate usage stayed comparatively stable.",
            detectionWindowStart: meterLatest.start,
            detectionWindowEnd: meterLatest.end,
            comparisonWindowStart: meterSeries.slice(-4, -1)[0]?.start ?? null,
            comparisonWindowEnd: meterSeries.slice(-4, -1).at(-1)?.end ?? null,
            basis: {
              meterName: meter.name,
              meterType: meter.meterType,
              meterLatestDailyKbtu: round(meterLatest.dailyKbtu, 2),
              meterTrailingAverageDailyKbtu: round(meterTrailingAverage, 2),
              meterDeviationFraction: round(meterDeviation, 3),
              buildingLatestDailyKbtu: round(buildingLatest.dailyKbtu, 2),
              buildingTrailingAverageDailyKbtu: round(buildingTrailingAverage, 2),
              buildingDeviationFraction: round(buildingDeviation, 3),
            },
            reasonCodes: [OPERATIONAL_ANOMALY_REASON_CODES.meterDivergesFromBuildingTrend],
            estimatedEnergyImpactKbtu: round(energyImpactKbtu, 2),
            attribution: buildAttribution({
              ...sharedAttributionContext,
              severity,
              estimatedEnergyImpactKbtu: energyImpactKbtu,
              anomalyType: "INCONSISTENT_METER_BEHAVIOR",
            }),
            metadata: {
              explanation:
                "The meter-level daily-normalized monthly series diverged materially from its trailing average without a similar change at the whole-building level.",
              confidence: "MEDIUM",
              sourceRefs: buildSourceRefs({
                buildingId: input.building.id,
                meterId: meter.id,
                readingIds: [
                  ...meterSeries.slice(-4).flatMap((bucket) => bucket.readingIds),
                  ...buildingSeries.slice(-4).flatMap((bucket) => bucket.readingIds),
                ],
                latestSnapshotId: input.latestSnapshot?.id ?? null,
                syncStateId: input.syncState?.id ?? null,
              }),
            },
          });
        }
      }
    }
  }

  return candidates;
}

function anomalySortWeight(anomaly: {
  severity: AlertSeverity;
  updatedAt?: Date;
  detectionWindowEnd?: Date;
}) {
  const severityWeight =
    anomaly.severity === "CRITICAL"
      ? 4
      : anomaly.severity === "HIGH"
        ? 3
        : anomaly.severity === "MEDIUM"
          ? 2
          : 1;
  return (
    severityWeight * 10000000000000 +
    (anomaly.updatedAt ?? anomaly.detectionWindowEnd ?? new Date(0)).getTime()
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function defaultCauseHypothesis(anomalyType: OperationalAnomalyType) {
  switch (anomalyType) {
    case "ABNORMAL_BASELOAD":
      return "Persistent base load has risen relative to the prior operating pattern.";
    case "OFF_HOURS_SCHEDULE_DRIFT":
      return "The building may be running longer hours or missing expected setback behavior.";
    case "UNUSUAL_CONSUMPTION_SPIKE":
      return "A recent operational or data change increased energy use above the trailing pattern.";
    case "UNUSUAL_CONSUMPTION_DROP":
      return "A recent operational or data change reduced energy use below the trailing pattern.";
    case "MISSING_OR_SUSPECT_METER_DATA":
      return "Coverage, overlap, or meter linkage problems are degrading the input signal.";
    case "INCONSISTENT_METER_BEHAVIOR":
      return "One meter is deviating from the building trend and may need linkage or system review.";
  }
}

function parseSourceRefs(metadata: unknown) {
  const metadataRecord = asRecord(metadata);
  const refs = Array.isArray(metadataRecord?.sourceRefs) ? metadataRecord.sourceRefs : [];
  return refs
    .map((ref) => {
      const record = asRecord(ref);
      const recordType = asString(record?.recordType);
      const recordId = asString(record?.recordId);
      const label = asString(record?.label);
      if (!recordType || !recordId || !label) {
        return null;
      }

      return {
        recordType,
        recordId,
        label,
      } as OperationalAnomalySourceRef;
    })
    .filter((ref): ref is OperationalAnomalySourceRef => ref !== null);
}

function parseAttribution(
  anomaly: Pick<
    OperationalAnomalyRecord,
    never
  > & {
    attributionJson: unknown;
    estimatedEnergyImpactKbtu: number | null;
    estimatedPenaltyImpactUsd: number | null;
    penaltyImpactStatus: OperationalAnomalyPenaltyImpactStatus;
  },
): OperationalAnomalyAttribution {
  const attributionRecord = asRecord(anomaly.attributionJson) ?? {};
  const latestSnapshotDate = asString(attributionRecord.latestSnapshotDate);
  const latestSiteEui = asNumber(attributionRecord.latestSiteEui);

  return {
    estimatedEnergyImpactKbtu:
      anomaly.estimatedEnergyImpactKbtu ??
      asNumber(attributionRecord.estimatedEnergyImpactKbtu),
    estimatedSiteEuiDelta: asNumber(attributionRecord.estimatedSiteEuiDelta),
    estimatedPenaltyImpactUsd:
      anomaly.estimatedPenaltyImpactUsd ??
      asNumber(attributionRecord.estimatedPenaltyImpactUsd),
    penaltyImpactStatus: anomaly.penaltyImpactStatus,
    penaltyImpactExplanation:
      asString(attributionRecord.penaltyImpactExplanation) ??
      "Penalty impact was not explained for this anomaly.",
    likelyBepsImpact:
      attributionRecord.likelyBepsImpact === "LIKELY_HIGHER_EUI_AND_WORSE_TRAJECTORY" ||
      attributionRecord.likelyBepsImpact === "LIKELY_LOWER_EUI" ||
      attributionRecord.likelyBepsImpact === "DATA_QUALITY_RISK" ||
      attributionRecord.likelyBepsImpact === "METER_REVIEW_REQUIRED"
        ? attributionRecord.likelyBepsImpact
        : "NONE",
    likelyBenchmarkingImpact:
      attributionRecord.likelyBenchmarkingImpact === "LIKELY_READINESS_BLOCKER" ||
      attributionRecord.likelyBenchmarkingImpact === "MAY_CHANGE_REPORTED_METRICS"
        ? attributionRecord.likelyBenchmarkingImpact
        : "NONE",
    operationalPriority:
      attributionRecord.operationalPriority === "CRITICAL" ||
      attributionRecord.operationalPriority === "HIGH" ||
      attributionRecord.operationalPriority === "MEDIUM"
        ? attributionRecord.operationalPriority
        : "LOW",
    latestSnapshotDate,
    latestSiteEui,
  };
}

function normalizeOperationalAnomaly(anomaly: {
  id: string;
  buildingId: string;
  meterId: string | null;
  anomalyType: OperationalAnomalyType;
  severity: AlertSeverity;
  status: OperationalAnomalyStatus;
  confidenceBand: OperationalAnomalyConfidenceBand;
  confidenceScore: number | null;
  title: string;
  summary: string;
  detectionWindowStart: Date;
  detectionWindowEnd: Date;
  comparisonWindowStart: Date | null;
  comparisonWindowEnd: Date | null;
  reasonCodesJson: unknown;
  estimatedEnergyImpactKbtu: number | null;
  estimatedPenaltyImpactUsd: number | null;
  penaltyImpactStatus: OperationalAnomalyPenaltyImpactStatus;
  attributionJson: unknown;
  metadata: unknown;
  updatedAt: Date;
  createdAt: Date;
  building: {
    id: string;
    name: string;
    complianceCycle: ComplianceCycle;
  };
  meter: {
    id: string;
    name: string;
    meterType: MeterType;
  } | null;
}): OperationalAnomalyRecord {
  const metadata = asRecord(anomaly.metadata) ?? {};
  const explanation =
    asString(metadata.explanation) ?? anomaly.summary;
  const attribution = parseAttribution({
    attributionJson: anomaly.attributionJson,
    estimatedEnergyImpactKbtu: anomaly.estimatedEnergyImpactKbtu,
    estimatedPenaltyImpactUsd: anomaly.estimatedPenaltyImpactUsd,
    penaltyImpactStatus: anomaly.penaltyImpactStatus,
  });
  const reasonCodes = Array.isArray(anomaly.reasonCodesJson)
    ? anomaly.reasonCodesJson.filter(
        (reasonCode): reasonCode is OperationalAnomalyReasonCode =>
          typeof reasonCode === "string",
      )
    : [];

  return {
    id: anomaly.id,
    buildingId: anomaly.buildingId,
    meterId: anomaly.meterId,
    anomalyType: anomaly.anomalyType,
    severity: anomaly.severity,
    status: anomaly.status,
    confidenceBand: anomaly.confidenceBand,
    confidenceScore: anomaly.confidenceScore,
    title: anomaly.title,
    summary: anomaly.summary,
    explanation,
    causeHypothesis:
      asString(metadata.causeHypothesis) ??
      defaultCauseHypothesis(anomaly.anomalyType),
    detectionWindowStart: anomaly.detectionWindowStart.toISOString(),
    detectionWindowEnd: anomaly.detectionWindowEnd.toISOString(),
    comparisonWindowStart: anomaly.comparisonWindowStart?.toISOString() ?? null,
    comparisonWindowEnd: anomaly.comparisonWindowEnd?.toISOString() ?? null,
    reasonCodes,
    estimatedEnergyImpactKbtu: anomaly.estimatedEnergyImpactKbtu,
    estimatedPenaltyImpactUsd: anomaly.estimatedPenaltyImpactUsd,
    penaltyImpactStatus: anomaly.penaltyImpactStatus,
    attribution,
    sourceRefs: parseSourceRefs(anomaly.metadata),
    updatedAt: anomaly.updatedAt.toISOString(),
    createdAt: anomaly.createdAt.toISOString(),
    building: {
      id: anomaly.building.id,
      name: anomaly.building.name,
      complianceCycle: anomaly.building.complianceCycle,
    },
    meter: anomaly.meter
      ? {
          id: anomaly.meter.id,
          name: anomaly.meter.name,
          meterType: anomaly.meter.meterType,
        }
      : null,
  };
}

function summarizeOperationalAnomalies(
  anomalies: OperationalAnomalyRecord[],
): BuildingOperationalAnomalySummary {
  if (anomalies.length === 0) {
    return {
      activeCount: 0,
      highSeverityCount: 0,
      totalEstimatedEnergyImpactKbtu: null,
      totalEstimatedPenaltyImpactUsd: null,
      penaltyImpactStatus: "INSUFFICIENT_CONTEXT",
      highestPriority: null,
      latestDetectedAt: null,
      needsAttention: false,
      topAnomalies: [],
    };
  }

  const totalEstimatedEnergyImpactKbtu = anomalies.reduce<number | null>((sum, anomaly) => {
    if (anomaly.estimatedEnergyImpactKbtu == null) {
      return sum;
    }
    return (sum ?? 0) + anomaly.estimatedEnergyImpactKbtu;
  }, null);
  const estimatedPenaltyAnomalies = anomalies.filter(
    (anomaly) => anomaly.penaltyImpactStatus === "ESTIMATED",
  );
  const totalEstimatedPenaltyImpactUsd =
    estimatedPenaltyAnomalies.length === 0
      ? null
      : round(
          estimatedPenaltyAnomalies.reduce(
            (sum, anomaly) => sum + (anomaly.estimatedPenaltyImpactUsd ?? 0),
            0,
          ),
          2,
        );
  const priorityWeight = (value: OperationalPriority | null) => {
    switch (value) {
      case "CRITICAL":
        return 4;
      case "HIGH":
        return 3;
      case "MEDIUM":
        return 2;
      case "LOW":
        return 1;
      default:
        return 0;
    }
  };
  const highestPriority = anomalies
    .map((anomaly) => anomaly.attribution.operationalPriority)
    .sort((left, right) => priorityWeight(left) - priorityWeight(right))
    .at(-1) ?? null;

  return {
    activeCount: anomalies.length,
    highSeverityCount: anomalies.filter(
      (anomaly) => anomaly.severity === "HIGH" || anomaly.severity === "CRITICAL",
    ).length,
    totalEstimatedEnergyImpactKbtu,
    totalEstimatedPenaltyImpactUsd,
    penaltyImpactStatus:
      estimatedPenaltyAnomalies.length > 0 ? "ESTIMATED" : anomalies.every(
        (anomaly) => anomaly.penaltyImpactStatus === "NOT_APPLICABLE",
      )
        ? "NOT_APPLICABLE"
        : "INSUFFICIENT_CONTEXT",
    highestPriority,
    latestDetectedAt:
      [...anomalies]
        .map((anomaly) => anomaly.detectionWindowEnd)
        .sort()
        .at(-1) ?? null,
    needsAttention: anomalies.some(
      (anomaly) =>
        anomaly.severity === "HIGH" ||
        anomaly.severity === "CRITICAL" ||
        anomaly.penaltyImpactStatus === "ESTIMATED",
    ),
    topAnomalies: anomalies.slice(0, 3).map((anomaly) => ({
      id: anomaly.id,
      anomalyType: anomaly.anomalyType,
      severity: anomaly.severity,
      confidenceBand: anomaly.confidenceBand,
      title: anomaly.title,
      explanation: anomaly.explanation,
      estimatedEnergyImpactKbtu: anomaly.estimatedEnergyImpactKbtu,
      estimatedPenaltyImpactUsd: anomaly.estimatedPenaltyImpactUsd,
      penaltyImpactStatus: anomaly.penaltyImpactStatus,
    })),
  };
}

export async function listBuildingOperationalAnomalySummaries(params: {
  organizationId: string;
  buildingIds: string[];
}) {
  const buildingIds = Array.from(new Set(params.buildingIds)).filter(Boolean);
  if (buildingIds.length === 0) {
    return new Map<string, BuildingOperationalAnomalySummary>();
  }

  const anomalies = await listOperationalAnomalies({
    organizationId: params.organizationId,
    includeDismissed: false,
    buildingIds,
    limit: 500,
  });

  const byBuildingId = new Map<string, OperationalAnomalyRecord[]>();
  for (const anomaly of anomalies) {
    const current = byBuildingId.get(anomaly.buildingId) ?? [];
    current.push(anomaly);
    byBuildingId.set(anomaly.buildingId, current);
  }

  return new Map(
    buildingIds.map((buildingId) => [
      buildingId,
      summarizeOperationalAnomalies(byBuildingId.get(buildingId) ?? []),
    ]),
  );
}

export async function refreshOperationalAnomaliesForBuilding(params: {
  organizationId: string;
  buildingId: string;
  lookbackMonths?: number;
}) {
  const now = new Date();
  const lookbackMonths = params.lookbackMonths ?? 18;
  const lookbackStart = startOfUtcMonth(
    now.getUTCFullYear(),
    now.getUTCMonth() - lookbackMonths,
  );

  const [
    building,
    meters,
    readings,
    latestSnapshot,
    syncState,
    operationalState,
    storedPenaltySummaries,
  ] = await Promise.all([
    prisma.building.findFirst({
      where: {
        id: params.buildingId,
        organizationId: params.organizationId,
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        grossSquareFeet: true,
        complianceCycle: true,
      },
    }),
    prisma.meter.findMany({
      where: {
        buildingId: params.buildingId,
        organizationId: params.organizationId,
      },
      select: {
        id: true,
        name: true,
        meterType: true,
        isActive: true,
      },
    }),
    prisma.energyReading.findMany({
      where: {
        buildingId: params.buildingId,
        organizationId: params.organizationId,
        periodEnd: {
          gte: lookbackStart,
        },
      },
      orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }],
      select: {
        id: true,
        meterId: true,
        meterType: true,
        periodStart: true,
        periodEnd: true,
        consumptionKbtu: true,
      },
    }),
    getLatestComplianceSnapshot(prisma, {
      buildingId: params.buildingId,
      organizationId: params.organizationId,
      select: {
        id: true,
        snapshotDate: true,
        siteEui: true,
      },
    }),
    prisma.portfolioManagerSyncState.findFirst({
      where: {
        buildingId: params.buildingId,
        organizationId: params.organizationId,
      },
      select: {
        id: true,
      },
    }),
    getBuildingOperationalState({
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    }),
    listStoredPenaltySummaries({
      organizationId: params.organizationId,
      buildingIds: [params.buildingId],
    }),
  ]);

  if (!building) {
    throw new Error("Building not found for operational anomaly refresh");
  }

  const candidates = detectOperationalAnomaliesData({
    building,
    meters,
    readings,
    latestSnapshot,
    syncState,
    readinessSummary: operationalState.readinessSummary,
    penaltySummary: storedPenaltySummaries[0]?.summary ?? null,
    now,
  });

  const existing = await prisma.operationalAnomaly.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    },
    select: {
      detectionHash: true,
      status: true,
      acknowledgedAt: true,
      acknowledgedById: true,
      acknowledgedByType: true,
      dismissedAt: true,
      dismissedById: true,
      dismissedByType: true,
    },
  });
  const existingByHash = new Map(existing.map((anomaly) => [anomaly.detectionHash, anomaly]));
  const currentHashes = candidates.map((candidate) => candidate.detectionHash);

  await prisma.$transaction(async (tx) => {
    if (currentHashes.length === 0) {
      await tx.operationalAnomaly.deleteMany({
        where: {
          organizationId: params.organizationId,
          buildingId: params.buildingId,
        },
      });
      return;
    }

    await tx.operationalAnomaly.deleteMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        detectionHash: {
          notIn: currentHashes,
        },
      },
    });

    for (const candidate of candidates) {
      const prior = existingByHash.get(candidate.detectionHash);
      await tx.operationalAnomaly.upsert({
        where: {
          buildingId_detectionHash: {
            buildingId: params.buildingId,
            detectionHash: candidate.detectionHash,
          },
        },
        create: {
          organizationId: params.organizationId,
          buildingId: params.buildingId,
          meterId: candidate.meterId,
          anomalyType: candidate.anomalyType,
          severity: candidate.severity,
          status: "ACTIVE",
          confidenceBand: candidate.confidenceBand,
          confidenceScore: candidate.confidenceScore,
          detectionHash: candidate.detectionHash,
          title: candidate.title,
          summary: candidate.summary,
          detectionWindowStart: candidate.detectionWindowStart,
          detectionWindowEnd: candidate.detectionWindowEnd,
          comparisonWindowStart: candidate.comparisonWindowStart,
          comparisonWindowEnd: candidate.comparisonWindowEnd,
          basisJson: candidate.basis as Prisma.InputJsonValue,
          reasonCodesJson: candidate.reasonCodes as unknown as Prisma.InputJsonValue,
          estimatedEnergyImpactKbtu: candidate.estimatedEnergyImpactKbtu,
          estimatedPenaltyImpactUsd: candidate.attribution.estimatedPenaltyImpactUsd,
          penaltyImpactStatus: candidate.attribution.penaltyImpactStatus,
          attributionJson: candidate.attribution as unknown as Prisma.InputJsonValue,
          metadata: candidate.metadata as Prisma.InputJsonValue,
        },
        update: {
          meterId: candidate.meterId,
          anomalyType: candidate.anomalyType,
          severity: candidate.severity,
          status: prior?.status ?? "ACTIVE",
          confidenceBand: candidate.confidenceBand,
          confidenceScore: candidate.confidenceScore,
          title: candidate.title,
          summary: candidate.summary,
          detectionWindowStart: candidate.detectionWindowStart,
          detectionWindowEnd: candidate.detectionWindowEnd,
          comparisonWindowStart: candidate.comparisonWindowStart,
          comparisonWindowEnd: candidate.comparisonWindowEnd,
          basisJson: candidate.basis as Prisma.InputJsonValue,
          reasonCodesJson: candidate.reasonCodes as unknown as Prisma.InputJsonValue,
          estimatedEnergyImpactKbtu: candidate.estimatedEnergyImpactKbtu,
          estimatedPenaltyImpactUsd: candidate.attribution.estimatedPenaltyImpactUsd,
          penaltyImpactStatus: candidate.attribution.penaltyImpactStatus,
          attributionJson: candidate.attribution as unknown as Prisma.InputJsonValue,
          metadata: candidate.metadata as Prisma.InputJsonValue,
          acknowledgedAt: prior?.acknowledgedAt ?? null,
          acknowledgedById: prior?.acknowledgedById ?? null,
          acknowledgedByType: prior?.acknowledgedByType ?? null,
          dismissedAt: prior?.dismissedAt ?? null,
          dismissedById: prior?.dismissedById ?? null,
          dismissedByType: prior?.dismissedByType ?? null,
        },
      });
    }
  });

  return listOperationalAnomalies({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
  });
}

export async function listOperationalAnomalies(params: {
  organizationId: string;
  buildingId?: string;
  buildingIds?: string[];
  includeDismissed?: boolean;
  limit?: number;
}) {
  const anomalies = await prisma.operationalAnomaly.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.buildingId ? { buildingId: params.buildingId } : {}),
      ...(params.buildingIds?.length
        ? {
            buildingId: {
              in: params.buildingIds,
            },
          }
        : {}),
      ...(params.includeDismissed ? {} : { status: { not: "DISMISSED" } }),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: params.limit ?? 100,
    include: {
      building: {
        select: {
          id: true,
          name: true,
          complianceCycle: true,
        },
      },
      meter: {
        select: {
          id: true,
          name: true,
          meterType: true,
        },
      },
    },
  });

  return anomalies
    .sort((left, right) => anomalySortWeight(right) - anomalySortWeight(left))
    .map(normalizeOperationalAnomaly);
}

export async function getOperationalAnomalyDetail(params: {
  organizationId: string;
  anomalyId: string;
}) {
  const anomaly = await prisma.operationalAnomaly.findFirst({
    where: {
      id: params.anomalyId,
      organizationId: params.organizationId,
    },
    include: {
      building: {
        select: {
          id: true,
          name: true,
          complianceCycle: true,
          grossSquareFeet: true,
        },
      },
      meter: {
        select: {
          id: true,
          name: true,
          meterType: true,
        },
      },
    },
  });

  return anomaly ? normalizeOperationalAnomaly(anomaly) : null;
}

export async function updateOperationalAnomalyStatus(params: {
  organizationId: string;
  anomalyId: string;
  nextStatus: Extract<OperationalAnomalyStatus, "ACKNOWLEDGED" | "DISMISSED">;
  actorType: ActorType;
  actorId?: string | null;
}) {
  const anomaly = await prisma.operationalAnomaly.findFirst({
    where: {
      id: params.anomalyId,
      organizationId: params.organizationId,
    },
    select: {
      id: true,
    },
  });

  if (!anomaly) {
    throw new Error("Operational anomaly not found");
  }

  const updated = await prisma.operationalAnomaly.update({
    where: {
      id: params.anomalyId,
    },
    data: {
      status: params.nextStatus,
      acknowledgedAt:
        params.nextStatus === "ACKNOWLEDGED" ? new Date() : null,
      acknowledgedByType:
        params.nextStatus === "ACKNOWLEDGED" ? params.actorType : null,
      acknowledgedById:
        params.nextStatus === "ACKNOWLEDGED" ? params.actorId ?? null : null,
      dismissedAt: params.nextStatus === "DISMISSED" ? new Date() : null,
      dismissedByType:
        params.nextStatus === "DISMISSED" ? params.actorType : null,
      dismissedById:
        params.nextStatus === "DISMISSED" ? params.actorId ?? null : null,
    },
    include: {
      building: {
        select: {
          id: true,
          name: true,
          complianceCycle: true,
        },
      },
      meter: {
        select: {
          id: true,
          name: true,
          meterType: true,
        },
      },
    },
  });

  return normalizeOperationalAnomaly(updated);
}
