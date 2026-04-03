import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ContractValidationError } from "@/server/lib/errors";

export const PM_PROVISIONING_PAYLOAD_VERSION = 1 as const;

export const PM_PROVISIONING_JOB_TYPE = {
  PROPERTY_PROVISIONING: "PROPERTY_PROVISIONING",
} as const;

const baseEnvelopeSchema = z.object({
  payloadVersion: z.literal(PM_PROVISIONING_PAYLOAD_VERSION),
  requestId: z.string().min(1),
  organizationId: z.string().min(1),
  buildingId: z.string().min(1),
  operationalJobId: z.string().min(1),
  triggeredAt: z.string().datetime(),
});

const propertyProvisioningEnvelopeSchema = baseEnvelopeSchema.extend({
  jobType: z.literal(PM_PROVISIONING_JOB_TYPE.PROPERTY_PROVISIONING),
  trigger: z.enum(["BUILDING_CREATE", "RETRY"]),
});

export const portfolioManagerProvisioningEnvelopeSchema =
  propertyProvisioningEnvelopeSchema;

export type PortfolioManagerProvisioningEnvelope = z.infer<
  typeof propertyProvisioningEnvelopeSchema
>;

function contractError(message: string, details?: Record<string, unknown>) {
  return new ContractValidationError(message, { details });
}

export function buildPortfolioManagerProvisioningEnvelope(input: {
  requestId?: string | null;
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  trigger: "BUILDING_CREATE" | "RETRY";
  triggeredAt?: Date;
}): PortfolioManagerProvisioningEnvelope {
  return {
    payloadVersion: PM_PROVISIONING_PAYLOAD_VERSION,
    requestId: input.requestId ?? randomUUID(),
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    operationalJobId: input.operationalJobId,
    jobType: PM_PROVISIONING_JOB_TYPE.PROPERTY_PROVISIONING,
    trigger: input.trigger,
    triggeredAt: (input.triggeredAt ?? new Date()).toISOString(),
  };
}

export function peekPortfolioManagerProvisioningEnvelopeContext(input: unknown) {
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
    jobType:
      typeof record["jobType"] === "string" ? record["jobType"] : null,
    payloadVersion:
      typeof record["payloadVersion"] === "number"
        ? record["payloadVersion"]
        : null,
  };
}

export function parsePortfolioManagerProvisioningEnvelope(
  input: unknown,
): PortfolioManagerProvisioningEnvelope {
  const context = peekPortfolioManagerProvisioningEnvelopeContext(input);

  if (
    context.payloadVersion != null &&
    context.payloadVersion !== PM_PROVISIONING_PAYLOAD_VERSION
  ) {
    throw contractError("Unsupported Portfolio Manager provisioning payload version.", {
      payloadVersion: context.payloadVersion,
      supportedPayloadVersion: PM_PROVISIONING_PAYLOAD_VERSION,
    });
  }

  const parsed = propertyProvisioningEnvelopeSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throw contractError("Invalid Portfolio Manager provisioning envelope payload.", {
    payloadVersion: context.payloadVersion,
    jobType: context.jobType,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}
