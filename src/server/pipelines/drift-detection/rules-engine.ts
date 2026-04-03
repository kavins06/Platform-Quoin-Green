/**
 * Drift Detection Rules Engine
 *
 * Deterministic rules for detecting energy consumption anomalies.
 * No LLM — all thresholds and checks are pure TypeScript.
 *
 * Rules from CLAUDE.md:
 * 1. EUI Spike: consumption > baseline + 2σ
 * 2. Score Drop: ENERGY STAR score drops ≥3 points
 * 3. Consumption Anomaly: 3x typical monthly consumption
 * 4. Seasonal Deviation: ±20% from same month year-over-year
 * 5. Sustained Drift: 7+ consecutive days >15% above baseline
 */

export type DriftRuleId =
  | "EUI_SPIKE"
  | "SCORE_DROP"
  | "CONSUMPTION_ANOMALY"
  | "SEASONAL_DEVIATION"
  | "SUSTAINED_DRIFT";

export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface DriftAlert {
  ruleId: DriftRuleId;
  severity: AlertSeverity;
  title: string;
  description: string;
  currentValue: number;
  threshold: number;
  buildingId: string;
  detectedAt: Date;
}

export interface MonthlyReading {
  periodStart: Date;
  consumptionKbtu: number;
  meterType: string;
}

export interface DriftDetectionInput {
  buildingId: string;
  currentReadings: MonthlyReading[];
  historicalReadings: MonthlyReading[];
  currentScore: number | null;
  previousScore: number | null;
  baselineSiteEui: number | null;
  currentSiteEui: number | null;
  grossSquareFeet: number;
}

/**
 * Run all drift detection rules against building data.
 * Returns all triggered alerts.
 */
export function detectDrift(input: DriftDetectionInput): DriftAlert[] {
  const alerts: DriftAlert[] = [];
  const now = new Date();

  const euiSpike = checkEuiSpike(input, now);
  if (euiSpike) alerts.push(euiSpike);

  const scoreDrop = checkScoreDrop(input, now);
  if (scoreDrop) alerts.push(scoreDrop);

  const anomalies = checkConsumptionAnomaly(input, now);
  alerts.push(...anomalies);

  const seasonal = checkSeasonalDeviation(input, now);
  alerts.push(...seasonal);

  const sustained = checkSustainedDrift(input, now);
  if (sustained) alerts.push(sustained);

  return alerts;
}

/**
 * Rule 1: EUI Spike — current EUI > mean + 2σ of historical EUI
 */
function checkEuiSpike(
  input: DriftDetectionInput,
  now: Date,
): DriftAlert | null {
  if (!input.currentSiteEui || input.historicalReadings.length < 6) return null;

  const monthlyEuis = computeMonthlyEuis(
    input.historicalReadings,
    input.grossSquareFeet,
  );
  if (monthlyEuis.length < 6) return null;

  const mean = monthlyEuis.reduce((s, v) => s + v, 0) / monthlyEuis.length;
  const variance =
    monthlyEuis.reduce((s, v) => s + Math.pow(v - mean, 2), 0) /
    monthlyEuis.length;
  const stddev = Math.sqrt(variance);
  const threshold = mean + 2 * stddev;

  if (input.currentSiteEui > threshold) {
    return {
      ruleId: "EUI_SPIKE",
      severity: input.currentSiteEui > mean + 3 * stddev ? "CRITICAL" : "HIGH",
      title: "EUI Spike Detected",
      description:
        `Current Site EUI ${input.currentSiteEui.toFixed(1)} kBtu/ft² exceeds ` +
        `2σ threshold of ${threshold.toFixed(1)} (mean: ${mean.toFixed(1)}, σ: ${stddev.toFixed(1)}).`,
      currentValue: input.currentSiteEui,
      threshold,
      buildingId: input.buildingId,
      detectedAt: now,
    };
  }

  return null;
}

/**
 * Rule 2: Score Drop — ENERGY STAR score dropped ≥3 points
 */
function checkScoreDrop(
  input: DriftDetectionInput,
  now: Date,
): DriftAlert | null {
  if (input.currentScore === null || input.previousScore === null) return null;
  const drop = input.previousScore - input.currentScore;
  if (drop < 3) return null;

  const severity: AlertSeverity =
    drop >= 10 ? "CRITICAL" : drop >= 5 ? "HIGH" : "MEDIUM";

  return {
    ruleId: "SCORE_DROP",
    severity,
    title: "ENERGY STAR Score Drop",
    description:
      `Score dropped ${drop} points from ${input.previousScore} to ${input.currentScore}.`,
    currentValue: input.currentScore,
    threshold: input.previousScore - 3,
    buildingId: input.buildingId,
    detectedAt: now,
  };
}

/**
 * Rule 3: Consumption Anomaly — any month has 3x typical consumption
 */
function checkConsumptionAnomaly(
  input: DriftDetectionInput,
  now: Date,
): DriftAlert[] {
  const alerts: DriftAlert[] = [];
  if (input.historicalReadings.length < 3) return alerts;

  const avgConsumption =
    input.historicalReadings.reduce((s, r) => s + r.consumptionKbtu, 0) /
    input.historicalReadings.length;
  const threshold = avgConsumption * 3;

  for (const reading of input.currentReadings) {
    if (reading.consumptionKbtu > threshold) {
      alerts.push({
        ruleId: "CONSUMPTION_ANOMALY",
        severity: "HIGH",
        title: "Consumption Anomaly",
        description:
          `Monthly consumption ${Math.round(reading.consumptionKbtu).toLocaleString()} kBtu is ` +
          `${(reading.consumptionKbtu / avgConsumption).toFixed(1)}x the historical average ` +
          `of ${Math.round(avgConsumption).toLocaleString()} kBtu (threshold: 3x).`,
        currentValue: reading.consumptionKbtu,
        threshold,
        buildingId: input.buildingId,
        detectedAt: now,
      });
    }
  }

  return alerts;
}

/**
 * Rule 4: Seasonal Deviation — consumption ±20% from same month last year
 */
function checkSeasonalDeviation(
  input: DriftDetectionInput,
  now: Date,
): DriftAlert[] {
  const alerts: DriftAlert[] = [];
  const historicalByMonth = groupByMonth(input.historicalReadings);

  for (const reading of input.currentReadings) {
    const month = reading.periodStart.getUTCMonth();
    const sameMonthHistory = historicalByMonth.get(month);
    if (!sameMonthHistory || sameMonthHistory.length === 0) continue;

    const avgSameMonth =
      sameMonthHistory.reduce((s, r) => s + r.consumptionKbtu, 0) /
      sameMonthHistory.length;

    if (avgSameMonth === 0) continue;

    const deviationPct =
      ((reading.consumptionKbtu - avgSameMonth) / avgSameMonth) * 100;

    if (Math.abs(deviationPct) > 20) {
      const direction = deviationPct > 0 ? "above" : "below";
      alerts.push({
        ruleId: "SEASONAL_DEVIATION",
        severity: Math.abs(deviationPct) > 40 ? "HIGH" : "MEDIUM",
        title: "Seasonal Deviation",
        description:
          `Month ${month + 1} consumption is ${Math.abs(deviationPct).toFixed(0)}% ` +
          `${direction} same-month historical average.`,
        currentValue: reading.consumptionKbtu,
        threshold: avgSameMonth * (deviationPct > 0 ? 1.2 : 0.8),
        buildingId: input.buildingId,
        detectedAt: now,
      });
    }
  }

  return alerts;
}

/**
 * Rule 5: Sustained Drift — 7+ consecutive readings >15% above baseline
 */
function checkSustainedDrift(
  input: DriftDetectionInput,
  now: Date,
): DriftAlert | null {
  if (!input.baselineSiteEui || input.currentReadings.length < 7) return null;

  const baselineMonthlyKbtu =
    (input.baselineSiteEui * input.grossSquareFeet) / 12;
  const driftThreshold = baselineMonthlyKbtu * 1.15;

  let consecutiveAbove = 0;
  for (const reading of input.currentReadings) {
    if (reading.consumptionKbtu > driftThreshold) {
      consecutiveAbove++;
    } else {
      consecutiveAbove = 0;
    }
  }

  if (consecutiveAbove >= 7) {
    return {
      ruleId: "SUSTAINED_DRIFT",
      severity: "CRITICAL",
      title: "Sustained Energy Drift",
      description:
        `${consecutiveAbove} consecutive periods with consumption >15% above baseline ` +
        `(baseline monthly: ${Math.round(baselineMonthlyKbtu).toLocaleString()} kBtu, ` +
        `threshold: ${Math.round(driftThreshold).toLocaleString()} kBtu).`,
      currentValue: consecutiveAbove,
      threshold: 7,
      buildingId: input.buildingId,
      detectedAt: now,
    };
  }

  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeMonthlyEuis(
  readings: MonthlyReading[],
  grossSquareFeet: number,
): number[] {
  if (grossSquareFeet <= 0) return [];
  return readings.map((r) => r.consumptionKbtu / grossSquareFeet);
}

function groupByMonth(
  readings: MonthlyReading[],
): Map<number, MonthlyReading[]> {
  const map = new Map<number, MonthlyReading[]>();
  for (const r of readings) {
    const month = r.periodStart.getUTCMonth();
    if (!map.has(month)) map.set(month, []);
    map.get(month)!.push(r);
  }
  return map;
}
