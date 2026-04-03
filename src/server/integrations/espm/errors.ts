export class ESPMError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly espmErrorCode?: string,
    public readonly rawResponse?: string,
  ) {
    super(message);
    this.name = "ESPMError";
  }
}

export class ESPMAuthError extends ESPMError {
  constructor(message: string, rawResponse?: string) {
    super(message, 401, "AUTH_FAILED", rawResponse);
    this.name = "ESPMAuthError";
  }
}

export class ESPMAccessError extends ESPMError {
  constructor(message: string, rawResponse?: string) {
    super(message, 403, "ACCESS_DENIED", rawResponse);
    this.name = "ESPMAccessError";
  }
}

export class ESPMNotFoundError extends ESPMError {
  constructor(message: string, rawResponse?: string) {
    super(message, 404, "NOT_FOUND", rawResponse);
    this.name = "ESPMNotFoundError";
  }
}

export class ESPMRateLimitError extends ESPMError {
  constructor(rawResponse?: string) {
    super("ESPM rate limit exceeded", 429, "RATE_LIMIT", rawResponse);
    this.name = "ESPMRateLimitError";
  }
}

export class ESPMValidationError extends ESPMError {
  constructor(message: string, rawResponse?: string) {
    super(message, 400, "VALIDATION", rawResponse);
    this.name = "ESPMValidationError";
  }
}
