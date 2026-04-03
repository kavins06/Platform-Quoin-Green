export const COMPLIANCE_CYCLE_VALUES = ["CYCLE_1", "CYCLE_2", "CYCLE_3"] as const;

export type ComplianceCycleValue = (typeof COMPLIANCE_CYCLE_VALUES)[number];

export const BUILDING_SELECTED_PATHWAY_VALUES = [
  "STANDARD",
  "PERFORMANCE",
  "PRESCRIPTIVE",
  "TRAJECTORY",
  "NONE",
] as const;

export type BuildingSelectedPathwayValue =
  (typeof BUILDING_SELECTED_PATHWAY_VALUES)[number];

export const BEPS_PATHWAY_VALUES = [
  "PERFORMANCE",
  "STANDARD_TARGET",
  "PRESCRIPTIVE",
  "TRAJECTORY",
] as const;

export type BepsPathwayValue = (typeof BEPS_PATHWAY_VALUES)[number];

export function toBuildingSelectedPathway(
  value: BepsPathwayValue | null | undefined,
): BuildingSelectedPathwayValue | null {
  if (!value) {
    return null;
  }

  if (value === "STANDARD_TARGET") {
    return "STANDARD";
  }

  return value;
}

export function toBepsPathway(
  value: BuildingSelectedPathwayValue | null | undefined,
): BepsPathwayValue | null {
  if (!value || value === "NONE") {
    return null;
  }

  if (value === "STANDARD") {
    return "STANDARD_TARGET";
  }

  return value;
}

export function formatPathwayLabel(value: string | null | undefined) {
  switch (value) {
    case "STANDARD":
    case "STANDARD_TARGET":
      return "Standard target";
    case "PERFORMANCE":
      return "Performance";
    case "PRESCRIPTIVE":
      return "Prescriptive";
    case "TRAJECTORY":
      return "Trajectory";
    case "NONE":
      return "Not selected";
    default:
      return null;
  }
}
