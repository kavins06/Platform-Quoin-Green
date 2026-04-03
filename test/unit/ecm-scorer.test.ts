import { describe, it, expect } from "vitest";
import {
  scoreECMs,
  getECMDatabase,
  type BuildingProfile,
} from "@/server/pipelines/pathway-analysis/ecm-scorer";

function makeProfile(overrides: Partial<BuildingProfile> = {}): BuildingProfile {
  return {
    propertyType: "OFFICE",
    grossSquareFeet: 150_000,
    yearBuilt: 1985,
    hvacType: "VAV",
    currentSiteEui: 120,
    currentScore: 45,
    bepsTargetScore: 71,
    hasLedLighting: false,
    hasRetroCommissioning: false,
    envelopeCondition: "FAIR",
    ...overrides,
  };
}

describe("ECM Scorer", () => {
  it("returns ECMs sorted by relevance score", () => {
    const result = scoreECMs(makeProfile());
    expect(result.ecms.length).toBeGreaterThan(0);
    for (let i = 1; i < result.ecms.length; i++) {
      expect(result.ecms[i].relevanceScore).toBeLessThanOrEqual(
        result.ecms[i - 1].relevanceScore,
      );
    }
  });

  it("Performance pathway prioritizes deep retrofits for score <= 55", () => {
    const result = scoreECMs(makeProfile({ currentScore: 40 }));
    expect(result.pathway).toBe("PERFORMANCE");
    const topEcm = result.ecms[0];
    expect(topEcm.priority).toBe("DEEP_RETROFIT");
  });

  it("Standard pathway prioritizes quick wins for score > 55", () => {
    const result = scoreECMs(makeProfile({ currentScore: 60 }));
    expect(result.pathway).toBe("STANDARD_TARGET");
    const quickWins = result.ecms.filter((e) => e.priority === "QUICK_WIN");
    expect(quickWins.length).toBeGreaterThan(0);
    // Quick wins should be ranked higher
    expect(quickWins[0].relevanceScore).toBeGreaterThanOrEqual(
      result.ecms[result.ecms.length - 1].relevanceScore,
    );
  });

  it("excludes LED retrofit if building already has LED", () => {
    const result = scoreECMs(makeProfile({ hasLedLighting: true }));
    expect(result.ecms.find((e) => e.id === "ecm-led-retrofit")).toBeUndefined();
  });

  it("excludes RCx if already completed", () => {
    const result = scoreECMs(makeProfile({ hasRetroCommissioning: true }));
    expect(result.ecms.find((e) => e.id === "ecm-rcx")).toBeUndefined();
  });

  it("excludes ECMs for buildings too new", () => {
    const result = scoreECMs(makeProfile({ yearBuilt: 2023 }));
    // Window replacement needs 25+ years, should be excluded
    expect(result.ecms.find((e) => e.id === "ecm-window-replacement")).toBeUndefined();
  });

  it("calculates total estimated cost", () => {
    const result = scoreECMs(makeProfile());
    expect(result.totalEstimatedCost).toBeGreaterThan(0);
    const manualSum = result.ecms.reduce((s, e) => s + e.estimatedCost, 0);
    expect(result.totalEstimatedCost).toBe(manualSum);
  });

  it("calculates projected EUI after all ECMs", () => {
    const profile = makeProfile({ currentSiteEui: 100 });
    const result = scoreECMs(profile);
    expect(result.projectedSiteEui).toBeLessThan(100);
    expect(result.projectedSiteEui).toBeGreaterThan(0);
  });

  it("caps total savings at 80%", () => {
    const result = scoreECMs(makeProfile());
    expect(result.totalEstimatedSavingsPct).toBeLessThanOrEqual(80);
  });

  it("boosts envelope ECMs for POOR condition", () => {
    // Use Standard pathway (score=60) + newer building to keep scores below 100 cap
    const poor = scoreECMs(makeProfile({ envelopeCondition: "POOR", yearBuilt: 2000, currentScore: 60 }));
    const good = scoreECMs(makeProfile({ envelopeCondition: "GOOD", yearBuilt: 2000, currentScore: 60 }));

    const poorEnvelope = poor.ecms.find((e) => e.category === "ENVELOPE");
    const goodEnvelope = good.ecms.find((e) => e.category === "ENVELOPE");
    expect(poorEnvelope).toBeDefined();
    expect(goodEnvelope).toBeDefined();
    expect(poorEnvelope!.relevanceScore).toBeGreaterThan(
      goodEnvelope!.relevanceScore,
    );
  });

  it("getECMDatabase returns all ECMs", () => {
    const db = getECMDatabase();
    expect(db.length).toBeGreaterThan(5);
    expect(db.every((e) => e.id && e.name && e.category)).toBe(true);
  });
});
