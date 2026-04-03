"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/internal/status-helpers";
import { formatPeriodDateRange } from "@/lib/period-date";

type PushReadinessStatus = "READY" | "READY_WITH_WARNINGS" | "BLOCKED";

type PushReviewMeterRow = {
  meterId: string;
  meterName: string;
  meterType: string;
  localUnit: string;
  espmMeterId: string | null;
  rawPmType: string | null;
  rawPmUnitOfMeasure: string | null;
  canonicalSource: string | null;
  reconciliationStatus: string;
  readingCount: number;
  firstPeriodStart: string | Date | null;
  lastPeriodEnd: string | Date | null;
  blockers: string[];
  warnings: string[];
  reviewNote: string;
  includedInPush: boolean;
};

type PushReviewPayload = {
  status: PushReadinessStatus;
  reportingYear: number;
  canPush: boolean;
  summaryLine: string;
  blockers: string[];
  warnings: string[];
  pushableMeterCount: number;
  pushableReadingCount: number;
  coverageSummary: {
    status: string;
    summaryLine: string;
    totalLinkedMeters: number;
    metersWithUsableData: number;
    totalPeriods: number;
  } | null;
  meterRows: PushReviewMeterRow[];
};

type UsageStateSummary = {
  overallStatus: string;
  lastRunDirection: string | null;
  lastUsageAppliedAt: string | Date | null;
  lastMetricsRefreshedAt: string | Date | null;
  resultSummary: Record<string, unknown> | null;
};

function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return "Not yet";
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not yet";
  }

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTokenLabel(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  return value.toLowerCase().replaceAll("_", " ");
}

function getPushStatusDisplay(status: PushReadinessStatus) {
  switch (status) {
    case "READY":
      return { label: "Ready to push", tone: "success" as const };
    case "READY_WITH_WARNINGS":
      return { label: "Ready with warnings", tone: "warning" as const };
    default:
      return { label: "Not ready to push", tone: "danger" as const };
  }
}

function getUsageDirectionLabel(value: string | null) {
  if (value === "IMPORT_PM_TO_LOCAL") {
    return "Import PM to Quoin";
  }

  if (value === "PUSH_LOCAL_TO_PM") {
    return "Push Quoin to PM";
  }

  return "Not run";
}

function getCoverageTone(status: string | null | undefined) {
  if (status === "READY_FOR_METRICS") {
    return "success" as const;
  }

  if (status === "PARTIAL_COVERAGE") {
    return "warning" as const;
  }

  if (status === "NO_USABLE_DATA" || status === "NEEDS_ATTENTION") {
    return "danger" as const;
  }

  return "muted" as const;
}

function getConfirmDisabledReason(input: {
  canManage: boolean;
  usageBusy: boolean;
  pushReadiness: PushReviewPayload;
}) {
  if (!input.canManage) {
    return "Usage push is read-only for your role.";
  }

  if (input.usageBusy) {
    return "A Portfolio Manager usage run is already queued or running. Review stays available, but confirmation is disabled until it finishes.";
  }

  if (!input.pushReadiness.canPush) {
    return input.pushReadiness.blockers[0] ?? "Push is blocked until the listed issues are resolved.";
  }

  return null;
}

function PushReviewMeterCard({ row }: { row: PushReviewMeterRow }) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-zinc-900">{row.meterName}</div>
          <div className="text-xs text-zinc-500">
            Local {formatTokenLabel(row.meterType, "meter")} · {row.localUnit}
            {row.espmMeterId ? ` · PM meter ${row.espmMeterId}` : ""}
          </div>
          <div className="text-xs text-zinc-500">
            PM {row.rawPmType ?? "Type unavailable"} · {row.rawPmUnitOfMeasure ?? "Unit unavailable"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <StatusBadge
            label={row.includedInPush ? "Will push" : "Excluded from push"}
            tone={row.includedInPush ? "success" : "muted"}
          />
          <StatusBadge
            label={formatTokenLabel(row.reconciliationStatus, "unknown")}
            tone={
              row.reconciliationStatus === "CLEAN"
                ? "success"
                : row.reconciliationStatus === "CONFLICTED"
                  ? "danger"
                  : row.reconciliationStatus === "INCOMPLETE"
                    ? "warning"
                    : "muted"
            }
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-zinc-200/70 bg-zinc-50 px-3 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
            Canonical source
          </div>
          <div className="mt-1 text-sm text-zinc-800">
            {formatTokenLabel(row.canonicalSource, "Not selected")}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200/70 bg-zinc-50 px-3 py-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
            Readings to push
          </div>
          <div className="mt-1 text-sm text-zinc-800">{String(row.readingCount)}</div>
        </div>
        <div className="rounded-xl border border-zinc-200/70 bg-zinc-50 px-3 py-3 md:col-span-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
            Period range
          </div>
          <div className="mt-1 text-sm text-zinc-800">
            {formatPeriodDateRange(row.firstPeriodStart, row.lastPeriodEnd)}
          </div>
        </div>
      </div>

      <div className="mt-4 text-sm leading-6 text-zinc-700">{row.reviewNote}</div>

      {row.blockers.length > 0 ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900">
          <div className="font-medium">Meter blockers</div>
          <ul className="mt-2 space-y-1 text-red-800">
            {row.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.warnings.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <div className="font-medium">Meter warnings</div>
          <ul className="mt-2 space-y-1 text-amber-800">
            {row.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function PortfolioManagerPushReviewDialog({
  open,
  onOpenChange,
  canManage,
  pushReadiness,
  usageState,
  confirmPending,
  onConfirm,
  errorMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  pushReadiness: PushReviewPayload;
  usageState: UsageStateSummary;
  confirmPending: boolean;
  onConfirm: () => void;
  errorMessage: string | null;
}) {
  const pushStatusDisplay = getPushStatusDisplay(pushReadiness.status);
  const usageBusy =
    usageState.overallStatus === "QUEUED" || usageState.overallStatus === "RUNNING";
  const willPushRows = pushReadiness.meterRows.filter((row) => row.includedInPush);
  const excludedRows = pushReadiness.meterRows.filter((row) => !row.includedInPush);
  const confirmDisabledReason = getConfirmDisabledReason({
    canManage,
    usageBusy,
    pushReadiness,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader className="space-y-3">
          <DialogTitle>Review push to PM</DialogTitle>
          <DialogDescription>
            Review the approved local readings Quoin will send to Portfolio Manager for reporting
            year {pushReadiness.reportingYear}. Nothing is queued until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[75vh] space-y-5 overflow-y-auto pr-1">
          <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-4">
            <div className="text-sm text-zinc-700">{pushReadiness.summaryLine}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <StatusBadge label={pushStatusDisplay.label} tone={pushStatusDisplay.tone} />
              <StatusBadge
                label={`Reporting year ${pushReadiness.reportingYear}`}
                tone="muted"
              />
              {pushReadiness.coverageSummary ? (
                <StatusBadge
                  label={formatTokenLabel(pushReadiness.coverageSummary.status, "coverage")}
                  tone={getCoverageTone(pushReadiness.coverageSummary.status)}
                />
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                Will push meters
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
                {String(pushReadiness.pushableMeterCount)}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                Will push readings
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
                {String(pushReadiness.pushableReadingCount)}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                Coverage summary
              </div>
              <div className="mt-2 text-sm leading-6 text-zinc-700">
                {pushReadiness.coverageSummary?.summaryLine ?? "Coverage summary is not available yet."}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                Latest usage action
              </div>
              <div className="mt-2 text-sm leading-6 text-zinc-700">
                {getUsageDirectionLabel(usageState.lastRunDirection)}
                <div>{formatTimestamp(usageState.lastUsageAppliedAt)}</div>
              </div>
            </div>
          </div>

          {pushReadiness.coverageSummary ? (
            <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50 px-4 py-4 text-sm text-zinc-700">
              {pushReadiness.coverageSummary.metersWithUsableData} of{" "}
              {pushReadiness.coverageSummary.totalLinkedMeters} linked meters have approved local
              usage coverage, across {pushReadiness.coverageSummary.totalPeriods} selected billing
              period{pushReadiness.coverageSummary.totalPeriods === 1 ? "" : "s"}.
            </div>
          ) : null}

          {usageState.lastMetricsRefreshedAt || usageState.resultSummary ? (
            <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4">
              <div className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                Most recent PM usage run
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="text-sm text-zinc-700">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                    Direction
                  </div>
                  <div className="mt-1">{getUsageDirectionLabel(usageState.lastRunDirection)}</div>
                </div>
                <div className="text-sm text-zinc-700">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                    Last metrics refresh
                  </div>
                  <div className="mt-1">{formatTimestamp(usageState.lastMetricsRefreshedAt)}</div>
                </div>
                <div className="text-sm text-zinc-700">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                    Created or updated
                  </div>
                  <div className="mt-1">
                    {String((usageState.resultSummary?.readingsCreated as number | undefined) ?? 0)}
                    {" created · "}
                    {String((usageState.resultSummary?.readingsUpdated as number | undefined) ?? 0)}
                    {" updated"}
                  </div>
                </div>
                <div className="text-sm text-zinc-700">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                    Pushed or skipped
                  </div>
                  <div className="mt-1">
                    {String((usageState.resultSummary?.readingsPushed as number | undefined) ?? 0)}
                    {" pushed · "}
                    {String(
                      (usageState.resultSummary?.readingsSkippedExisting as number | undefined) ??
                        (usageState.resultSummary?.readingsSkippedConflicting as number | undefined) ??
                        0,
                    )}
                    {" skipped"}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {usageBusy ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              A Portfolio Manager usage run is already queued or running. Review stays available,
              but confirmation remains disabled until it finishes.
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">
              {errorMessage}
            </div>
          ) : null}

          {pushReadiness.blockers.length > 0 ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">
              <div className="font-medium">Push blockers</div>
              <ul className="mt-2 space-y-1 text-red-800">
                {pushReadiness.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {pushReadiness.warnings.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              <div className="font-medium">Push warnings</div>
              <ul className="mt-2 space-y-1 text-amber-800">
                {pushReadiness.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold tracking-tight text-zinc-900">
                  Will push
                </div>
                <div className="text-xs text-zinc-500">
                  {willPushRows.length} meter{willPushRows.length === 1 ? "" : "s"}
                </div>
              </div>
              {willPushRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-600">
                  No linked meters are currently approved for push.
                </div>
              ) : (
                willPushRows.map((row) => <PushReviewMeterCard key={row.meterId} row={row} />)
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold tracking-tight text-zinc-900">
                  Excluded from push
                </div>
                <div className="text-xs text-zinc-500">
                  {excludedRows.length} meter{excludedRows.length === 1 ? "" : "s"}
                </div>
              </div>
              {excludedRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-600">
                  Every linked meter with approved local readings is currently included in push.
                </div>
              ) : (
                excludedRows.map((row) => <PushReviewMeterCard key={row.meterId} row={row} />)
              )}
            </section>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {confirmDisabledReason ? (
            <div className="mr-auto max-w-2xl text-sm text-zinc-500">{confirmDisabledReason}</div>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            variant="luminous"
            onClick={onConfirm}
            disabled={confirmPending || confirmDisabledReason != null}
          >
            {confirmPending ? "Queueing..." : "Confirm push to PM"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
