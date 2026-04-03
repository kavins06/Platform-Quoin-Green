import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRequestAuth: vi.fn(),
  listMembershipSummariesForAuthUser: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/server/lib/auth", () => ({
  resolveRequestAuth: mocks.resolveRequestAuth,
  listMembershipSummariesForAuthUser: mocks.listMembershipSummariesForAuthUser,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/components/layout/sidebar", () => ({
  Sidebar: () => createElement("div", { "data-testid": "sidebar" }, "Sidebar"),
}));

vi.mock("@/components/layout/topbar", () => ({
  Topbar: () => createElement("div", { "data-testid": "topbar" }, "Topbar"),
}));

import DashboardLayout from "@/app/(dashboard)/layout";

function setRedirectBehavior(): void {
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
}

describe("dashboard layout", () => {
  beforeEach(() => {
    mocks.resolveRequestAuth.mockReset();
    mocks.listMembershipSummariesForAuthUser.mockReset();
    mocks.redirect.mockReset();
    setRedirectBehavior();
  });

  it("redirects signed-out users to sign-in", async () => {
    mocks.resolveRequestAuth.mockResolvedValue({
      authUserId: null,
    });

    await expect(
      DashboardLayout({
        children: createElement("div", null, "Child content"),
      }),
    ).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("redirects signed-in users without an organization to onboarding", async () => {
    mocks.resolveRequestAuth.mockResolvedValue({
      authUserId: "user_123",
      activeOrganizationId: null,
    });
    mocks.listMembershipSummariesForAuthUser.mockResolvedValue([]);

    await expect(
      DashboardLayout({
        children: createElement("div", null, "Child content"),
      }),
    ).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("renders the dashboard shell when a user and organization are present", async () => {
    mocks.resolveRequestAuth.mockResolvedValue({
      authUserId: "user_123",
      activeOrganizationId: "org_123",
    });
    mocks.listMembershipSummariesForAuthUser.mockResolvedValue([
      {
        organizationId: "org_123",
        organizationName: "Benchmark Group",
        organizationSlug: "benchmark-group",
        role: "ADMIN",
      },
    ]);

    const element = await DashboardLayout({
      children: createElement("div", null, "Child content"),
    });

    expect(renderToStaticMarkup(element)).toContain("Child content");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
