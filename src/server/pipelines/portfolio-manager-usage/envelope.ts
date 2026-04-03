import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PortfolioManagerUsageDirection } from "@/generated/prisma/client";
import { ContractValidationError } from "@/server/lib/errors";

export const PM_USAGE_PAYLOAD_VERSION = 1 as const;

export const PM_USAGE_JOB_TYPE = {
  USAGE_PUSH_APPLY: "USAGE_PUSH_APPLY",
  USAGE_IMPORT_APPLY: "USAGE_IMPORT_APPLY",
} as const;

const usageEnvelopeSchema = z.object({
  payloadVersion: z.literal(PM_USAGE_PAYLOAD_VERSION),
  requestId: z.string().min(1),
  organizationId: z.string().min(1),
  buildingId: z.string().min(1),
  operationalJobId: z.string().min(1),
  reportingYear: z.number().int().min(2000).max(2100),
  direction: z.nativeEnum(PortfolioManagerUsageDirection),
  triggeredAt: z.string().datetime(),
  jobType: z.enum([
    PM_USAGE_JOB_TYPE.USAGE_PUSH_APPLY,
    PM_USAGE_JOB_TYPE.USAGE_IMPORT_APPLY,
  ]),
});

export type PortfolioManagerUsageEnvelope = z.infer<typeof usageEnvelopeSchema>;

function contractError(message: string, details?: Record<string, unknown>) {
  return new ContractValidationError(message, { details });
}

export function buildPortfolioManagerUsageEnvelope(input: {
  requestId?: string | null;
  organizationId: string;
  buildingId: string;
  operationalJobId: string;
  reportingYear: number;
  direction: PortfolioManagerUsageDirection;
  jobType:
    | typeof PM_USAGE_JOB_TYPE.USAGE_PUSH_APPLY
    | typeof PM_USAGE_JOB_TYPE.USAGE_IMPORT_APPLY;
  triggeredAt?: Date;
}) {
  return {
    payloadVersion: PM_USAGE_PAYLOAD_VERSION,
    requestId: input.requestId ?? randomUUID(),
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    operationalJobId: input.operationalJobId,
    reportingYear: input.reportingYear,
    direction: input.direction,
    triggeredAt: (input.triggeredAt ?? new Date()).toISOString(),
    jobType: input.jobType,
  } satisfies PortfolioManagerUsageEnvelope;
}

export function peekPortfolioManagerUsageEnvelopeContext(input: unknown) {
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
      reportingYear: null,
      direction: null,
      jobType: null,
      payloadVersion: null,
    };
  }

  return {
    requestId: typeof record.requestId === "string" ? record.requestId : null,
    organizationId:
      typeof record.organizationId === "string" ? record.organizationId : null,
    buildingId: typeof record.buildingId === "string" ? record.buildingId : null,
    operationalJobId:
      typeof record.operationalJobId === "string" ? record.operationalJobId : null,
    reportingYear:
      typeof record.reportingYear === "number" ? record.reportingYear : null,
    direction: typeof record.direction === "string" ? record.direction : null,
    jobType: typeof record.jobType === "string" ? record.jobType : null,
    payloadVersion:
      typeof record.payloadVersion === "number" ? record.payloadVersion : null,
  };
}

export function parsePortfolioManagerUsageEnvelope(input: unknown) {
  const context = peekPortfolioManagerUsageEnvelopeContext(input);

  if (
    context.payloadVersion != null &&
    context.payloadVersion !== PM_USAGE_PAYLOAD_VERSION
  ) {
    throw contractError("Unsupported Portfolio Manager usage payload version.", {
      payloadVersion: context.payloadVersion,
      supportedPayloadVersion: PM_USAGE_PAYLOAD_VERSION,
    });
  }

  const parsed = usageEnvelopeSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throw contractError("Invalid Portfolio Manager usage envelope payload.", {
    payloadVersion: context.payloadVersion,
    jobType: context.jobType,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}
