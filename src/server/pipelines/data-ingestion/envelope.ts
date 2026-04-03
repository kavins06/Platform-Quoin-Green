import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ContractValidationError } from "@/server/lib/errors";

export const INGESTION_PAYLOAD_VERSION = 1 as const;

export const INGESTION_JOB_TYPE = {
  CSV_UPLOAD_PIPELINE: "CSV_UPLOAD_PIPELINE",
  GREEN_BUTTON_NOTIFICATION: "GREEN_BUTTON_NOTIFICATION",
} as const;

export const INGESTION_SOURCE_SYSTEM = {
  CSV_UPLOAD: "CSV_UPLOAD",
  GREEN_BUTTON: "GREEN_BUTTON",
  MANUAL: "MANUAL",
  SYSTEM: "SYSTEM",
} as const;

const triggerTypeSchema = z.enum(["CSV_UPLOAD", "MANUAL", "WEBHOOK", "SCHEDULED"]);

const csvUploadPayloadSchema = z.object({
  uploadBatchId: z.string().min(1),
  triggerType: triggerTypeSchema,
});

const greenButtonNotificationPayloadSchema = z.object({
  connectionId: z.string().min(1),
  notificationUri: z.string().url(),
  subscriptionId: z.string().min(1),
  resourceUri: z.string().url().nullable().optional(),
});

const baseEnvelopeSchema = z.object({
  payloadVersion: z.literal(INGESTION_PAYLOAD_VERSION),
  requestId: z.string().min(1),
  organizationId: z.string().min(1),
  buildingId: z.string().min(1),
  triggeredAt: z.string().datetime(),
});

const csvUploadEnvelopeSchema = baseEnvelopeSchema.extend({
  jobType: z.literal(INGESTION_JOB_TYPE.CSV_UPLOAD_PIPELINE),
  sourceSystem: z.enum([
    INGESTION_SOURCE_SYSTEM.CSV_UPLOAD,
    INGESTION_SOURCE_SYSTEM.MANUAL,
    INGESTION_SOURCE_SYSTEM.SYSTEM,
  ]),
  payload: csvUploadPayloadSchema,
});

const greenButtonNotificationEnvelopeSchema = baseEnvelopeSchema.extend({
  jobType: z.literal(INGESTION_JOB_TYPE.GREEN_BUTTON_NOTIFICATION),
  sourceSystem: z.literal(INGESTION_SOURCE_SYSTEM.GREEN_BUTTON),
  payload: greenButtonNotificationPayloadSchema,
});

export const ingestionEnvelopeSchema = z.discriminatedUnion("jobType", [
  csvUploadEnvelopeSchema,
  greenButtonNotificationEnvelopeSchema,
]);

export type CsvUploadIngestionEnvelope = z.infer<typeof csvUploadEnvelopeSchema>;
export type GreenButtonNotificationIngestionEnvelope =
  z.infer<typeof greenButtonNotificationEnvelopeSchema>;
export type IngestionEnvelope = z.infer<typeof ingestionEnvelopeSchema>;

const legacyCsvUploadSchema = z.object({
  buildingId: z.string().min(1),
  organizationId: z.string().min(1),
  uploadBatchId: z.string().min(1),
  triggerType: triggerTypeSchema,
});

function contractError(message: string, details?: Record<string, unknown>) {
  return new ContractValidationError(message, { details });
}

function parseWithContractError<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
  message: string,
  details?: Record<string, unknown>,
) {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throw contractError(message, {
    ...(details ?? {}),
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

export function buildCsvUploadIngestionEnvelope(input: {
  requestId?: string | null;
  organizationId: string;
  buildingId: string;
  uploadBatchId: string;
  triggerType: "CSV_UPLOAD" | "MANUAL" | "WEBHOOK" | "SCHEDULED";
  sourceSystem?: "CSV_UPLOAD" | "MANUAL" | "SYSTEM";
  triggeredAt?: Date;
}): CsvUploadIngestionEnvelope {
  return {
    payloadVersion: INGESTION_PAYLOAD_VERSION,
    jobType: INGESTION_JOB_TYPE.CSV_UPLOAD_PIPELINE,
    sourceSystem: input.sourceSystem ?? INGESTION_SOURCE_SYSTEM.CSV_UPLOAD,
    requestId: input.requestId ?? randomUUID(),
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    triggeredAt: (input.triggeredAt ?? new Date()).toISOString(),
    payload: {
      uploadBatchId: input.uploadBatchId,
      triggerType: input.triggerType,
    },
  };
}

export function buildGreenButtonNotificationEnvelope(input: {
  requestId: string;
  organizationId: string;
  buildingId: string;
  connectionId: string;
  notificationUri: string;
  subscriptionId: string;
  resourceUri?: string | null;
  triggeredAt?: Date;
}): GreenButtonNotificationIngestionEnvelope {
  return {
    payloadVersion: INGESTION_PAYLOAD_VERSION,
    jobType: INGESTION_JOB_TYPE.GREEN_BUTTON_NOTIFICATION,
    sourceSystem: INGESTION_SOURCE_SYSTEM.GREEN_BUTTON,
    requestId: input.requestId,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    triggeredAt: (input.triggeredAt ?? new Date()).toISOString(),
    payload: {
      connectionId: input.connectionId,
      notificationUri: input.notificationUri,
      subscriptionId: input.subscriptionId,
      resourceUri: input.resourceUri ?? null,
    },
  };
}

export function peekIngestionEnvelopeContext(input: unknown) {
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;

  if (!record) {
    return {
      requestId: null,
      organizationId: null,
      buildingId: null,
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
    jobType:
      typeof record["jobType"] === "string" ? record["jobType"] : null,
    payloadVersion:
      typeof record["payloadVersion"] === "number"
        ? record["payloadVersion"]
        : null,
  };
}

export function parseIngestionEnvelope(input: unknown): IngestionEnvelope {
  const context = peekIngestionEnvelopeContext(input);

  if (context.payloadVersion != null && context.payloadVersion !== INGESTION_PAYLOAD_VERSION) {
    throw contractError("Unsupported ingestion payload version.", {
      payloadVersion: context.payloadVersion,
      supportedPayloadVersion: INGESTION_PAYLOAD_VERSION,
    });
  }

  const parsedEnvelope = ingestionEnvelopeSchema.safeParse(input);
  if (parsedEnvelope.success) {
    return parsedEnvelope.data;
  }

  const parsedLegacy = legacyCsvUploadSchema.safeParse(input);
  if (parsedLegacy.success) {
    return buildCsvUploadIngestionEnvelope({
      requestId: `legacy:${parsedLegacy.data.organizationId}:${parsedLegacy.data.buildingId}:${parsedLegacy.data.uploadBatchId}`,
      organizationId: parsedLegacy.data.organizationId,
      buildingId: parsedLegacy.data.buildingId,
      uploadBatchId: parsedLegacy.data.uploadBatchId,
      triggerType: parsedLegacy.data.triggerType,
      sourceSystem:
        parsedLegacy.data.triggerType === "MANUAL"
          ? INGESTION_SOURCE_SYSTEM.MANUAL
          : INGESTION_SOURCE_SYSTEM.CSV_UPLOAD,
    });
  }

  throw parseWithContractError(
    ingestionEnvelopeSchema,
    input,
    "Invalid ingestion envelope payload.",
    {
      payloadVersion: context.payloadVersion,
      jobType: context.jobType,
    },
  );
}
