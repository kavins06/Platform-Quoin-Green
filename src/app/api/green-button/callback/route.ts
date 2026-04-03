import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  upsertGreenButtonCredentials,
} from "@/server/integrations/green-button";
import { toAppError } from "@/server/lib/errors";
import { createAuditLog } from "@/server/lib/audit-log";
import {
  createJob,
  markCompleted,
  markDead,
  markFailed,
  markRunning,
} from "@/server/lib/jobs";
import { createLogger } from "@/server/lib/logger";
import {
  TenantAccessError,
  requireTenantContextFromSession,
} from "@/server/lib/tenant-access";
import {
  requireGreenButtonTokenMasterKey,
  getOptionalGreenButtonConfig,
} from "@/server/lib/config";
import { refreshSourceReconciliationDataIssues } from "@/server/compliance/data-issues";
import {
  applyRateLimit,
  createRateLimitExceededResponse,
  getRateLimitClientKey,
} from "@/server/lib/rate-limit";

const GREEN_BUTTON_STATE_COOKIE = "quoin_green_button_oauth_state";

function clearStateCookie(response: NextResponse) {
  response.cookies.delete(GREEN_BUTTON_STATE_COOKIE);
  return response;
}

/**
 * GET /api/green-button/callback?code=xxx&state=xxx
 * Handles the OAuth callback from Pepco after user authorization.
 * Exchanges the code for tokens and stores them encrypted on the building.
 */
export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const logger = createLogger({
    requestId,
    procedure: "greenButton.callback",
  });
  const rateLimit = await applyRateLimit({
    scope: "green-button-callback",
    key: getRateLimitClientKey(req),
    limit: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return createRateLimitExceededResponse({
      message: "Too many Green Button callback attempts. Please wait and try again.",
      result: rateLimit,
    });
  }
  let tenant;
  try {
    tenant = await requireTenantContextFromSession();
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return clearStateCookie(
        NextResponse.redirect(new URL("/sign-in", req.nextUrl.origin)),
      );
    }

    throw error;
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  // User denied authorization
  if (error) {
    const buildingId = state?.split(":")?.[1];
    const redirectUrl = buildingId
      ? `/buildings/${buildingId}?gb=denied`
      : "/dashboard?gb=denied";
    return clearStateCookie(
      NextResponse.redirect(new URL(redirectUrl, req.nextUrl.origin)),
    );
  }

  if (!code || !state) {
    return clearStateCookie(
      NextResponse.redirect(
        new URL("/dashboard?gb=error", req.nextUrl.origin),
      ),
    );
  }

  const expectedState = req.cookies.get(GREEN_BUTTON_STATE_COOKIE)?.value ?? null;
  if (!expectedState || expectedState !== state) {
    logger.warn("Green Button callback state validation failed");
    return clearStateCookie(
      NextResponse.redirect(
        new URL("/dashboard?gb=error", req.nextUrl.origin),
      ),
    );
  }

  // Extract buildingId from state (format: csrfToken:buildingId)
  const stateParts = state.split(":");
  if (stateParts.length < 2) {
    return clearStateCookie(
      NextResponse.redirect(
        new URL("/dashboard?gb=error", req.nextUrl.origin),
      ),
    );
  }
  const buildingId = stateParts[1]!;
  const job = await createJob({
    type: "GREEN_BUTTON_CALLBACK",
    organizationId: tenant.organizationId,
    buildingId,
    maxAttempts: 1,
  });
  const runningJob = await markRunning(job.id);
  const jobLogger = logger.child({
    jobId: job.id,
    organizationId: tenant.organizationId,
    buildingId,
    userId: tenant.authUserId,
  });
  const safelyPersist = async (
    label: string,
    operation: () => Promise<unknown>,
  ) => {
    try {
      await operation();
    } catch (persistenceError) {
      jobLogger.error("Green Button callback persistence failed", {
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
      actorType: "USER",
      actorId: tenant.authUserId,
      organizationId: tenant.organizationId,
      buildingId,
      requestId,
      action: input.action,
      inputSnapshot: input.inputSnapshot,
      outputSnapshot: input.outputSnapshot,
      errorCode: input.errorCode ?? null,
    }).catch((auditError) => {
      jobLogger.error("Green Button callback audit log persistence failed", {
        error: auditError,
        auditAction: input.action,
      });
      return null;
    });

  await writeAudit({
    action: "green_button.callback.received",
    inputSnapshot: {
      buildingId,
    },
  });
  await writeAudit({
    action: "green_button.callback.started",
    inputSnapshot: {
      buildingId,
    },
  });

  const config = getOptionalGreenButtonConfig();
  if (!config) {
    jobLogger.warn("Green Button callback received without integration config");
    await safelyPersist("job.dead", () =>
      markDead(runningJob.id, "Green Button is not configured"),
    );
    await writeAudit({
      action: "green_button.callback.failed",
      inputSnapshot: {
        buildingId,
      },
      outputSnapshot: {
        retryable: false,
      },
      errorCode: "CONFIG_ERROR",
    });
    return clearStateCookie(
      NextResponse.redirect(
        new URL(`/buildings/${buildingId}?gb=error`, req.nextUrl.origin),
      ),
    );
  }

  const encryptionKey = requireGreenButtonTokenMasterKey();

  const building = await tenant.tenantDb.building.findUnique({
    where: { id: buildingId },
    select: { id: true },
  });
  if (!building) {
    await safelyPersist("job.dead", () =>
      markDead(runningJob.id, "Building not found"),
    );
    await writeAudit({
      action: "green_button.callback.failed",
      inputSnapshot: {
        buildingId,
      },
      outputSnapshot: {
        retryable: false,
      },
      errorCode: "NOT_FOUND",
    });
    return clearStateCookie(
      NextResponse.redirect(
        new URL("/dashboard?gb=error", req.nextUrl.origin),
      ),
    );
  }

  try {
    await writeAudit({
      action: "green_button.callback.external_request.started",
      inputSnapshot: {
        buildingId,
        externalService: "GREEN_BUTTON_OAUTH",
      },
    });
    const tokens = await exchangeCodeForTokens(config, code);
    await writeAudit({
      action: "green_button.callback.external_request.succeeded",
      inputSnapshot: {
        buildingId,
        externalService: "GREEN_BUTTON_OAUTH",
      },
      outputSnapshot: {
        subscriptionId: tokens.subscriptionId,
        resourceUri: tokens.resourceUri,
      },
    });

    await upsertGreenButtonCredentials({
      db: tenant.tenantDb,
      organizationId: tenant.organizationId,
      buildingId,
      tokens,
      masterKey: encryptionKey,
      status: "ACTIVE",
      runtimeStatus: "IDLE",
    });

    await tenant.tenantDb.building.update({
      where: { id: buildingId },
      data: {
        greenButtonStatus: "ACTIVE",
        dataIngestionMethod: "GREEN_BUTTON",
      },
    });

    try {
      await refreshSourceReconciliationDataIssues({
        organizationId: tenant.organizationId,
        buildingId,
        actorType: "USER",
        actorId: tenant.authUserId,
        requestId,
      });
    } catch (reconciliationError) {
      jobLogger.warn("Green Button callback reconciliation refresh failed", {
        error: reconciliationError,
      });
    }

    await safelyPersist("job.completed", () => markCompleted(runningJob.id));
    await writeAudit({
      action: "green_button.callback.succeeded",
      inputSnapshot: {
        buildingId,
      },
      outputSnapshot: {
        subscriptionId: tokens.subscriptionId,
        resourceUri: tokens.resourceUri,
      },
    });

    return clearStateCookie(
      NextResponse.redirect(
        new URL(`/buildings/${buildingId}?gb=success`, req.nextUrl.origin),
      ),
    );
  } catch (err) {
    const appError = toAppError(err);
    await writeAudit({
      action: "green_button.callback.external_request.failed",
      inputSnapshot: {
        buildingId,
        externalService: "GREEN_BUTTON_OAUTH",
      },
      outputSnapshot: {
        retryable: appError.retryable,
      },
      errorCode: appError.code,
    });
    jobLogger.error("Green Button callback failed", {
      error: appError,
      retryable: appError.retryable,
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
      action: "green_button.callback.failed",
      inputSnapshot: {
        buildingId,
      },
      outputSnapshot: {
        retryable: appError.retryable,
      },
      errorCode: appError.code,
    });

    await tenant.tenantDb.building.update({
      where: { id: buildingId },
      data: { greenButtonStatus: "FAILED" },
    });
    await tenant.tenantDb.greenButtonConnection.updateMany({
      where: {
        buildingId,
        organizationId: tenant.organizationId,
      },
      data: {
        status: "FAILED",
        latestErrorCode: appError.code,
        latestErrorMessage: appError.message,
      },
    });

    try {
      await refreshSourceReconciliationDataIssues({
        organizationId: tenant.organizationId,
        buildingId,
        actorType: "USER",
        actorId: tenant.authUserId,
        requestId,
      });
    } catch (reconciliationError) {
      jobLogger.warn("Green Button callback reconciliation refresh failed", {
        error: reconciliationError,
      });
    }

    return clearStateCookie(
      NextResponse.redirect(
        new URL(`/buildings/${buildingId}?gb=error`, req.nextUrl.origin),
      ),
    );
  }
}

