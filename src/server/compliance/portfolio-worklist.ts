import { prisma } from "@/server/lib/db";
import { WorkflowStateError } from "@/server/lib/errors";
import { type BuildingReadinessState } from "@/server/compliance/data-issues";
import {
  listBuildingGovernedOperationalSummaries,
  type BuildingGovernedOperationalSummary,
} from "@/server/compliance/governed-operational-summary";
import { type BuildingIntegrationRuntimeSummary } from "@/server/compliance/integration-runtime";
import { type SubmissionWorkflowSummary } from "@/server/compliance/submission-workflows";

export type WorklistArtifactStatus =
  | "NOT_STARTED"
  | "GENERATED"
  | "STALE"
  | "FINALIZED";

export type PortfolioWorklistSort =
  | "PRIORITY"
  | "NAME"
  | "LAST_COMPLIANCE_EVALUATED";

export type PortfolioWorklistSubmissionState =
  | SubmissionWorkflowSummary["state"]
  | "NOT_STARTED";

export type PortfolioWorklistTriageBucket =
  | "COMPLIANCE_BLOCKER"
  | "ARTIFACT_ATTENTION"
  | "REVIEW_QUEUE"
  | "SUBMISSION_QUEUE"
  | "SYNC_ATTENTION"
  | "MONITORING";

export type PortfolioWorklistTriageUrgency = "NOW" | "NEXT" | "MONITOR";

export type PortfolioWorklistNextActionCode =
  | "RESOLVE_BLOCKING_ISSUES"
  | "REFRESH_INTEGRATION"
  | "REGENERATE_ARTIFACT"
  | "FINALIZE_ARTIFACT"
  | "REVIEW_COMPLIANCE_RESULT"
  | "SUBMIT_ARTIFACT"
  | "MONITOR_SUBMISSION";

export interface PortfolioWorklistArtifactSummary {
  status: WorklistArtifactStatus;
  sourceRecordId: string | null;
  generatedAt: string | null;
  finalizedAt: string | null;
}

export interface PortfolioWorklistSubmissionSummary {
  state: PortfolioWorklistSubmissionState;
  workflowId: string | null;
  latestTransitionAt: string | null;
}

export interface PortfolioWorklistOverallSubmissionSummary {
  state: PortfolioWorklistSubmissionState;
  workflowId: string | null;
  workflowType: "BENCHMARK" | null;
  latestTransitionAt: string | null;
}

export interface PortfolioWorklistItem {
  buildingId: string;
  buildingName: string;
  address: string;
  propertyType: string;
  grossSquareFeet: number | null;
  readinessState: BuildingReadinessState;
  blockingIssueCount: number;
  warningIssueCount: number;
  nextAction: {
    code: PortfolioWorklistNextActionCode;
    title: string;
    reason: string;
  };
  complianceSummary: {
    primaryStatus: string;
    qaVerdict: string | null;
    reasonSummary: string;
  };
  artifacts: {
    benchmark: PortfolioWorklistArtifactSummary;
  };
  runtime: BuildingIntegrationRuntimeSummary;
  submission: {
    overall: PortfolioWorklistOverallSubmissionSummary;
    benchmark: PortfolioWorklistSubmissionSummary;
  };
  triage: {
    bucket: PortfolioWorklistTriageBucket;
    urgency: PortfolioWorklistTriageUrgency;
    cue: string;
  };
  timestamps: {
    lastReadinessEvaluatedAt: string | null;
    lastComplianceEvaluatedAt: string | null;
    lastArtifactGeneratedAt: string | null;
    lastArtifactFinalizedAt: string | null;
    lastSubmissionTransitionAt: string | null;
  };
  flags: {
    blocked: boolean;
    readyForReview: boolean;
    readyToSubmit: boolean;
    submitted: boolean;
    needsCorrection: boolean;
    needsSyncAttention: boolean;
  };
}

export interface PortfolioWorklistAggregate {
  totalBuildings: number;
  blocked: number;
  readyForReview: number;
  readyToSubmit: number;
  submitted: number;
  needsCorrection: number;
  withSyncAttention: number;
  withDraftArtifacts: number;
  finalizedAwaitingNextAction: number;
  needsAttentionNow: number;
  reviewQueue: number;
  submissionQueue: number;
  syncQueue: number;
}

export interface PortfolioWorklistPageInfo {
  returnedCount: number;
  totalMatchingCount: number;
  nextCursor: string | null;
}

export interface PortfolioWorklistResult {
  items: PortfolioWorklistItem[];
  aggregate: PortfolioWorklistAggregate;
  pageInfo: PortfolioWorklistPageInfo;
}

interface PortfolioWorklistParams {
  organizationId: string;
  search?: string;
  readinessState?: BuildingReadinessState;
  hasBlockingIssues?: boolean;
  submissionState?: PortfolioWorklistSubmissionState;
  needsSyncAttention?: boolean;
  triageUrgency?: PortfolioWorklistTriageUrgency;
  artifactStatus?: WorklistArtifactStatus;
  nextAction?: PortfolioWorklistNextActionCode;
  triageBucket?: PortfolioWorklistTriageBucket;
  sortBy?: PortfolioWorklistSort;
  cursor?: string;
  pageSize?: number;
}

function encodeCursor(offset: number) {
  return Buffer.from(String(offset), "utf8").toString("base64");
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) {
    return 0;
  }

  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const parsed = Number.parseInt(decoded, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function toWorklistArtifactStatus(value: string | null | undefined): WorklistArtifactStatus {
  return value === "GENERATED" ||
    value === "STALE" ||
    value === "FINALIZED"
    ? value
    : "NOT_STARTED";
}

function deriveNextAction(
  summary: BuildingGovernedOperationalSummary,
): PortfolioWorklistItem["nextAction"] {
  const readiness = summary.readinessSummary;
  const benchmarkPacketStatus = toWorklistArtifactStatus(
    summary.artifactSummary.benchmark.latestArtifactStatus,
  );
  const benchmarkWorkflow = summary.submissionSummary.benchmark;

  if (readiness.blockingIssueCount > 0) {
    return {
      code: "RESOLVE_BLOCKING_ISSUES",
      title: readiness.nextAction.title,
      reason: readiness.nextAction.reason,
    };
  }

  if (benchmarkWorkflow?.state === "NEEDS_CORRECTION") {
    return {
      code: "REGENERATE_ARTIFACT",
      title: "Correct and regenerate the artifact",
      reason: "The latest submission workflow requires correction before it can proceed.",
    };
  }

  if (benchmarkWorkflow?.state === "APPROVED_FOR_SUBMISSION") {
    return {
      code: "SUBMIT_ARTIFACT",
      title: "Record the governed submission",
      reason: "A finalized artifact has been approved and is ready for submission operations.",
    };
  }

  if (
    benchmarkWorkflow?.state === "SUBMITTED" ||
    benchmarkWorkflow?.state === "COMPLETED"
  ) {
    return {
      code: "MONITOR_SUBMISSION",
      title: "Monitor submission outcome",
      reason: "Submission has already been recorded for the current governed artifact.",
    };
  }

  if (benchmarkWorkflow?.state === "READY_FOR_REVIEW") {
    return {
      code: "REVIEW_COMPLIANCE_RESULT",
      title: "Review the finalized artifact",
      reason: "A finalized governed artifact is ready for consultant review.",
    };
  }

  if (summary.runtimeSummary.nextAction) {
    return {
      code: "REFRESH_INTEGRATION",
      title: summary.runtimeSummary.nextAction.title,
      reason: summary.runtimeSummary.nextAction.reason,
    };
  }

  if (benchmarkPacketStatus === "STALE") {
    return {
      code: "REGENERATE_ARTIFACT",
      title: "Regenerate the governed artifact",
      reason: "An upstream change has made the latest artifact stale.",
    };
  }

  if (benchmarkPacketStatus === "GENERATED") {
    return {
      code: "FINALIZE_ARTIFACT",
      title: "Finalize the governed artifact",
      reason: "A generated artifact is ready for consultant review and lock.",
    };
  }

  switch (readiness.state) {
    case "READY_FOR_REVIEW":
      return {
        code: "REVIEW_COMPLIANCE_RESULT",
        title: readiness.nextAction.title,
        reason: readiness.nextAction.reason,
      };
    case "READY_TO_SUBMIT":
      return {
        code: "SUBMIT_ARTIFACT",
        title: readiness.nextAction.title,
        reason: readiness.nextAction.reason,
      };
    case "SUBMITTED":
      return {
        code: "MONITOR_SUBMISSION",
        title: readiness.nextAction.title,
        reason: readiness.nextAction.reason,
      };
    default:
      return {
        code: "RESOLVE_BLOCKING_ISSUES",
        title: readiness.nextAction.title,
        reason: readiness.nextAction.reason,
      };
  }
}

function deriveOverallSubmissionSummary(
  benchmark: PortfolioWorklistSubmissionSummary,
): PortfolioWorklistOverallSubmissionSummary {
  if (benchmark.state !== "NOT_STARTED") {
    return {
      state: benchmark.state,
      workflowId: benchmark.workflowId,
      workflowType: "BENCHMARK",
      latestTransitionAt: benchmark.latestTransitionAt,
    };
  }

  return {
    state: "NOT_STARTED",
    workflowId: null,
    workflowType: null,
    latestTransitionAt: null,
  };
}

function deriveTriage(input: {
  readinessState: BuildingReadinessState;
  blockingIssueCount: number;
  nextAction: PortfolioWorklistItem["nextAction"];
  flags: PortfolioWorklistItem["flags"];
  submissionOverall: PortfolioWorklistOverallSubmissionSummary;
}): PortfolioWorklistItem["triage"] {
  if (input.flags.blocked) {
    return {
      bucket: "COMPLIANCE_BLOCKER",
      urgency: "NOW",
      cue:
        input.blockingIssueCount === 1
          ? "1 governed compliance blocker is preventing review."
          : `${input.blockingIssueCount} governed compliance blockers are preventing review.`,
    };
  }

  if (
    input.flags.needsCorrection ||
    input.nextAction.code === "REGENERATE_ARTIFACT" ||
    input.nextAction.code === "FINALIZE_ARTIFACT"
  ) {
    return {
      bucket: "ARTIFACT_ATTENTION",
      urgency: "NOW",
      cue:
        input.submissionOverall.state === "NEEDS_CORRECTION"
          ? "The latest governed artifact needs correction before submission can continue."
          : "The current governed artifact needs consultant action before workflow can continue.",
    };
  }

  if (input.flags.needsSyncAttention || input.nextAction.code === "REFRESH_INTEGRATION") {
    return {
      bucket: "SYNC_ATTENTION",
      urgency: "NOW",
      cue: "Upstream integration state needs attention before the building can progress cleanly.",
    };
  }

  if (
    input.nextAction.code === "REVIEW_COMPLIANCE_RESULT" ||
    input.flags.readyForReview
  ) {
    return {
      bucket: "REVIEW_QUEUE",
      urgency: "NOW",
      cue: "The latest governed result is ready for consultant review.",
    };
  }

  if (
    input.nextAction.code === "SUBMIT_ARTIFACT" ||
    input.flags.readyToSubmit
  ) {
    return {
      bucket: "SUBMISSION_QUEUE",
      urgency: "NOW",
      cue: "A governed artifact is approved and ready for submission operations.",
    };
  }

  return {
    bucket: "MONITORING",
    urgency: input.readinessState === "SUBMITTED" ? "MONITOR" : "NEXT",
    cue:
      input.readinessState === "SUBMITTED"
        ? "Submission has been recorded and is awaiting downstream outcome."
        : "The building is in a stable governed state with no immediate queue action.",
  };
}

function priorityRank(item: PortfolioWorklistItem) {
  switch (item.triage.bucket) {
    case "COMPLIANCE_BLOCKER":
      return 0;
    case "ARTIFACT_ATTENTION":
      return 1;
    case "REVIEW_QUEUE":
      return 2;
    case "SUBMISSION_QUEUE":
      return 3;
    case "SYNC_ATTENTION":
      return 4;
    default:
      return 5;
  }
}

function sortItems(items: PortfolioWorklistItem[], sortBy: PortfolioWorklistSort) {
  return [...items].sort((left, right) => {
    switch (sortBy) {
      case "NAME":
        return left.buildingName.localeCompare(right.buildingName);
      case "LAST_COMPLIANCE_EVALUATED":
        return (right.timestamps.lastComplianceEvaluatedAt ?? "").localeCompare(
          left.timestamps.lastComplianceEvaluatedAt ?? "",
        );
      default: {
        const rankDelta = priorityRank(left) - priorityRank(right);
        if (rankDelta !== 0) {
          return rankDelta;
        }

        const blockingDelta = right.blockingIssueCount - left.blockingIssueCount;
        if (blockingDelta !== 0) {
          return blockingDelta;
        }

        return left.buildingName.localeCompare(right.buildingName);
      }
    }
  });
}

function matchesArtifactStatus(
  item: PortfolioWorklistItem,
  artifactStatus: WorklistArtifactStatus,
) {
  return item.artifacts.benchmark.status === artifactStatus;
}

function toAggregate(items: PortfolioWorklistItem[]): PortfolioWorklistAggregate {
  return items.reduce<PortfolioWorklistAggregate>(
    (acc, item) => {
      acc.totalBuildings += 1;
      if (item.flags.blocked) {
        acc.blocked += 1;
      }
      if (item.flags.readyForReview) {
        acc.readyForReview += 1;
      }
      if (item.flags.readyToSubmit) {
        acc.readyToSubmit += 1;
      }
      if (item.flags.submitted) {
        acc.submitted += 1;
      }
      if (item.flags.needsCorrection) {
        acc.needsCorrection += 1;
      }
      if (item.flags.needsSyncAttention) {
        acc.withSyncAttention += 1;
      }
      if (
        item.artifacts.benchmark.status === "GENERATED" ||
        item.artifacts.benchmark.status === "STALE"
      ) {
        acc.withDraftArtifacts += 1;
      }
      if (
        !item.flags.submitted &&
        item.artifacts.benchmark.status === "FINALIZED" &&
        item.submission.benchmark.state !== "COMPLETED"
      ) {
        acc.finalizedAwaitingNextAction += 1;
      }
      if (item.triage.urgency === "NOW") {
        acc.needsAttentionNow += 1;
      }
      if (item.triage.bucket === "REVIEW_QUEUE") {
        acc.reviewQueue += 1;
      }
      if (item.triage.bucket === "SUBMISSION_QUEUE") {
        acc.submissionQueue += 1;
      }
      if (item.triage.bucket === "SYNC_ATTENTION") {
        acc.syncQueue += 1;
      }
      return acc;
    },
    {
      totalBuildings: 0,
      blocked: 0,
      readyForReview: 0,
      readyToSubmit: 0,
      submitted: 0,
      needsCorrection: 0,
      withSyncAttention: 0,
      withDraftArtifacts: 0,
      finalizedAwaitingNextAction: 0,
      needsAttentionNow: 0,
      reviewQueue: 0,
      submissionQueue: 0,
      syncQueue: 0,
    },
  );
}

export async function getPortfolioWorklist(
  params: PortfolioWorklistParams,
): Promise<PortfolioWorklistResult> {
  const buildings = await prisma.building.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" } },
              { address: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      address: true,
      propertyType: true,
      grossSquareFeet: true,
    },
  });

  const buildingIds = buildings.map((building) => building.id);
  const governedSummaries = await listBuildingGovernedOperationalSummaries({
    organizationId: params.organizationId,
    buildingIds,
  });

  const items = buildings.map<PortfolioWorklistItem>((building) => {
    const governedSummary = governedSummaries.get(building.id);
    if (!governedSummary) {
      throw new WorkflowStateError(
        "Portfolio worklist requires an operational state for every building.",
      );
    }

    const readiness = governedSummary.readinessSummary;
    const nextAction = deriveNextAction(governedSummary);
    const benchmarkArtifact: PortfolioWorklistArtifactSummary = {
      status: toWorklistArtifactStatus(
        governedSummary.artifactSummary.benchmark.latestArtifactStatus,
      ),
      sourceRecordId: governedSummary.artifactSummary.benchmark.sourceRecordId,
      generatedAt: governedSummary.artifactSummary.benchmark.lastGeneratedAt,
      finalizedAt: governedSummary.artifactSummary.benchmark.lastFinalizedAt,
    };
    const submission = {
      benchmark: {
        state: governedSummary.submissionSummary.benchmark?.state ?? "NOT_STARTED",
        workflowId: governedSummary.submissionSummary.benchmark?.id ?? null,
        latestTransitionAt:
          governedSummary.submissionSummary.benchmark?.latestTransitionAt ?? null,
      },
    };
    const submissionOverall = deriveOverallSubmissionSummary(submission.benchmark);
    const flags = {
      blocked: readiness.state === "DATA_INCOMPLETE",
      readyForReview: readiness.state === "READY_FOR_REVIEW",
      readyToSubmit: readiness.state === "READY_TO_SUBMIT",
      submitted: readiness.state === "SUBMITTED",
      needsCorrection:
        governedSummary.submissionSummary.benchmark?.state === "NEEDS_CORRECTION",
      needsSyncAttention: governedSummary.runtimeSummary.needsAttention,
    };
    const triage = deriveTriage({
      readinessState: readiness.state,
      blockingIssueCount: readiness.blockingIssueCount,
      nextAction,
      flags,
      submissionOverall,
    });

    return {
      buildingId: building.id,
      buildingName: building.name,
      address: building.address,
      propertyType: building.propertyType,
      grossSquareFeet: building.grossSquareFeet ?? null,
      readinessState: readiness.state,
      blockingIssueCount: readiness.blockingIssueCount,
      warningIssueCount: readiness.warningIssueCount,
      nextAction,
      complianceSummary: {
        primaryStatus: governedSummary.complianceSummary.primaryStatus,
        qaVerdict: governedSummary.complianceSummary.qaVerdict,
        reasonSummary: governedSummary.complianceSummary.reasonSummary,
      },
      artifacts: {
        benchmark: benchmarkArtifact,
      },
      runtime: governedSummary.runtimeSummary,
      submission: {
        overall: submissionOverall,
        benchmark: submission.benchmark,
      },
      triage,
      timestamps: {
        lastReadinessEvaluatedAt: governedSummary.timestamps.lastReadinessEvaluatedAt,
        lastComplianceEvaluatedAt: governedSummary.timestamps.lastComplianceEvaluatedAt,
        lastArtifactGeneratedAt: governedSummary.timestamps.lastArtifactGeneratedAt,
        lastArtifactFinalizedAt: governedSummary.timestamps.lastArtifactFinalizedAt,
        lastSubmissionTransitionAt: governedSummary.timestamps.lastSubmissionTransitionAt,
      },
      flags,
    };
  });

  const filteredItems = items.filter((item) => {
    if (params.readinessState && item.readinessState !== params.readinessState) {
      return false;
    }
    if (
      params.hasBlockingIssues != null &&
      (item.blockingIssueCount > 0) !== params.hasBlockingIssues
    ) {
      return false;
    }
    if (
      params.submissionState &&
      item.submission.overall.state !== params.submissionState
    ) {
      return false;
    }
    if (
      params.needsSyncAttention != null &&
      item.flags.needsSyncAttention !== params.needsSyncAttention
    ) {
      return false;
    }
    if (params.triageUrgency && item.triage.urgency !== params.triageUrgency) {
      return false;
    }
    if (
      params.artifactStatus &&
      !matchesArtifactStatus(item, params.artifactStatus)
    ) {
      return false;
    }
    if (params.nextAction && item.nextAction.code !== params.nextAction) {
      return false;
    }
    if (params.triageBucket && item.triage.bucket !== params.triageBucket) {
      return false;
    }
    return true;
  });

  const sortedItems = sortItems(filteredItems, params.sortBy ?? "PRIORITY");
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), 100);
  const startIndex = decodeCursor(params.cursor);
  const pagedItems = sortedItems.slice(startIndex, startIndex + pageSize);
  const nextIndex = startIndex + pagedItems.length;

  return {
    items: pagedItems,
    aggregate: toAggregate(items),
    pageInfo: {
      returnedCount: pagedItems.length,
      totalMatchingCount: sortedItems.length,
      nextCursor: nextIndex < sortedItems.length ? encodeCursor(nextIndex) : null,
    },
  };
}
