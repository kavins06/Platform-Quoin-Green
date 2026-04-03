import { describe, it, expect } from "vitest";
import {
  screenForExemptions,
  type ExemptionInput,
  type FinancialDistressIndicators,
} from "@/server/pipelines/pathway-analysis/exemption-screener";

const NO_DISTRESS: FinancialDistressIndicators = {
  inForeclosure: false,
  inBankruptcy: false,
  negativeNetOperatingIncome: false,
  taxDelinquent: false,
};

function makeInput(overrides: Partial<ExemptionInput> = {}): ExemptionInput {
  return {
    baselineOccupancyPct: 90,
    financialDistressIndicators: NO_DISTRESS,
    grossSquareFeet: 150_000,
    propertyType: "OFFICE",
    yearBuilt: 2000,
    ...overrides,
  };
}

describe("Exemption Screener", () => {
  it("non-exempt building returns eligible=false", () => {
    const result = screenForExemptions(makeInput());
    expect(result.eligible).toBe(false);
    expect(result.qualifiedExemptions).toHaveLength(0);
    expect(result.details).toHaveLength(0);
  });

  // ─── Low Occupancy ────────────────────────────────────────────────

  it("low occupancy (<50%) qualifies for exemption", () => {
    const result = screenForExemptions(makeInput({ baselineOccupancyPct: 35 }));
    expect(result.eligible).toBe(true);
    expect(result.qualifiedExemptions).toContain("LOW_OCCUPANCY");
    expect(result.details[0]).toContain("35%");
  });

  it("exactly 50% occupancy does NOT qualify", () => {
    const result = screenForExemptions(makeInput({ baselineOccupancyPct: 50 }));
    expect(result.eligible).toBe(false);
    expect(result.qualifiedExemptions).not.toContain("LOW_OCCUPANCY");
  });

  it("0% occupancy qualifies", () => {
    const result = screenForExemptions(makeInput({ baselineOccupancyPct: 0 }));
    expect(result.eligible).toBe(true);
    expect(result.qualifiedExemptions).toContain("LOW_OCCUPANCY");
  });

  it("null occupancy reports missing data", () => {
    const result = screenForExemptions(
      makeInput({ baselineOccupancyPct: null }),
    );
    expect(result.missingData).toContain("Baseline occupancy data not available");
  });

  // ─── Financial Distress ───────────────────────────────────────────

  it("foreclosure qualifies for financial distress", () => {
    const result = screenForExemptions(
      makeInput({
        financialDistressIndicators: { ...NO_DISTRESS, inForeclosure: true },
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.qualifiedExemptions).toContain("FINANCIAL_DISTRESS");
    expect(result.details[0]).toContain("foreclosure");
  });

  it("bankruptcy qualifies for financial distress", () => {
    const result = screenForExemptions(
      makeInput({
        financialDistressIndicators: { ...NO_DISTRESS, inBankruptcy: true },
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.qualifiedExemptions).toContain("FINANCIAL_DISTRESS");
  });

  it("negative NOI qualifies for financial distress", () => {
    const result = screenForExemptions(
      makeInput({
        financialDistressIndicators: {
          ...NO_DISTRESS,
          negativeNetOperatingIncome: true,
        },
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.qualifiedExemptions).toContain("FINANCIAL_DISTRESS");
  });

  it("tax delinquency qualifies for financial distress", () => {
    const result = screenForExemptions(
      makeInput({
        financialDistressIndicators: { ...NO_DISTRESS, taxDelinquent: true },
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.qualifiedExemptions).toContain("FINANCIAL_DISTRESS");
  });

  it("multiple distress indicators combine in details", () => {
    const result = screenForExemptions(
      makeInput({
        financialDistressIndicators: {
          inForeclosure: true,
          inBankruptcy: true,
          negativeNetOperatingIncome: false,
          taxDelinquent: true,
        },
      }),
    );
    expect(result.qualifiedExemptions).toContain("FINANCIAL_DISTRESS");
    expect(result.details[0]).toContain("foreclosure");
    expect(result.details[0]).toContain("bankruptcy");
    expect(result.details[0]).toContain("tax delinquent");
  });

  // ─── Recent Construction ──────────────────────────────────────────

  it("building built in 2017 qualifies (within 5 years of 2021)", () => {
    const result = screenForExemptions(makeInput({ yearBuilt: 2017 }));
    expect(result.eligible).toBe(true);
    expect(result.qualifiedExemptions).toContain("RECENT_CONSTRUCTION");
  });

  it("building built in 2016 qualifies (exactly at cutoff)", () => {
    const result = screenForExemptions(makeInput({ yearBuilt: 2016 }));
    expect(result.eligible).toBe(true);
    expect(result.qualifiedExemptions).toContain("RECENT_CONSTRUCTION");
  });

  it("building built in 2015 does NOT qualify", () => {
    const result = screenForExemptions(makeInput({ yearBuilt: 2015 }));
    expect(result.eligible).toBe(false);
    expect(result.qualifiedExemptions).not.toContain("RECENT_CONSTRUCTION");
  });

  it("null yearBuilt reports missing data", () => {
    const result = screenForExemptions(makeInput({ yearBuilt: null }));
    expect(result.missingData).toContain("Year built not available");
  });

  // ─── Multiple Exemptions ──────────────────────────────────────────

  it("building can qualify for multiple exemptions", () => {
    const result = screenForExemptions(
      makeInput({
        baselineOccupancyPct: 30,
        financialDistressIndicators: { ...NO_DISTRESS, inForeclosure: true },
        yearBuilt: 2019,
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.qualifiedExemptions).toHaveLength(3);
    expect(result.qualifiedExemptions).toContain("LOW_OCCUPANCY");
    expect(result.qualifiedExemptions).toContain("FINANCIAL_DISTRESS");
    expect(result.qualifiedExemptions).toContain("RECENT_CONSTRUCTION");
    expect(result.details).toHaveLength(3);
  });
});
