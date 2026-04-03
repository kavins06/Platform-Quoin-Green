import { describe, expect, it } from "vitest";
import {
  evaluateBuildingProfile,
  getBuildingProfileMissingInputMessage,
} from "@/lib/buildings/property-use-profile";
import {
  deriveBenchmarkTargetScoreFromUses,
  deriveBuildingPropertyTypeFromUses,
  listPropertyUseDefinitions,
} from "@/lib/buildings/property-use-registry";

describe("property use registry and profile evaluation", () => {
  it("includes the full supported worksheet catalog", () => {
    const definitions = listPropertyUseDefinitions();

    expect(definitions).toHaveLength(19);
    expect(definitions.map((definition) => definition.key)).toContain("BANK_BRANCH");
    expect(definitions.map((definition) => definition.key)).toContain(
      "WHOLESALE_CLUB_SUPERCENTER",
    );
  });

  it("marks a complete single-use office profile as ready", () => {
    const evaluation = evaluateBuildingProfile({
      grossSquareFeet: 120000,
      yearBuilt: 1998,
      propertyUses: [
        {
          sortOrder: 0,
          useKey: "OFFICE",
          displayName: "Main Office",
          grossSquareFeet: 120000,
          details: {
            weeklyOperatingHours: 60,
            workersOnMainShift: 180,
            numberOfComputers: 220,
            percentThatCanBeCooled: "50% or more",
          },
        },
      ],
    });

    expect(evaluation.isComplete).toBe(true);
    expect(evaluation.derivedPropertyType).toBe("OFFICE");
    expect(evaluation.recommendedTargetScore).toBe(71);
  });

  it("derives mixed use from multiple detailed uses and flags area mismatches", () => {
    const evaluation = evaluateBuildingProfile({
      grossSquareFeet: 100000,
      yearBuilt: 2005,
      propertyUses: [
        {
          sortOrder: 0,
          useKey: "OFFICE",
          displayName: "Office Component",
          grossSquareFeet: 70000,
          details: {
            weeklyOperatingHours: 55,
            workersOnMainShift: 80,
            numberOfComputers: 70,
            percentThatCanBeCooled: "50% or more",
          },
        },
        {
          sortOrder: 1,
          useKey: "FAST_FOOD_RESTAURANT",
          displayName: "Retail Food Component",
          grossSquareFeet: 20000,
          details: {
            weeklyOperatingHours: 70,
            workersOnMainShift: 16,
            seatingCapacity: 30,
            cashRegisters: 4,
          },
        },
      ],
    });

    expect(deriveBuildingPropertyTypeFromUses(["OFFICE", "FAST_FOOD_RESTAURANT"])).toBe(
      "MIXED_USE",
    );
    expect(deriveBenchmarkTargetScoreFromUses(["OFFICE", "FAST_FOOD_RESTAURANT"])).toBe(
      66,
    );
    expect(evaluation.isComplete).toBe(false);
    expect(evaluation.missingInputCodes).toContain("BUILDING_PROFILE_AREA_TOTAL_MISMATCH");
    expect(
      evaluation.missingInputCodes.map(getBuildingProfileMissingInputMessage),
    ).toContain(
      "The total detailed-use area must equal the building gross square footage.",
    );
  });
});
