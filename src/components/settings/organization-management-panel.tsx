"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/internal/admin-primitives";
import { StatusBadge } from "@/components/internal/status-helpers";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ROLE_OPTIONS = ["ADMIN", "MANAGER", "ENGINEER", "VIEWER"] as const;

const softCardStyle = {
  background: "rgba(255,255,255,0.82)",
  border: "1px solid rgba(205, 210, 214, 0.72)",
  boxShadow: "0 24px 52px -40px rgba(27, 39, 51, 0.22)",
} as const;

const warmCardStyle = {
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(252,251,248,0.92) 100%)",
  border: "1px solid rgba(205, 210, 214, 0.72)",
  boxShadow: "0 24px 52px -40px rgba(27, 39, 51, 0.22)",
} as const;

export function OrganizationManagementPanel() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const session = trpc.organization.session.useQuery(undefined, { retry: false });
  const active = trpc.organization.active.useQuery(undefined, { retry: false });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>("MANAGER");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");

  const addMember = trpc.organization.addMember.useMutation({
    onSuccess: async () => {
      setEmail("");
      setRole("MANAGER");
      await Promise.all([
        utils.organization.active.invalidate(),
        utils.organization.session.invalidate(),
      ]);
    },
  });
  const removeMember = trpc.organization.removeMember.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.organization.active.invalidate(),
        utils.organization.session.invalidate(),
      ]);
    },
  });
  const deleteOrganization = trpc.organization.deleteActive.useMutation({
    onSuccess: async () => {
      const memberships = session.data?.memberships ?? [];
      const currentOrganizationId = active.data?.organization.id ?? null;
      const nextMembership =
        memberships.find(
          (membership) => membership.organization.id !== currentOrganizationId,
        ) ?? null;

      if (nextMembership) {
        await fetch("/api/auth/active-organization", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ organizationId: nextMembership.organization.id }),
        });
        await utils.organization.session.invalidate();
        await utils.organization.active.invalidate();
        router.push("/settings");
        router.refresh();
        return;
      }

      await fetch("/api/auth/active-organization", {
        method: "DELETE",
      });
      await utils.organization.session.invalidate();
      router.push("/onboarding");
      router.refresh();
    },
  });

  const visibleError =
    active.error?.message ??
    addMember.error?.message ??
    removeMember.error?.message ??
    deleteOrganization.error?.message ??
    null;

  const canManage = active.data?.canManageMembers ?? false;
  const members = active.data?.members ?? [];
  const organization = active.data?.organization ?? null;
  const deleteMatches = confirmationName.trim() === (organization?.name ?? "");
  const memberCountLabel = useMemo(() => {
    if (members.length === 1) {
      return "1 member";
    }

    return `${members.length} members`;
  }, [members.length]);

  return (
    <>
      <Panel title="Organization" subtitle="Members and access." compact>
        {organization ? (
          <div className="space-y-6">
            <section className="rounded-[28px] px-5 py-5" style={warmCardStyle}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="font-dashboard-display text-[1.65rem] font-medium tracking-[-0.04em] text-zinc-900">
                    {organization.name}
                  </div>
                  <div className="mt-2 font-dashboard-sans text-sm text-zinc-500">
                    {memberCountLabel}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    label={active.data?.currentRole ?? "VIEWER"}
                    tone={canManage ? "success" : "muted"}
                  />
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setDeleteDialogOpen(true)}
                      className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
                    >
                      Delete organization
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            {visibleError ? (
              <div className="rounded-[24px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {visibleError}
              </div>
            ) : null}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(19rem,0.82fr)]">
              <section className="rounded-[28px] px-5 py-5" style={softCardStyle}>
                <div>
                  <div className="text-sm font-semibold text-zinc-900">Members</div>
                  <div className="mt-1 text-sm text-zinc-500">Everyone with access.</div>
                </div>

                <div className="mt-5 space-y-3">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex flex-col gap-3 rounded-[22px] border border-zinc-200/80 bg-[#fcfbf8] px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-zinc-900">
                            {member.user.name}
                          </div>
                          {member.isCurrentUser ? (
                            <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                              You
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-zinc-600">{member.user.email}</div>
                      </div>

                      <div className="flex items-center gap-2">
                        <StatusBadge
                          label={member.role}
                          tone={member.role === "ADMIN" ? "success" : "muted"}
                        />
                        {canManage && !member.isCurrentUser ? (
                          <button
                            type="button"
                            onClick={() =>
                              removeMember.mutate({
                                membershipId: member.id,
                              })
                            }
                            disabled={removeMember.isPending}
                            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[28px] px-5 py-5" style={softCardStyle}>
                <div>
                  <div className="text-sm font-semibold text-zinc-900">Add member</div>
                  <div className="mt-1 text-sm text-zinc-500">Add someone who has signed in before.</div>
                </div>

                <div className="mt-5 space-y-4">
                  <label className="space-y-2">
                    <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                      Email
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={!canManage || addMember.isPending}
                      placeholder="teammate@company.com"
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                      Role
                    </span>
                    <select
                      value={role}
                      onChange={(event) =>
                        setRole(event.target.value as (typeof ROLE_OPTIONS)[number])
                      }
                      disabled={!canManage || addMember.isPending}
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50"
                    >
                      {ROLE_OPTIONS.map((roleOption) => (
                        <option key={roleOption} value={roleOption}>
                          {roleOption}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() =>
                      addMember.mutate({
                        email: email.trim(),
                        role,
                      })
                    }
                    disabled={!canManage || addMember.isPending || email.trim().length === 0}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {addMember.isPending ? "Adding..." : "Add member"}
                  </button>

                  {!canManage ? (
                    <div className="text-sm text-zinc-500">Only admins can manage members.</div>
                  ) : (
                    <div className="text-sm text-zinc-500">If not found, have them sign in once first.</div>
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </Panel>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="space-y-3">
            <DialogTitle>Delete organization</DialogTitle>
            <DialogDescription>
              This removes the organization and its buildings, sync records, and workflow history.
              Type the organization name to confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This action cannot be undone.
            </div>
            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                Type {organization?.name ?? "the organization name"}
              </span>
              <input
                type="text"
                value={confirmationName}
                onChange={(event) => setConfirmationName(event.target.value)}
                disabled={deleteOrganization.isPending}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-50"
              />
            </label>
            {deleteOrganization.error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {deleteOrganization.error.message}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setDeleteDialogOpen(false);
                setConfirmationName("");
                deleteOrganization.reset();
              }}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                deleteOrganization.mutate({
                  confirmationName: confirmationName.trim(),
                })
              }
              disabled={deleteOrganization.isPending || !deleteMatches}
              className="rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-50"
            >
              {deleteOrganization.isPending ? "Deleting..." : "Delete organization"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
