export type PrimaryComplianceSurfaceStatus =
  | "DATA_INCOMPLETE"
  | "READY"
  | "COMPLIANT"
  | "NON_COMPLIANT";

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

export interface ComplianceEngineSurfaceResult {
  status: string | null;
  metricUsed: string | null;
  qaVerdict: string | null;
  ruleVersion: string | null;
  reasonCodes: string[];
  decision: {
    meetsStandard: boolean | null;
    blocked: boolean;
    insufficientData: boolean;
  };
  raw: RecordLike | null;
}

export function extractComplianceEngineResult(
  payload: unknown,
): ComplianceEngineSurfaceResult | null {
  const record = asRecord(payload);
  const engine = asRecord(record?.complianceEngine ?? record?.engineResult);

  if (!engine) {
    return null;
  }

  const qa = asRecord(engine.qa);
  const decision = asRecord(engine.decision);

  return {
    status: typeof engine.status === "string" ? engine.status : null,
    metricUsed: typeof engine.metricUsed === "string" ? engine.metricUsed : null,
    qaVerdict: typeof qa?.verdict === "string" ? qa.verdict : null,
    ruleVersion: typeof engine.ruleVersion === "string" ? engine.ruleVersion : null,
    reasonCodes: Array.isArray(engine.reasonCodes)
      ? engine.reasonCodes.filter((value): value is string => typeof value === "string")
      : [],
    decision: {
      meetsStandard:
        typeof decision?.meetsStandard === "boolean"
          ? decision.meetsStandard
          : null,
      blocked: decision?.blocked === true,
      insufficientData: decision?.insufficientData === true,
    },
    raw: engine,
  };
}

export function derivePrimaryComplianceStatus(input: {
  benchmark: ComplianceEngineSurfaceResult | null;
  beps: ComplianceEngineSurfaceResult | null;
}): PrimaryComplianceSurfaceStatus {
  if (input.benchmark?.qaVerdict === "FAIL" || input.benchmark?.decision.blocked) {
    return "DATA_INCOMPLETE";
  }

  if (input.beps) {
    if (input.beps.status === "COMPUTED" && input.beps.decision.meetsStandard === true) {
      return "COMPLIANT";
    }

    if (input.beps.status === "COMPUTED" && input.beps.decision.meetsStandard === false) {
      return "NON_COMPLIANT";
    }

    if (input.beps.decision.blocked || input.beps.decision.insufficientData) {
      return "DATA_INCOMPLETE";
    }
  }

  if (input.benchmark && input.benchmark.qaVerdict !== "FAIL") {
    return "READY";
  }

  return "DATA_INCOMPLETE";
}

export function humanizeReasonCode(code: string | null | undefined) {
  if (!code) {
    return "No reason code";
  }

  return code
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function summarizeReasonCodes(reasonCodes: string[]) {
  if (reasonCodes.length === 0) {
    return "No blocking reason codes recorded";
  }

  return reasonCodes.slice(0, 2).map(humanizeReasonCode).join(" · ");
}
