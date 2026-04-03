"use client";

import React from "react";
import {
  StatusBadge,
  getWorkflowStageStatusDisplay,
} from "@/components/internal/status-helpers";
import { WorkflowPanel } from "./workflow-panel";
import { BenchmarkingTab } from "./benchmarking-tab";
import { VerificationRequestsTab } from "./verification-requests-tab";
import { ArtifactWorkspacePanel } from "./artifact-workspace-panel";

type BenchmarkWorkbenchProps = {
  buildingId: string;
  canManage: boolean;
  canManageSubmissionWorkflows: boolean;
  onUpload: () => void;
  readinessSummary: {
    state: string;
    blockingIssueCount: number;
    warningIssueCount: number;
    nextAction: {
      title: string;
      reason: string;
    };
    lastReadinessEvaluatedAt: string | null;
  };
  governedSummary: {
    artifactSummary: {
      benchmark: {
        latestArtifactStatus: "NOT_STARTED" | "DRAFT" | "GENERATED" | "STALE" | "FINALIZED";
        lastGeneratedAt: string | null;
        lastFinalizedAt: string | null;
      };
    };
    submissionSummary: {
      benchmark: {
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
      } | null;
    };
    runtimeSummary: {
      needsAttention: boolean;
    };
  };
};

type StageKey = "source" | "verification" | "submission";

function deriveStageStatus(input: {
  blocked: boolean;
  started: boolean;
  complete: boolean;
  needsAttention: boolean;
}) {
  if (input.blocked) {
    return "BLOCKED" as const;
  }
  if (input.complete) {
    return "COMPLETE" as const;
  }
  if (input.needsAttention || input.started) {
    return "NEEDS_ATTENTION" as const;
  }
  return "NOT_STARTED" as const;
}

function getDefaultActiveStage(params: {
  readinessState: string;
  packetStatus: "NOT_STARTED" | "DRAFT" | "GENERATED" | "STALE" | "FINALIZED";
  workflowState:
    | "NOT_STARTED"
    | "DRAFT"
    | "READY_FOR_REVIEW"
    | "APPROVED_FOR_SUBMISSION"
    | "SUBMITTED"
    | "COMPLETED"
    | "NEEDS_CORRECTION"
    | "SUPERSEDED"
    | null;
}) {
  if (params.workflowState && params.workflowState !== "NOT_STARTED") {
    return "submission" as const;
  }

  if (params.packetStatus === "FINALIZED") {
    return "submission" as const;
  }

  if (
    params.readinessState !== "DATA_INCOMPLETE" ||
    params.packetStatus === "GENERATED" ||
    params.packetStatus === "STALE"
  ) {
    return "verification" as const;
  }

  return "source" as const;
}

function CollapsedStage({
  stage,
  onOpen,
}: {
  stage: {
    key: StageKey;
    label: string;
    status: "COMPLETE" | "NEEDS_ATTENTION" | "BLOCKED" | "NOT_STARTED";
    summary: string;
  };
  onOpen: () => void;
}) {
  const status = getWorkflowStageStatusDisplay(stage.status);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-[#fafbfc] px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-white"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold tracking-tight text-zinc-900">
          {stage.label}
        </div>
        <div className="mt-1 text-[12px] leading-5 text-zinc-500">{stage.summary}</div>
      </div>
      <StatusBadge label={status.label} tone={status.tone} />
    </button>
  );
}

export function BenchmarkWorkbenchTab({
  buildingId,
  canManage,
  canManageSubmissionWorkflows,
  onUpload,
  readinessSummary,
  governedSummary,
}: BenchmarkWorkbenchProps) {
  const benchmarkArtifact = governedSummary.artifactSummary.benchmark;
  const benchmarkWorkflow = governedSummary.submissionSummary.benchmark;

  const stages = React.useMemo(
    () => [
      {
        key: "source" as const,
        label: "Get ready",
        status: deriveStageStatus({
          blocked: readinessSummary.blockingIssueCount > 0,
          started: readinessSummary.lastReadinessEvaluatedAt != null,
          complete: readinessSummary.state !== "DATA_INCOMPLETE",
          needsAttention: governedSummary.runtimeSummary.needsAttention,
        }),
        summary:
          readinessSummary.blockingIssueCount > 0
            ? "Fix blocking data first."
            : readinessSummary.lastReadinessEvaluatedAt
              ? "Data is ready for review."
              : "Add or sync data, then check readiness.",
      },
      {
        key: "verification" as const,
        label: "Review",
        status: deriveStageStatus({
          blocked:
            benchmarkArtifact.latestArtifactStatus === "NOT_STARTED" &&
            readinessSummary.state === "DATA_INCOMPLETE",
          started: benchmarkArtifact.lastGeneratedAt != null,
          complete: benchmarkArtifact.latestArtifactStatus === "FINALIZED",
          needsAttention:
            benchmarkArtifact.latestArtifactStatus === "GENERATED" ||
            benchmarkArtifact.latestArtifactStatus === "STALE",
        }),
        summary:
          benchmarkArtifact.latestArtifactStatus === "FINALIZED"
            ? "Packet is complete."
            : benchmarkArtifact.lastGeneratedAt
              ? "Review the current packet."
              : "Create the first packet.",
      },
      {
        key: "submission" as const,
        label: "Submit",
        status: deriveStageStatus({
          blocked: benchmarkWorkflow?.state === "NEEDS_CORRECTION",
          started: benchmarkWorkflow != null && benchmarkWorkflow.state !== "NOT_STARTED",
          complete: benchmarkWorkflow?.state === "COMPLETED",
          needsAttention:
            benchmarkWorkflow?.state === "READY_FOR_REVIEW" ||
            benchmarkWorkflow?.state === "APPROVED_FOR_SUBMISSION" ||
            benchmarkWorkflow?.state === "SUBMITTED",
        }),
        summary:
          benchmarkWorkflow?.state === "COMPLETED"
            ? "Submission is complete."
            : benchmarkWorkflow?.state === "NEEDS_CORRECTION"
              ? "Fix the submission and resubmit."
              : benchmarkWorkflow?.latestTransitionAt
                ? "Submission is open."
                : "Submit after review is done.",
      },
    ],
    [benchmarkArtifact, benchmarkWorkflow, governedSummary.runtimeSummary.needsAttention, readinessSummary],
  );

  const [activeStage, setActiveStage] = React.useState<StageKey>(() =>
    getDefaultActiveStage({
      readinessState: readinessSummary.state,
      packetStatus: benchmarkArtifact.latestArtifactStatus,
      workflowState: benchmarkWorkflow?.state ?? null,
    }),
  );

  return (
    <div className="space-y-5">
      <section className="space-y-4 border-b border-zinc-200/80 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold tracking-tight text-zinc-900">
              Choose the next step
            </div>
            <div className="mt-1 text-[12px] leading-5 text-zinc-500">
              Get ready, review the packet, then submit.
            </div>
          </div>
          <div className="flex items-start">
            {canManage ? (
              <button type="button" onClick={onUpload} className="btn-secondary whitespace-nowrap">
                Upload data
              </button>
            ) : null}
          </div>
        </div>

        <WorkflowPanel
          activeStage={activeStage}
          onStageChange={(stageKey) => setActiveStage(stageKey as StageKey)}
          stages={stages}
        />
      </section>

      <section id="workflow-readiness" className="scroll-mt-24 space-y-4">
        {activeStage !== "source" ? (
          <CollapsedStage
            stage={stages[0]}
            onOpen={() => setActiveStage("source")}
          />
        ) : null}
        <div className={activeStage === "source" ? "block" : "hidden"}>
          <BenchmarkingTab buildingId={buildingId} canManage={canManage} />
        </div>
      </section>

      <section id="workflow-verification" className="scroll-mt-24 space-y-4">
        {activeStage !== "verification" ? (
          <CollapsedStage
            stage={stages[1]}
            onOpen={() => setActiveStage("verification")}
          />
        ) : null}
        <div className={activeStage === "verification" ? "block" : "hidden"}>
          <VerificationRequestsTab
            buildingId={buildingId}
            showPacketActions={false}
            canManage={canManage}
          />
        </div>
      </section>

      <section id="workflow-submission" className="scroll-mt-24 space-y-4">
        {activeStage !== "submission" ? (
          <CollapsedStage
            stage={stages[2]}
            onOpen={() => setActiveStage("submission")}
          />
        ) : null}
        <div className={activeStage === "submission" ? "block" : "hidden"}>
          <ArtifactWorkspacePanel
            buildingId={buildingId}
            canManageSubmissionWorkflows={canManageSubmissionWorkflows}
            scopes={["benchmark"]}
            title="Submit"
            subtitle="Use the current packet."
            compact
          />
        </div>
      </section>
    </div>
  );
}
