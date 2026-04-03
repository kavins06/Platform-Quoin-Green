import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ContractValidationError } from "@/server/lib/errors";

export const PM_SETUP_PAYLOAD_VERSION = 1 as const;

export const PM_SETUP_JOB_TYPE = {
  APPLY_BUILDING_SETUP: "APPLY_BUILDING_SETUP",
} as const;

const setupEnvelopeSchema = z.object({
  payloadVersion: z.literal(PM_SETUP_PAYLOAD_VERSION),
  requestId: z.string().min(1),
  organizationId: z.string().min(1),
  buildingId: z.string().min(1),
  operationalJobId: z.string().min(1),
  triggeredAt: z.string().datetime(),
  jobType: z.literal(PM_SETUP_JOB_TYPE.APPLY_BUILDING_SETUP),
});

export type PortfolioManagerSetupEnvelope = z.infer<typeof setupEnvelopeSchema>;

function contractError(message: string, details?: Record<string, unknown>) {
  return new ContractValidationError(message, { details });
}

export function buildPortfolioManagerSetupEnvelope(input: {
  requestId?: string | null;
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  triggeredAt?: Date;
}): PortfolioManagerSetupEnvelope {
  return {
    payloadVersion: PM_SETUP_PAYLOAD_VERSION,
    requestId: input.requestId ?? randomUUID(),
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    operationalJobId: input.operationalJobId,
    triggeredAt: (input.triggeredAt ?? new Date()).toISOString(),
    jobType: PM_SETUP_JOB_TYPE.APPLY_BUILDING_SETUP,
  };
}

export function peekPortfolioManagerSetupEnvelopeContext(input: unknown) {
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;

  if (!record) {
    return {
      requestId: null,
      organizationId: null,
      buildingId: null,
      operationalJobId: null,
      jobType: null,
      payloadVersion: null,
    };
  }

  return {
    requestId:
      typeof record["requestId"] === "string" ? record["requestId"] : null,
    organizationId:
      typeof record["organizationId"] === "string"
        ? record["organizationId"]
        : null,
    buildingId:
      typeof record["buildingId"] === "string" ? record["buildingId"] : null,
    operationalJobId:
      typeof record["operationalJobId"] === "string"
        ? record["operationalJobId"]
        : null,
    jobType: typeof record["jobType"] === "string" ? record["jobType"] : null,
    payloadVersion:
      typeof record["payloadVersion"] === "number"
        ? record["payloadVersion"]
        : null,
  };
}

export function parsePortfolioManagerSetupEnvelope(input: unknown) {
  const context = peekPortfolioManagerSetupEnvelopeContext(input);

  if (
    context.payloadVersion != null &&
    context.payloadVersion !== PM_SETUP_PAYLOAD_VERSION
  ) {
    throw contractError("Unsupported Portfolio Manager setup payload version.", {
      payloadVersion: context.payloadVersion,
      supportedPayloadVersion: PM_SETUP_PAYLOAD_VERSION,
    });
  }

  const parsed = setupEnvelopeSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throw contractError("Invalid Portfolio Manager setup envelope payload.", {
    payloadVersion: context.payloadVersion,
    jobType: context.jobType,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}
