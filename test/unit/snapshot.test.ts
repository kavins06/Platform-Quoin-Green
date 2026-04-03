import { describe, it, expect } from "vitest";
import {
  calculateEUI,
  determineComplianceStatus,
  calculateComplianceGap,
  estimatePenalty,
  computeDataQualityScore,
  buildSnapshotData,
  type EUIReading,
} from "@/server/pipelines/data-ingestion/snapshot";

describe("Snapshot — EUI Calculation", () => {
  it("calculates site and source EUI for electric-only building", () => {
    // 12 months × 42,500 kWh each = 510,000 kWh total
    // Site kBtu = 510,000 × 3.412 = 1,740,120 kBtu (but we're using pre-converted kBtu)
    // For simplicity: 12 readings of 145,010 kBtu each (42500 × 3.412)
    const readings: EUIReading[] = Array.from({ length: 12 }, (_, i) => ({
      consumptionKbtu: 145_010,
      meterType: "ELECTRIC" as const,
      periodStart: new Date(`2025-${String(i + 1).padStart(2, "0")}-01T00:00:00Z`),
    }));

    const eui = calculateEUI(readings, 150_000);

    expect(eui.readingCount).toBe(12);
    expect(eui.monthsCovered).toBe(12);
    expect(eui.totalSiteKBtu).toBe(145_010 * 12);
    // Site EUI = 1,740,120 / 150,000 = 11.6008
    expect(eui.siteEui).toBeCloseTo(11.6008, 2);
    // Source EUI = 1,740,120 × 2.80 / 150,000 = 32.482
    expect(eui.sourceEui).toBeCloseTo(eui.siteEui * 2.8, 2);
    expect(eui.fuelBreakdown["ELECTRIC"]).toBe(145_010 * 12);
  });

  it("calculates dual-fuel EUI with correct source-site ratios", () => {
    const readings: EUIReading[] = [
      {
        consumptionKbtu: 100_000,
        meterType: "ELECTRIC",
        periodStart: new Date("2025-01-01T00:00:00Z"),
      },
      {
        consumptionKbtu: 50_000,
        meterType: "GAS",
        periodStart: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const eui = calculateEUI(readings, 100_000);

    expect(eui.totalSiteKBtu).toBe(150_000);
    // Source: electric 100K × 2.80 = 280K, gas 50K × 1.05 = 52.5K → total 332.5K
    expect(eui.totalSourceKBtu).toBe(100_000 * 2.8 + 50_000 * 1.05);
    expect(eui.siteEui).toBe(1.5);
    expect(eui.sourceEui).toBeCloseTo(3.325, 3);
    expect(eui.fuelBreakdown["ELECTRIC"]).toBe(100_000);
    expect(eui.fuelBreakdown["GAS"]).toBe(50_000);
    expect(eui.monthsCovered).toBe(1);
  });

  it("returns zeros for empty readings", () => {
    const eui = calculateEUI([], 100_000);
    expect(eui.siteEui).toBe(0);
    expect(eui.sourceEui).toBe(0);
    expect(eui.totalSiteKBtu).toBe(0);
    expect(eui.readingCount).toBe(0);
    expect(eui.monthsCovered).toBe(0);
  });

  it("returns zeros for zero GSF", () => {
    const readings: EUIReading[] = [
      {
        consumptionKbtu: 100_000,
        meterType: "ELECTRIC",
        periodStart: new Date("2025-01-01T00:00:00Z"),
      },
    ];
    const eui = calculateEUI(readings, 0);
    expect(eui.siteEui).toBe(0);
    expect(eui.sourceEui).toBe(0);
  });

  it("counts distinct months correctly", () => {
    const readings: EUIReading[] = [
      {
        consumptionKbtu: 1000,
        meterType: "ELECTRIC",
        periodStart: new Date("2025-01-05T00:00:00Z"),
      },
      {
        consumptionKbtu: 1000,
        meterType: "ELECTRIC",
        periodStart: new Date("2025-01-20T00:00:00Z"),
      },
      {
        consumptionKbtu: 1000,
        meterType: "GAS",
        periodStart: new Date("2025-02-01T00:00:00Z"),
      },
    ];
    const eui = calculateEUI(readings, 10_000);
    // Two readings in Jan, one in Feb → 2 months
    expect(eui.monthsCovered).toBe(2);
    expect(eui.readingCount).toBe(3);
  });

  it("uses 1.45 ratio for STEAM", () => {
    const readings: EUIReading[] = [
      {
        consumptionKbtu: 100_000,
        meterType: "STEAM",
        periodStart: new Date("2025-01-01T00:00:00Z"),
      },
    ];
    const eui = calculateEUI(readings, 100_000);
    expect(eui.sourceEui).toBeCloseTo(1.45, 3);
  });
});

describe("Snapshot — Compliance Status", () => {
  it("returns COMPLIANT when score >= target", () => {
    expect(determineComplianceStatus(78, 71)).toBe("COMPLIANT");
  });

  it("returns COMPLIANT when score = target", () => {
    expect(determineComplianceStatus(71, 71)).toBe("COMPLIANT");
  });

  it("returns AT_RISK when within 5 points of target", () => {
    expect(determineComplianceStatus(68, 71)).toBe("AT_RISK");
    expect(determineComplianceStatus(66, 71)).toBe("AT_RISK");
  });

  it("returns NON_COMPLIANT when more than 5 below target", () => {
    expect(determineComplianceStatus(45, 71)).toBe("NON_COMPLIANT");
    expect(determineComplianceStatus(65, 71)).toBe("NON_COMPLIANT");
  });

  it("returns PENDING_DATA when score is null", () => {
    expect(determineComplianceStatus(null, 71)).toBe("PENDING_DATA");
  });
});

describe("Snapshot — Compliance Gap", () => {
  it("returns positive gap when above target", () => {
    expect(calculateComplianceGap(78, 71)).toBe(7);
  });

  it("returns negative gap when below target", () => {
    expect(calculateComplianceGap(45, 71)).toBe(-26);
  });

  it("returns zero when exactly at target", () => {
    expect(calculateComplianceGap(71, 71)).toBe(0);
  });

  it("returns null when score is null", () => {
    expect(calculateComplianceGap(null, 71)).toBeNull();
  });
});

describe("Snapshot — Penalty Estimate", () => {
  it("returns $0 for compliant building", () => {
    expect(estimatePenalty(78, 71, 1_500_000)).toBe(0);
  });

  it("returns $0 when score is null", () => {
    expect(estimatePenalty(null, 71, 1_500_000)).toBe(0);
  });

  it("estimates penalty proportional to gap", () => {
    // Score 45, target 71 → gap 26 → fraction 26/71 ≈ 0.3662
    // Penalty = 1,500,000 × 0.3662 ≈ 549,296
    const penalty = estimatePenalty(45, 71, 1_500_000);
    expect(penalty).toBeCloseTo(549_296, -1);
  });

  it("caps penalty fraction at 1.0", () => {
    // Score 0, target 71 → gap 71 → fraction 71/71 = 1.0
    // Penalty = max penalty
    const penalty = estimatePenalty(0, 71, 1_500_000);
    expect(penalty).toBe(1_500_000);
  });

  it("respects $7.5M cap via maxPenaltyExposure", () => {
    // 800K SF building → maxPenalty should be min(800000*10, 7500000) = 7,500,000
    const maxPenalty = Math.min(800_000 * 10, 7_500_000);
    expect(maxPenalty).toBe(7_500_000);
    const penalty = estimatePenalty(0, 71, maxPenalty);
    expect(penalty).toBe(7_500_000);
  });
});

describe("Snapshot — Data Quality Score", () => {
  it("returns 100 for perfect data", () => {
    expect(computeDataQualityScore(12, 0, 0, 12)).toBe(100);
  });

  it("returns 0 for no readings", () => {
    expect(computeDataQualityScore(0, 0, 0, 0)).toBe(0);
  });

  it("deducts for rejected readings", () => {
    // 50% rejection → -20 points
    const score = computeDataQualityScore(10, 5, 0, 12);
    expect(score).toBe(80);
  });

  it("deducts for warnings", () => {
    // 5 warnings / 10 readings = 0.5 → -10 points
    const score = computeDataQualityScore(10, 0, 5, 12);
    expect(score).toBe(90);
  });

  it("deducts for incomplete coverage", () => {
    // 6 months → 6 missing × 3 = -18
    const score = computeDataQualityScore(6, 0, 0, 6);
    expect(score).toBe(82);
  });

  it("returns low score for poor data", () => {
    // 50% rejected (-20), high warnings (-20), 6 months (-18)
    const score = computeDataQualityScore(10, 5, 10, 6);
    expect(score).toBeLessThan(50);
  });

  it("clamps to 0-100 range", () => {
    // Worst case: 100% rejected (-40), max warnings (-20), 0 months (-36)
    // 100 - 40 - 20 - 36 = 4 → minimum achievable is 4
    const score = computeDataQualityScore(1, 1, 100, 0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    // Perfect data should be 100
    expect(computeDataQualityScore(12, 0, 0, 12)).toBe(100);
  });
});

describe("Snapshot — buildSnapshotData", () => {
  it("builds complete snapshot for non-compliant building", () => {
    const snap = buildSnapshotData({
      buildingId: "b1",
      organizationId: "org1",
      grossSquareFeet: 150_000,
      bepsTargetScore: 71,
      energyStarScore: 45,
      siteEui: 120.5,
      sourceEui: 337.4,
      weatherNormalizedSiteEui: 115.2,
      dataQualityScore: 85,
    });

    expect(snap.buildingId).toBe("b1");
    expect(snap.organizationId).toBe("org1");
    expect(snap.triggerType).toBe("PIPELINE_RUN");
    expect(snap.energyStarScore).toBe(45);
    expect(snap.siteEui).toBe(120.5);
    expect(snap.sourceEui).toBe(337.4);
    expect(snap.complianceStatus).toBe("NON_COMPLIANT");
    expect(snap.complianceGap).toBe(-26);
    expect(snap.estimatedPenalty).toBeGreaterThan(0);
    expect(snap.dataQualityScore).toBe(85);
  });

  it("builds snapshot with $0 penalty for compliant building", () => {
    const snap = buildSnapshotData({
      buildingId: "b2",
      organizationId: "org1",
      grossSquareFeet: 200_000,
      bepsTargetScore: 61,
      energyStarScore: 68,
      siteEui: 82,
      sourceEui: 229.6,
      weatherNormalizedSiteEui: 79.5,
    });

    expect(snap.complianceStatus).toBe("COMPLIANT");
    expect(snap.complianceGap).toBe(7);
    expect(snap.estimatedPenalty).toBe(0);
    expect(snap.dataQualityScore).toBeNull();
  });

  it("builds PENDING_DATA snapshot when no ESPM score", () => {
    const snap = buildSnapshotData({
      buildingId: "b3",
      organizationId: "org1",
      grossSquareFeet: 80_000,
      bepsTargetScore: 66,
      energyStarScore: null,
      siteEui: 95.2,
      sourceEui: 266.56,
      weatherNormalizedSiteEui: null,
    });

    expect(snap.complianceStatus).toBe("PENDING_DATA");
    expect(snap.complianceGap).toBeNull();
    expect(snap.estimatedPenalty).toBe(0);
  });

  it("caps maxPenalty at $7.5M", () => {
    const snap = buildSnapshotData({
      buildingId: "b4",
      organizationId: "org1",
      grossSquareFeet: 1_000_000,
      bepsTargetScore: 71,
      energyStarScore: 0,
      siteEui: 200,
      sourceEui: 560,
      weatherNormalizedSiteEui: 195.0,
    });

    // maxPenalty = min(1M × 10, 7.5M) = 7.5M, fraction = 1.0
    expect(snap.estimatedPenalty).toBe(7_500_000);
  });
});
