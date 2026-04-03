import { cookies } from "next/headers";

export const ACTIVE_ORGANIZATION_COOKIE = "quoin_active_organization";

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

/**
 * Reads the active Quoin organization selection from the request cookie jar.
 */
export async function getActiveOrganizationCookie() {
  const cookieStore = await cookies();
  const value = cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value?.trim() ?? "";

  return value.length > 0 ? value : null;
}

/**
 * Persists the active Quoin organization selection in an HTTP-only cookie.
 */
export async function setActiveOrganizationCookie(organizationId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, getCookieOptions());
}

/**
 * Clears the active Quoin organization selection cookie.
 */
export async function clearActiveOrganizationCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORGANIZATION_COOKIE);
}
