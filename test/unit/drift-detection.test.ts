import { describe, it, expect } from "vitest";
import {
  detectDrift,
  type DriftDetectionInput,
  type MonthlyReading,
} from "@/server/pipelines/drift-detection/rules-engine";

function makeReading(
  month: number,
  consumptionKbtu: number,
  year = 2025,
): MonthlyReading {
  return {
    periodStart: new Date(Date.UTC(year, month - 1, 1)),
    consumptionKbtu,
    meterType: "ELECTRIC",
  };
}

function makeInput(
  overrides: Partial<DriftDetectionInput> = {},
): DriftDetectionInput {
  // 12 months of historical data with known variance
  // Range: 90K-110K, mean=100K, stddev~6K → 2σ threshold ≈ 112K
  const baseValues = [92, 95, 98, 100, 103, 106, 108, 110, 107, 104, 97, 93];
  const historical = baseValues.map((v, i) =>
    makeReading(i + 1, v * 1_000, 2024),
  );

  return {
    buildingId: "b1",
    currentReadings: [makeReading(1, 95_000)],
    historicalReadings: historical,
    currentScore: 65,
    previousScore: 66,
    baselineSiteEui: 80,
    currentSiteEui: 0.65,
    grossSquareFeet: 150_000,
    ...overrides,
  };
}

describe("Drift Detection Rules Engine", () => {
  // ─── No Alerts ────────────────────────────────────────────────────

  it("returns no alerts for normal readings", () => {
    const alerts = detectDrift(makeInput());
    expect(alerts).toHaveLength(0);
  });

  // ─── Rule 1: EUI Spike ───────────────────────────────────────────

  it("detects EUI spike above 2σ", () => {
    // Historical: 12 readings at 100K kBtu → monthly EUI ≈ 0.667
    // Mean = 0.667, σ ≈ 0 → threshold ≈ 0.667 + 0 = 0.667
    // Need to add variance in historical data
    const historical = Array.from({ length: 12 }, (_, i) =>
      makeReading(i + 1, 90_000 + i * 2_000, 2024),
    );

    const alerts = detectDrift(
      makeInput({
        historicalReadings: historical,
        currentSiteEui: 2.0, // Way above mean ~0.67
      }),
    );

    const euiSpike = alerts.find((a) => a.ruleId === "EUI_SPIKE");
    expect(euiSpike).toBeDefined();
    expect(euiSpike!.severity === "HIGH" || euiSpike!.severity === "CRITICAL").toBe(true);
  });

  it("does not flag EUI spike with insufficient history", () => {
    const alerts = detectDrift(
      makeInput({
        historicalReadings: [makeReading(1, 100_000, 2024)],
        currentSiteEui: 200,
      }),
    );
    expect(alerts.find((a) => a.ruleId === "EUI_SPIKE")).toBeUndefined();
  });

  // ─── Rule 2: Score Drop ───────────────────────────────────────────

  it("detects score drop of 3+ points", () => {
    const alerts = detectDrift(
      makeInput({
        currentScore: 60,
        previousScore: 65,
      }),
    );

    const scoreDrop = alerts.find((a) => a.ruleId === "SCORE_DROP");
    expect(scoreDrop).toBeDefined();
    expect(scoreDrop!.severity).toBe("HIGH");
    expect(scoreDrop!.description).toContain("5 points");
  });

  it("detects critical score drop of 10+ points", () => {
    const alerts = detectDrift(
      makeInput({
        currentScore: 50,
        previousScore: 65,
      }),
    );

    const scoreDrop = alerts.find((a) => a.ruleId === "SCORE_DROP");
    expect(scoreDrop).toBeDefined();
    expect(scoreDrop!.severity).toBe("CRITICAL");
  });

  it("does not flag score drop of 2 points", () => {
    const alerts = detectDrift(
      makeInput({
        currentScore: 63,
        previousScore: 65,
      }),
    );
    expect(alerts.find((a) => a.ruleId === "SCORE_DROP")).toBeUndefined();
  });

  it("handles null scores gracefully", () => {
    const alerts = detectDrift(
      makeInput({
        currentScore: null,
        previousScore: null,
      }),
    );
    expect(alerts.find((a) => a.ruleId === "SCORE_DROP")).toBeUndefined();
  });

  // ─── Rule 3: Consumption Anomaly ──────────────────────────────────

  it("detects 3x consumption anomaly", () => {
    const alerts = detectDrift(
      makeInput({
        currentReadings: [makeReading(1, 350_000)], // 3.5x avg of 100K
      }),
    );

    const anomaly = alerts.find((a) => a.ruleId === "CONSUMPTION_ANOMALY");
    expect(anomaly).toBeDefined();
    expect(anomaly!.severity).toBe("HIGH");
  });

  it("does not flag 2x consumption", () => {
    const alerts = detectDrift(
      makeInput({
        currentReadings: [makeReading(1, 200_000)], // 2x, below 3x threshold
      }),
    );
    expect(alerts.find((a) => a.ruleId === "CONSUMPTION_ANOMALY")).toBeUndefined();
  });

  // ─── Rule 4: Seasonal Deviation ──────────────────────────────────

  it("detects >20% seasonal deviation", () => {
    // Historical January at 100K, current January at 130K (30% above)
    const alerts = detectDrift(
      makeInput({
        currentReadings: [makeReading(1, 130_000)],
      }),
    );

    const seasonal = alerts.find((a) => a.ruleId === "SEASONAL_DEVIATION");
    expect(seasonal).toBeDefined();
    expect(seasonal!.description).toContain("above");
  });

  it("detects >20% below seasonal deviation", () => {
    const alerts = detectDrift(
      makeInput({
        currentReadings: [makeReading(1, 70_000)], // 30% below
      }),
    );

    const seasonal = alerts.find((a) => a.ruleId === "SEASONAL_DEVIATION");
    expect(seasonal).toBeDefined();
    expect(seasonal!.description).toContain("below");
  });

  it("does not flag 15% seasonal change", () => {
    // Historical Jan = 92K, so 15% above = ~106K (within ±20% threshold)
    const alerts = detectDrift(
      makeInput({
        currentReadings: [makeReading(1, 105_000)],
      }),
    );
    expect(alerts.find((a) => a.ruleId === "SEASONAL_DEVIATION")).toBeUndefined();
  });

  // ─── Rule 5: Sustained Drift ──────────────────────────────────────

  it("detects sustained drift of 7+ readings above 15% baseline", () => {
    // Baseline EUI = 80, GSF = 150K → monthly baseline = 80*150K/12 = 1,000,000
    // 15% above = 1,150,000
    const currentReadings = Array.from({ length: 8 }, (_, i) =>
      makeReading(i + 1, 1_200_000),
    );

    const alerts = detectDrift(
      makeInput({
        currentReadings,
        baselineSiteEui: 80,
        grossSquareFeet: 150_000,
      }),
    );

    const sustained = alerts.find((a) => a.ruleId === "SUSTAINED_DRIFT");
    expect(sustained).toBeDefined();
    expect(sustained!.severity).toBe("CRITICAL");
  });

  it("does not flag 6 consecutive above-baseline readings", () => {
    const currentReadings = Array.from({ length: 6 }, (_, i) =>
      makeReading(i + 1, 1_200_000),
    );

    const alerts = detectDrift(
      makeInput({
        currentReadings,
        baselineSiteEui: 80,
        grossSquareFeet: 150_000,
      }),
    );

    expect(alerts.find((a) => a.ruleId === "SUSTAINED_DRIFT")).toBeUndefined();
  });

  // ─── Multiple Alerts ──────────────────────────────────────────────

  it("can trigger multiple rules simultaneously", () => {
    const alerts = detectDrift(
      makeInput({
        currentReadings: [makeReading(1, 350_000)], // 3x anomaly + seasonal
        currentScore: 55,
        previousScore: 68, // 13-point drop
      }),
    );

    const ruleIds = alerts.map((a) => a.ruleId);
    expect(ruleIds).toContain("SCORE_DROP");
    expect(ruleIds).toContain("CONSUMPTION_ANOMALY");
    expect(alerts.length).toBeGreaterThanOrEqual(2);
  });
});
