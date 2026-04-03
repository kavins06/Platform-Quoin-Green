import { prisma } from "@/server/lib/db";

export type AppRole = "ADMIN" | "MANAGER" | "ENGINEER" | "VIEWER";

interface EnsureUserRecordInput {
  authUserId: string;
  email?: string | null;
  name?: string | null;
}

interface UpsertOrganizationInput {
  name: string;
  slug?: string | null;
}

/**
 * Normalizes a label into a URL-safe organization slug.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Ensures a local Quoin user exists for the provided Supabase identity.
 */
export async function ensureUserRecord(input: EnsureUserRecordInput) {
  const authUserId = input.authUserId.trim();
  if (!authUserId) {
    throw new Error("authUserId is required.");
  }

  const email =
    input.email?.trim() || `${authUserId.toLowerCase()}@placeholder.local`;
  const name = input.name?.trim() || "Unknown";

  const existingUser = await prisma.user.findUnique({
    where: {
      authUserId,
    },
  });

  if (existingUser) {
    return prisma.user.update({
      where: { id: existingUser.id },
      data: {
        authUserId,
        email,
        name,
      },
    });
  }

  return prisma.user.create({
    data: {
      authUserId,
      email,
      name,
    },
  });
}

/**
 * Creates or updates a local organization record by its Quoin slug.
 */
export async function upsertOrganization(input: UpsertOrganizationInput) {
  const normalizedSlug = input.slug?.trim() || slugify(input.name);
  const existing = await prisma.organization.findFirst({
    where: { slug: normalizedSlug },
    select: { id: true },
  });

  if (existing) {
    return prisma.organization.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        slug: normalizedSlug,
      },
    });
  }

  return prisma.organization.create({
    data: {
      name: input.name,
      slug: normalizedSlug,
      tier: "FREE",
      settings: {},
    },
  });
}

/**
 * Creates or updates a membership for the given organization and auth user.
 */
export async function upsertOrganizationMembership(params: {
  organizationId: string;
  authUserId: string;
  role: AppRole;
  email?: string | null;
  name?: string | null;
}) {
  const user = await ensureUserRecord({
    authUserId: params.authUserId,
    email: params.email,
    name: params.name,
  });

  const existingMembership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: params.organizationId,
        userId: user.id,
      },
    },
  });

  if (existingMembership) {
    return prisma.organizationMembership.update({
      where: { id: existingMembership.id },
      data: {
        organizationId: params.organizationId,
        userId: user.id,
        role: params.role,
      },
    });
  }

  return prisma.organizationMembership.create({
    data: {
      organizationId: params.organizationId,
      userId: user.id,
      role: params.role,
    },
  });
}

/**
 * Creates a new Quoin-managed organization and seeds the creator as admin.
 */
export async function createOrganizationForUser(params: {
  authUserId: string;
  email?: string | null;
  name?: string | null;
  organizationName: string;
  organizationSlug?: string | null;
}) {
  const organization = await upsertOrganization({
    name: params.organizationName,
    slug: params.organizationSlug,
  });

  await upsertOrganizationMembership({
    organizationId: organization.id,
    authUserId: params.authUserId,
    role: "ADMIN",
    email: params.email,
    name: params.name,
  });

  return organization;
}

/**
 * Lists memberships for the provided auth user.
 */
export async function listOrganizationMembershipsForUser(params: {
  authUserId: string;
}) {
  const user = await prisma.user.findUnique({
    where: {
      authUserId: params.authUserId,
    },
    select: {
      id: true,
      memberships: {
        orderBy: {
          organization: {
            name: "asc",
          },
        },
        include: {
          organization: true,
        },
      },
    },
  });

  return {
    userId: user?.id ?? null,
    memberships: user?.memberships ?? [],
  };
}

/**
 * Deletes a membership using the Quoin organization and user identifiers.
 */
export async function deleteOrganizationMembership(params: {
  organizationId: string;
  userId: string;
}) {
  const deleted = await prisma.organizationMembership.deleteMany({
    where: {
      organizationId: params.organizationId,
      userId: params.userId,
    },
  });

  return deleted.count;
}
