"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

interface StepOrgProps {
  onNext: () => void;
}

/**
 * Handles Quoin-managed organization creation during onboarding.
 */
export function StepOrg({ onNext }: StepOrgProps) {
  const session = trpc.organization.session.useQuery(undefined, {
    retry: false,
  });
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createOrganization = trpc.organization.create.useMutation({
    onSuccess: async (organization) => {
      await fetch("/api/auth/active-organization", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ organizationId: organization.id }),
      });
      onNext();
    },
    onError: (cause) => {
      setError(cause.message);
    },
  });

  async function handleContinueExisting() {
    const organizationId =
      session.data?.activeOrganizationId ??
      session.data?.memberships[0]?.organization.id ??
      null;

    if (!organizationId) {
      return;
    }

    await fetch("/api/auth/active-organization", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ organizationId }),
    });
    onNext();
  }

  function handleCreate() {
    if (!orgName.trim()) {
      return;
    }

    setError(null);
    createOrganization.mutate({
      name: orgName.trim(),
    });
  }

  if ((session.data?.memberships.length ?? 0) > 0) {
    const activeOrganization =
      session.data?.memberships.find(
        (membership: (typeof session.data.memberships)[number]) =>
          membership.organization.id === session.data?.activeOrganizationId,
      ) ?? session.data?.memberships[0] ?? null;

    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Organization
          </h2>
          <p className="mt-3 text-base leading-7 text-zinc-600">
            You&apos;re already part of{" "}
            <strong className="font-semibold text-zinc-900">
              {activeOrganization?.organization.name}
            </strong>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={handleContinueExisting}
          className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-base font-semibold text-white transition-all hover:bg-zinc-800 active:scale-[0.98]"
        >
          Continue Pipeline
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Create your organization
        </h2>
        <p className="mt-3 text-base leading-7 text-zinc-600">
          This is the company or entity that owns or manages the buildings.
        </p>
      </div>

      <div className="space-y-3">
        <label
          htmlFor="org-name"
          className="block text-xs font-medium uppercase tracking-[0.08em] text-zinc-500"
        >
          Organization name
        </label>
        <input
          id="org-name"
          type="text"
          value={orgName}
          onChange={(event) => setOrgName(event.target.value)}
          placeholder="e.g., Acme Property Management"
          className="block w-full rounded-xl border border-zinc-200 bg-zinc-50/40 px-4 py-3 text-base text-zinc-900 transition-shadow placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-4 focus:ring-zinc-900/5"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              handleCreate();
            }
          }}
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">{error}</p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleCreate}
        disabled={createOrganization.isPending || !orgName.trim()}
        className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-base font-semibold text-white transition-all hover:bg-zinc-800 disabled:opacity-50 active:scale-[0.98]"
      >
        {createOrganization.isPending ? "Creating..." : "Create & continue"}
      </button>
    </div>
  );
}
