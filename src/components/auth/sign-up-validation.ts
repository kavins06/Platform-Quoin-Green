export interface SignUpValidationInput {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptedTerms: boolean;
}

/**
 * Returns the first operator-facing sign-up validation error, if any.
 */
export function getSignUpValidationError(input: SignUpValidationInput): string | null {
  if (!input.name.trim()) {
    return "Enter your full name.";
  }

  if (!input.email.trim()) {
    return "Enter your email address.";
  }

  if (input.password.length < 8) {
    return "Use a password with at least 8 characters.";
  }

  if (input.password !== input.confirmPassword) {
    return "Re-enter the same password to continue.";
  }

  if (!input.acceptedTerms) {
    return "Accept the terms and conditions to create your workspace.";
  }

  return null;
}
