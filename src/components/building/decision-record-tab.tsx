"use client";

import React from "react";
import { EmptyState, Panel, formatDate } from "@/components/internal/admin-primitives";
import {
  StatusBadge,
  getDataIssueSeverityDisplay,
  getDataIssueStatusDisplay,
  getPrimaryComplianceStatusDisplay,
  getSourceReconciliationStatusDisplay,
  getVerificationStatusDisplay,
  humanizeToken,
} from "@/components/internal/status-helpers";

function decisionExplanation(input: {
  blocked: boolean;
  meetsStandard: boolean | null;
  reasonSummary: string;
}) {
  if (input.blocked) {
    return "The current benchmark decision is blocked by data or workflow issues.";
  }

  if (input.meetsStandard === true) {
    return "The current governed benchmark decision meets the active standard.";
  }

  if (input.meetsStandard === false) {
    return "The current governed benchmark decision does not meet the active standard.";
  }

  return input.reasonSummary || "A governed decision has not been recorded yet.";
}

type DecisionRecordTabProps = {
  building: any;
  verificationChecklist: any;
};

export function DecisionRecordTab({
  building,
  verificationChecklist,
}: DecisionRecordTabProps) {
  const readiness = building.readinessSummary;
  const benchmarkEvaluation = readiness.evaluations.benchmark;
  const primaryDisplay = getPrimaryComplianceStatusDisplay(readiness.primaryStatus);
  const activeIssues = building.issueSummary.openIssues.filter(
    (issue: any) => issue.status === "OPEN" || issue.status === "IN_PROGRESS",
  );
  const verificationItemsNeedingAttention = (verificationChecklist?.items ?? []).filter(
    (item: any) => item.status === "FAILED" || item.status === "NEEDS_REVIEW",
  );
  const sourceReconciliation = building.sourceReconciliation;
  const sourceReconciliationDisplay = getSourceReconciliationStatusDisplay(
    sourceReconciliation?.status ?? "NOT_STARTED",
  );

  const auditEvents = [
    {
      label: "Readiness evaluation",
      value: readiness.lastReadinessEvaluatedAt,
    },
    {
      label: "Compliance evaluation",
      value: readiness.lastComplianceEvaluatedAt ?? benchmarkEvaluation?.lastComplianceEvaluatedAt ?? null,
    },
    {
      label: "Packet generation",
      value: readiness.lastPacketGeneratedAt,
    },
    {
      label: "Packet finalization",
      value: readiness.lastPacketFinalizedAt,
    },
    {
      label: "Submission transition",
      value: building.governedSummary.timestamps.lastSubmissionTransitionAt,
    },
  ].filter((event) => event.value);

  return (
    <div className="space-y-5">
      <Panel
        title="Benchmark record"
        subtitle="See why the current benchmark status stands and what supports it."
        compact
      >
        <div className="space-y-4 border-t border-zinc-200/80 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold tracking-tight text-zinc-900">
                Current status
              </div>
              <div className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">
                {decisionExplanation({
                  blocked: benchmarkEvaluation?.decision.blocked ?? false,
                  meetsStandard: benchmarkEvaluation?.decision.meetsStandard ?? null,
                  reasonSummary: benchmarkEvaluation?.reasonSummary ?? readiness.reasonSummary,
                })}
              </div>
            </div>
            <StatusBadge label={primaryDisplay.label} tone={primaryDisplay.tone} />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
              <div className="text-[11px] font-medium text-zinc-500">Reporting year</div>
              <div className="mt-1 text-sm font-semibold tracking-tight text-zinc-900">
                {benchmarkEvaluation?.reportingYear ?? "Not recorded"}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
              <div className="text-[11px] font-medium text-zinc-500">Rule version</div>
              <div className="mt-1 text-sm font-semibold tracking-tight text-zinc-900">
                {benchmarkEvaluation?.ruleVersion ?? "Not recorded"}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
              <div className="text-[11px] font-medium text-zinc-500">Metric used</div>
              <div className="mt-1 text-sm font-semibold tracking-tight text-zinc-900">
                {benchmarkEvaluation?.metricUsed
                  ? humanizeToken(benchmarkEvaluation.metricUsed)
                  : "Not recorded"}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3">
              <div className="text-[11px] font-medium text-zinc-500">QA verdict</div>
              <div className="mt-1 text-sm font-semibold tracking-tight text-zinc-900">
                {readiness.qaVerdict ? humanizeToken(readiness.qaVerdict) : "Not recorded"}
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel
          title="Supporting evidence"
          subtitle="Only the items still affecting the benchmark stay visible here."
          compact
        >
          <div className="space-y-4 border-t border-zinc-200/80 pt-4">
            <div className="space-y-3">
              <div className="text-sm font-semibold tracking-tight text-zinc-900">Open data issues</div>
              {activeIssues.length === 0 ? (
                <div className="text-sm text-zinc-500">No open data issues are affecting the current decision.</div>
              ) : (
                activeIssues.slice(0, 4).map((issue: any) => {
                  const severityDisplay = getDataIssueSeverityDisplay(issue.severity);
                  const statusDisplay = getDataIssueStatusDisplay(issue.status);
                  return (
                    <div
                      key={issue.id}
                      className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold tracking-tight text-zinc-900">
                            {issue.title}
                          </div>
                          <div className="mt-1 text-sm text-zinc-600">{issue.requiredAction}</div>
                          <div className="mt-2 text-[12px] text-zinc-500">
                            {humanizeToken(issue.issueType)} | {issue.source}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <StatusBadge label={severityDisplay.label} tone={severityDisplay.tone} />
                          <StatusBadge label={statusDisplay.label} tone={statusDisplay.tone} />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="space-y-3">
              <div className="text-sm font-semibold tracking-tight text-zinc-900">
                Verification checks
              </div>
              {verificationChecklist ? (
                <>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3 text-sm text-zinc-600">
                    {verificationChecklist.summary.passedCount} passed |{" "}
                    {verificationChecklist.summary.failedCount} failed |{" "}
                    {verificationChecklist.summary.needsReviewCount} need review
                  </div>
                  {verificationItemsNeedingAttention.length > 0 ? (
                    verificationItemsNeedingAttention.slice(0, 4).map((item: any) => {
                      const display = getVerificationStatusDisplay(item.status);
                      return (
                        <div
                          key={item.key}
                          className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold tracking-tight text-zinc-900">
                                {humanizeToken(item.key)}
                              </div>
                              <div className="mt-1 text-sm text-zinc-600">{item.explanation}</div>
                            </div>
                            <StatusBadge label={display.label} tone={display.tone} />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-zinc-500">
                      No verification items currently require review on this page.
                    </div>
                  )}
                </>
              ) : (
                <EmptyState message="Verification detail is not available for the current reporting year." />
              )}
            </div>
          </div>
        </Panel>

        <Panel
          title="Source history"
          subtitle="Review the current source choice and any unresolved drift."
          compact
        >
          <div className="space-y-4 border-t border-zinc-200/80 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight text-zinc-900">
                  Source reconciliation
                </div>
                <div className="mt-1 text-sm text-zinc-600">
                  {sourceReconciliation
                    ? `${sourceReconciliation.canonicalSource ? humanizeToken(sourceReconciliation.canonicalSource) : "No canonical source selected"} | ${sourceReconciliation.conflictCount} conflict(s) | ${sourceReconciliation.incompleteCount} incomplete source(s)`
                    : "No reconciliation record exists yet."}
                </div>
              </div>
              <StatusBadge
                label={sourceReconciliationDisplay.label}
                tone={sourceReconciliationDisplay.tone}
              />
            </div>

            {sourceReconciliation ? (
              <>
                <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3 text-sm text-zinc-600">
                  Reference year {sourceReconciliation.referenceYear ?? "Not recorded"} | Last reconciled{" "}
                  {sourceReconciliation.lastReconciledAt
                    ? formatDate(sourceReconciliation.lastReconciledAt)
                    : "Not recorded"}
                </div>
                <details className="rounded-2xl border border-zinc-200/80 bg-[#fafbfc] px-4 py-3">
                  <summary className="cursor-pointer list-none text-sm font-semibold tracking-tight text-zinc-900">
                    Source records and conflicts
                  </summary>
                  <div className="mt-4 space-y-3">
                    {sourceReconciliation.sourceRecords.map((record: any) => (
                      <div
                        key={`${record.sourceSystem}-${record.externalRecordId ?? record.linkedRecordId ?? "record"}`}
                        className="rounded-xl border border-zinc-200/80 bg-white/80 px-4 py-3 text-sm text-zinc-600"
                      >
                        <div className="font-semibold tracking-tight text-zinc-900">
                          {humanizeToken(record.sourceSystem)}
                        </div>
                        <div className="mt-1">
                          {humanizeToken(record.state)} | {record.coverageMonthCount} month(s) |{" "}
                          {record.readingCount} reading(s)
                        </div>
                      </div>
                    ))}
                    {sourceReconciliation.conflicts.map((conflict: any, index: number) => (
                      <div
                        key={`${conflict.code}-${index}`}
                        className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-sm text-amber-900"
                      >
                        <div className="font-semibold tracking-tight">{humanizeToken(conflict.code)}</div>
                        <div className="mt-1">{conflict.message}</div>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            ) : (
              <EmptyState message="No source reconciliation record is available for this building yet." />
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title="Recent activity"
        subtitle="See what the governed system last evaluated, generated, or changed."
        compact
      >
        <div className="grid gap-4 border-t border-zinc-200/80 pt-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            {auditEvents.length > 0 ? (
              auditEvents.map((event) => (
                <div
                  key={event.label}
                  className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3"
                >
                  <div className="text-sm font-semibold tracking-tight text-zinc-900">
                    {event.label}
                  </div>
                  <div className="mt-1 text-sm text-zinc-600">{formatDate(event.value!)}</div>
                </div>
              ))
            ) : (
              <EmptyState message="No governed lifecycle events are recorded yet." />
            )}
          </div>

          <div className="space-y-3">
            {building.recentAuditLogs.length > 0 ? (
              building.recentAuditLogs.slice(0, 8).map((entry: any) => (
                <div
                  key={entry.id}
                  className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold tracking-tight text-zinc-900">
                        {humanizeToken(entry.action)}
                      </div>
                      <div className="mt-1 text-sm text-zinc-600">
                        {formatDate(entry.timestamp)}
                      </div>
                    </div>
                    {entry.errorCode ? (
                      <StatusBadge label={entry.errorCode} tone="warning" />
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState message="No recent audit log entries are available." />
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
