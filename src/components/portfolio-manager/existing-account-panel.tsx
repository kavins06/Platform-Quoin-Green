"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { EmptyState, Panel, formatDate } from "@/components/internal/admin-primitives";
import {
  StatusBadge,
  getPortfolioManagerConnectionStateDisplay,
} from "@/components/internal/status-helpers";

interface PortfolioManagerExistingAccountPanelProps {
  title?: string;
  subtitle?: string;
  showOnboardingActions?: boolean;
  canManage?: boolean;
  onNext?: () => void;
  onSkip?: () => void;
  showHeader?: boolean;
  usernameLabel?: string;
  saveLabel?: string;
  refreshLabel?: string;
  continueLabel?: string;
  skipLabel?: string;
  presentationMode?: "settings" | "onboarding";
}

function summarizeProviderMessage(state: string) {
  switch (state) {
    case "WAITING_FOR_REQUEST":
      return "Save the username, then ask the customer to connect and share.";
    case "WAITING_FOR_SHARES":
      return "Connected. Waiting for property and meter shares.";
    case "SYNCING":
      return "Syncing shared properties now.";
    case "CONNECTED":
      return "Connected. Shared properties sync automatically.";
    case "FAILED":
      return "Needs attention. Check the latest sync error.";
    case "QUOIN_MANAGED":
      return "Managed directly through Quoin.";
    case "NOT_CONNECTED":
    default:
      return "Enter the customer's ESPM username to start the connection.";
  }
}

function buildEmptyPropertyMessage(state: string) {
  switch (state) {
    case "WAITING_FOR_REQUEST":
      return "No shared ESPM properties are available yet. Ask the customer to connect and send the provider share request first.";
    case "WAITING_FOR_SHARES":
      return "The account connection is accepted, but Quoin is still waiting for property and meter shares.";
    case "SYNCING":
      return "Quoin is checking for newly shared properties now.";
    case "FAILED":
      return "Shared ESPM properties are unavailable until the provider sync succeeds again.";
    default:
      return "No shared ESPM properties are loaded yet.";
  }
}

export function PortfolioManagerExistingAccountPanel({
  title = "Portfolio Manager",
  subtitle = "Connect Portfolio Manager and keep shared properties in sync.",
  showOnboardingActions = false,
  canManage = true,
  onNext,
  onSkip,
  showHeader = true,
  usernameLabel = "Customer ESPM username",
  saveLabel = "Save username",
  refreshLabel = "Check connection and shares",
  continueLabel = "Continue",
  skipLabel = "Do this later",
  presentationMode = "settings",
}: PortfolioManagerExistingAccountPanelProps) {
  const utils = trpc.useUtils();
  const [username, setUsername] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const connection = trpc.portfolioManager.getProviderConnectionStatus.useQuery(undefined, {
    enabled: canManage,
    refetchInterval: (query) =>
      query.state.data?.summary.state === "WAITING_FOR_REQUEST" ||
      query.state.data?.summary.state === "WAITING_FOR_SHARES" ||
      query.state.data?.summary.state === "SYNCING"
        ? 5000
        : false,
  });
  const configureProviderConnection =
    trpc.portfolioManager.configureProviderConnection.useMutation({
      onSuccess: async () => {
        setActionMessage("Username saved. Quoin will keep checking for shared properties.");
        await utils.portfolioManager.getProviderConnectionStatus.invalidate();
      },
    });
  const refreshProviderConnection =
    trpc.portfolioManager.refreshProviderConnection.useMutation({
      onSuccess: async (result) => {
        setActionMessage(result.message);
        await utils.portfolioManager.getProviderConnectionStatus.invalidate();
      },
    });
  const restoreRemoteProperty =
    trpc.portfolioManager.restoreRemoteProperty.useMutation({
      onSuccess: async () => {
        await Promise.all([
          utils.portfolioManager.getProviderConnectionStatus.invalidate(),
          utils.building.list.invalidate(),
          utils.building.portfolioWorklist.invalidate(),
          utils.building.portfolioStats.invalidate(),
          utils.building.onboardingStatus.invalidate(),
        ]);
      },
    });

  useEffect(() => {
    const nextUsername =
      connection.data?.summary.targetUsername ??
      connection.data?.summary.linkedUsername ??
      "";
    if (nextUsername) {
      setUsername(nextUsername);
    }
  }, [connection.data?.summary.linkedUsername, connection.data?.summary.targetUsername]);

  const state = connection.data;
  const summaryState = state?.summary.state ?? "NOT_CONNECTED";
  const statusDisplay = getPortfolioManagerConnectionStateDisplay(summaryState);
  const providerUsername =
    state?.summary.providerUsername ?? state?.provider.username ?? "kavinsakthi06";
  const visibleError =
    configureProviderConnection.error?.message ??
    refreshProviderConnection.error?.message ??
    restoreRemoteProperty.error?.message ??
    state?.summary.latestErrorMessage ??
    connection.error?.message ??
    null;
  const runtimeWarning =
    !visibleError ? state?.summary.backgroundSyncMessage ?? state?.runtimeHealth?.warning ?? null : null;
  const remoteProperties = state?.remoteProperties ?? [];
  const linkedBuildingCount = state?.summary.linkedBuildingCount ?? 0;
  const propertyCountLabel =
    remoteProperties.length === 0
      ? "No shared properties loaded yet"
      : `${remoteProperties.length} shared | ${linkedBuildingCount} linked in Quoin`;
  const isOnboarding = presentationMode === "onboarding";
  const shouldCheckDirectly =
    state?.summary.backgroundSyncAvailable === false ||
    state?.runtimeHealth?.latestJob?.stalled === true;
  const resolvedRefreshLabel = shouldCheckDirectly ? "Check now" : refreshLabel;

  function handleSaveUsername() {
    setActionMessage(null);
    configureProviderConnection.mutate({
      targetUsername: username.trim(),
    });
  }

  const content = (
    <div className="space-y-6">
      <div
        className="rounded-[28px] px-5 py-5"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(252,251,248,0.92) 100%)",
          border: "1px solid rgba(205, 210, 214, 0.72)",
          boxShadow: "0 24px 52px -40px rgba(27, 39, 51, 0.22)",
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge label={statusDisplay.label} tone={statusDisplay.tone} />
          <span className="text-sm text-zinc-600">Provider account: {providerUsername}</span>
        </div>
        <div className="mt-3 space-y-1 text-sm text-zinc-600">
          <div>{summarizeProviderMessage(summaryState)}</div>
          {state?.summary.targetUsername ? (
            <div className="text-xs text-zinc-500">
              Customer username: {state.summary.linkedUsername ?? state.summary.targetUsername}
            </div>
          ) : null}
          {state?.summary.linkedAccountId ? (
            <div className="text-xs text-zinc-500">
              Connected customer account ID: {state.summary.linkedAccountId}
            </div>
          ) : null}
          {state?.summary.lastConnectionCheckedAt ? (
            <div className="text-xs text-zinc-500">
              Last checked {formatDate(state.summary.lastConnectionCheckedAt)}
            </div>
          ) : null}
          {remoteProperties.length > 0 ? (
            <div className="text-xs text-zinc-500">{propertyCountLabel}</div>
          ) : null}
        </div>
      </div>

      {visibleError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {visibleError}
        </div>
      ) : null}

      {!visibleError && actionMessage ? (
        <div className="rounded-[24px] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {actionMessage}
        </div>
      ) : null}

      {!visibleError && runtimeWarning ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {runtimeWarning}
        </div>
      ) : null}

      <div
        className="space-y-4 rounded-[28px] px-5 py-5"
        style={{
          background: "rgba(255,255,255,0.82)",
          border: "1px solid rgba(205, 210, 214, 0.72)",
          boxShadow: "0 24px 52px -40px rgba(27, 39, 51, 0.22)",
        }}
      >
        <div>
          <div className="text-sm font-semibold text-zinc-900">Connect through Quoin</div>
          <div className="mt-1 text-sm text-zinc-500">
            Save the username, then have the customer share with{" "}
            <span className="font-medium text-zinc-900">{providerUsername}</span>.
          </div>
        </div>

        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            {usernameLabel}
          </span>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="customer.portfolio.manager.user"
            className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none"
          />
        </label>

        <div className="rounded-[22px] border border-zinc-200/80 bg-[#fcfbf8] px-4 py-3 text-sm text-zinc-600">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">Provider account</div>
          <div className="mt-1 font-medium text-zinc-900">{providerUsername}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSaveUsername}
            disabled={configureProviderConnection.isPending || username.trim().length === 0}
            className="btn-primary px-4 py-2.5 text-sm disabled:opacity-50"
          >
            {configureProviderConnection.isPending ? "Saving..." : saveLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              setActionMessage(null);
              refreshProviderConnection.mutate();
            }}
            disabled={
              refreshProviderConnection.isPending ||
              !state?.summary.targetUsername
            }
            className="btn-secondary px-4 py-2.5 text-sm disabled:opacity-50"
          >
            {refreshProviderConnection.isPending ? "Checking..." : resolvedRefreshLabel}
          </button>
        </div>
      </div>

      <div
        className="space-y-4 rounded-[28px] px-5 py-5"
        style={{
          background: "rgba(255,255,255,0.82)",
          border: "1px solid rgba(205, 210, 214, 0.72)",
          boxShadow: "0 24px 52px -40px rgba(27, 39, 51, 0.22)",
        }}
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-900">Shared ESPM properties</div>
            <div className="mt-1 text-sm text-zinc-500">Shared properties appear here.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/buildings"
              className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
            >
              Open Buildings
            </Link>
          </div>
        </div>

        {remoteProperties.length === 0 ? (
          <EmptyState message={buildEmptyPropertyMessage(summaryState)} />
        ) : (
          <div className="space-y-3">
            {remoteProperties.map((property) => (
              <div
                key={property.propertyId}
                className="rounded-[22px] border border-zinc-200/80 bg-[#fcfbf8] px-4 py-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-zinc-900">
                        {property.name ?? `Property ${property.propertyId}`}
                      </div>
                      <StatusBadge
                        label={
                          property.suppressedInQuoin
                            ? "Hidden in Quoin"
                            : property.linkedBuildingId
                              ? "Linked in Quoin"
                              : "Shared"
                        }
                        tone={
                          property.suppressedInQuoin
                            ? "warning"
                            : property.linkedBuildingId
                              ? "success"
                              : "muted"
                        }
                      />
                    </div>
                    <div className="text-xs text-zinc-500">ESPM property {property.propertyId}</div>
                    {property.address ? (
                      <div className="text-sm text-zinc-600">{property.address}</div>
                    ) : null}
                    {property.lastSyncedAt ? (
                      <div className="text-xs text-zinc-500">
                        Synced {formatDate(property.lastSyncedAt)}
                      </div>
                    ) : null}
                    {property.latestErrorMessage ? (
                      <div className="text-xs text-amber-700">{property.latestErrorMessage}</div>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-start gap-2 lg:items-end">
                    {property.linkedBuildingId ? (
                      <div className="text-sm text-zinc-600">
                        Linked building{" "}
                        <Link
                          href={`/buildings/${property.linkedBuildingId}`}
                          className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4"
                        >
                          {property.linkedBuildingName ?? property.linkedBuildingId}
                        </Link>
                      </div>
                    ) : property.suppressedInQuoin ? (
                      <>
                        <div className="text-sm text-zinc-500">Hidden in Quoin.</div>
                        <button
                          type="button"
                          onClick={() =>
                            restoreRemoteProperty.mutate({
                              propertyId: property.propertyId,
                            })
                          }
                          disabled={restoreRemoteProperty.isPending}
                          className="text-sm font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 disabled:opacity-50"
                        >
                          {restoreRemoteProperty.isPending
                            ? "Restoring..."
                            : "Restore in Quoin"}
                        </button>
                      </>
                    ) : (
                      <div className="text-sm text-zinc-500">Waiting to link in Buildings.</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showOnboardingActions ? (
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={onNext}
            className="w-full bg-zinc-900 px-4 py-3 text-base font-semibold text-white transition-all hover:bg-zinc-800 active:scale-[0.98]"
          >
            {continueLabel}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="w-full text-center text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800"
          >
            {skipLabel}
          </button>
        </div>
      ) : null}

      {isOnboarding ? (
        <div className="rounded-2xl border border-dashed border-zinc-200/80 bg-zinc-50/70 px-4 py-3 text-xs leading-5 text-zinc-500">
          The customer can finish the ESPM connection later from Settings. Quoin will keep checking
          for the provider share after the username is saved.
        </div>
      ) : null}
    </div>
  );

  if (!canManage) {
    return (
      <Panel title={title} subtitle={subtitle} compact>
        <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-4 text-sm text-zinc-600">
          Portfolio Manager connection is limited to organization managers and admins.
        </div>
      </Panel>
    );
  }

  return showHeader ? (
    <Panel title={title} subtitle={subtitle} compact>
      {content}
    </Panel>
  ) : (
    <div className="space-y-5">{content}</div>
  );
}
