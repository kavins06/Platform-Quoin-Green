export interface FinancialDistressIndicators {
  inForeclosure: boolean;
  inBankruptcy: boolean;
  negativeNetOperatingIncome: boolean;
  taxDelinquent: boolean;
}

export interface ExemptionInput {
  baselineOccupancyPct: number | null;
  financialDistressIndicators: FinancialDistressIndicators;
  grossSquareFeet: number;
  propertyType: string;
  yearBuilt: number | null;
}

export type ExemptionType =
  | "LOW_OCCUPANCY"
  | "FINANCIAL_DISTRESS"
  | "RECENT_CONSTRUCTION";

export interface ExemptionResult {
  eligible: boolean;
  qualifiedExemptions: ExemptionType[];
  details: string[];
  missingData: string[];
}

export function screenForExemptions(input: ExemptionInput): ExemptionResult {
  const qualifiedExemptions: ExemptionType[] = [];
  const details: string[] = [];
  const missingData: string[] = [];

  // 1. Low Occupancy Exemption (<50% occupancy)
  if (input.baselineOccupancyPct === null) {
    missingData.push("Baseline occupancy data not available");
  } else if (input.baselineOccupancyPct < 50) {
    qualifiedExemptions.push("LOW_OCCUPANCY");
    details.push(
      `Baseline occupancy was ${input.baselineOccupancyPct}%, which is below the 50% threshold.`,
    );
  }

  // 2. Financial Distress Exemption
  const distressReasons: string[] = [];
  if (input.financialDistressIndicators.inForeclosure) distressReasons.push("foreclosure");
  if (input.financialDistressIndicators.inBankruptcy) distressReasons.push("bankruptcy");
  if (input.financialDistressIndicators.negativeNetOperatingIncome) distressReasons.push("negative NOI");
  if (input.financialDistressIndicators.taxDelinquent) distressReasons.push("tax delinquent");

  if (distressReasons.length > 0) {
    qualifiedExemptions.push("FINANCIAL_DISTRESS");
    details.push(
      `Building shows financial distress markers: ${distressReasons.join(", ")}.`,
    );
  }

  // 3. Recent Construction Exemption (Built 2016 or later)
  if (input.yearBuilt === null) {
    missingData.push("Year built not available");
  } else if (input.yearBuilt >= 2016) {
    qualifiedExemptions.push("RECENT_CONSTRUCTION");
    details.push(
      `Building was built in ${input.yearBuilt}, qualifying as recent construction (within 5 years of the 2021 BEPS cycle start).`,
    );
  }

  return {
    eligible: qualifiedExemptions.length > 0,
    qualifiedExemptions,
    details,
    missingData,
  };
}
