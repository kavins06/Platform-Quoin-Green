"use client";

import { type ReactNode, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricGrid,
  Panel,
  formatDate,
} from "@/components/internal/admin-primitives";
import {
  StatusBadge,
  getReadinessStatusDisplay,
  getSyncStatusDisplay,
  getVerificationStatusDisplay,
} from "@/components/internal/status-helpers";
import { BuildingBenchmarkProfilePanel } from "./building-benchmark-profile-panel";

function defaultReportingYear() {
  return new Date().getUTCFullYear() - 1;
}

function formatSyncStatus(status: string | null | undefined) {
  return getSyncStatusDisplay(status).label;
}

function formatStepLabel(step: unknown) {
  return typeof step === "string" && step.trim()
    ? step.replaceAll("_", " ").toLowerCase()
    : "Not available";
}

function DisclosureSection({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
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
          <div className="text-[12px] text-zinc-500">Show</div>
        </div>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

export function BenchmarkingTab({
  buildingId,
  canManage,
}: {
  buildingId: string;
  canManage: boolean;
}) {
  const [reportingYear, setReportingYear] = useState(defaultReportingYear());
  const utils = trpc.useUtils();

  const syncStatus = trpc.benchmarking.getLegacyPortfolioManagerBenchmarkStatus.useQuery(
    { buildingId },
    { retry: false },
  );
  const qaFindings = trpc.benchmarking.getLegacyPortfolioManagerQaFindings.useQuery(
    { buildingId },
    { retry: false },
  );
  const readiness = trpc.benchmarking.getReadiness.useQuery(
    { buildingId, reportingYear },
    { retry: false },
  );
  const submissions = trpc.benchmarking.listSubmissions.useQuery({
    buildingId,
    limit: 10,
  });
  const verificationChecklist = trpc.benchmarking.getVerificationChecklist.useQuery(
    { buildingId, reportingYear },
    { retry: false },
  );

  const evaluateMutation = trpc.benchmarking.evaluateReadiness.useMutation({
    onSuccess: () => {
      utils.benchmarking.getReadiness.invalidate({ buildingId, reportingYear });
      utils.benchmarking.listSubmissions.invalidate({ buildingId, limit: 10 });
      utils.benchmarking.getVerificationChecklist.invalidate({
        buildingId,
        reportingYear,
      });
    },
  });

  if (submissions.isLoading) {
    return <LoadingState />;
  }

  if (submissions.error) {
    return (
      <ErrorState
        message="Benchmarking workflow is unavailable."
        detail={submissions.error.message}
      />
    );
  }

  const syncData = syncStatus.error ? null : syncStatus.data;
  const qaPayload =
    qaFindings.error ||
    !qaFindings.data ||
    typeof qaFindings.data !== "object" ||
    Array.isArray(qaFindings.data)
      ? null
      : (qaFindings.data as Record<string, unknown>);
  const findings = Array.isArray(qaPayload?.findings) ? qaPayload.findings : [];
  const syncDiagnostics = syncData?.diagnostics ?? null;
  const syncWarnings = Array.isArray(syncDiagnostics?.warnings)
    ? syncDiagnostics.warnings.map((warning) => String(warning))
    : [];
  const verificationItems = verificationChecklist.data?.items ?? [];
  const verificationSummary = verificationChecklist.data?.summary ?? null;

  const primaryBtnClass =
    "btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:hover:translate-y-0";
  const qualityStatus = getReadinessStatusDisplay(
    String(qaPayload?.status ?? "NOT_AVAILABLE"),
  );
  const readinessStatus = readiness.data
    ? getReadinessStatusDisplay(readiness.data.status)
    : qualityStatus;
  const blockingFindings = findings.filter((finding) => {
    const record =
      finding && typeof finding === "object" && !Array.isArray(finding)
        ? (finding as Record<string, unknown>)
        : {};
    return String(record.status ?? "") === "BLOCKED";
  });

  const readinessEvaluatedAt = readiness.data?.readinessEvaluatedAt ?? null;
  const checklistSummaryText = verificationSummary
    ? `${verificationSummary.failedCount} failed, ${verificationSummary.needsReviewCount} review`
    : "Not generated";

  return (
    <div className="space-y-4">
      <BuildingBenchmarkProfilePanel
        buildingId={buildingId}
        canManage={canManage}
      />

      <Panel
        title="Get ready"
        compact
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              value={reportingYear}
              onChange={(event) => setReportingYear(Number(event.target.value))}
              className="w-28 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
            {canManage ? (
              <button
                onClick={() => evaluateMutation.mutate({ buildingId, reportingYear })}
                disabled={evaluateMutation.isPending}
                className={primaryBtnClass}
              >
                {evaluateMutation.isPending ? "Checking..." : "Check readiness"}
              </button>
            ) : null}
          </div>
        }
      >
        <div className="space-y-4 border-t border-zinc-200/80 pt-4">
          <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
            <MetricGrid
              compact
              items={[
                {
                  label: "Ready",
                  value: readinessStatus.label,
                  tone: readinessStatus.tone === "danger" ? "danger" : "default",
                },
                {
                  label: "Checklist",
                  value: checklistSummaryText,
                },
                {
                  label: "Last checked",
                  value: readinessEvaluatedAt ? formatDate(readinessEvaluatedAt) : "Not yet",
                },
              ]}
            />
          </div>

          <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight text-zinc-900">
                  {blockingFindings.length > 0 ? "Blocked" : readinessStatus.label}
                </div>
              </div>
              <StatusBadge
                label={qualityStatus.label}
                tone={qualityStatus.tone}
              />
            </div>

            {blockingFindings.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-zinc-700">
                {blockingFindings.slice(0, 3).map((finding, index) => {
                  const record =
                    finding && typeof finding === "object" && !Array.isArray(finding)
                      ? (finding as Record<string, unknown>)
                      : {};

                  return (
                    <li
                      key={`${String(record.code ?? "finding")}-${index}`}
                      className="rounded-xl border border-red-200/60 bg-red-50/60 px-3 py-2 text-red-800"
                    >
                      <span className="font-medium text-red-900">
                        {String(record.code ?? "Finding")}
                      </span>
                      {": "}
                      {String(record.message ?? "Blocked")}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {syncStatus.error && syncStatus.error.data?.code !== "NOT_FOUND" ? (
            <ErrorState
              message="Portfolio Manager runtime failed to load."
              detail={syncStatus.error.message}
            />
          ) : null}

          {readiness.error && readiness.error.data?.code !== "NOT_FOUND" ? (
            <ErrorState
              message="Readiness state failed to load."
              detail={readiness.error.message}
            />
          ) : null}

          {syncDiagnostics?.message ? (
            <DisclosureSection
              title="Runtime"
              summary={formatSyncStatus(syncData?.status)}
            >
              <div className="space-y-3 text-sm text-zinc-600">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-500">
                  <span>Phase: {formatStepLabel(syncDiagnostics.failedStep)}</span>
                  <span>
                    Retryable: {syncDiagnostics.retryable === true ? "Yes" : "No"}
                  </span>
                  <span>
                    Imported: {String(syncDiagnostics.readingsCreated ?? 0)} new /{" "}
                    {String(syncDiagnostics.readingsUpdated ?? 0)} updated /{" "}
                    {String(syncDiagnostics.readingsSkipped ?? 0)} skipped
                  </span>
                </div>
                {syncWarnings.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-amber-700">
                    {syncWarnings.slice(0, 4).map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </DisclosureSection>
          ) : null}

          <DisclosureSection
            title="Checklist"
            summary={
              verificationItems.length > 0
                ? `${verificationItems.length} checks`
                : "No checklist"
            }
          >
            {verificationChecklist.error &&
            verificationChecklist.error.data?.code !== "NOT_FOUND" ? (
              <ErrorState
                message="Checklist failed to load."
                detail={verificationChecklist.error.message}
              />
            ) : verificationItems.length === 0 ? (
              <EmptyState message="No checklist." />
            ) : (
              <div className="space-y-3">
                {verificationSummary ? (
                  <MetricGrid
                    compact
                    items={[
                      {
                        label: "Passed",
                        value: String(verificationSummary.passedCount),
                      },
                      {
                        label: "Failed",
                        value: String(verificationSummary.failedCount),
                      },
                      {
                        label: "Needs review",
                        value: String(verificationSummary.needsReviewCount),
                      },
                    ]}
                  />
                ) : null}

                <div className="space-y-3">
                  {verificationItems.map((item) => {
                    const statusDisplay = getVerificationStatusDisplay(item.status);

                    return (
                      <div
                        key={item.key}
                        className="rounded-xl border border-zinc-200/80 bg-white/80 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold tracking-tight text-zinc-900">
                              {item.category
                                .toLowerCase()
                                .split("_")
                                .map(
                                  (segment) =>
                                    segment.charAt(0).toUpperCase() + segment.slice(1),
                                )
                                .join(" ")}
                            </div>
                            <div className="mt-1 text-[12px] text-zinc-500">{item.key}</div>
                          </div>
                          <StatusBadge label={statusDisplay.label} tone={statusDisplay.tone} />
                        </div>
                        <p className="mt-2 text-sm text-zinc-600">{item.explanation}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </DisclosureSection>

          <DisclosureSection
            title="Record"
            summary={
              readiness.data
                ? `Year ${readiness.data.reportingYear}`
                : "No record"
            }
          >
            {readiness.error?.data?.code === "NOT_FOUND" || !readiness.data ? (
              <EmptyState message="No record." />
            ) : (
              <div className="space-y-2 text-sm text-zinc-600">
                <div className="flex items-center gap-2">
                  <StatusBadge
                    label={getReadinessStatusDisplay(readiness.data.status).label}
                    tone={getReadinessStatusDisplay(readiness.data.status).tone}
                  />
                  <span>Reporting year {readiness.data.reportingYear}</span>
                </div>
                {readiness.data.complianceRunId ? (
                  <div>
                    Compliance run ID{" "}
                    <span className="font-mono text-xs text-zinc-900">
                      {readiness.data.complianceRunId}
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </DisclosureSection>

          <DisclosureSection
            title="Submissions"
            summary={
              submissions.data && submissions.data.length > 0
                ? `${submissions.data.length} recent`
                : "No submissions"
            }
          >
            {!submissions.data || submissions.data.length === 0 ? (
              <EmptyState message="No submissions." />
            ) : (
              <div className="space-y-3">
                {submissions.data.map((submission) => (
                  <div
                    key={submission.id}
                    className="rounded-xl border border-zinc-200/80 bg-white/80 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-zinc-900">
                        Reporting year {submission.reportingYear}
                      </div>
                      <StatusBadge
                        label={getReadinessStatusDisplay(submission.status).label}
                        tone={getReadinessStatusDisplay(submission.status).tone}
                      />
                    </div>
                    <div className="mt-1 text-[12px] text-zinc-500">
                      Created {formatDate(submission.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DisclosureSection>
        </div>
      </Panel>
    </div>
  );
}
