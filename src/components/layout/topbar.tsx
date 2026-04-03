"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { trpc } from "@/lib/trpc";

const ADD_ORGANIZATION_VALUE = "__add_organization__";

/**
 * Renders the app-owned organization switcher and account actions.
 */
export function Topbar() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const session = trpc.organization.session.useQuery(undefined, {
    retry: false,
  });
  const [isSwitching, setIsSwitching] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [organizationName, setOrganizationName] = useState("");

  const memberships = session.data?.memberships ?? [];
  const activeOrganizationId =
    session.data?.activeOrganizationId ?? memberships[0]?.organization.id ?? "";
  const activeOrganization =
    memberships.find(
      (membership: (typeof memberships)[number]) =>
        membership.organization.id === activeOrganizationId,
    ) ?? memberships[0] ?? null;
  const createOrganization = trpc.organization.create.useMutation({
    onSuccess: async (organization) => {
      await fetch("/api/auth/active-organization", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ organizationId: organization.id }),
      });
      setOrganizationName("");
      setIsCreateDialogOpen(false);
      await utils.organization.session.invalidate();

      startTransition(() => {
        router.push("/buildings");
        router.refresh();
      });
    },
  });

  async function handleOrganizationChange(organizationId: string) {
    if (organizationId === ADD_ORGANIZATION_VALUE) {
      setIsCreateDialogOpen(true);
      return;
    }

    setIsSwitching(true);

    try {
      await fetch("/api/auth/active-organization", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ organizationId }),
      });

      startTransition(() => {
        router.push("/buildings");
        router.refresh();
      });
    } finally {
      setIsSwitching(false);
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
      });

      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.push("/sign-in");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  function handleCreateOrganization() {
    if (!organizationName.trim()) {
      return;
    }

    createOrganization.mutate({
      name: organizationName.trim(),
    });
  }

  return (
    <>
      <header
        className="sticky top-0 z-30 flex h-14 items-center justify-end gap-3 px-6 lg:px-10"
        style={{
          backgroundColor: "rgba(248,247,243,0.88)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(207, 211, 214, 0.7)",
        }}
      >
        {memberships.length > 0 ? (
          <label className="flex items-center gap-2 font-dashboard-sans text-[0.88rem] font-medium tracking-[0.01em] text-zinc-500">
            Organization
            <select
              value={activeOrganizationId}
              onChange={(event) => handleOrganizationChange(event.target.value)}
              disabled={isSwitching || createOrganization.isPending}
              className="min-w-[14rem] border-0 border-b border-zinc-300 bg-transparent px-0 py-1 font-dashboard-sans text-[0.95rem] font-medium tracking-[0.01em] text-zinc-900 outline-none transition focus:border-zinc-500 disabled:opacity-60"
            >
              {memberships.map((membership: (typeof memberships)[number]) => (
                <option
                  key={membership.organization.id}
                  value={membership.organization.id}
                >
                  {membership.organization.name}
                </option>
              ))}
              <option value={ADD_ORGANIZATION_VALUE}>+ Add organization</option>
            </select>
          </label>
        ) : (
          <Link
            href="/onboarding"
            className="font-dashboard-sans text-[0.94rem] font-medium text-zinc-900 transition hover:text-zinc-600"
          >
            Create organization
          </Link>
        )}

        <div
          className="hidden sm:block"
          style={{ width: "1px", height: "16px", backgroundColor: "rgba(188,192,196,0.55)" }}
        />

        <div className="hidden text-right sm:block">
          <div className="font-dashboard-sans text-[0.95rem] font-semibold text-zinc-900">
            {session.data?.user.name ?? "Quoin operator"}
          </div>
          <div className="font-dashboard-sans text-[0.84rem] text-zinc-500">
            {activeOrganization?.role ?? "No role"}
          </div>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="font-dashboard-sans text-[0.9rem] font-medium text-zinc-500 transition hover:text-zinc-900 disabled:opacity-60"
        >
          {isSigningOut ? "Signing out..." : "Sign out"}
        </button>
      </header>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add organization</DialogTitle>
            <DialogDescription>
              Create a new organization and switch into it right away.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                Organization name
              </span>
              <input
                type="text"
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Metro"
                disabled={createOrganization.isPending}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50"
              />
            </label>

            {createOrganization.error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {createOrganization.error.message}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setIsCreateDialogOpen(false);
                setOrganizationName("");
                createOrganization.reset();
              }}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateOrganization}
              disabled={createOrganization.isPending || organizationName.trim().length === 0}
              className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
            >
              {createOrganization.isPending ? "Creating..." : "Create organization"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
