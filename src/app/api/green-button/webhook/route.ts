import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { createAuditLog } from "@/server/lib/audit-log";
import { prisma } from "@/server/lib/db";
import { toAppError } from "@/server/lib/errors";
import {
  createJob,
  markCompleted,
  markDead,
  markFailed,
  markRunning,
} from "@/server/lib/jobs";
import { createLogger } from "@/server/lib/logger";
import { extractSubscriptionId } from "@/server/integrations/green-button";
import { enqueueGreenButtonNotificationJob } from "@/server/pipelines/data-ingestion/green-button";
import {
  markGreenButtonIngestionFailed,
  noteGreenButtonWebhookReceived,
} from "@/server/compliance/integration-runtime";
import {
  applyRateLimit,
  createRateLimitExceededResponse,
  getRateLimitClientKey,
} from "@/server/lib/rate-limit";

const webhookParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

function extractNotificationUri(parsed: Record<string, unknown>) {
  let notificationUri: string | null = null;

  const batchList = parsed["BatchList"] as Record<string, unknown> | undefined;
  if (batchList) {
    const resources = batchList["resources"] as string | undefined;
    notificationUri = resources ?? null;
  }

  const feed = parsed["feed"] as Record<string, unknown> | undefined;
  if (feed) {
    const entries = feed["entry"];
    const entryArray = Array.isArray(entries) ? entries : entries ? [entries] : [];
    for (const entry of entryArray as Record<string, unknown>[]) {
      const content = entry["content"] as Record<string, unknown> | undefined;
      const batchUrl = content?.["BatchList"] ?? entry["link"] ?? null;
      if (typeof batchUrl === "string") {
        notificationUri = batchUrl;
        break;
      }

      const link = entry["link"] as Record<string, unknown> | undefined;
      if (link?.["@_href"]) {
        notificationUri = String(link["@_href"]);
        break;
      }
    }
  }

  return notificationUri;
}

/**
 * POST /api/green-button/webhook
 * Public endpoint that receives utility push notifications and enqueues a
 * canonical ingestion envelope for background processing.
 */
export async function POST(req: NextRequest) {
  const rateLimit = await applyRateLimit({
    scope: "green-button-webhook",
    key: getRateLimitClientKey(req),
    limit: 120,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return createRateLimitExceededResponse({
      message: "Too many Green Button webhook requests. Please wait and try again.",
      result: rateLimit,
    });
  }

  const requestId = randomUUID();
  const job = await createJob({
    type: "GREEN_BUTTON_WEBHOOK",
    maxAttempts: 3,
  });
  const runningJob = await markRunning(job.id);
  const logger = createLogger({
    requestId,
    jobId: job.id,
    procedure: "greenButton.webhook",
  });
  const safelyPersist = async (
    label: string,
    operation: () => Promise<unknown>,
  ) => {
    try {
      await operation();
    } catch (persistenceError) {
      logger.error("Green Button webhook persistence failed", {
        error: persistenceError,
        persistenceLabel: label,
      });
    }
  };
  const writeAudit = (input: {
    action: string;
    inputSnapshot?: Record<string, unknown>;
    outputSnapshot?: Record<string, unknown>;
    errorCode?: string | null;
  }) =>
    createAuditLog({
      actorType: "SYSTEM",
      requestId,
      action: input.action,
      inputSnapshot: {
        jobId: job.id,
        ...(input.inputSnapshot ?? {}),
      },
      outputSnapshot: input.outputSnapshot,
      errorCode: input.errorCode ?? null,
    }).catch((auditError) => {
      logger.error("Green Button webhook audit log persistence failed", {
        error: auditError,
        auditAction: input.action,
      });
      return null;
    });

  await writeAudit({
    action: "green_button.webhook.received",
  });
  await writeAudit({
    action: "green_button.webhook.started",
  });

  try {
    const body = await req.text();

    if (!body.trim()) {
      await safelyPersist("job.dead", () =>
        markDead(runningJob.id, "Empty request body"),
      );
      await writeAudit({
        action: "green_button.webhook.failed",
        outputSnapshot: {
          retryable: false,
        },
        errorCode: "VALIDATION_ERROR",
      });
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    const parsed = webhookParser.parse(body) as Record<string, unknown>;
    const notificationUri = extractNotificationUri(parsed);

    if (!notificationUri) {
      logger.warn("Green Button webhook payload did not include notification URI");
      await safelyPersist("job.completed", () => markCompleted(runningJob.id));
      await writeAudit({
        action: "green_button.webhook.ignored",
        outputSnapshot: {
          reason: "missing_notification_uri",
        },
      });
      return NextResponse.json({ received: true });
    }

    const subscriptionId = extractSubscriptionId(notificationUri);
    if (!subscriptionId) {
      logger.warn("Green Button webhook notification URI did not contain subscription ID", {
        notificationUri,
      });
      await safelyPersist("job.completed", () => markCompleted(runningJob.id));
      await writeAudit({
        action: "green_button.webhook.ignored",
        inputSnapshot: {
          notificationUri,
        },
        outputSnapshot: {
          reason: "missing_subscription_id",
        },
      });
      return NextResponse.json({ received: true });
    }

    const connection = await prisma.greenButtonConnection.findFirst({
      where: {
        status: "ACTIVE",
        subscriptionId,
      },
      select: {
        id: true,
        organizationId: true,
        buildingId: true,
        subscriptionId: true,
        resourceUri: true,
      },
    });

    if (!connection) {
      logger.warn("Green Button webhook could not resolve active connection", {
        notificationUri,
        subscriptionId,
      });
      await safelyPersist("job.completed", () => markCompleted(runningJob.id));
      await writeAudit({
        action: "green_button.webhook.ignored",
        inputSnapshot: {
          notificationUri,
          subscriptionId,
        },
        outputSnapshot: {
          reason: "connection_not_found",
        },
      });
      return NextResponse.json({ received: true });
    }

    try {
      await noteGreenButtonWebhookReceived({
        connectionId: connection.id,
      });
      await writeAudit({
        action: "green_button.webhook.enqueue_attempted",
        inputSnapshot: {
          notificationUri,
          subscriptionId,
          organizationId: connection.organizationId,
          buildingId: connection.buildingId,
        },
      });

      const enqueueResult = await enqueueGreenButtonNotificationJob({
        requestId,
        organizationId: connection.organizationId,
        buildingId: connection.buildingId,
        connectionId: connection.id,
        notificationUri,
        subscriptionId: connection.subscriptionId ?? subscriptionId,
        resourceUri: connection.resourceUri,
      });
      if (enqueueResult.deduplicated) {
        logger.info("Green Button webhook already queued", {
          notificationUri,
          subscriptionId,
          queueJobId: enqueueResult.queueJobId,
        });
        await safelyPersist("job.completed", () => markCompleted(runningJob.id));
        await writeAudit({
          action: "green_button.webhook.enqueue_succeeded",
          inputSnapshot: {
            notificationUri,
            subscriptionId,
            organizationId: connection.organizationId,
            buildingId: connection.buildingId,
          },
          outputSnapshot: {
            queue: enqueueResult.queueName,
            payloadVersion: enqueueResult.payloadVersion,
            jobType: enqueueResult.jobType,
            deduplicated: true,
            queueJobId: enqueueResult.queueJobId,
          },
        });
        await writeAudit({
          action: "green_button.webhook.completed",
          outputSnapshot: {
            queue: enqueueResult.queueName,
            deduplicated: true,
          },
        });
        return NextResponse.json({ received: true });
      }
      logger.info("Enqueued Green Button webhook job", {
        notificationUri,
        subscriptionId,
        organizationId: connection.organizationId,
        buildingId: connection.buildingId,
        queueJobId: enqueueResult.queueJobId,
      });

      await safelyPersist("job.completed", () => markCompleted(runningJob.id));
      await writeAudit({
        action: "green_button.webhook.enqueue_succeeded",
        inputSnapshot: {
          notificationUri,
          subscriptionId,
          organizationId: connection.organizationId,
          buildingId: connection.buildingId,
        },
        outputSnapshot: {
          queue: enqueueResult.queueName,
          payloadVersion: enqueueResult.payloadVersion,
          jobType: enqueueResult.jobType,
          queueJobId: enqueueResult.queueJobId,
        },
      });
      await writeAudit({
        action: "green_button.webhook.completed",
        outputSnapshot: {
          queue: enqueueResult.queueName,
        },
      });
    } catch (queueErr) {
      const appError = toAppError(queueErr);
      await markGreenButtonIngestionFailed({
        connectionId: connection.id,
        jobId: runningJob.id,
        errorCode: appError.code,
        errorMessage: appError.message,
        retryScheduled:
          appError.retryable && runningJob.attempts < runningJob.maxAttempts,
      }).catch((runtimeError) => {
        logger.error("Failed to persist Green Button enqueue runtime state", {
          error: runtimeError,
          notificationUri,
          subscriptionId,
        });
      });
      logger.error("Failed to enqueue Green Button webhook job", {
        error: appError,
        notificationUri,
        subscriptionId,
      });
      if (appError.retryable && runningJob.attempts < runningJob.maxAttempts) {
        await safelyPersist("job.failed", () =>
          markFailed(runningJob.id, appError.message),
        );
      } else {
        await safelyPersist("job.dead", () =>
          markDead(runningJob.id, appError.message),
        );
      }
      await writeAudit({
        action: "green_button.webhook.enqueue_failed",
        inputSnapshot: {
          notificationUri,
          subscriptionId,
          organizationId: connection.organizationId,
          buildingId: connection.buildingId,
        },
        outputSnapshot: {
          retryable: appError.retryable,
        },
        errorCode: appError.code,
      });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const appError = toAppError(err);
    logger.error("Error processing Green Button webhook notification", {
      error: appError,
    });
    if (appError.retryable && runningJob.attempts < runningJob.maxAttempts) {
      await safelyPersist("job.failed", () =>
        markFailed(runningJob.id, appError.message),
      );
    } else {
      await safelyPersist("job.dead", () =>
        markDead(runningJob.id, appError.message),
      );
    }
    await writeAudit({
      action: "green_button.webhook.failed",
      outputSnapshot: {
        retryable: appError.retryable,
      },
      errorCode: appError.code,
    });
    return NextResponse.json({ received: true });
  }
}
