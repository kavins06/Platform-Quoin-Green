import type { UserRole } from "@/generated/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveOrganizationCookie } from "@/server/lib/auth-cookies";
import { prisma } from "@/server/lib/db";

export interface ResolvedRequestAuth {
  authUserId: string | null;
  email: string | null;
  name: string | null;
  activeOrganizationId: string | null;
}

export interface ResolvedMembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: UserRole;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Resolves the current Supabase-authenticated request, if present.
 */
export async function resolveRequestAuth(): Promise<ResolvedRequestAuth> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    const authUserId = normalizeIdentifier(claims?.sub);

    if (!authUserId) {
      return {
        authUserId: null,
        email: null,
        name: null,
        activeOrganizationId: await getActiveOrganizationCookie(),
      };
    }

    const userMetadata =
      claims && typeof claims === "object" && "user_metadata" in claims
        ? (claims.user_metadata as Record<string, unknown> | undefined)
        : undefined;

    return {
      authUserId,
      email: normalizeIdentifier(claims?.email),
      name:
        normalizeIdentifier(userMetadata?.full_name) ??
        normalizeIdentifier(userMetadata?.name),
      activeOrganizationId: await getActiveOrganizationCookie(),
    };
  } catch {
    return {
      authUserId: null,
      email: null,
      name: null,
      activeOrganizationId: await getActiveOrganizationCookie(),
    };
  }
}

/**
 * Lists the local Quoin memberships for the resolved authenticated user.
 */
export async function listMembershipSummariesForAuthUser(input: {
  authUserId: string;
}) {
  const user = await prisma.user.findUnique({
    where: {
      authUserId: input.authUserId,
    },
    select: {
      memberships: {
        orderBy: {
          organization: {
            name: "asc",
          },
        },
        select: {
          role: true,
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    return [] satisfies ResolvedMembershipSummary[];
  }

  return user.memberships.map((membership) => ({
    organizationId: membership.organization.id,
    organizationName: membership.organization.name,
    organizationSlug: membership.organization.slug,
    role: membership.role,
  }));
}
