"use client";

import { trpc } from "@/lib/trpc";
import React from "react";
import { useState } from "react";
import {
  formatPeriodDate,
  formatPeriodDateInputValue,
} from "@/lib/period-date";
import {
  EmptyState,
  ErrorState,
  MetricGrid,
  Panel,
  formatDate,
} from "@/components/internal/admin-primitives";
import { PortfolioManagerPushReviewDialog } from "@/components/building/portfolio-manager-push-review-dialog";
import {
  StatusBadge,
  getPrimaryComplianceStatusDisplay,
  getRuntimeStatusDisplay,
  getSourceReconciliationStatusDisplay,
  humanizeToken,
} from "@/components/internal/status-helpers";
import { EnergyUsageChart, type EnergyReadingRow } from "./energy-usage-chart";

const PROPERTY_LABELS: Record<string, string> = {
  OFFICE: "Office",
  MULTIFAMILY: "Multifamily",
  MIXED_USE: "Mixed Use",
  OTHER: "Other",
};

const UTILITY_LABELS: Record<string, string> = {
  WATER_INDOOR: "Indoor water",
  WATER_OUTDOOR: "Outdoor water",
  WATER_RECYCLED: "Recycled water",
  OTHER: "Other utility",
};

const WATER_METER_TYPES = new Set(["WATER_INDOOR", "WATER_OUTDOOR", "WATER_RECYCLED"]);
const READING_TABS = [
  { key: "electricity", label: "Electricity" },
  { key: "gas", label: "Gas" },
  { key: "water", label: "Water" },
] as const;

export type ReadingTabKey = (typeof READING_TABS)[number]["key"];

type UtilityMeterReadingRow = {
  id: string;
  meterId: string;
  meterType: string;
  periodStart: string | Date;
  periodEnd: string | Date;
  consumption: number;
  unit: string;
  cost: number | null;
  source: string;
  originalSource?: string | null;
  ingestedAt: string | Date;
};

type UtilityMeterRow = {
  id: string;
  name: string;
  meterType: string;
  unit: string;
  espmMeterId: string | null;
  readingCount: number;
  latestReading: UtilityMeterReadingRow | null;
  readings: UtilityMeterReadingRow[];
};

type ImportedReadingRow = {
  id: string;
  meterType: string;
  meterName: string | null;
  consumption: number;
  unit: string;
  source: string;
  originalSource?: string | null;
  periodStart: string | Date;
  periodEnd: string | Date;
  category: ReadingTabKey;
};

function buildImportedReadingRows(
  energyRows: EnergyReadingRow[],
  utilityRows: UtilityMeterRow[],
): ImportedReadingRow[] {
  const waterRows = utilityRows.flatMap((meter) =>
    WATER_METER_TYPES.has(meter.meterType)
      ? meter.readings.map((reading) => ({
          id: reading.id,
          meterType: meter.meterType,
          meterName: meter.name,
          consumption: reading.consumption,
          unit: reading.unit,
          source: reading.source,
          originalSource: reading.originalSource ?? null,
          periodStart: reading.periodStart,
          periodEnd: reading.periodEnd,
          category: "water" as const,
        }))
      : [],
  );

  return [
    ...energyRows.map((row) => ({
      id: row.id,
      meterType: row.meterType,
      meterName: row.meterName ?? null,
      consumption: row.consumption,
      unit: row.unit,
      source: row.source,
      originalSource:
        "originalSource" in row && typeof row.originalSource === "string"
          ? row.originalSource
          : null,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      category: row.meterType === "GAS" ? ("gas" as const) : ("electricity" as const),
    })),
    ...waterRows,
  ];
}

function countPmBackedEditedRows(rows: ImportedReadingRow[]) {
  return rows.filter(
    (row) => row.source === "MANUAL" && row.originalSource === "ESPM_SYNC",
  ).length;
}

type EditReadingDraft = {
  periodStart: string;
  periodEnd: string;
  consumption: string;
};

interface LatestSnapshot {
  energyStarScore: number | null;
  siteEui: number | null;
  sourceEui: number | null;
  weatherNormalizedSiteEui: number | null;
  snapshotDate: string | Date;
  complianceStatus: string | null;
  estimatedPenalty: number | null;
  activePathway: string | null;
  targetScore: number | null;
  targetEui: number | null;
}

interface LatestPortfolioManagerMetrics {
  energyStarScore: number | null;
  siteEui: number | null;
  sourceEui: number | null;
  weatherNormalizedSiteEui: number | null;
}

interface RuntimeEntry {
  currentState: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  needsAttention: boolean;
}

interface RuntimeSummary {
  portfolioManager: RuntimeEntry;
  greenButton: RuntimeEntry;
  needsAttention: boolean;
}

interface SourceReconciliationSummary {
  status: string | null;
  canonicalSource: string | null;
  conflictCount: number;
  incompleteCount: number;
  lastReconciledAt: string | null;
}

interface BuildingOverviewRecord {
  name: string;
  propertyType: string;
  grossSquareFeet: number;
  yearBuilt: number | null;
  espmPropertyId: string | null;
  latestSnapshot: LatestSnapshot | null;
  latestPortfolioManagerMetrics: LatestPortfolioManagerMetrics | null;
  localDataCounts: {
    meterCount: number;
    energyReadingCount: number;
    complianceSnapshotCount: number;
  };
  portfolioManagerImportState: {
    status: string;
    latestErrorMessage: string | null;
  } | null;
  portfolioManagerSetupSummary: {
    summaryState: string;
    summaryLine: string;
    isLinked: boolean;
  } | null;
  portfolioManagerRuntimeHealth: {
    latestJob: {
      latestJobStatus: string | null;
    };
    [key: string]: unknown;
  } | null;
  governedSummary: {
    complianceSummary: {
      primaryStatus: string | null;
      reasonSummary: string;
    };
    runtimeSummary: RuntimeSummary;
  };
  sourceReconciliation: SourceReconciliationSummary | null;
}

interface BuildingOverviewTabProps {
  buildingId: string;
  building: BuildingOverviewRecord;
  canManage: boolean;
  onUpload: (utility: ReadingTabKey) => void;
}

function formatMetricNumber(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) {
    return "Unavailable";
  }

  return value.toFixed(digits);
}

function formatEui(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "Unavailable";
  }

  return `${value.toFixed(1)} kBtu/sf`;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "Unavailable";
  }

  return `$${value.toLocaleString()}`;
}

function formatUtilityReading(value: number, unit: string) {
  const normalizedUnit = unit === "KGAL" ? "kgal" : unit === "CCF" ? "ccf" : unit === "GAL" ? "gal" : unit.toLowerCase();
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: normalizedUnit === "gal" ? 0 : 2,
  })} ${normalizedUnit}`;
}

function formatEnergyReadingValue(value: number, unit: string) {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: unit === "KWH" ? 0 : 2,
  })} ${unit.toLowerCase()}`;
}

function formatEnergySource(source: string) {
  switch (source) {
    case "ESPM_SYNC":
      return "Portfolio Manager";
    case "GREEN_BUTTON":
      return "Green Button";
    case "CSV_UPLOAD":
      return "CSV upload";
    case "BILL_UPLOAD":
      return "Bill upload";
    case "MANUAL":
      return "Edited";
    default:
      return humanizeToken(source);
  }
}

function formatSourceContext(row: ImportedReadingRow) {
  return formatEnergySource(row.originalSource ?? row.source);
}

function formatReadingType(meterType: string) {
  if (meterType === "ELECTRIC") {
    return "Electricity";
  }

  if (meterType === "GAS") {
    return "Gas";
  }

  if (WATER_METER_TYPES.has(meterType)) {
    return UTILITY_LABELS[meterType] ?? "Water";
  }

  return humanizeToken(meterType);
}

function formatRuntimeDetail(runtime: RuntimeEntry) {
  if (runtime.lastSucceededAt) {
    return `Last success ${formatDate(runtime.lastSucceededAt)}`;
  }

  if (runtime.lastFailedAt) {
    return `Last failure ${formatDate(runtime.lastFailedAt)}`;
  }

  return runtime.needsAttention ? "Needs operator attention" : "No recent runtime recorded";
}

function formatTargetContext(snapshot: LatestSnapshot | null) {
  if (!snapshot) {
    return null;
  }

  if (snapshot.targetScore != null) {
    return `Target score ${snapshot.targetScore}`;
  }

  if (snapshot.targetEui != null) {
    return `Target EUI ${snapshot.targetEui.toFixed(1)} kBtu/sf`;
  }

  return null;
}

function getSyncActionLabel(input: {
  isPending: boolean;
  overallStatus: string | null | undefined;
  hasImportedUsage: boolean;
}) {
  if (input.isPending || input.overallStatus === "RUNNING" || input.overallStatus === "QUEUED") {
    return "Syncing...";
  }

  return input.hasImportedUsage ? "Sync from PM" : "Run PM sync";
}

function getSyncSuccessMessage(result: {
  outcome?: string | null;
  usageResult?: {
    resultSummary?: Record<string, unknown> | null;
  } | null;
}, input?: { pmBackedEditedRows?: number }) {
  const partialReason = result.usageResult?.resultSummary?.partialReasonSummary;
  if (typeof partialReason === "string" && partialReason.trim().length > 0) {
    return partialReason;
  }

  if ((input?.pmBackedEditedRows ?? 0) > 0) {
    return "Portfolio Manager sync complete. Edited rows stay in place until you change them.";
  }

  switch (result.outcome) {
    case "SYNCED":
      return "Portfolio Manager sync complete.";
    case "PARTIAL":
      return "Portfolio Manager sync complete with partial data.";
    case "NEEDS_MANUAL_SETUP":
      return "Portfolio Manager sync needs manual setup.";
    default:
      return "Portfolio Manager sync complete.";
  }
}

function EditImportedReadingDialog({
  row,
  draft,
  onDraftChange,
  onClose,
  onSave,
  isSaving,
  errorMessage,
}: {
  row: ImportedReadingRow;
  draft: EditReadingDraft;
  onDraftChange: (draft: EditReadingDraft) => void;
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
  errorMessage: string | null;
}) {
  const usageLabel = row.category === "water" ? "Usage" : "Usage";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default bg-[rgba(42,52,57,0.48)]"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-[28px] bg-white px-6 py-5 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
              Imported reading
            </div>
            <div className="mt-2 text-xl font-semibold tracking-tight text-zinc-900">
              Edit reading
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            Close
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-zinc-200/80 bg-zinc-50/80 px-4 py-3 text-sm text-zinc-600">
          <div className="font-medium text-zinc-900">{row.meterName ?? "Linked meter"}</div>
          <div className="mt-1">{formatReadingType(row.meterType)}</div>
          <div className="mt-1">Original source: {formatSourceContext(row)}</div>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
              Start date
            </div>
            <input
              type="date"
              value={draft.periodStart}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  periodStart: event.target.value,
                })
              }
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400"
            />
          </label>

          <label className="block">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
              End date
            </div>
            <input
              type="date"
              value={draft.periodEnd}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  periodEnd: event.target.value,
                })
              }
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400"
            />
          </label>

          <label className="block">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
              {usageLabel}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                value={draft.consumption}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    consumption: event.target.value,
                  })
                }
                className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400"
              />
              <div className="text-sm font-medium text-zinc-500">{row.unit.toLowerCase()}</div>
            </div>
          </label>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BuildingOverviewTab({
  buildingId,
  building,
  canManage,
  onUpload,
}: BuildingOverviewTabProps) {
  const utils = trpc.useUtils();
  const [selectedReadingTab, setSelectedReadingTab] = useState<ReadingTabKey>("electricity");
  const [isPushReviewOpen, setIsPushReviewOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<ImportedReadingRow | null>(null);
  const [editDraft, setEditDraft] = useState<EditReadingDraft | null>(null);
  const energyReadingsQuery = trpc.building.energyReadings.useQuery({
    buildingId,
    months: 24,
  });
  const utilityQuery = trpc.building.utilityReadings.useQuery({
    buildingId,
  });
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
  const refreshPull = trpc.portfolioManager.refreshBuildingPull.useMutation({
    onSuccess: async (result) => {
      const [
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        ,
        utilityRefetchResult,
        energyRefetchResult,
      ] = await Promise.all([
        utils.portfolioManager.getBuildingSetup.invalidate({ buildingId }),
        utils.portfolioManager.getBuildingUsageStatus.invalidate({ buildingId }),
        utils.building.get.invalidate({ id: buildingId }),
        utils.building.energyReadings.invalidate({ buildingId, months: 24 }),
        utils.building.utilityReadings.invalidate({ buildingId }),
        utils.building.complianceHistory.invalidate({ buildingId, limit: 8 }),
        setupQuery.refetch(),
        usageQuery.refetch(),
        utilityQuery.refetch(),
        energyReadingsQuery.refetch(),
      ]);

      const importedRows = buildImportedReadingRows(
        (energyRefetchResult.data ?? []) as EnergyReadingRow[],
        (utilityRefetchResult.data ?? []) as UtilityMeterRow[],
      );
      setActionMessage(
        getSyncSuccessMessage(result, {
          pmBackedEditedRows: countPmBackedEditedRows(importedRows),
        }),
      );
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
  const createReadingOverride = trpc.building.createEnergyReadingOverride.useMutation({
    onSuccess: async () => {
      setActionMessage("Reading updated.");
      setEditingRow(null);
      setEditDraft(null);
      await Promise.all([
        utils.building.get.invalidate({ id: buildingId }),
        utils.building.energyReadings.invalidate({ buildingId, months: 24 }),
        utils.building.utilityReadings.invalidate({ buildingId }),
        utils.building.complianceHistory.invalidate({ buildingId, limit: 8 }),
        energyReadingsQuery.refetch(),
        utilityQuery.refetch(),
      ]);
    },
  });

  const latestSnapshot = building.latestSnapshot;
  const latestMetrics =
    latestSnapshot ??
    building.latestPortfolioManagerMetrics;
  const primaryStatus = getPrimaryComplianceStatusDisplay(
    building.governedSummary.complianceSummary.primaryStatus,
  );
  const sourceStatus = getSourceReconciliationStatusDisplay(
    building.sourceReconciliation?.status ?? null,
  );
  const snapshotStatus = getPrimaryComplianceStatusDisplay(latestSnapshot?.complianceStatus);
  const portfolioManagerStatus = getRuntimeStatusDisplay(
    building.governedSummary.runtimeSummary.portfolioManager.currentState,
  );
  const greenButtonStatus = getRuntimeStatusDisplay(
    building.governedSummary.runtimeSummary.greenButton.currentState,
  );
  const targetContext = formatTargetContext(latestSnapshot);
  const isLoading =
    energyReadingsQuery.isLoading || setupQuery.isLoading || usageQuery.isLoading;
  const error = energyReadingsQuery.error;
  const energyRows = (energyReadingsQuery.data ?? []) as EnergyReadingRow[];
  const utilityRows = (utilityQuery.data ?? []) as UtilityMeterRow[];
  const importedReadingRows = buildImportedReadingRows(energyRows, utilityRows);
  const selectedReadingRows = importedReadingRows
    .filter((row) => row.category === selectedReadingTab)
    .slice()
    .sort(
      (left, right) =>
        new Date(right.periodStart).getTime() - new Date(left.periodStart).getTime(),
    )
    .slice(0, 12);
  const selectedPmBackedEditedRowCount = countPmBackedEditedRows(selectedReadingRows);
  const editDisabled =
    !editDraft ||
    createReadingOverride.isPending ||
    !editDraft.periodStart ||
    !editDraft.periodEnd ||
    !Number.isFinite(Number(editDraft.consumption)) ||
    Number(editDraft.consumption) <= 0 ||
    new Date(editDraft.periodEnd).getTime() <= new Date(editDraft.periodStart).getTime();
  const utilityStatusRows = utilityRows.filter((meter) => WATER_METER_TYPES.has(meter.meterType));
  const importedPmBuildingNeedsSetup =
    Boolean(building.espmPropertyId) &&
    building.portfolioManagerImportState?.status === "SUCCEEDED" &&
    building.portfolioManagerSetupSummary?.isLinked === true &&
    building.portfolioManagerSetupSummary.summaryState !== "BENCHMARK_READY" &&
    building.localDataCounts.meterCount === 0 &&
    building.localDataCounts.energyReadingCount === 0 &&
    building.localDataCounts.complianceSnapshotCount === 0;
  const pmSyncInProgress =
    importedPmBuildingNeedsSetup &&
    (building.portfolioManagerRuntimeHealth?.latestJob.latestJobStatus === "RUNNING" ||
      building.portfolioManagerRuntimeHealth?.latestJob.latestJobStatus === "QUEUED");
  const usageEmptyMessage = importedPmBuildingNeedsSetup
    ? pmSyncInProgress
      ? "Portfolio Manager sync is running. Quoin is still importing meters and monthly usage."
      : "Portfolio Manager is linked, but Quoin still needs to finish pulling meters and monthly usage."
    : "No monthly energy readings are available for this building yet.";
  const selectedUsageEmptyMessage = importedPmBuildingNeedsSetup
    ? pmSyncInProgress
      ? `Portfolio Manager sync is running. Quoin is still importing ${selectedReadingTab} readings.`
      : `Portfolio Manager is linked, but Quoin still needs to finish pulling ${selectedReadingTab} readings.`
    : `No imported ${selectedReadingTab} readings are available for this building yet.`;
  const snapshotEmptyMessage = importedPmBuildingNeedsSetup
    ? pmSyncInProgress
      ? "A benchmark snapshot will appear after the current Portfolio Manager sync finishes."
      : "No benchmark snapshot has been recorded yet. Run Sync from PM to refresh usage and metrics."
    : "No governed compliance snapshot has been recorded yet.";
  const setup = setupQuery.data;
  const usage = usageQuery.data;
  const isPmLinked = Boolean(
    setup?.building.espmPropertyId && setup.building.espmShareStatus === "LINKED",
  );
  const showPushAction = Boolean(
    canManage &&
      isPmLinked &&
      usage?.pushReadiness.canPush &&
      (usage.pushReadiness.status === "READY" ||
        usage.pushReadiness.status === "READY_WITH_WARNINGS"),
  );
  const syncActionLabel = getSyncActionLabel({
    isPending: refreshPull.isPending,
    overallStatus: usage?.usageState.overallStatus,
    hasImportedUsage: Boolean(usage?.usageState.lastUsageAppliedAt),
  });

  const metricItems: Array<{
    label: string;
    value: React.ReactNode;
    tone?: "default" | "danger" | "warning" | "success";
  }> = [
    {
      label: "ENERGY STAR score",
      value: formatMetricNumber(latestMetrics?.energyStarScore, 0),
    },
    {
      label: "Site EUI",
      value: formatEui(latestMetrics?.siteEui),
    },
    {
      label: "Source EUI",
      value: formatEui(latestMetrics?.sourceEui),
    },
    {
      label: "Weather-normalized site EUI",
      value: formatEui(latestMetrics?.weatherNormalizedSiteEui),
    },
    {
      label: "Compliance status",
      value: <StatusBadge label={primaryStatus.label} tone={primaryStatus.tone} />,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="grid gap-3 rounded-[28px] border border-zinc-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] p-5 md:grid-cols-2 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
            Building profile
          </div>
          <div className="mt-2 text-lg font-semibold tracking-tight text-zinc-900">
            {building.name}
          </div>
          <div className="mt-1 text-sm text-zinc-600">
            {PROPERTY_LABELS[building.propertyType] ?? humanizeToken(building.propertyType)}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200/70 bg-white/80 px-4 py-3">
          <div className="text-[11px] font-medium text-zinc-500">GSF</div>
          <div className="mt-1 text-sm font-semibold tracking-tight text-zinc-900">
            {building.grossSquareFeet.toLocaleString()} sq ft
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200/70 bg-white/80 px-4 py-3">
          <div className="text-[11px] font-medium text-zinc-500">Year built</div>
          <div className="mt-1 text-sm font-semibold tracking-tight text-zinc-900">
            {building.yearBuilt ?? "Not recorded"}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-200/70 bg-white/80 px-4 py-3">
          <div className="text-[11px] font-medium text-zinc-500">ESPM property ID</div>
          <div className="mt-1 text-sm font-semibold tracking-tight text-zinc-900">
            {building.espmPropertyId ?? "Not linked"}
          </div>
        </div>
      </section>

      {importedPmBuildingNeedsSetup ? (
        <div className="rounded-[24px] border border-sky-200/80 bg-[linear-gradient(180deg,rgba(240,249,255,0.95),rgba(248,250,252,0.92))] px-5 py-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-sky-700">
            Portfolio Manager import
          </div>
          <div className="mt-2 text-sm font-semibold tracking-tight text-zinc-900">
            {pmSyncInProgress
              ? "Quoin is syncing this building from Portfolio Manager now."
              : "This building is linked to Portfolio Manager, but the full sync has not finished yet."}
          </div>
          <div className="mt-1 text-sm leading-6 text-zinc-600">
            {pmSyncInProgress
              ? "Meters, usage, metrics, and the latest benchmark snapshot will appear here as soon as the sync completes."
              : "Use Sync from PM to pull meters, usage, metrics, and the latest benchmark snapshot into Quoin."}
          </div>
        </div>
      ) : null}

      <Panel title="Key metrics" compact>
        <div className="border-t border-zinc-200/80 pt-4">
          <MetricGrid items={metricItems} compact />
        </div>
      </Panel>

      <Panel
        title="Monthly energy usage"
        compact
        actions={
          canManage ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isPmLinked ? (
                <button
                  type="button"
                  onClick={() => {
                    setActionMessage(null);
                    refreshPull.mutate({ buildingId });
                  }}
                  disabled={
                    refreshPull.isPending ||
                    usage?.usageState.overallStatus === "RUNNING" ||
                    usage?.usageState.overallStatus === "QUEUED"
                  }
                  className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {syncActionLabel}
                </button>
              ) : null}
              {showPushAction ? (
                <button
                  type="button"
                  onClick={() => {
                    setActionMessage(null);
                    setIsPushReviewOpen(true);
                  }}
                  className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900"
                >
                  Push to ESPM
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onUpload(selectedReadingTab)}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
              >
                Upload data
              </button>
            </div>
          ) : undefined
        }
      >
        <div className="border-t border-zinc-200/80 pt-4">
          {actionMessage ? (
            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {actionMessage}
            </div>
          ) : null}
          {refreshPull.error ? (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {refreshPull.error.message}
            </div>
          ) : null}
          {pushUsage.error ? (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {pushUsage.error.message}
            </div>
          ) : null}
          {isLoading ? (
            <div className="overflow-hidden">
              <div className="loading-bar h-0.5 w-1/3 bg-zinc-300" />
            </div>
          ) : error ? (
            <ErrorState
              message="Energy trend is unavailable."
              detail={error.message}
            />
          ) : energyRows.length === 0 ? (
            <EmptyState message={usageEmptyMessage} />
          ) : (
            <div className="space-y-5">
              <EnergyUsageChart rows={energyRows} heightClassName="h-[300px]" />

              <div className="overflow-hidden rounded-[22px] border border-zinc-200/80 bg-white/85">
                <div className="border-b border-zinc-200/80 px-4 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold tracking-tight text-zinc-900">
                        Imported readings
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        Start date, end date, source, meter, and consumption pulled into Quoin.
                      </div>
                    </div>
                    <div className="inline-flex rounded-full border border-zinc-200 bg-zinc-50/90 p-1">
                      {READING_TABS.map((tab) => {
                        const isActive = tab.key === selectedReadingTab;
                        return (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setSelectedReadingTab(tab.key)}
                            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                              isActive
                                ? "bg-zinc-900 text-white"
                                : "text-zinc-600 hover:bg-white hover:text-zinc-900"
                            }`}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {selectedReadingRows.length === 0 ? (
                  <div className="px-4 py-6">
                    <EmptyState message={selectedUsageEmptyMessage} />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    {selectedPmBackedEditedRowCount > 0 ? (
                      <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        Sync from PM updates the imported Portfolio Manager rows, but edited rows stay in place.
                      </div>
                    ) : null}
                    <table className="min-w-full divide-y divide-zinc-200/80 text-sm">
                      <thead className="bg-zinc-50/85 text-left text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                        <tr>
                          <th className="px-4 py-3 font-medium">Start date</th>
                          <th className="px-4 py-3 font-medium">End date</th>
                          <th className="px-4 py-3 font-medium">Usage</th>
                          <th className="px-4 py-3 font-medium">Source</th>
                          <th className="px-4 py-3 font-medium">Meter</th>
                          <th className="px-4 py-3 font-medium">Type</th>
                          {canManage ? (
                            <th className="px-4 py-3 text-right font-medium">Edit</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {selectedReadingRows.map((row) => (
                          <tr key={row.id} className="align-top">
                            <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                              {formatPeriodDate(row.periodStart)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                              {formatPeriodDate(row.periodEnd)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-900">
                              {selectedReadingTab === "water"
                                ? formatUtilityReading(row.consumption, row.unit)
                                : formatEnergyReadingValue(row.consumption, row.unit)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                              <div>{formatEnergySource(row.source)}</div>
                              {row.source === "MANUAL" && row.originalSource ? (
                                <div className="mt-1 text-xs text-zinc-500">
                                  From {formatSourceContext(row)}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-zinc-600">
                              {row.meterName ?? "Linked meter"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                              {formatReadingType(row.meterType)}
                            </td>
                            {canManage ? (
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionMessage(null);
                                    setEditingRow(row);
                                    setEditDraft({
                                      periodStart: formatPeriodDateInputValue(row.periodStart),
                                      periodEnd: formatPeriodDateInputValue(row.periodEnd),
                                      consumption: String(row.consumption),
                                    });
                                  }}
                                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-900"
                                >
                                  Edit
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Panel>

      {usage ? (
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
      ) : null}

      {editingRow && editDraft ? (
        <EditImportedReadingDialog
          row={editingRow}
          draft={editDraft}
          onDraftChange={setEditDraft}
          onClose={() => {
            setEditingRow(null);
            setEditDraft(null);
          }}
          onSave={() => {
            if (editDisabled) {
              return;
            }

            createReadingOverride.mutate({
              buildingId,
              readingId: editingRow.id,
              periodStart: new Date(`${editDraft.periodStart}T00:00:00.000Z`),
              periodEnd: new Date(`${editDraft.periodEnd}T00:00:00.000Z`),
              consumption: Number(editDraft.consumption),
            });
          }}
          isSaving={createReadingOverride.isPending}
          errorMessage={createReadingOverride.error?.message ?? null}
        />
      ) : null}

      <Panel title="Utility imports" compact>
        <div className="border-t border-zinc-200/80 pt-4">
          {utilityQuery.isLoading ? (
            <div className="overflow-hidden">
              <div className="loading-bar h-0.5 w-1/3 bg-zinc-300" />
            </div>
          ) : utilityQuery.error ? (
            <ErrorState
              message="Utility imports are unavailable."
              detail={utilityQuery.error.message}
            />
          ) : utilityStatusRows.length === 0 ? (
            <EmptyState message="No water utility meters have been imported for this building yet." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {utilityStatusRows.map((meter) => (
                <div
                  key={meter.id}
                  className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold tracking-tight text-zinc-900">
                        {meter.name}
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-zinc-500">
                        {UTILITY_LABELS[meter.meterType] ?? humanizeToken(meter.meterType)}
                      </div>
                    </div>
                    <StatusBadge
                      label={meter.readingCount > 0 ? "Imported" : "No readings yet"}
                      tone={meter.readingCount > 0 ? "success" : "muted"}
                    />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-zinc-600">
                    <div>
                      <span className="text-zinc-500">Readings</span>{" "}
                      <span className="font-medium text-zinc-900">{meter.readingCount}</span>
                    </div>
                    {meter.latestReading ? (
                      <div>
                        <span className="text-zinc-500">Latest imported period</span>{" "}
                        <span className="font-medium text-zinc-900">
                          {formatPeriodDate(meter.latestReading.periodStart)} to{" "}
                          {formatPeriodDate(meter.latestReading.periodEnd)}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm text-zinc-500">
                        Quoin can see this utility meter, but no readings have been imported yet.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Latest snapshot" compact>
          <div className="space-y-4 border-t border-zinc-200/80 pt-4">
            {latestSnapshot ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold tracking-tight text-zinc-900">
                      Snapshot date
                    </div>
                    <div className="text-sm text-zinc-600">
                      {formatDate(latestSnapshot.snapshotDate)}
                    </div>
                  </div>
                  {latestSnapshot.complianceStatus ? (
                    <StatusBadge
                      label={humanizeToken(latestSnapshot.complianceStatus)}
                      tone={snapshotStatus.tone}
                    />
                  ) : null}
                </div>

                <div className="rounded-2xl border border-zinc-200/80 bg-[#fafbfc] px-4 py-3 text-sm text-zinc-600">
                  <div>{building.governedSummary.complianceSummary.reasonSummary}</div>
                  {targetContext ? <div className="mt-2">{targetContext}</div> : null}
                </div>
              </>
            ) : (
              <EmptyState message={snapshotEmptyMessage} />
            )}
          </div>
        </Panel>

        <Panel title="Source and sync status" compact>
          <div className="space-y-4 border-t border-zinc-200/80 pt-4">
            <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold tracking-tight text-zinc-900">
                    Source reconciliation
                  </div>
                  <div className="text-sm text-zinc-600">
                    {building.sourceReconciliation?.canonicalSource
                      ? humanizeToken(building.sourceReconciliation.canonicalSource)
                      : "No canonical source selected"}
                  </div>
                </div>
                <StatusBadge label={sourceStatus.label} tone={sourceStatus.tone} />
              </div>
              <div className="mt-3 grid gap-3 text-sm text-zinc-600 md:grid-cols-3">
                <div>
                  <div className="text-[11px] font-medium text-zinc-500">Conflicts</div>
                  <div className="mt-1 font-semibold text-zinc-900">
                    {building.sourceReconciliation?.conflictCount ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-zinc-500">Incomplete sources</div>
                  <div className="mt-1 font-semibold text-zinc-900">
                    {building.sourceReconciliation?.incompleteCount ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-zinc-500">Last reconciled</div>
                  <div className="mt-1 font-semibold text-zinc-900">
                    {building.sourceReconciliation?.lastReconciledAt
                      ? formatDate(building.sourceReconciliation.lastReconciledAt)
                      : "Not recorded"}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold tracking-tight text-zinc-900">
                    Portfolio Manager
                  </div>
                  <StatusBadge
                    label={portfolioManagerStatus.label}
                    tone={portfolioManagerStatus.tone}
                  />
                </div>
                <div className="mt-2 text-sm text-zinc-600">
                  {formatRuntimeDetail(building.governedSummary.runtimeSummary.portfolioManager)}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold tracking-tight text-zinc-900">
                    Green Button
                  </div>
                  <StatusBadge label={greenButtonStatus.label} tone={greenButtonStatus.tone} />
                </div>
                <div className="mt-2 text-sm text-zinc-600">
                  {formatRuntimeDetail(building.governedSummary.runtimeSummary.greenButton)}
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
