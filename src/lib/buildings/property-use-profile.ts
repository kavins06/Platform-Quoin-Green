import type { BuildingPropertyUseType, PropertyType } from "@/generated/prisma/client";
import {
  buildDefaultPropertyUseDisplayName,
  deriveBenchmarkTargetScoreFromUses,
  deriveBuildingPropertyTypeFromUses,
  getAllPropertyUseFields,
  getPropertyUseDefinition,
  getPropertyUseFieldDefinition,
  type BuildingPropertyUseKey,
} from "@/lib/buildings/property-use-registry";

export type BuildingPropertyUseInput = {
  id?: string | null;
  sortOrder: number;
  useKey: BuildingPropertyUseType | BuildingPropertyUseKey;
  displayName: string;
  grossSquareFeet: number;
  details: Record<string, unknown>;
  espmPropertyUseId?: string | bigint | null;
  espmUseDetailsId?: string | bigint | null;
};

export type BuildingProfileEvaluation = {
  isComplete: boolean;
  missingInputCodes: string[];
  derivedPropertyType: PropertyType;
  recommendedTargetScore: number;
};

export const BUILDING_PROFILE_REQUIRED_YEAR_CODE = "BUILDING_PROFILE_YEAR_REQUIRED";
export const BUILDING_PROFILE_PROPERTY_USE_REQUIRED_CODE =
  "BUILDING_PROFILE_PROPERTY_USE_REQUIRED";
export const BUILDING_PROFILE_AREA_MISMATCH_CODE =
  "BUILDING_PROFILE_AREA_TOTAL_MISMATCH";
export const BUILDING_PROFILE_USE_NAME_REQUIRED_CODE =
  "BUILDING_PROFILE_USE_NAME_REQUIRED";

function isBlank(value: unknown) {
  return value == null || (typeof value === "string" && value.trim().length === 0);
}

export function evaluateBuildingProfile(input: {
  grossSquareFeet: number;
  yearBuilt?: number | null;
  plannedConstructionCompletionYear?: number | null;
  propertyUses: BuildingPropertyUseInput[];
}): BuildingProfileEvaluation {
  const missingInputCodes = new Set<string>();
  const useKeys = input.propertyUses.map((row) => row.useKey as BuildingPropertyUseKey);

  if (input.propertyUses.length === 0) {
    missingInputCodes.add(BUILDING_PROFILE_PROPERTY_USE_REQUIRED_CODE);
  }

  if (input.yearBuilt == null && input.plannedConstructionCompletionYear == null) {
    missingInputCodes.add(BUILDING_PROFILE_REQUIRED_YEAR_CODE);
  }

  const grossSquareFeetTotal = input.propertyUses.reduce(
    (sum, row) => sum + (Number.isFinite(row.grossSquareFeet) ? row.grossSquareFeet : 0),
    0,
  );

  if (input.propertyUses.length > 0 && grossSquareFeetTotal !== input.grossSquareFeet) {
    missingInputCodes.add(BUILDING_PROFILE_AREA_MISMATCH_CODE);
  }

  for (const row of input.propertyUses) {
    const useKey = row.useKey as BuildingPropertyUseKey;
    if (row.displayName.trim().length === 0) {
      missingInputCodes.add(`${BUILDING_PROFILE_USE_NAME_REQUIRED_CODE}:${useKey}`);
    }

    for (const field of getPropertyUseDefinition(useKey).requiredFields) {
      if (isBlank(row.details[field.key])) {
        missingInputCodes.add(
          `BUILDING_PROFILE_FIELD_REQUIRED:${useKey}:${field.key}`,
        );
      }
    }
  }

  return {
    isComplete: missingInputCodes.size === 0,
    missingInputCodes: Array.from(missingInputCodes),
    derivedPropertyType: deriveBuildingPropertyTypeFromUses(useKeys),
    recommendedTargetScore: deriveBenchmarkTargetScoreFromUses(useKeys),
  };
}

export function getBuildingProfileMissingInputMessage(code: string) {
  if (code === BUILDING_PROFILE_PROPERTY_USE_REQUIRED_CODE) {
    return "At least one detailed property use is still required.";
  }

  if (code === BUILDING_PROFILE_REQUIRED_YEAR_CODE) {
    return "Add either the year built or the planned construction completion year.";
  }

  if (code === BUILDING_PROFILE_AREA_MISMATCH_CODE) {
    return "The total detailed-use area must equal the building gross square footage.";
  }

  if (code.startsWith(`${BUILDING_PROFILE_USE_NAME_REQUIRED_CODE}:`)) {
    const [, useKeyRaw] = code.split(":");
    const definition = getPropertyUseDefinition(useKeyRaw as BuildingPropertyUseKey);
    return `${definition.label} needs a use name.`;
  }

  if (code.startsWith("BUILDING_PROFILE_FIELD_REQUIRED:")) {
    const [, useKeyRaw, fieldKey] = code.split(":");
    const definition = getPropertyUseDefinition(useKeyRaw as BuildingPropertyUseKey);
    const field = getPropertyUseFieldDefinition(
      useKeyRaw as BuildingPropertyUseKey,
      fieldKey,
    );
    return field
      ? `${definition.label}: ${field.label} is required.`
      : `${definition.label} still has required inputs missing.`;
  }

  return "Benchmarking profile details are still incomplete.";
}

export function buildDefaultPropertyUsesFromCoarseType(input: {
  buildingName: string;
  propertyType: PropertyType;
  grossSquareFeet: number;
}) {
  let useKey: BuildingPropertyUseKey | null = null;

  if (input.propertyType === "OFFICE") {
    useKey = "OFFICE";
  } else if (input.propertyType === "MULTIFAMILY") {
    useKey = "MULTIFAMILY_HOUSING";
  }

  if (!useKey) {
    return [];
  }

  return [
    {
      sortOrder: 0,
      useKey,
      displayName: buildDefaultPropertyUseDisplayName(input.buildingName, useKey),
      grossSquareFeet: input.grossSquareFeet,
      details: {},
    },
  ] satisfies Array<
    Pick<BuildingPropertyUseInput, "sortOrder" | "useKey" | "displayName" | "grossSquareFeet" | "details">
  >;
}

export function toSerializablePropertyUseDetails(
  useKey: BuildingPropertyUseType | BuildingPropertyUseKey,
  details: Record<string, unknown>,
) {
  const normalized: Record<string, unknown> = {};
  for (const field of getAllPropertyUseFields(useKey as BuildingPropertyUseKey)) {
    const value = details[field.key];
    if (!isBlank(value)) {
      normalized[field.key] = value;
    }
  }

  return normalized;
}
