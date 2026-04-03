import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizationUrl,
  generateState,
} from "@/server/integrations/green-button";
import { createLogger } from "@/server/lib/logger";
import {
  TenantAccessError,
  requireTenantContextFromSession,
} from "@/server/lib/tenant-access";
import { getOptionalGreenButtonConfig } from "@/server/lib/config";
import {
  applyRateLimit,
  createRateLimitExceededResponse,
  getRateLimitClientKey,
  withRateLimitHeaders,
} from "@/server/lib/rate-limit";

const GREEN_BUTTON_STATE_COOKIE = "quoin_green_button_oauth_state";

function getStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  };
}

/**
 * GET /api/green-button/authorize?buildingId=xxx
 * Initiates Green Button OAuth flow by redirecting to the utility's authorization page.
 */
export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const logger = createLogger({
    requestId,
    procedure: "greenButton.authorize",
  });
  const rateLimit = await applyRateLimit({
    scope: "green-button-authorize",
    key: getRateLimitClientKey(req),
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return createRateLimitExceededResponse({
      message: "Too many Green Button authorization attempts. Please wait and try again.",
      result: rateLimit,
    });
  }
  let tenant;
  try {
    tenant = await requireTenantContextFromSession();
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return withRateLimitHeaders(
        NextResponse.json({ error: error.message }, { status: error.status }),
        rateLimit,
      );
    }

    throw error;
  }

  const buildingId = req.nextUrl.searchParams.get("buildingId");
  if (!buildingId) {
    logger.warn("Green Button authorization requested without buildingId");
    return withRateLimitHeaders(
      NextResponse.json(
        { error: "buildingId is required", requestId },
        { status: 400 },
      ),
      rateLimit,
    );
  }

  const config = getOptionalGreenButtonConfig();
  if (!config) {
    logger.warn("Green Button authorization attempted without configuration", {
      buildingId,
    });
    return withRateLimitHeaders(
      NextResponse.json(
        { error: "Green Button is not configured", requestId },
        { status: 503 },
      ),
      rateLimit,
    );
  }

  const building = await tenant.tenantDb.building.findUnique({
    where: { id: buildingId },
  });
  if (!building) {
    logger.warn("Green Button authorization requested for missing building", {
      buildingId,
    });
    return withRateLimitHeaders(
      NextResponse.json(
        { error: "Building not found", requestId },
        { status: 404 },
      ),
      rateLimit,
    );
  }

  // Generate CSRF state that encodes buildingId for the callback
  const csrfToken = generateState();
  const state = `${csrfToken}:${buildingId}`;

  // Update building status to PENDING_AUTH
  await tenant.tenantDb.building.update({
    where: { id: buildingId },
    data: { greenButtonStatus: "PENDING_AUTH" },
  });

  const authUrl = buildAuthorizationUrl(config, state);
  logger.info("Redirecting to Green Button authorization endpoint", {
    buildingId,
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(GREEN_BUTTON_STATE_COOKIE, state, getStateCookieOptions());
  return withRateLimitHeaders(response, rateLimit);
}
