import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  useQuery: vi.fn(),
  createUseMutation: vi.fn(),
  sessionInvalidate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      organization: {
        session: {
          invalidate: mocks.sessionInvalidate,
        },
      },
    }),
    organization: {
      session: {
        useQuery: mocks.useQuery,
      },
      create: {
        useMutation: mocks.createUseMutation,
      },
    },
  },
}));

import { Topbar } from "@/components/layout/topbar";

describe("topbar", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.refresh.mockReset();
    mocks.useQuery.mockReset();
    mocks.sessionInvalidate.mockReset();
    mocks.sessionInvalidate.mockResolvedValue(undefined);
    mocks.createUseMutation.mockReset();
    mocks.createUseMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
      reset: vi.fn(),
    });
    mocks.useQuery.mockReturnValue({
      data: {
        user: {
          id: "user_1",
          name: "Jordan Benchmark",
          email: "jordan@example.com",
        },
        activeOrganizationId: "org_1",
        memberships: [
          {
            id: "membership_1",
            role: "ADMIN",
            organization: {
              id: "org_1",
              name: "Benchmark Group",
              slug: "benchmark-group",
            },
          },
        ],
      },
    });
  });

  it("renders the Quoin-managed workspace switcher", () => {
    const html = renderToStaticMarkup(createElement(Topbar));

    expect(html).toContain("Organization");
    expect(html).toContain("Benchmark Group");
    expect(html).toContain("+ Add organization");
    expect(html).not.toContain("Settings");
  });

  it("renders the user name and sign-out action", () => {
    const html = renderToStaticMarkup(createElement(Topbar));

    expect(html).toContain("Jordan Benchmark");
    expect(html).toContain("Sign out");
  });

  it("wires workspace creation through the topbar flow", () => {
    const source = renderToStaticMarkup(createElement(Topbar));
    expect(source).toContain("+ Add organization");

    const fileSource = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/components/layout/topbar.tsx"),
      "utf8",
    );

    expect(fileSource).toContain("trpc.organization.create.useMutation");
    expect(fileSource).toContain('const ADD_ORGANIZATION_VALUE = "__add_organization__"');
    expect(fileSource).toContain("Add organization");
    expect(fileSource).toContain("Create organization");
    expect(fileSource).toContain("/api/auth/active-organization");
  });
});
