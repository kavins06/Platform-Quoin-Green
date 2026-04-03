import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ContractValidationError } from "@/server/lib/errors";

export const PM_PROVIDER_SYNC_PAYLOAD_VERSION = 1 as const;

export const PM_PROVIDER_SYNC_JOB_TYPE = {
  PROVIDER_CONNECTION_SYNC: "PROVIDER_CONNECTION_SYNC",
} as const;

const providerSyncEnvelopeSchema = z.object({
  payloadVersion: z.literal(PM_PROVIDER_SYNC_PAYLOAD_VERSION),
  requestId: z.string().min(1),
  organizationId: z.string().min(1),
  operationalJobId: z.string().min(1),
  triggeredAt: z.string().datetime(),
  jobType: z.literal(PM_PROVIDER_SYNC_JOB_TYPE.PROVIDER_CONNECTION_SYNC),
});

export type PortfolioManagerProviderSyncEnvelope = z.infer<
  typeof providerSyncEnvelopeSchema
>;

function contractError(message: string, details?: Record<string, unknown>) {
  return new ContractValidationError(message, { details });
}

export function buildPortfolioManagerProviderSyncEnvelope(input: {
  requestId?: string | null;
  organizationId: string;
  operationalJobId: string;
  triggeredAt?: Date;
}) {
  return {
    payloadVersion: PM_PROVIDER_SYNC_PAYLOAD_VERSION,
    requestId: input.requestId ?? randomUUID(),
    organizationId: input.organizationId,
    operationalJobId: input.operationalJobId,
    triggeredAt: (input.triggeredAt ?? new Date()).toISOString(),
    jobType: PM_PROVIDER_SYNC_JOB_TYPE.PROVIDER_CONNECTION_SYNC,
  } satisfies PortfolioManagerProviderSyncEnvelope;
}

export function peekPortfolioManagerProviderSyncEnvelopeContext(input: unknown) {
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;

  if (!record) {
    return {
      requestId: null,
      organizationId: null,
      operationalJobId: null,
      jobType: null,
      payloadVersion: null,
    };
  }

  return {
    requestId: typeof record.requestId === "string" ? record.requestId : null,
    organizationId:
      typeof record.organizationId === "string" ? record.organizationId : null,
    operationalJobId:
      typeof record.operationalJobId === "string" ? record.operationalJobId : null,
    jobType: typeof record.jobType === "string" ? record.jobType : null,
    payloadVersion:
      typeof record.payloadVersion === "number" ? record.payloadVersion : null,
  };
}

export function parsePortfolioManagerProviderSyncEnvelope(input: unknown) {
  const context = peekPortfolioManagerProviderSyncEnvelopeContext(input);

  if (
    context.payloadVersion != null &&
    context.payloadVersion !== PM_PROVIDER_SYNC_PAYLOAD_VERSION
  ) {
    throw contractError("Unsupported Portfolio Manager provider sync payload version.", {
      payloadVersion: context.payloadVersion,
      supportedPayloadVersion: PM_PROVIDER_SYNC_PAYLOAD_VERSION,
    });
  }

  const parsed = providerSyncEnvelopeSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throw contractError("Invalid Portfolio Manager provider sync envelope payload.", {
    payloadVersion: context.payloadVersion,
    jobType: context.jobType,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}
