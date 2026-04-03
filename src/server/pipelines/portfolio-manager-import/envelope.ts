import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ContractValidationError } from "@/server/lib/errors";

export const PM_IMPORT_PAYLOAD_VERSION = 1 as const;

export const PM_IMPORT_JOB_TYPE = {
  EXISTING_ACCOUNT_PROPERTY_IMPORT: "EXISTING_ACCOUNT_PROPERTY_IMPORT",
} as const;

const importEnvelopeSchema = z.object({
  payloadVersion: z.literal(PM_IMPORT_PAYLOAD_VERSION),
  requestId: z.string().min(1),
  organizationId: z.string().min(1),
  operationalJobId: z.string().min(1),
  propertyIds: z.array(z.string().min(1)).min(1),
  triggeredAt: z.string().datetime(),
  jobType: z.literal(PM_IMPORT_JOB_TYPE.EXISTING_ACCOUNT_PROPERTY_IMPORT),
});

export type PortfolioManagerImportEnvelope = z.infer<
  typeof importEnvelopeSchema
>;

function contractError(message: string, details?: Record<string, unknown>) {
  return new ContractValidationError(message, { details });
}

export function buildPortfolioManagerImportEnvelope(input: {
  requestId?: string | null;
  organizationId: string;
  operationalJobId: string;
  propertyIds: string[];
  triggeredAt?: Date;
}): PortfolioManagerImportEnvelope {
  return {
    payloadVersion: PM_IMPORT_PAYLOAD_VERSION,
    requestId: input.requestId ?? randomUUID(),
    organizationId: input.organizationId,
    operationalJobId: input.operationalJobId,
    propertyIds: input.propertyIds,
    triggeredAt: (input.triggeredAt ?? new Date()).toISOString(),
    jobType: PM_IMPORT_JOB_TYPE.EXISTING_ACCOUNT_PROPERTY_IMPORT,
  };
}

export function peekPortfolioManagerImportEnvelopeContext(input: unknown) {
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;

  if (!record) {
    return {
      requestId: null,
      organizationId: null,
      operationalJobId: null,
      propertyIds: [],
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
    operationalJobId:
      typeof record["operationalJobId"] === "string"
        ? record["operationalJobId"]
        : null,
    propertyIds: Array.isArray(record["propertyIds"])
      ? record["propertyIds"].filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
      : [],
    jobType:
      typeof record["jobType"] === "string" ? record["jobType"] : null,
    payloadVersion:
      typeof record["payloadVersion"] === "number"
        ? record["payloadVersion"]
        : null,
  };
}

export function parsePortfolioManagerImportEnvelope(
  input: unknown,
): PortfolioManagerImportEnvelope {
  const context = peekPortfolioManagerImportEnvelopeContext(input);

  if (context.payloadVersion != null && context.payloadVersion !== PM_IMPORT_PAYLOAD_VERSION) {
    throw contractError("Unsupported Portfolio Manager import payload version.", {
      payloadVersion: context.payloadVersion,
      supportedPayloadVersion: PM_IMPORT_PAYLOAD_VERSION,
    });
  }

  const parsed = importEnvelopeSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throw contractError("Invalid Portfolio Manager import envelope payload.", {
    payloadVersion: context.payloadVersion,
    jobType: context.jobType,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}
