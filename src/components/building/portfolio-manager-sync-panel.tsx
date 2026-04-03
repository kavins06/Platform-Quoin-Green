"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Panel, formatDate } from "@/components/internal/admin-primitives";
import {
  StatusBadge,
  getPortfolioManagerCoverageStatusDisplay,
  getPortfolioManagerMetricsStatusDisplay,
  getPortfolioManagerSetupDisplay,
} from "@/components/internal/status-helpers";
import { PortfolioManagerPushReviewDialog } from "@/components/building/portfolio-manager-push-review-dialog";
import { PortfolioManagerSetupPanel } from "@/components/building/portfolio-manager-setup-panel";

function getPushReadinessDisplay(status: "READY" | "READY_WITH_WARNINGS" | "BLOCKED") {
  switch (status) {
    case "READY":
      return { label: "Ready to push", tone: "success" as const };
    case "READY_WITH_WARNINGS":
      return { label: "Ready with warnings", tone: "warning" as const };
    default:
      return { label: "Not ready to push", tone: "danger" as const };
  }
}

function getSyncPresentation(input: {
  setupSummaryState: string;
  setupSummaryLine: string;
  usageSummaryState: string;
  usageSummaryLine: string | null | undefined;
  usageOverallStatus: string;
  usageMetricsStatus: string;
  skippedMeterCount: number;
  partialReasonSummary: string | null | undefined;
  runtimeWarning: string | null | undefined;
  latestErrorMessage: string | null | undefined;
  hasImportedUsage: boolean;
}) {
  if (input.runtimeWarning) {
    return {
      label: "Sync unavailable",
      tone: "warning" as const,
      summary: input.runtimeWarning,
    };
  }

  if (
    input.usageOverallStatus === "RUNNING" ||
    input.usageOverallStatus === "QUEUED" ||
    input.setupSummaryState === "READY_FOR_NEXT_STEP"
  ) {
    return {
      label: "Syncing from PM",
      tone: "muted" as const,
      summary: "Quoin is importing property setup, meters, usage, and the latest metrics.",
    };
  }

  if (
    input.usageOverallStatus === "PARTIAL" ||
    input.skippedMeterCount > 0 ||
    input.partialReasonSummary
  ) {
    return {
      label: "Partial sync",
      tone: "warning" as const,
      summary:
        input.partialReasonSummary ??
        (input.skippedMeterCount > 0
          ? `Quoin synced the supported Portfolio Manager meters and skipped ${input.skippedMeterCount} meter${input.skippedMeterCount === 1 ? "" : "s"} that ESPM does not expose to this provider flow.`
          : input.usageSummaryLine ?? "Quoin imported the supported Portfolio Manager data."),
    };
  }

  if (
    input.setupSummaryState === "NEEDS_ATTENTION" &&
    input.latestErrorMessage?.toLowerCase().includes("manual")
  ) {
    return {
      label: "Needs manual setup",
      tone: "warning" as const,
      summary: input.latestErrorMessage,
    };
  }

  if (input.latestErrorMessage) {
    return {
      label: "Needs retry",
      tone: "danger" as const,
      summary: input.latestErrorMessage,
    };
  }

  if (
    input.hasImportedUsage &&
    (input.usageMetricsStatus === "SUCCEEDED" || input.usageMetricsStatus === "PARTIAL")
  ) {
    return {
      label: "Synced",
      tone: "success" as const,
      summary: "Meters, usage, and the latest Portfolio Manager metrics are available in Quoin.",
    };
  }

  if (input.usageSummaryState === "SETUP_INCOMPLETE") {
    return {
      label: "Preparing setup",
      tone: "warning" as const,
      summary: input.usageSummaryLine ?? input.setupSummaryLine,
    };
  }

  return {
    label: "Ready to sync",
    tone: "muted" as const,
    summary: input.setupSummaryLine,
  };
}

export function PortfolioManagerSyncPanel({
  buildingId,
  canManage,
}: {
  buildingId: string;
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const [isPushReviewOpen, setIsPushReviewOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const setupQuery = trpc.portfolioManager.getBuildingSetup.useQuery(
    { buildingId },
    {
      retry: false,
      refetchInterval: (query) =>
        query.state.data?.setupState.status === "APPLY_QUEUED" ||
        query.state.data?.setupState.status === "APPLY_RUNNING"
          ? 3000
          : false,
    },
  );
  const usageQuery = trpc.portfolioManager.getBuildingUsageStatus.useQuery(
    { buildingId },
    {
      retry: false,
      refetchInterval: (query) =>
        query.state.data?.usageState.overallStatus === "QUEUED" ||
        query.state.data?.usageState.overallStatus === "RUNNING"
          ? 3000
          : false,
    },
  );
  const utilityQuery = trpc.building.utilityReadings.useQuery(
    { buildingId },
    {
      retry: false,
    },
  );
  const refreshPull = trpc.portfolioManager.refreshBuildingPull.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
        utils.building.get.invalidate({ id: buildingId }),
        utils.building.energyReadings.invalidate({ buildingId, months: 24 }),
        utils.building.utilityReadings.invalidate({ buildingId }),
        utils.building.complianceHistory.invalidate({ buildingId, limit: 8 }),
      ]);
    },
  });
  const pushUsage = trpc.portfolioManager.pushBuildingUsage.useMutation({
    onSuccess: async (result) => {
      setActionMessage(result.message);
      setIsPushReviewOpen(false);
      await Promise.all([
        utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
        utils.building.get.invalidate({ id: buildingId }),
        utils.organization.governanceOverview.invalidate(),
      ]);
    },
  });

  const setup = setupQuery.data;
  const usage = usageQuery.data;

  const isLoading = setupQuery.isLoading || usageQuery.isLoading;
  if (isLoading || !setup || !usage) {
    return null;
  }

  if (!setup.building.espmPropertyId || setup.building.espmShareStatus !== "LINKED") {
    return null;
  }

  const setupDisplay = getPortfolioManagerSetupDisplay(setup.setupState.summaryState);
  const coverageDisplay = getPortfolioManagerCoverageStatusDisplay(
    usage.usageState.coverageStatus,
  );
  const metricsDisplay = getPortfolioManagerMetricsStatusDisplay(
    usage.usageState.metricsStatus,
  );
  const pushDisplay = getPushReadinessDisplay(usage.pushReadiness.status);
  const syncDisplay = getSyncPresentation({
    setupSummaryState: setup.setupState.summaryState,
    setupSummaryLine: setup.setupState.summaryLine,
    usageSummaryState: usage.usageState.summaryState,
    usageSummaryLine: usage.usageState.summaryLine,
    usageOverallStatus: usage.usageState.overallStatus,
    usageMetricsStatus: usage.usageState.metricsStatus,
    skippedMeterCount:
      typeof usage.usageState.resultSummary?.skippedMeterCount === "number"
        ? usage.usageState.resultSummary.skippedMeterCount
        : 0,
    partialReasonSummary:
      typeof usage.usageState.resultSummary?.partialReasonSummary === "string"
        ? usage.usageState.resultSummary.partialReasonSummary
        : null,
    runtimeWarning: usage.runtimeHealth.warning,
    latestErrorMessage:
      usage.usageState.latestErrorMessage ?? setup.setupState.latestErrorMessage,
    hasImportedUsage: Boolean(usage.usageState.lastUsageAppliedAt),
  });
  const syncDetails = useMemo(
    () => [
      setup.setupState.lastAppliedAt
        ? `Setup ${formatDate(setup.setupState.lastAppliedAt)}`
        : null,
      usage.usageState.lastUsageAppliedAt
        ? `Usage ${formatDate(usage.usageState.lastUsageAppliedAt)}`
        : null,
      usage.usageState.lastMetricsRefreshedAt
        ? `Metrics ${formatDate(usage.usageState.lastMetricsRefreshedAt)}`
        : null,
    ].filter(Boolean),
    [
      setup.setupState.lastAppliedAt,
      usage.usageState.lastMetricsRefreshedAt,
      usage.usageState.lastUsageAppliedAt,
    ],
  );
  const importedUtilityMeters = useMemo(
    () =>
      (utilityQuery.data ?? []).filter(
        (meter) =>
          meter.meterType === "WATER_INDOOR" ||
          meter.meterType === "WATER_OUTDOOR" ||
          meter.meterType === "WATER_RECYCLED",
      ),
    [utilityQuery.data],
  );
  const utilitySummary =
    importedUtilityMeters.length > 0
      ? `${importedUtilityMeters.length} utility meter${importedUtilityMeters.length === 1 ? "" : "s"} imported, including water.`
      : "Energy and utility meters that Portfolio Manager exposes to Quoin will import automatically. Water is import-only for now.";

  return (
    <div className="space-y-4">
      <Panel
        title="Portfolio Manager"
        subtitle="Quoin handles the pull from PM automatically after the property is linked. Use this panel to retry a sync or review a push."
        compact
      >
        <div className="space-y-4 border-t border-zinc-200/80 pt-4">
          {actionMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {actionMessage}
            </div>
          ) : null}
          <section className="rounded-[24px] border border-zinc-200/80 bg-white px-5 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold tracking-tight text-zinc-900">
                    Sync from PM
                  </div>
                  <StatusBadge label={syncDisplay.label} tone={syncDisplay.tone} />
                  <StatusBadge label={setupDisplay.label} tone={setupDisplay.tone} />
                </div>
                <div className="max-w-2xl text-sm leading-6 text-zinc-600">
                  {syncDisplay.summary}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <StatusBadge label={coverageDisplay.label} tone={coverageDisplay.tone} />
                  <StatusBadge label={metricsDisplay.label} tone={metricsDisplay.tone} />
                </div>
                {syncDetails.length > 0 ? (
                  <div className="text-xs text-zinc-500">{syncDetails.join(" | ")}</div>
                ) : null}
                <div className="text-xs text-zinc-500">{utilitySummary}</div>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => refreshPull.mutate({ buildingId })}
                  disabled={refreshPull.isPending}
                  className="btn-primary shrink-0 px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  {refreshPull.isPending
                    ? "Running sync..."
                    : usage.usageState.lastUsageAppliedAt
                      ? "Refresh from PM"
                      : "Run sync now"}
                </button>
              ) : null}
            </div>
          </section>

          <section className="rounded-[24px] border border-zinc-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.94))] px-5 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold tracking-tight text-zinc-900">
                    Push to PM
                  </div>
                  <StatusBadge label={pushDisplay.label} tone={pushDisplay.tone} />
                </div>
                <div className="max-w-2xl text-sm leading-6 text-zinc-600">
                  {usage.pushReadiness.summaryLine}
                </div>
                <div className="text-xs text-zinc-500">
                  Reporting year {usage.pushReadiness.reportingYear} | Ready meters{" "}
                  {usage.pushReadiness.pushableMeterCount} | Ready readings{" "}
                  {usage.pushReadiness.pushableReadingCount}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPushReviewOpen(true)}
                disabled={!canManage}
                className="btn-secondary shrink-0 px-4 py-2.5 text-sm disabled:opacity-50"
              >
                Review push
              </button>
            </div>
          </section>

          <details className="rounded-2xl border border-zinc-200/80 bg-[#fafbfc] px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-zinc-700">
              Technical details
            </summary>
            <div className="mt-4">
              <PortfolioManagerSetupPanel buildingId={buildingId} canManage={canManage} />
            </div>
          </details>
        </div>
      </Panel>

      <PortfolioManagerPushReviewDialog
        open={isPushReviewOpen}
        onOpenChange={setIsPushReviewOpen}
        canManage={canManage}
        usageState={usage.usageState}
        pushReadiness={usage.pushReadiness}
        confirmPending={pushUsage.isPending}
        errorMessage={pushUsage.error?.message ?? null}
        onConfirm={() =>
          pushUsage.mutate({
            buildingId,
            reportingYear: usage.pushReadiness.reportingYear,
          })
        }
      />
    </div>
  );
}
