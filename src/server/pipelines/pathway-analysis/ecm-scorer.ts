/**
 * ECM (Energy Conservation Measure) Scorer
 *
 * Deterministic logic mapping building profiles to the ECM reference database.
 * No LLM calls — pure TypeScript matching and scoring.
 *
 * Priority rules per Phase 2 spec:
 * - Standard Pathway (score > 55): "Quick Wins" — Lighting, RCx, controls
 * - Performance Pathway (score <= 55): "Deep Retrofits" — Heat pumps, air sealing, envelope
 */

export interface BuildingProfile {
  propertyType: string;
  grossSquareFeet: number;
  yearBuilt: number | null;
  hvacType: string | null;
  currentSiteEui: number;
  currentScore: number | null;
  bepsTargetScore: number;
  hasLedLighting: boolean;
  hasRetroCommissioning: boolean;
  envelopeCondition: "GOOD" | "FAIR" | "POOR" | "UNKNOWN";
}

export interface ECM {
  id: string;
  name: string;
  category: ECMCategory;
  estimatedSavingsPct: number;
  costPerSqft: number;
  simplePaybackYears: number;
  applicablePropertyTypes: string[];
  minBuildingAge: number;
  priority: "QUICK_WIN" | "DEEP_RETROFIT";
  description: string;
}

export type ECMCategory =
  | "LIGHTING"
  | "HVAC"
  | "CONTROLS"
  | "ENVELOPE"
  | "RECOMMISSIONING"
  | "RENEWABLE"
  | "WATER";

export interface ScoredECM extends ECM {
  /** Relevance score 0-100 */
  relevanceScore: number;
  /** Estimated annual savings in kBtu */
  estimatedAnnualSavingsKbtu: number;
  /** Estimated project cost */
  estimatedCost: number;
  /** Reasons this ECM was selected */
  reasons: string[];
}

export interface ECMRecommendation {
  pathway: "STANDARD_TARGET" | "PERFORMANCE";
  ecms: ScoredECM[];
  totalEstimatedSavingsPct: number;
  totalEstimatedCost: number;
  projectedSiteEui: number;
}

/**
 * ECM reference database.
 * Source: DC BEPS compliance guidebook + ASHRAE 90.1 typical measures.
 */
const ECM_DATABASE: ECM[] = [
  // ── Quick Wins (Standard Pathway priority) ──────────────────────
  {
    id: "ecm-led-retrofit",
    name: "LED Lighting Retrofit",
    category: "LIGHTING",
    estimatedSavingsPct: 8,
    costPerSqft: 2.5,
    simplePaybackYears: 2,
    applicablePropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
    minBuildingAge: 5,
    priority: "QUICK_WIN",
    description: "Replace fluorescent and HID fixtures with LED. Includes occupancy sensors and daylight harvesting.",
  },
  {
    id: "ecm-rcx",
    name: "Retro-Commissioning (RCx)",
    category: "RECOMMISSIONING",
    estimatedSavingsPct: 10,
    costPerSqft: 0.5,
    simplePaybackYears: 1,
    applicablePropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
    minBuildingAge: 3,
    priority: "QUICK_WIN",
    description: "Systematic evaluation and optimization of existing building systems. Low cost, high impact.",
  },
  {
    id: "ecm-bms-upgrade",
    name: "Building Management System (BMS) Upgrade",
    category: "CONTROLS",
    estimatedSavingsPct: 7,
    costPerSqft: 3.0,
    simplePaybackYears: 3,
    applicablePropertyTypes: ["OFFICE", "MIXED_USE", "OTHER"],
    minBuildingAge: 10,
    priority: "QUICK_WIN",
    description: "Upgrade to modern DDC controls with scheduling, setback, and demand-based ventilation.",
  },
  {
    id: "ecm-vfd",
    name: "Variable Frequency Drives (VFDs)",
    category: "HVAC",
    estimatedSavingsPct: 5,
    costPerSqft: 1.5,
    simplePaybackYears: 3,
    applicablePropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
    minBuildingAge: 10,
    priority: "QUICK_WIN",
    description: "Install VFDs on AHU fans and chilled/hot water pumps.",
  },
  {
    id: "ecm-low-flow",
    name: "Low-Flow Water Fixtures",
    category: "WATER",
    estimatedSavingsPct: 2,
    costPerSqft: 0.3,
    simplePaybackYears: 1,
    applicablePropertyTypes: ["MULTIFAMILY", "OFFICE", "MIXED_USE", "OTHER"],
    minBuildingAge: 0,
    priority: "QUICK_WIN",
    description: "Replace faucets, showerheads, and toilets with WaterSense-certified fixtures.",
  },

  // ── Deep Retrofits (Performance Pathway priority) ───────────────
  {
    id: "ecm-heat-pump",
    name: "Air-Source Heat Pump Conversion",
    category: "HVAC",
    estimatedSavingsPct: 25,
    costPerSqft: 15.0,
    simplePaybackYears: 10,
    applicablePropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
    minBuildingAge: 15,
    priority: "DEEP_RETROFIT",
    description: "Replace gas-fired boilers/furnaces with high-efficiency air-source heat pumps.",
  },
  {
    id: "ecm-envelope-air-sealing",
    name: "Building Envelope Air Sealing",
    category: "ENVELOPE",
    estimatedSavingsPct: 12,
    costPerSqft: 5.0,
    simplePaybackYears: 7,
    applicablePropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
    minBuildingAge: 20,
    priority: "DEEP_RETROFIT",
    description: "Seal air leakage at windows, doors, and wall penetrations. Add continuous air barrier.",
  },
  {
    id: "ecm-window-replacement",
    name: "Window Replacement (Double/Triple Pane)",
    category: "ENVELOPE",
    estimatedSavingsPct: 10,
    costPerSqft: 12.0,
    simplePaybackYears: 15,
    applicablePropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
    minBuildingAge: 25,
    priority: "DEEP_RETROFIT",
    description: "Replace single-pane or degraded windows with low-E, insulated glazing units.",
  },
  {
    id: "ecm-roof-insulation",
    name: "Roof Insulation Upgrade",
    category: "ENVELOPE",
    estimatedSavingsPct: 6,
    costPerSqft: 4.0,
    simplePaybackYears: 8,
    applicablePropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
    minBuildingAge: 15,
    priority: "DEEP_RETROFIT",
    description: "Add continuous insulation above roof deck to meet or exceed ASHRAE 90.1 requirements.",
  },
  {
    id: "ecm-solar-pv",
    name: "Rooftop Solar PV",
    category: "RENEWABLE",
    estimatedSavingsPct: 15,
    costPerSqft: 8.0,
    simplePaybackYears: 8,
    applicablePropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
    minBuildingAge: 0,
    priority: "DEEP_RETROFIT",
    description: "Install rooftop photovoltaic panels sized for available roof area.",
  },
];

/**
 * Score and rank ECMs for a building profile.
 *
 * Returns ECMs sorted by relevance score (highest first), with estimated
 * savings and costs calculated for the specific building.
 */
export function scoreECMs(profile: BuildingProfile): ECMRecommendation {
  const pathway = determinePathway(profile);
  const buildingAge = profile.yearBuilt
    ? new Date().getFullYear() - profile.yearBuilt
    : 30;

  const scored: ScoredECM[] = [];

  for (const ecm of ECM_DATABASE) {
    if (!ecm.applicablePropertyTypes.includes(profile.propertyType)) continue;
    if (buildingAge < ecm.minBuildingAge) continue;
    if (ecm.id === "ecm-led-retrofit" && profile.hasLedLighting) continue;
    if (ecm.id === "ecm-rcx" && profile.hasRetroCommissioning) continue;

    const relevanceScore = calculateRelevanceScore(ecm, profile, pathway, buildingAge);
    if (relevanceScore <= 0) continue;

    const estimatedCost = ecm.costPerSqft * profile.grossSquareFeet;
    const annualSiteKbtu = profile.currentSiteEui * profile.grossSquareFeet;
    const estimatedAnnualSavingsKbtu = annualSiteKbtu * (ecm.estimatedSavingsPct / 100);

    const reasons: string[] = [];
    if (ecm.priority === "QUICK_WIN" && pathway === "STANDARD_TARGET") {
      reasons.push("Quick win aligned with Standard Pathway");
    }
    if (ecm.priority === "DEEP_RETROFIT" && pathway === "PERFORMANCE") {
      reasons.push("Deep retrofit needed for 20% EUI reduction target");
    }
    if (ecm.simplePaybackYears <= 3) {
      reasons.push(`Short payback: ${ecm.simplePaybackYears} years`);
    }
    if (ecm.estimatedSavingsPct >= 10) {
      reasons.push(`High savings potential: ${ecm.estimatedSavingsPct}%`);
    }
    if (buildingAge > 30 && ecm.category === "ENVELOPE") {
      reasons.push("Aging envelope likely degraded");
    }

    scored.push({
      ...ecm,
      relevanceScore,
      estimatedAnnualSavingsKbtu,
      estimatedCost,
      reasons,
    });
  }

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const totalSavingsPct = scored.reduce(
    (sum, ecm) => sum + ecm.estimatedSavingsPct,
    0,
  );
  const totalCost = scored.reduce((sum, ecm) => sum + ecm.estimatedCost, 0);
  const projectedSiteEui =
    profile.currentSiteEui * (1 - Math.min(totalSavingsPct, 80) / 100);

  return {
    pathway,
    ecms: scored,
    totalEstimatedSavingsPct: Math.min(totalSavingsPct, 80),
    totalEstimatedCost: totalCost,
    projectedSiteEui,
  };
}

function determinePathway(
  profile: BuildingProfile,
): "STANDARD_TARGET" | "PERFORMANCE" {
  if (profile.currentScore !== null && profile.currentScore > 55) {
    return "STANDARD_TARGET";
  }
  return "PERFORMANCE";
}

function calculateRelevanceScore(
  ecm: ECM,
  profile: BuildingProfile,
  pathway: "STANDARD_TARGET" | "PERFORMANCE",
  buildingAge: number,
): number {
  let score = 50;

  // Pathway alignment bonus
  if (ecm.priority === "QUICK_WIN" && pathway === "STANDARD_TARGET") {
    score += 25;
  } else if (ecm.priority === "DEEP_RETROFIT" && pathway === "PERFORMANCE") {
    score += 25;
  } else if (ecm.priority === "QUICK_WIN" && pathway === "PERFORMANCE") {
    score += 10;
  } else {
    score -= 10;
  }

  // Savings impact
  if (ecm.estimatedSavingsPct >= 15) score += 15;
  else if (ecm.estimatedSavingsPct >= 10) score += 10;
  else if (ecm.estimatedSavingsPct >= 5) score += 5;

  // Payback attractiveness
  if (ecm.simplePaybackYears <= 2) score += 15;
  else if (ecm.simplePaybackYears <= 5) score += 10;
  else if (ecm.simplePaybackYears <= 10) score += 5;

  // Envelope condition bonus for envelope ECMs
  if (ecm.category === "ENVELOPE") {
    if (profile.envelopeCondition === "POOR") score += 15;
    else if (profile.envelopeCondition === "FAIR") score += 5;
  }

  // Building age bonus for older buildings
  if (buildingAge > 40) score += 10;
  else if (buildingAge > 25) score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Get the full ECM reference database for UI display.
 */
export function getECMDatabase(): ECM[] {
  return [...ECM_DATABASE];
}
