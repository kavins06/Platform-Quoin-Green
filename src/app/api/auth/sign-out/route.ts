import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/server/lib/auth-cookies";
import { resolveRequestAuth } from "@/server/lib/auth";
import { createAuditLog } from "@/server/lib/audit-log";

/**
 * Signs the current Supabase user out and clears Quoin tenant selection state.
 */
export async function POST() {
  const requestId = randomUUID();
  const auth = await resolveRequestAuth();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const response = NextResponse.json({ success: true });
  response.cookies.delete(ACTIVE_ORGANIZATION_COOKIE);
  if (auth.authUserId) {
    await createAuditLog({
      actorType: "USER",
      actorId: auth.authUserId,
      organizationId: auth.activeOrganizationId ?? null,
      action: "AUTH_SIGN_OUT",
      requestId,
    }).catch(() => null);
  }
  return response;
}
