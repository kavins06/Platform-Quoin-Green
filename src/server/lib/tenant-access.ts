import { getTenantClient } from "@/server/lib/db";
import { resolveRequestAuth } from "@/server/lib/auth";
import {
  ensureUserRecord,
  listOrganizationMembershipsForUser,
  type AppRole,
} from "@/server/lib/organization-membership";
import {
  listCapabilitiesForRole,
  hasCapability,
  type Capability,
} from "@/server/lib/capabilities";

export class TenantAccessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TenantAccessError";
  }
}

export interface TenantContext {
  authUserId: string;
  userId: string;
  actorId: string;
  appRole: AppRole;
  capabilities: Capability[];
  organizationId: string;
  tenantDb: ReturnType<typeof getTenantClient>;
}

export function normalizeTenantIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Resolves the tenant-scoped runtime context from the current auth state.
 */
export async function requireTenantContext(input: {
  authUserId?: string | null;
  email?: string | null;
  name?: string | null;
  activeOrganizationId?: string | null;
}) {
  const authUserId = normalizeTenantIdentifier(input.authUserId);
  if (!authUserId) {
    throw new TenantAccessError("Unauthorized", 401);
  }

  const user = await ensureUserRecord({
    authUserId,
    email: input.email,
    name: input.name,
  });
  const membershipData = await listOrganizationMembershipsForUser({
    authUserId,
  });

  if (membershipData.memberships.length === 0) {
    throw new TenantAccessError(
      "No organization selected. Please create an organization to continue.",
      403,
    );
  }

  const requestedOrganizationId = normalizeTenantIdentifier(input.activeOrganizationId);
  const membership =
    membershipData.memberships.find(
      (entry) => entry.organizationId === requestedOrganizationId,
    ) ?? (membershipData.memberships.length === 1 ? membershipData.memberships[0] : null);

  if (!membership) {
    throw new TenantAccessError(
      "No organization selected. Please choose one of your organizations.",
      403,
    );
  }

  return {
    authUserId,
    userId: user.id,
    actorId: authUserId,
    appRole: membership.role,
    capabilities: listCapabilitiesForRole(membership.role),
    organizationId: membership.organizationId,
    tenantDb: getTenantClient(membership.organizationId),
  } satisfies TenantContext;
}

export function canManageOperatorActions(appRole: AppRole) {
  return hasCapability(appRole, "BUILDING_WRITE");
}

/**
 * Resolves the tenant context directly from the current request session.
 */
export async function requireTenantContextFromSession() {
  const auth = await resolveRequestAuth();
  if (!auth.authUserId) {
    throw new TenantAccessError("Unauthorized", 401);
  }

  return requireTenantContext(auth);
}

/**
 * Resolves the tenant context and asserts the current user can manage operator workflows.
 */
export async function requireOperatorTenantContextFromSession() {
  const tenant = await requireTenantContextFromSession();

  if (!canManageOperatorActions(tenant.appRole)) {
    throw new TenantAccessError(
      "Operator access is required for this action.",
      403,
    );
  }

  return tenant;
}
