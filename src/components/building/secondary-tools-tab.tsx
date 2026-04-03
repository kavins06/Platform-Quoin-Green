"use client";

import React from "react";
import { trpc } from "@/lib/trpc";
import {
  Panel,
  formatDate,
} from "@/components/internal/admin-primitives";
import {
  StatusBadge,
  getPortfolioManagerSetupDisplay,
  humanizeToken,
} from "@/components/internal/status-helpers";
import { PortfolioManagerSyncPanel } from "./portfolio-manager-sync-panel";

function DisclosureSection({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-2xl border border-zinc-200/80 bg-[#fafbfc] px-4 py-3"
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold tracking-tight text-zinc-900">{title}</div>
            {summary ? (
              <div className="mt-1 text-[12px] leading-5 text-zinc-500">{summary}</div>
            ) : null}
          </div>
          <div className="text-[12px] text-zinc-500">Open</div>
        </div>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function AccordionSection({
  open,
  onToggle,
  title,
  purpose,
  summary,
  badge,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  purpose: string;
  summary: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-zinc-900">{title}</h3>
            {badge}
          </div>
          <p className="text-sm text-zinc-600">{purpose}</p>
          <div className="text-[12px] leading-5 text-zinc-500">{summary}</div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="btn-secondary shrink-0 px-4 py-2 text-sm"
        >
          {open ? "Close" : "Open"}
        </button>
      </div>

      {open ? <div className="mt-4 border-t border-zinc-200/80 pt-4">{children}</div> : null}
    </section>
  );
}

export function SecondaryToolsTab({
  buildingId,
  canManage,
  sourceReconciliation,
  latestSnapshotDate,
}: {
  buildingId: string;
  canManage: boolean;
  sourceReconciliation: {
    status?: string | null;
    canonicalSource?: string | null;
    lastReconciledAt?: string | null;
  } | null;
  latestSnapshotDate: string | null;
}) {
  const [activeSection, setActiveSection] = React.useState<
    "portfolio-manager" | "recovery" | null
  >(null);
  const utils = trpc.useUtils();
  const portfolioManagerSetup = trpc.portfolioManager.getBuildingSetup.useQuery(
    { buildingId },
    { retry: false },
  );
  const pipelineRuns = trpc.building.pipelineRuns.useQuery(
    { buildingId, limit: 5 },
    { retry: false },
  );
  const complianceHistory = trpc.building.complianceHistory.useQuery(
    { buildingId, limit: 8 },
    { retry: false },
  );
  const reenqueueIngestion = trpc.building.reenqueueGreenButtonIngestion.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.building.get.invalidate({ id: buildingId }),
        utils.building.pipelineRuns.invalidate({ buildingId, limit: 5 }),
      ]);
    },
  });
  const rerunReconciliation = trpc.building.rerunSourceReconciliation.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.building.get.invalidate({ id: buildingId }),
        utils.building.complianceHistory.invalidate({ buildingId, limit: 8 }),
      ]);
    },
  });

  const latestPipelineRun = pipelineRuns.data?.[0] ?? null;
  const recoverySummary = [
    sourceReconciliation?.status
      ? `Reconciliation ${humanizeToken(sourceReconciliation.status)}`
      : null,
    latestPipelineRun
      ? `Last pipeline ${humanizeToken(latestPipelineRun.status)}`
      : null,
    latestSnapshotDate ? `Snapshot ${formatDate(latestSnapshotDate)}` : null,
  ]
    .filter(Boolean)
    .join(" | ") || "Recovery tools and recent benchmark history";
  const setupDisplay = getPortfolioManagerSetupDisplay(
    portfolioManagerSetup.data?.setupState.summaryState,
  );
  const showPortfolioManagerSetup =
    portfolioManagerSetup.data?.building.espmPropertyId != null &&
    portfolioManagerSetup.data?.building.espmShareStatus === "LINKED";

  return (
    <div className="space-y-4">
      <Panel
        title="Additional tools"
        subtitle="Only the benchmark-facing setup and recovery tools remain active here."
        compact
      >
        <div className="space-y-3 border-t border-zinc-200/80 pt-4">
          {showPortfolioManagerSetup ? (
            <AccordionSection
              open={activeSection === "portfolio-manager"}
              onToggle={() =>
                setActiveSection((current) =>
                  current === "portfolio-manager" ? null : "portfolio-manager",
                )
              }
              title="Portfolio Manager setup"
              purpose="Review the current PM sync, retry an import, and guide any push back to Portfolio Manager."
              summary={
                portfolioManagerSetup.data?.setupState.summaryLine ??
                "Portfolio Manager setup is loading."
              }
              badge={<StatusBadge label={setupDisplay.label} tone={setupDisplay.tone} />}
            >
              <PortfolioManagerSyncPanel buildingId={buildingId} canManage={canManage} />
            </AccordionSection>
          ) : null}

          <AccordionSection
            open={activeSection === "recovery"}
            onToggle={() =>
              setActiveSection((current) => (current === "recovery" ? null : "recovery"))
            }
            title="Benchmarking recovery"
            purpose="Run targeted recovery actions and review recent benchmark history."
            summary={recoverySummary}
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-200/80 bg-[#fafbfc] px-4 py-4">
                <div className="text-sm font-semibold tracking-tight text-zinc-900">
                  Runtime summary
                </div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div className="text-sm text-zinc-600">
                    Source reconciliation:{" "}
                    <span className="font-medium text-zinc-900">
                      {humanizeToken(sourceReconciliation?.status)}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-600">
                    Canonical source:{" "}
                    <span className="font-medium text-zinc-900">
                      {humanizeToken(sourceReconciliation?.canonicalSource)}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-600">
                    Last reconciliation:{" "}
                    <span className="font-medium text-zinc-900">
                      {formatDate(sourceReconciliation?.lastReconciledAt ?? null)}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-600">
                    Latest benchmark snapshot:{" "}
                    <span className="font-medium text-zinc-900">
                      {formatDate(latestSnapshotDate)}
                    </span>
                  </div>
                </div>
              </div>

              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => reenqueueIngestion.mutate({ buildingId })}
                    disabled={reenqueueIngestion.isPending}
                    className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {reenqueueIngestion.isPending ? "Re-enqueuing..." : "Re-enqueue ingestion"}
                  </button>
                  <button
                    type="button"
                    onClick={() => rerunReconciliation.mutate({ buildingId })}
                    disabled={rerunReconciliation.isPending}
                    className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {rerunReconciliation.isPending ? "Running..." : "Rerun reconciliation"}
                  </button>
                </div>
              ) : null}

              <DisclosureSection
                title="Recent benchmark history"
                summary={
                  complianceHistory.data?.length
                    ? `${complianceHistory.data.length} recent snapshot(s)`
                    : "No recent governed snapshots recorded"
                }
              >
                {complianceHistory.data?.length ? (
                  <div className="space-y-2">
                    {complianceHistory.data.map((snapshot) => (
                      <div
                        key={snapshot.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/80 bg-white px-3 py-2 text-sm"
                      >
                        <div className="font-medium text-zinc-900">
                          {formatDate(snapshot.snapshotDate)}
                        </div>
                        <div className="text-zinc-600">
                          {humanizeToken(snapshot.complianceStatus)}
                        </div>
                        <div className="text-zinc-500">
                          Score {snapshot.energyStarScore ?? "-"} | Site EUI {snapshot.siteEui ?? "-"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-zinc-600">
                    No governed benchmark history is available for this building yet.
                  </div>
                )}
              </DisclosureSection>
            </div>
          </AccordionSection>
        </div>
      </Panel>
    </div>
  );
}
