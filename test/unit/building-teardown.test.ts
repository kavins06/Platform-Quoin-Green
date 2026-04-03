import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  ACTIVE_BUILDING_TEARDOWN_DELEGATES,
  BUILDING_TEARDOWN_DELEGATES,
  LEGACY_BUILDING_TEARDOWN_DELEGATES,
} from "@/server/lifecycle/building-teardown";

function toDelegateName(modelName: string) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

describe("building teardown inventory", () => {
  it("accounts for every schema model that owns building-scoped records", () => {
    const buildingOwnedDelegates = Prisma.dmmf.datamodel.models
      .filter((model) => model.name !== "Building")
      .filter((model) =>
        model.fields.some((field) => field.kind === "object" && field.type === "Building"),
      )
      .filter((model) => model.fields.some((field) => field.name === "buildingId"))
      .filter((model) => model.fields.some((field) => field.name === "organizationId"))
      .map((model) => toDelegateName(model.name))
      .sort();

    expect([...BUILDING_TEARDOWN_DELEGATES].sort()).toEqual(buildingOwnedDelegates);
  });

  it("keeps legacy financing cleanup isolated from active teardown ownership", () => {
    expect(LEGACY_BUILDING_TEARDOWN_DELEGATES).toEqual([
      "financingPacket",
      "financingCaseCandidate",
      "financingCase",
    ]);

    expect(ACTIVE_BUILDING_TEARDOWN_DELEGATES).not.toContain("financingPacket");
    expect(ACTIVE_BUILDING_TEARDOWN_DELEGATES).not.toContain("financingCaseCandidate");
    expect(ACTIVE_BUILDING_TEARDOWN_DELEGATES).not.toContain("financingCase");
  });
});
