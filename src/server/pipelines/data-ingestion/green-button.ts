import crypto from "node:crypto";
import { EnergyUnit, MeterType } from "@/generated/prisma/client";
import { QUEUES, withQueue } from "@/server/lib/queue";
import {
  aggregateToMonthly,
  fetchNotificationData,
  getValidToken,
} from "@/server/integrations/green-button";
import type { ESPM } from "@/server/integrations/espm";
import {
  requireGreenButtonTokenMasterKey,
  getOptionalGreenButtonConfig,
} from "@/server/lib/config";
import { createLogger, type StructuredLogger } from "@/server/lib/logger";
import { ValidationError, WorkflowStateError } from "@/server/lib/errors";
import { runIngestionPipeline, type IngestionPipelineResult } from "./logic";
import type { GreenButtonNotificationIngestionEnvelope } from "./envelope";
import { buildGreenButtonNotificationEnvelope } from "./envelope";
import { resolvePortfolioManagerClientForOrganization } from "@/server/portfolio-manager/existing-account";

type AuditWriter = (input: {
  action: string;
  inputSnapshot?: Record<string, unknown>;
  outputSnapshot?: Record<string, unknown>;
  errorCode?: string | null;
}) => Promise<unknown>;

type GreenButtonMeterRecord = {
  id: string;
  meterType: MeterType;
  name: string;
};

function meterNameForType(meterType: MeterType) {
  return meterType === "GAS" ? "Green Button Gas" : "Green Button Electric";
}

export function uploadBatchIdForGreenButtonNotification(notificationUri: string) {
  const hash = crypto
    .createHash("sha256")
    .update(notificationUri)
    .digest("hex")
    .slice(0, 16);
  return `gb_${hash}`;
}

function normalizeGreenButtonBatchUri(input: {
  notificationUri?: string | null;
  resourceUri?: string | null;
  subscriptionId: string;
}) {
  if (input.notificationUri) {
    return input.notificationUri;
  }

  if (!input.resourceUri) {
    throw new WorkflowStateError(
      "Green Button ingestion cannot be enqueued because no notification or resource URI is available.",
      {
        details: {
          subscriptionId: input.subscriptionId,
        },
      },
    );
  }

  const resourceUri = input.resourceUri.replace(/\/+$/, "");
  return `${resourceUri}/Batch/Subscription/${input.subscriptionId}`;
}

export async function enqueueGreenButtonNotificationJob(input: {
  requestId: string;
  organizationId: string;
  buildingId: string;
  connectionId: string;
  subscriptionId: string;
  resourceUri?: string | null;
  notificationUri?: string | null;
  triggeredAt?: Date;
}) {
  const notificationUri = normalizeGreenButtonBatchUri({
    notificationUri: input.notificationUri ?? null,
    resourceUri: input.resourceUri ?? null,
    subscriptionId: input.subscriptionId,
  });
  const envelope = buildGreenButtonNotificationEnvelope({
    requestId: input.requestId,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    connectionId: input.connectionId,
    notificationUri,
    subscriptionId: input.subscriptionId,
    resourceUri: input.resourceUri ?? null,
    triggeredAt: input.triggeredAt,
  });
  const queueJobId = `green-button:${input.connectionId}:${uploadBatchIdForGreenButtonNotification(
    notificationUri,
  )}`;
  const existingJob = await withQueue(QUEUES.DATA_INGESTION, async (queue) =>
    queue.getJob(queueJobId),
  );

  if (existingJob) {
    return {
      queueJobId,
      notificationUri,
      deduplicated: true,
      payloadVersion: envelope.payloadVersion,
      jobType: envelope.jobType,
      queueName: QUEUES.DATA_INGESTION,
    };
  }

  await withQueue(QUEUES.DATA_INGESTION, async (queue) => {
    await queue.add("green-button-webhook", envelope, {
      jobId: queueJobId,
    });
  });

  return {
    queueJobId,
    notificationUri,
    deduplicated: false,
    payloadVersion: envelope.payloadVersion,
    jobType: envelope.jobType,
    queueName: QUEUES.DATA_INGESTION,
  };
}

async function getOrCreateGreenButtonMeters(input: {
  organizationId: string;
  buildingId: string;
  meterTypes: MeterType[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenantDb: any;
}): Promise<Map<MeterType, GreenButtonMeterRecord>> {
  const existing = await input.tenantDb.meter.findMany({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      meterType: { in: input.meterTypes },
      name: {
        in: input.meterTypes.map(meterNameForType),
      },
    },
    select: {
      id: true,
      meterType: true,
      name: true,
    },
  });

  const existingMeters = existing as GreenButtonMeterRecord[];
  const byType = new Map<MeterType, GreenButtonMeterRecord>(
    existingMeters.map((meter) => [meter.meterType, meter]),
  );

  for (const meterType of input.meterTypes) {
    if (byType.has(meterType)) {
      continue;
    }

    const created = (await input.tenantDb.meter.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        meterType,
        name: meterNameForType(meterType),
        unit: EnergyUnit.KBTU,
        isActive: true,
      },
      select: {
        id: true,
        meterType: true,
        name: true,
      },
    })) as GreenButtonMeterRecord;

    byType.set(meterType, created);
  }

  return byType;
}

export async function processGreenButtonNotificationEnvelope(input: {
  envelope: GreenButtonNotificationIngestionEnvelope;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenantDb: any;
  logger?: StructuredLogger;
  writeAudit?: AuditWriter;
}): Promise<{
  uploadBatchId: string;
  importedCount: number;
  updatedCount: number;
  pipelineResult: IngestionPipelineResult | null;
}> {
  const logger =
    input.logger ??
    createLogger({
      requestId: input.envelope.requestId,
      organizationId: input.envelope.organizationId,
      buildingId: input.envelope.buildingId,
      procedure: "dataIngestion.greenButton",
    });
  const writeAudit = input.writeAudit ?? (async () => null);

  const config = getOptionalGreenButtonConfig();
  if (!config) {
    throw new WorkflowStateError(
      "Green Button notification cannot be processed because the integration is not configured.",
    );
  }

  const encryptionKey = requireGreenButtonTokenMasterKey();

  const connection = await input.tenantDb.greenButtonConnection.findFirst({
    where: {
      id: input.envelope.payload.connectionId,
      organizationId: input.envelope.organizationId,
      buildingId: input.envelope.buildingId,
    },
    select: {
      id: true,
      status: true,
      subscriptionId: true,
      resourceUri: true,
    },
  });

  if (!connection) {
    throw new WorkflowStateError(
      "Green Button notification connection could not be resolved for this building.",
      {
        details: {
          connectionId: input.envelope.payload.connectionId,
        },
      },
    );
  }

  if (connection.status !== "ACTIVE") {
    throw new WorkflowStateError(
      "Green Button notification connection is not active.",
      {
        details: {
          connectionId: connection.id,
          status: connection.status,
        },
      },
    );
  }

  await writeAudit({
    action: "green_button.worker.external_request.started",
    inputSnapshot: {
      connectionId: connection.id,
      notificationUri: input.envelope.payload.notificationUri,
      subscriptionId: input.envelope.payload.subscriptionId,
    },
  });

  const tokens = await getValidToken(
    {
      buildingId: input.envelope.buildingId,
      organizationId: input.envelope.organizationId,
      config,
      encryptionKey,
    },
    input.tenantDb,
  );

  const intervalReadings = await fetchNotificationData(
    input.envelope.payload.notificationUri,
    tokens.accessToken,
  );
  const monthlyReadings = aggregateToMonthly(intervalReadings);

  await writeAudit({
    action: "green_button.worker.external_request.succeeded",
    inputSnapshot: {
      connectionId: connection.id,
      notificationUri: input.envelope.payload.notificationUri,
    },
    outputSnapshot: {
      intervalReadingCount: intervalReadings.length,
      monthlyReadingCount: monthlyReadings.length,
    },
  });

  if (monthlyReadings.length === 0) {
    logger.info("Green Button notification contained no readings", {
      connectionId: connection.id,
      notificationUri: input.envelope.payload.notificationUri,
    });
    return {
      uploadBatchId: uploadBatchIdForGreenButtonNotification(
        input.envelope.payload.notificationUri,
      ),
      importedCount: 0,
      updatedCount: 0,
      pipelineResult: null,
    };
  }

  const uploadBatchId = uploadBatchIdForGreenButtonNotification(
    input.envelope.payload.notificationUri,
  );
  const meterTypes = Array.from(
    new Set(
      monthlyReadings.map((reading) =>
        reading.fuelType === "GAS" ? MeterType.GAS : MeterType.ELECTRIC,
      ),
    ),
  );
  const metersByType = await getOrCreateGreenButtonMeters({
    organizationId: input.envelope.organizationId,
    buildingId: input.envelope.buildingId,
    meterTypes,
    tenantDb: input.tenantDb,
  });

  const periodStartMin = monthlyReadings.reduce(
    (min, reading) =>
      reading.periodStart.getTime() < min.getTime() ? reading.periodStart : min,
    monthlyReadings[0]!.periodStart,
  );
  const periodEndMax = monthlyReadings.reduce(
    (max, reading) =>
      reading.periodEnd.getTime() > max.getTime() ? reading.periodEnd : max,
    monthlyReadings[0]!.periodEnd,
  );
  const existingReadings = (await input.tenantDb.energyReading.findMany({
    where: {
      organizationId: input.envelope.organizationId,
      buildingId: input.envelope.buildingId,
      source: "GREEN_BUTTON",
      periodStart: { gte: periodStartMin },
      periodEnd: { lte: periodEndMax },
    },
    select: {
      id: true,
      meterType: true,
      periodStart: true,
      periodEnd: true,
    },
  })) as Array<{
    id: string;
    meterType: MeterType;
    periodStart: Date;
    periodEnd: Date;
  }>;

  const existingByKey = new Map<string, (typeof existingReadings)[number]>(
    existingReadings.map((reading) => [
        `${reading.meterType}:${reading.periodStart.toISOString()}:${reading.periodEnd.toISOString()}`,
        reading,
      ]),
  );

  let importedCount = 0;
  let updatedCount = 0;

  for (const reading of monthlyReadings) {
    const meterType =
      reading.fuelType === "GAS" ? MeterType.GAS : MeterType.ELECTRIC;
    const meter = metersByType.get(meterType);
    if (!meter) {
      throw new WorkflowStateError("Green Button meter mapping could not be resolved.", {
        details: {
          meterType,
        },
      });
    }

    const periodEndExclusive = new Date(reading.periodEnd);
    const key = `${meterType}:${reading.periodStart.toISOString()}:${periodEndExclusive.toISOString()}`;
    const existing = existingByKey.get(key);
    const payload = {
      sourceSystem: "GREEN_BUTTON",
      requestId: input.envelope.requestId,
      notificationUri: input.envelope.payload.notificationUri,
      subscriptionId: input.envelope.payload.subscriptionId,
      resourceUri: input.envelope.payload.resourceUri ?? connection.resourceUri,
      importedAt: new Date().toISOString(),
      intervalSeconds: reading.intervalSeconds,
      isEstimated: reading.isEstimated,
      normalizedUnit: EnergyUnit.KBTU,
    };

    if (existing) {
      await input.tenantDb.energyReading.update({
        where: { id: existing.id },
        data: {
          meterId: meter.id,
          meterType,
          consumption: reading.consumptionKBtu,
          unit: EnergyUnit.KBTU,
          consumptionKbtu: reading.consumptionKBtu,
          cost: reading.cost,
          uploadBatchId,
          rawPayload: payload,
        },
      });
      updatedCount += 1;
      continue;
    }

    await input.tenantDb.energyReading.create({
      data: {
        organizationId: input.envelope.organizationId,
        buildingId: input.envelope.buildingId,
        source: "GREEN_BUTTON",
        meterType,
        meterId: meter.id,
        periodStart: reading.periodStart,
        periodEnd: periodEndExclusive,
        consumption: reading.consumptionKBtu,
        unit: EnergyUnit.KBTU,
        consumptionKbtu: reading.consumptionKBtu,
        cost: reading.cost,
        isVerified: false,
        uploadBatchId,
        rawPayload: payload,
      },
    });
    importedCount += 1;
  }

  let espmClient: ESPM | undefined;
  try {
    espmClient = await resolvePortfolioManagerClientForOrganization({
      organizationId: input.envelope.organizationId,
    });
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      throw error;
    }
  }

  const pipelineResult = await runIngestionPipeline({
    buildingId: input.envelope.buildingId,
    organizationId: input.envelope.organizationId,
    uploadBatchId,
    triggerType: "WEBHOOK",
    tenantDb: input.tenantDb,
    espmClient,
  });

  logger.info("Green Button notification processed", {
    connectionId: connection.id,
    uploadBatchId,
    importedCount,
    updatedCount,
    pipelineSummary: pipelineResult.summary,
  });

  return {
    uploadBatchId,
    importedCount,
    updatedCount,
    pipelineResult,
  };
}
