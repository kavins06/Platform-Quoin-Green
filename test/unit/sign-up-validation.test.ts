import { describe, expect, it } from "vitest";
import { getSignUpValidationError } from "@/components/auth/sign-up-validation";

describe("getSignUpValidationError", () => {
  it("requires a matching confirmation password", () => {
    expect(
      getSignUpValidationError({
        name: "Kavin S",
        email: "kavin@example.com",
        password: "password-123",
        confirmPassword: "password-456",
        acceptedTerms: true,
      }),
    ).toBe("Re-enter the same password to continue.");
  });

  it("requires terms acceptance", () => {
    expect(
      getSignUpValidationError({
        name: "Kavin S",
        email: "kavin@example.com",
        password: "password-123",
        confirmPassword: "password-123",
        acceptedTerms: false,
      }),
    ).toBe("Accept the terms and conditions to create your workspace.");
  });

  it("returns null for a valid submission", () => {
    expect(
      getSignUpValidationError({
        name: "Kavin S",
        email: "kavin@example.com",
        password: "password-123",
        confirmPassword: "password-123",
        acceptedTerms: true,
      }),
    ).toBeNull();
  });
});
