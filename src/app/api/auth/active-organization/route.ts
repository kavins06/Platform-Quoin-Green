import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/server/lib/auth-cookies";
import { resolveRequestAuth } from "@/server/lib/auth";
import { listOrganizationMembershipsForUser } from "@/server/lib/organization-membership";
import { createAuditLog } from "@/server/lib/audit-log";
import {
  applyRateLimit,
  createRateLimitExceededResponse,
  getRateLimitClientKey,
  withRateLimitHeaders,
} from "@/server/lib/rate-limit";

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

/**
 * Stores the active organization cookie after validating membership.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const rateLimit = await applyRateLimit({
    scope: "auth-active-organization",
    key: getRateLimitClientKey(request),
    limit: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return createRateLimitExceededResponse({
      message: "Too many organization switch attempts. Please wait and try again.",
      result: rateLimit,
    });
  }

  const auth = await resolveRequestAuth();
  if (!auth.authUserId) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      rateLimit,
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { organizationId?: string }
    | null;
  const organizationId = body?.organizationId?.trim() ?? "";

  if (!organizationId) {
    return withRateLimitHeaders(
      NextResponse.json(
        { error: "organizationId is required." },
        { status: 400 },
      ),
      rateLimit,
    );
  }

  const membershipData = await listOrganizationMembershipsForUser({
    authUserId: auth.authUserId,
  });
  const allowed = membershipData.memberships.some(
    (membership: { organizationId: string }) =>
      membership.organizationId === organizationId,
  );

  if (!allowed) {
    return withRateLimitHeaders(
      NextResponse.json(
        { error: "Organization membership not found." },
        { status: 403 },
      ),
      rateLimit,
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, getCookieOptions());
  await createAuditLog({
    actorType: "USER",
    actorId: auth.authUserId,
    organizationId,
    action: "AUTH_ACTIVE_ORGANIZATION_SET",
    requestId,
  }).catch(() => null);
  return withRateLimitHeaders(response, rateLimit);
}

/**
 * Clears the active organization cookie.
 */
export async function DELETE() {
  const requestId = randomUUID();
  const response = NextResponse.json({ success: true });
  response.cookies.delete(ACTIVE_ORGANIZATION_COOKIE);
  const auth = await resolveRequestAuth();
  if (auth.authUserId) {
    await createAuditLog({
      actorType: "USER",
      actorId: auth.authUserId,
      organizationId: auth.activeOrganizationId ?? null,
      action: "AUTH_ACTIVE_ORGANIZATION_CLEARED",
      requestId,
    }).catch(() => null);
  }
  return response;
}
