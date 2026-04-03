import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureUserRecord: vi.fn(),
  listOrganizationMembershipsForUser: vi.fn(),
  getTenantClient: vi.fn(() => ({ tenant: true })),
}));

vi.mock("@/server/lib/db", () => ({
  getTenantClient: mocks.getTenantClient,
}));

vi.mock("@/server/lib/organization-membership", () => ({
  ensureUserRecord: mocks.ensureUserRecord,
  listOrganizationMembershipsForUser: mocks.listOrganizationMembershipsForUser,
}));

import {
  TenantAccessError,
  normalizeTenantIdentifier,
  requireTenantContext,
} from "@/server/lib/tenant-access";

describe("tenant access", () => {
  beforeEach(() => {
    mocks.ensureUserRecord.mockReset();
    mocks.listOrganizationMembershipsForUser.mockReset();
    mocks.getTenantClient.mockClear();
  });

  it("normalizes only non-empty string identifiers", () => {
    expect(normalizeTenantIdentifier(" org_123 ")).toBe("org_123");
    expect(normalizeTenantIdentifier("")).toBeNull();
    expect(normalizeTenantIdentifier("   ")).toBeNull();
    expect(normalizeTenantIdentifier(null)).toBeNull();
    expect(normalizeTenantIdentifier(undefined)).toBeNull();
    expect(normalizeTenantIdentifier(42)).toBeNull();
  });

  it("rejects invalid auth ids before memberships are loaded", async () => {
    await expect(
      requireTenantContext({
        authUserId: { bad: true } as unknown as string,
      }),
    ).rejects.toMatchObject({
      name: "TenantAccessError",
      message: "Unauthorized",
      status: 401,
    } satisfies Partial<TenantAccessError>);

    expect(mocks.ensureUserRecord).not.toHaveBeenCalled();
    expect(mocks.listOrganizationMembershipsForUser).not.toHaveBeenCalled();
  });

  it("returns the matching membership when the active organization is valid", async () => {
    mocks.ensureUserRecord.mockResolvedValue({
      id: "user_123",
    });
    mocks.listOrganizationMembershipsForUser.mockResolvedValue({
      memberships: [
        {
          organizationId: "org_123",
          role: "ADMIN",
        },
      ],
    });

    const tenant = await requireTenantContext({
      authUserId: "auth_user_123",
      activeOrganizationId: "org_123",
      email: "operator@example.com",
      name: "Operator",
    });

    expect(tenant).toMatchObject({
      authUserId: "auth_user_123",
      userId: "user_123",
      actorId: "auth_user_123",
      appRole: "ADMIN",
      organizationId: "org_123",
    });
    expect(mocks.getTenantClient).toHaveBeenCalledWith("org_123");
  });
});
