"use client";

import { useState } from "react";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricGrid,
  Panel,
  formatDate,
} from "@/components/internal/admin-primitives";
import { trpc } from "@/lib/trpc";

function toneClass(tone: "success" | "warning" | "danger" | "muted") {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "danger":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-zinc-200 bg-zinc-50 text-zinc-600";
  }
}

function StatusPill({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "success" | "warning" | "danger" | "muted";
}) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] ${toneClass(tone)}`}
    >
      {label}
    </span>
  );
}

function runtimeTone(status: string) {
  switch (status) {
    case "HEALTHY":
    case "ok":
      return "success" as const;
    case "ATTENTION":
    case "OFFLINE":
    case "degraded":
      return "warning" as const;
    default:
      return "danger" as const;
  }
}

export function EnterpriseGovernancePanel() {
  const utils = trpc.useUtils();
  const governance = trpc.organization.governanceOverview.useQuery(undefined, {
    retry: false,
  });
  const reviewApproval = trpc.organization.reviewApprovalRequest.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.organization.governanceOverview.invalidate(),
        utils.building.list.invalidate(),
        utils.building.portfolioWorklist.invalidate(),
        utils.building.portfolioStats.invalidate(),
      ]);
    },
  });
  const [reviewNotesByRequest, setReviewNotesByRequest] = useState<Record<string, string>>({});

  if (governance.isLoading) {
    return <LoadingState />;
  }

  if (governance.error || !governance.data) {
    return (
      <ErrorState
        message="Enterprise governance state is unavailable."
        detail={governance.error?.message}
      />
    );
  }

  const data = governance.data;
  const canReviewApprovals = data.capabilities.includes("APPROVAL_REVIEW");
  const pendingApprovals = data.approvals.filter((request) => request.status === "PENDING");
  const recentAuditLogs = data.auditLogs.slice(0, 12);

  return (
    <Panel
      title="Enterprise governance"
      subtitle="Approvals, runtime, and audit trail."
    >
      <div className="space-y-6 border-t border-zinc-200/80 pt-5">
        <MetricGrid
          items={[
            {
              label: "Active organization",
              value: data.organization.name,
            },
            {
              label: "Current role",
              value: data.currentRole,
            },
            {
              label: "Pending approvals",
              value: pendingApprovals.length,
              tone: pendingApprovals.length > 0 ? "warning" : "default",
            },
            {
              label: "Runtime",
              value: data.runtimeHealth.status,
              tone: data.runtimeHealth.status === "ok" ? "success" : "warning",
            },
          ]}
          compact
        />

        <section className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-4">
          <div className="text-sm font-semibold tracking-tight text-zinc-900">
            Active tenant and capabilities
          </div>
          <div className="mt-2 text-sm leading-6 text-zinc-600">
            <span className="font-medium text-zinc-900">{data.organization.name}</span>.
            Sensitive actions are checked server-side.
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.capabilities.map((capability) => (
              <StatusPill key={capability} label={capability.replaceAll("_", " ")} />
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold tracking-tight text-zinc-900">
                Pending approvals
              </div>
              <StatusPill
                label={`${pendingApprovals.length} pending`}
                tone={pendingApprovals.length > 0 ? "warning" : "success"}
              />
            </div>

            {pendingApprovals.length === 0 ? (
              <EmptyState message="No high-risk actions are waiting for approval right now." />
            ) : (
              <div className="mt-4 space-y-4">
                {pendingApprovals.map((request) => {
                  const notes = reviewNotesByRequest[request.id] ?? "";
                  return (
                    <article
                      key={request.id}
                      className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900">
                            {request.title}
                          </div>
                          <div className="mt-1 text-sm leading-6 text-zinc-600">
                            {request.summary}
                          </div>
                        </div>
                        <StatusPill label={request.requestType.replaceAll("_", " ")} />
                      </div>
                      <div className="mt-3 text-xs text-zinc-500">
                        Requested {formatDate(request.requestedAt)}
                        {request.requestedByDisplay?.name
                          ? ` by ${request.requestedByDisplay.name}`
                          : request.requestedById
                            ? ` by ${request.requestedById}`
                            : ""}
                        {request.buildingId ? ` | Building ${request.buildingId}` : ""}
                      </div>
                      <label className="mt-4 block space-y-2">
                        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                          Review notes
                        </span>
                        <textarea
                          value={notes}
                          onChange={(event) =>
                            setReviewNotesByRequest((current) => ({
                              ...current,
                              [request.id]: event.target.value,
                            }))
                          }
                          placeholder="Add approval or rejection rationale."
                          className="min-h-[84px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500"
                          disabled={!canReviewApprovals || reviewApproval.isPending}
                        />
                      </label>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {canReviewApprovals ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                reviewApproval.mutate({
                                  approvalRequestId: request.id,
                                  decision: "APPROVE",
                                  notes: notes.trim() || undefined,
                                })
                              }
                              disabled={reviewApproval.isPending}
                              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                reviewApproval.mutate({
                                  approvalRequestId: request.id,
                                  decision: "REJECT",
                                  notes: notes.trim() || undefined,
                                })
                              }
                              disabled={reviewApproval.isPending}
                              className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <div className="text-sm text-zinc-500">
                            Admin approval capability is required to review these actions.
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {reviewApproval.error ? (
              <div className="mt-4">
                <ErrorState
                  message="Approval review failed."
                  detail={reviewApproval.error.message}
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-4">
              <div className="text-sm font-semibold tracking-tight text-zinc-900">
                Runtime health
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusPill
                  label={data.runtimeHealth.status}
                  tone={runtimeTone(data.runtimeHealth.status)}
                />
                <StatusPill
                  label={`worker ${data.runtimeHealth.services.worker.workerStatus}`}
                  tone={runtimeTone(data.runtimeHealth.services.worker.workerStatus)}
                />
              </div>
              <div className="mt-4 space-y-2 text-sm text-zinc-600">
                <div>App version {data.runtimeHealth.build.version}</div>
                <div>Node runtime {data.runtimeHealth.build.runtime}</div>
                <div>
                  Latest failed job class:{" "}
                  {data.runtimeHealth.jobs.latestFailureClass ?? "None"}
                </div>
                <div>Stalled jobs: {data.runtimeHealth.jobs.stalledCount}</div>
              </div>
              <div className="mt-4 space-y-2">
                {data.runtimeHealth.queues.items.map((queue) => (
                  <div
                    key={queue.name}
                    className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-zinc-900">{queue.name}</div>
                      <StatusPill label={queue.status} tone={runtimeTone(queue.status)} />
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">
                      waiting {queue.waitingCount} | active {queue.activeCount} | delayed{" "}
                      {queue.delayedCount} | failed {queue.failedCount}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-4">
              <div className="text-sm font-semibold tracking-tight text-zinc-900">
                Integration status
              </div>
              <div className="mt-4 space-y-3 text-sm text-zinc-600">
                <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-3">
                  <div className="font-medium text-zinc-900">Portfolio Manager</div>
                  <div className="mt-1">
                    Mode {data.integrations.portfolioManager.managementMode ?? "Not configured"} |{" "}
                    Status {data.integrations.portfolioManager.status}
                  </div>
                  <div className="mt-1">
                    Linked buildings {data.integrations.portfolioManager.linkedBuildingCount}
                  </div>
                  {data.integrations.portfolioManager.targetUsername ? (
                    <div className="mt-1">
                      Customer account {data.integrations.portfolioManager.targetUsername}
                    </div>
                  ) : null}
                  {data.integrations.portfolioManager.latestErrorMessage ? (
                    <div className="mt-1 text-red-700">
                      {data.integrations.portfolioManager.latestErrorMessage}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-3">
                  <div className="font-medium text-zinc-900">Green Button</div>
                  <div className="mt-1">
                    Active {data.integrations.greenButton.ACTIVE ?? 0} | Failed{" "}
                    {data.integrations.greenButton.FAILED ?? 0}
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-3">
                  <div className="font-medium text-zinc-900">Utility bill OCR</div>
                  <div className="mt-1">
                    Ready for review {data.integrations.utilityBills.READY_FOR_REVIEW ?? 0} |
                    Failed {data.integrations.utilityBills.FAILED ?? 0} | Confirmed{" "}
                    {data.integrations.utilityBills.CONFIRMED ?? 0}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-4">
          <div className="text-sm font-semibold tracking-tight text-zinc-900">
            Recent audit trail
          </div>
          {recentAuditLogs.length === 0 ? (
            <EmptyState message="No audit events yet." />
          ) : (
            <div className="mt-4 space-y-2">
              {recentAuditLogs.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-medium text-zinc-900">{entry.action}</div>
                    <div className="text-xs text-zinc-500">{formatDate(entry.timestamp)}</div>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {entry.actorDisplay?.name ?? entry.actorId ?? entry.actorType}
                    {entry.buildingId ? ` | Building ${entry.buildingId}` : ""}
                    {entry.requestId ? ` | Request ${entry.requestId}` : ""}
                    {entry.errorCode ? ` | Error ${entry.errorCode}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Panel>
  );
}
