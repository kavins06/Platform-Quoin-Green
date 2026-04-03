import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/server/lib/errors";
import {
  CAPABILITIES,
  hasCapability,
  listCapabilitiesForRole,
  requireCapability,
} from "@/server/lib/capabilities";

describe("capability policy", () => {
  it("grants the full capability matrix to admins", () => {
    expect(listCapabilitiesForRole("ADMIN")).toEqual(CAPABILITIES);
  });

  it("allows managers to request but not directly execute the highest-risk actions", () => {
    expect(hasCapability("MANAGER", "PM_PUSH_REQUEST")).toBe(true);
    expect(hasCapability("MANAGER", "PM_PUSH_EXECUTE")).toBe(false);
    expect(hasCapability("MANAGER", "BUILDING_DELETE_REMOTE_REQUEST")).toBe(true);
    expect(hasCapability("MANAGER", "BUILDING_DELETE_REMOTE_EXECUTE")).toBe(false);
    expect(hasCapability("MANAGER", "SUBMISSION_TRANSITION_REQUEST")).toBe(true);
    expect(hasCapability("MANAGER", "SUBMISSION_TRANSITION_EXECUTE")).toBe(false);
  });

  it("rejects forbidden capability checks with a structured authorization error", () => {
    expect(() =>
      requireCapability({
        role: "VIEWER",
        capability: "GOVERNANCE_VIEW",
      }),
    ).toThrowError(AuthorizationError);
  });
});
