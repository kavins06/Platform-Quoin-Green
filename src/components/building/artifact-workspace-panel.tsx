"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  ErrorState,
  Panel,
  downloadFile,
  formatDate,
  formatMoney,
} from "@/components/internal/admin-primitives";
import {
  StatusBadge,
  getPacketStatusDisplay,
  getSubmissionWorkflowStateDisplay,
  humanizeToken,
} from "@/components/internal/status-helpers";

function getDispositionDisplay(disposition: string | null) {
  switch (disposition) {
    case "READY":
      return { label: "Ready", tone: "success" as const };
    case "READY_WITH_WARNINGS":
      return { label: "Ready with warnings", tone: "warning" as const };
    case "BLOCKED":
      return { label: "Blocked", tone: "danger" as const };
    default:
      return { label: "Not generated", tone: "muted" as const };
  }
}

function getFinalizeGuidance(workflow: ArtifactWorkflow) {
  if (workflow.canFinalize) {
    return "The current packet is ready to finalize for review.";
  }

  if (!workflow.latestArtifact) {
    return "Generate the current governed packet to begin review.";
  }

  if (workflow.latestArtifact.finalizedAt) {
    return "The latest packet is already finalized.";
  }

  return "Finalization is blocked by the current packet state.";
}

function getWorkflowGuidance(
  workflow: ArtifactWorkflow,
  canManageSubmissionWorkflows: boolean,
) {
  if (!canManageSubmissionWorkflows) {
    return "Submission transitions require manager or admin access.";
  }

  if (!workflow.submissionWorkflow) {
    return "Submission workflow begins after the first governed packet is generated.";
  }

  return workflow.submissionWorkflow.nextAction.reason;
}

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
          <div className="text-[12px] text-zinc-500">Show</div>
        </div>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

type ArtifactWorkflow = {
  label: string;
  packetType: string | null;
  sourceRecordId: string | null;
  status: "NOT_STARTED" | "DRAFT" | "GENERATED" | "STALE" | "FINALIZED";
  disposition: string | null;
  canGenerate: boolean;
  canFinalize: boolean;
  latestArtifact: {
    id: string;
    version: number;
    status: "NOT_STARTED" | "DRAFT" | "GENERATED" | "STALE" | "FINALIZED";
    packetHash: string;
    generatedAt: string;
    finalizedAt: string | null;
    exportAvailable: boolean;
    lastExportedAt: string | null;
    lastExportFormat: "JSON" | "MARKDOWN" | "PDF" | null;
  } | null;
  history: Array<{
    id: string;
    version: number;
    status: "NOT_STARTED" | "DRAFT" | "GENERATED" | "STALE" | "FINALIZED";
    packetHash: string;
    generatedAt: string;
    finalizedAt: string | null;
    exportAvailable: boolean;
    lastExportedAt: string | null;
    lastExportFormat: "JSON" | "MARKDOWN" | "PDF" | null;
  }>;
  submissionWorkflow: {
    id: string;
    state:
      | "NOT_STARTED"
      | "DRAFT"
      | "READY_FOR_REVIEW"
      | "APPROVED_FOR_SUBMISSION"
      | "SUBMITTED"
      | "COMPLETED"
      | "NEEDS_CORRECTION"
      | "SUPERSEDED";
    latestTransitionAt: string | null;
    readyForReviewAt: string | null;
    approvedAt: string | null;
    submittedAt: string | null;
    completedAt: string | null;
    needsCorrectionAt: string | null;
    latestNotes: string | null;
    allowedTransitions: Array<{
      nextState:
        | "READY_FOR_REVIEW"
        | "APPROVED_FOR_SUBMISSION"
        | "SUBMITTED"
        | "COMPLETED"
        | "NEEDS_CORRECTION";
      label: string;
    }>;
    nextAction: {
      title: string;
      reason: string;
    };
    history: Array<{
      id: string;
      fromState:
        | "DRAFT"
        | "READY_FOR_REVIEW"
        | "APPROVED_FOR_SUBMISSION"
        | "SUBMITTED"
        | "COMPLETED"
        | "NEEDS_CORRECTION"
        | "SUPERSEDED"
        | null;
      toState:
        | "DRAFT"
        | "READY_FOR_REVIEW"
        | "APPROVED_FOR_SUBMISSION"
        | "SUBMITTED"
        | "COMPLETED"
        | "NEEDS_CORRECTION"
        | "SUPERSEDED";
      notes: string | null;
      createdAt: string;
      createdByType: string;
      createdById: string | null;
    }>;
  } | null;
  blockersCount: number;
  warningCount: number;
  sourceContext: {
    readinessState: string;
    primaryStatus: string;
    qaVerdict: string | null;
    reasonSummary: string;
    reportingYear: number | null;
    complianceRunId: string | null;
    readinessEvaluatedAt: string | null;
    complianceEvaluatedAt: string | null;
  };
};

function ArtifactCard({
  workflow,
  onGenerate,
  onFinalize,
  onExport,
  isGenerating,
  isFinalizing,
  onWorkflowTransition,
  isTransitioning,
  canManageSubmissionWorkflows,
  transitionNotes,
  onTransitionNotesChange,
}: {
  workflow: ArtifactWorkflow;
  onGenerate: () => void;
  onFinalize: () => void;
  onExport: (format: "JSON" | "MARKDOWN" | "PDF") => void;
  isGenerating: boolean;
  isFinalizing: boolean;
  onWorkflowTransition: (
    nextState:
      | "READY_FOR_REVIEW"
      | "APPROVED_FOR_SUBMISSION"
      | "SUBMITTED"
      | "COMPLETED"
      | "NEEDS_CORRECTION",
    notes: string | null,
  ) => void;
  isTransitioning: boolean;
  canManageSubmissionWorkflows: boolean;
  transitionNotes: string;
  onTransitionNotesChange: (value: string) => void;
}) {
  const dispositionDisplay = getDispositionDisplay(workflow.disposition);
  const workflowDisplay = getSubmissionWorkflowStateDisplay(
    workflow.submissionWorkflow?.state ?? "NOT_STARTED",
  );
  const transitionActions = canManageSubmissionWorkflows
    ? workflow.submissionWorkflow?.allowedTransitions ?? []
    : [];
  const primaryTransition =
    !workflow.canGenerate && !workflow.canFinalize
      ? transitionActions[0] ?? null
      : null;
  const secondaryTransitions = primaryTransition
    ? transitionActions.filter(
        (transition) => transition.nextState !== primaryTransition.nextState,
      )
    : transitionActions;
  const primaryButtonClass = "btn-primary inline-flex items-center justify-center";
  const quietButtonClass = "btn-secondary px-3 py-2 text-sm disabled:opacity-50";
  const primaryActionReason = workflow.submissionWorkflow
    ? workflow.submissionWorkflow.nextAction.reason
    : getFinalizeGuidance(workflow);
  const latestPacketSummary = workflow.latestArtifact
    ? `v${workflow.latestArtifact.version} generated ${formatDate(
        workflow.latestArtifact.generatedAt,
      )}`
    : "No packet generated yet";
  const historySummary = workflow.history[0]
    ? `${workflow.history.length} version(s), latest ${formatDate(workflow.history[0].generatedAt)}`
    : "No governed package versions yet";
  const workflowHistorySummary = workflow.submissionWorkflow?.history[0]
    ? `${workflow.submissionWorkflow.history.length} transition(s), latest ${formatDate(
        workflow.submissionWorkflow.history[0].createdAt,
      )}`
    : "No review or submission transitions yet";

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200/80 bg-white/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight text-zinc-900">
            {workflow.label}
          </div>
          <div className="mt-1 text-[12px] text-zinc-500">
            {workflow.sourceContext.reportingYear != null
              ? `Reporting year ${workflow.sourceContext.reportingYear}`
              : "No governed source record"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge label={dispositionDisplay.label} tone={dispositionDisplay.tone} />
          <StatusBadge label={workflowDisplay.label} tone={workflowDisplay.tone} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200/80 bg-[#fafbfc] px-3 py-3">
          <div className="text-[11px] font-medium text-zinc-500">Latest packet</div>
          <div className="mt-1 text-sm font-semibold tracking-tight text-zinc-900">
            {latestPacketSummary}
          </div>
          <div className="mt-1 text-[12px] text-zinc-500">
            {workflow.latestArtifact?.finalizedAt
              ? `Finalized ${formatDate(workflow.latestArtifact.finalizedAt)}`
              : "Not finalized"}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200/80 bg-[#fafbfc] px-3 py-3">
          <div className="text-[11px] font-medium text-zinc-500">Submission</div>
          <div className="mt-1 text-sm font-semibold tracking-tight text-zinc-900">
            {workflowDisplay.label}
          </div>
          <div className="mt-1 text-[12px] text-zinc-500">
            {workflow.submissionWorkflow?.latestTransitionAt
              ? `Last moved ${formatDate(workflow.submissionWorkflow.latestTransitionAt)}`
              : "Not started"}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200/80 bg-[#fafbfc] px-3 py-3">
          <div className="text-[11px] font-medium text-zinc-500">Issues</div>
          <div className="mt-1 text-sm font-semibold tracking-tight text-zinc-900">
            {workflow.blockersCount} blocker(s)
          </div>
          <div className="mt-1 text-[12px] text-zinc-500">
            {workflow.warningCount} warning(s)
          </div>
        </div>
      </div>

      <div className="text-sm text-zinc-600">{primaryActionReason}</div>

      <div className="flex flex-wrap items-center gap-2">
        {workflow.canGenerate ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={!workflow.canGenerate || isGenerating}
            className={primaryButtonClass}
          >
            {isGenerating
              ? "Generating package..."
              : workflow.latestArtifact
                ? "Refresh package"
                : "Generate package"}
          </button>
        ) : null}
        {!workflow.canGenerate && workflow.canFinalize ? (
          <button
            type="button"
            onClick={onFinalize}
            disabled={!workflow.canFinalize || isFinalizing}
            className={primaryButtonClass}
          >
            {isFinalizing ? "Finalizing package..." : "Finalize package"}
          </button>
        ) : null}
        {!workflow.canGenerate && !workflow.canFinalize && primaryTransition ? (
          <button
            type="button"
            onClick={() =>
              onWorkflowTransition(
                primaryTransition.nextState,
                transitionNotes.trim().length > 0 ? transitionNotes.trim() : null,
              )
            }
            disabled={isTransitioning}
            className={primaryButtonClass}
          >
            {primaryTransition.label}
          </button>
        ) : null}

        {secondaryTransitions.map((transition) => (
          <button
            key={transition.nextState}
            type="button"
            onClick={() =>
              onWorkflowTransition(
                transition.nextState,
                transitionNotes.trim().length > 0 ? transitionNotes.trim() : null,
              )
            }
            disabled={isTransitioning}
            className={quietButtonClass}
          >
            {transition.label}
          </button>
        ))}
        {workflow.latestArtifact ? (
          <>
            <button
              type="button"
              onClick={() => onExport("PDF")}
              className={quietButtonClass}
            >
              Export PDF
            </button>
            <button
              type="button"
              onClick={() => onExport("JSON")}
              className={quietButtonClass}
            >
              Export JSON
            </button>
          </>
        ) : null}
      </div>

      <DisclosureSection
        title="More detail"
        summary={`${workflow.sourceContext.reasonSummary} | ${workflow.blockersCount} blocker(s), ${workflow.warningCount} warning(s)`}
      >
        <div className="space-y-2 text-sm text-zinc-600">
          <div>{workflow.sourceContext.reasonSummary}</div>
          <div>
            Readiness {humanizeToken(workflow.sourceContext.readinessState)} | QA{" "}
            {workflow.sourceContext.qaVerdict ?? "Not recorded"}
          </div>
          <div>
            Compliance status {humanizeToken(workflow.sourceContext.primaryStatus)}
          </div>
          {workflow.sourceContext.readinessEvaluatedAt ? (
            <div>Last evaluated {formatDate(workflow.sourceContext.readinessEvaluatedAt)}</div>
          ) : null}
        </div>
      </DisclosureSection>

      {canManageSubmissionWorkflows && workflow.submissionWorkflow ? (
        <DisclosureSection
          title="Add note"
          summary="Notes are stored on the governed workflow transition."
        >
          <label className="text-[11px] font-medium text-zinc-500">
            Transition note
          </label>
          <textarea
            value={transitionNotes}
            onChange={(event) => onTransitionNotesChange(event.target.value)}
            placeholder="Add rationale for this workflow transition."
            className="mt-2 min-h-[84px] w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
          />
        </DisclosureSection>
      ) : null}

      <DisclosureSection title="Version history" summary={historySummary}>
        {workflow.history.length === 0 ? (
          <div className="text-sm text-zinc-500">
            No governed package versions exist yet. Generate the package to start version history.
          </div>
        ) : (
          <div className="space-y-2">
            {workflow.history.map((version) => {
              const versionStatus = getPacketStatusDisplay(version.status);
              return (
                <div
                  key={version.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-white/80 px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-medium text-zinc-900">
                      v{version.version} | {formatDate(version.generatedAt)}
                    </div>
                    <div className="mt-1 text-zinc-500">
                      {version.finalizedAt
                        ? `Finalized ${formatDate(version.finalizedAt)}`
                        : "Not finalized"}
                      {version.lastExportedAt
                        ? ` | Last export ${version.lastExportFormat ?? "unknown"} ${formatDate(version.lastExportedAt)}`
                        : ""}
                    </div>
                  </div>
                  <StatusBadge label={versionStatus.label} tone={versionStatus.tone} />
                </div>
              );
            })}
          </div>
        )}
      </DisclosureSection>

      {workflow.submissionWorkflow ? (
        <DisclosureSection title="Workflow history" summary={workflowHistorySummary}>
          {workflow.submissionWorkflow.history.length === 0 ? (
            <div className="text-sm text-zinc-500">
              No review or submission transitions are recorded yet.
            </div>
          ) : (
            <div className="space-y-2">
              {workflow.submissionWorkflow.history.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-zinc-200/80 bg-white/80 px-4 py-3 text-sm"
                >
                  <div className="font-medium text-zinc-900">
                    {humanizeToken(entry.fromState ?? "START")} to {humanizeToken(entry.toState)}
                  </div>
                  <div className="mt-1 text-zinc-500">
                    {formatDate(entry.createdAt)}
                    {entry.notes ? ` | ${entry.notes}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DisclosureSection>
      ) : null}
    </div>
  );
}

export function ArtifactWorkspacePanel({
  buildingId,
  canManageSubmissionWorkflows = false,
  scopes = ["benchmark"],
  title = "Governed artifacts",
  subtitle = "These are the immutable benchmarking artifacts generated from the current readiness and submission context.",
  compact = false,
}: {
  buildingId: string;
  canManageSubmissionWorkflows?: boolean;
  scopes?: Array<"benchmark">;
  title?: string;
  subtitle?: string;
  compact?: boolean;
}) {
  const utils = trpc.useUtils();
  const [benchmarkWorkflowNotes, setBenchmarkWorkflowNotes] = useState("");
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const artifactWorkspace = trpc.building.getArtifactWorkspace.useQuery(
    { buildingId },
    { retry: false },
  );

  const invalidateAll = async () => {
    await Promise.all([
      utils.building.get.invalidate({ id: buildingId }),
      utils.building.list.invalidate(),
      utils.building.getArtifactWorkspace.invalidate({ buildingId }),
      utils.building.portfolioWorklist.invalidate(),
    ]);
  };

  const benchmarkGenerate = trpc.benchmarking.generateBenchmarkPacket.useMutation({
    onSuccess: invalidateAll,
  });
  const benchmarkFinalize = trpc.benchmarking.finalizeBenchmarkPacket.useMutation({
    onSuccess: invalidateAll,
  });
  const transitionWorkflow = trpc.building.transitionSubmissionWorkflow.useMutation({
    onSuccess: async (result) => {
      setTransitionMessage(result.message);
      await Promise.all([
        invalidateAll(),
        utils.organization.governanceOverview.invalidate(),
      ]);
    },
  });

  async function exportBenchmark(format: "JSON" | "MARKDOWN" | "PDF") {
    const workflow = artifactWorkspace.data?.benchmarkVerification;
    const reportingYear = workflow?.sourceContext.reportingYear;
    if (reportingYear == null) {
      return;
    }

    const result = await utils.benchmarking.exportBenchmarkPacket.fetch({
      buildingId,
      reportingYear,
      format,
    });

    downloadFile({
      fileName: result.fileName,
      content: result.content,
      contentType: result.contentType,
      encoding: result.encoding,
    });
    await invalidateAll();
  }

  if (artifactWorkspace.isLoading) {
    return (
      <Panel title={title} subtitle={subtitle} compact={compact}>
        <div className="text-sm text-zinc-500">Preparing the governed artifact workspace...</div>
      </Panel>
    );
  }

  if (artifactWorkspace.error || !artifactWorkspace.data) {
    return (
      <ErrorState
        message="Governed artifact workspace is unavailable."
        detail={artifactWorkspace.error?.message}
      />
    );
  }

  const benchmark = artifactWorkspace.data.benchmarkVerification;
  return (
    <Panel title={title} subtitle={subtitle} compact={compact}>
      <div className="space-y-4 border-t border-zinc-200/80 pt-4">
        {transitionMessage ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {transitionMessage}
          </div>
        ) : null}
        {scopes.includes("benchmark") ? (
          <ArtifactCard
            workflow={benchmark}
            onGenerate={() => {
              const reportingYear = benchmark.sourceContext.reportingYear;
              if (reportingYear != null) {
                benchmarkGenerate.mutate({ buildingId, reportingYear });
              }
            }}
            onFinalize={() => {
              const reportingYear = benchmark.sourceContext.reportingYear;
              if (reportingYear != null) {
                benchmarkFinalize.mutate({ buildingId, reportingYear });
              }
            }}
            onExport={exportBenchmark}
            isGenerating={benchmarkGenerate.isPending}
            isFinalizing={benchmarkFinalize.isPending}
            onWorkflowTransition={(nextState, notes) => {
              const workflowId = benchmark.submissionWorkflow?.id;
              if (workflowId) {
                transitionWorkflow.mutate({
                  buildingId,
                  workflowId,
                  nextState,
                  notes,
                });
              }
            }}
            isTransitioning={transitionWorkflow.isPending}
            canManageSubmissionWorkflows={canManageSubmissionWorkflows}
            transitionNotes={benchmarkWorkflowNotes}
            onTransitionNotesChange={setBenchmarkWorkflowNotes}
          />
        ) : null}
      </div>
    </Panel>
  );
}
