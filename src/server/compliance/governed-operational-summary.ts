import { NotFoundError } from "@/server/lib/errors";
import {
  listBuildingOperationalStates,
  type BuildingIssueSummary,
  type BuildingOperationalState,
  type BuildingReadinessSummary,
} from "@/server/compliance/data-issues";
import {
  listSubmissionWorkflowSummariesForArtifacts,
  type SubmissionWorkflowSummary,
} from "@/server/compliance/submission-workflows";
import {
  listBuildingSourceReconciliationOverviews,
  type BuildingSourceReconciliationOverview,
} from "@/server/compliance/source-reconciliation";
import {
  listBuildingIntegrationRuntimeSummaries,
  type BuildingIntegrationRuntimeSummary,
} from "@/server/compliance/integration-runtime";

export type GovernedArtifactStatus =
  | "NOT_STARTED"
  | "DRAFT"
  | "GENERATED"
  | "STALE"
  | "FINALIZED";

export interface GovernedArtifactSummary {
  scope: "BENCHMARKING";
  sourceRecordId: string | null;
  sourceRecordStatus: string | null;
  latestArtifactId: string | null;
  latestArtifactStatus: GovernedArtifactStatus;
  reportingYear: number | null;
  lastGeneratedAt: string | null;
  lastFinalizedAt: string | null;
}

export interface GovernedComplianceSummary {
  primaryStatus: BuildingReadinessSummary["primaryStatus"];
  qaVerdict: string | null;
  reasonCodes: string[];
  reasonSummary: string;
  benchmark: BuildingReadinessSummary["evaluations"]["benchmark"];
}

export interface GovernedOperationalTimestamps {
  lastReadinessEvaluatedAt: string | null;
  lastComplianceEvaluatedAt: string | null;
  lastArtifactGeneratedAt: string | null;
  lastArtifactFinalizedAt: string | null;
  lastSubmissionTransitionAt: string | null;
}

export interface GovernedSubmissionWorkflowSummary {
  benchmark: SubmissionWorkflowSummary | null;
}

export interface BuildingGovernedOperationalSummary {
  buildingId: string;
  readinessSummary: BuildingReadinessSummary;
  issueSummary: {
    openIssues: BuildingIssueSummary["openIssues"];
  };
  activeIssueCounts: BuildingOperationalState["activeIssueCounts"];
  complianceSummary: GovernedComplianceSummary;
  artifactSummary: {
    benchmark: GovernedArtifactSummary;
  };
  reconciliationSummary: BuildingSourceReconciliationOverview;
  runtimeSummary: BuildingIntegrationRuntimeSummary;
  submissionSummary: GovernedSubmissionWorkflowSummary;
  timestamps: GovernedOperationalTimestamps;
}

const EMPTY_RECONCILIATION_SUMMARY: BuildingSourceReconciliationOverview = {
  id: null,
  status: null,
  canonicalSource: null,
  referenceYear: null,
  conflictCount: 0,
  incompleteCount: 0,
  lastReconciledAt: null,
};

const EMPTY_RUNTIME_SUMMARY: BuildingIntegrationRuntimeSummary = {
  portfolioManager: {
    system: "PORTFOLIO_MANAGER",
    currentState: "NOT_CONNECTED",
    connectionStatus: null,
    lastAttemptedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    lastWebhookReceivedAt: null,
    attemptCount: 0,
    retryCount: 0,
    latestJobId: null,
    latestErrorCode: null,
    latestErrorMessage: null,
    isStale: false,
    needsAttention: false,
    attentionReason: null,
    staleReason: null,
    sourceRecordId: null,
  },
  greenButton: {
    system: "GREEN_BUTTON",
    currentState: "NOT_CONNECTED",
    connectionStatus: null,
    lastAttemptedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    lastWebhookReceivedAt: null,
    attemptCount: 0,
    retryCount: 0,
    latestJobId: null,
    latestErrorCode: null,
    latestErrorMessage: null,
    isStale: false,
    needsAttention: false,
    attentionReason: null,
    staleReason: null,
    sourceRecordId: null,
  },
  needsAttention: false,
  attentionCount: 0,
  nextAction: null,
};

function toArtifactStatus(value: string | null | undefined): GovernedArtifactStatus {
  return value === "DRAFT" ||
    value === "GENERATED" ||
    value === "STALE" ||
    value === "FINALIZED"
    ? value
    : "NOT_STARTED";
}

function buildArtifactSummary(
  readiness: BuildingReadinessSummary,
): GovernedArtifactSummary {
  return {
    scope: "BENCHMARKING",
    sourceRecordId: readiness.artifacts.benchmarkSubmission?.id ?? null,
    sourceRecordStatus: readiness.artifacts.benchmarkSubmission?.status ?? null,
    latestArtifactId: readiness.artifacts.benchmarkPacket?.id ?? null,
    latestArtifactStatus: toArtifactStatus(readiness.artifacts.benchmarkPacket?.status),
    reportingYear:
      readiness.artifacts.benchmarkSubmission?.reportingYear ??
      readiness.evaluations.benchmark?.reportingYear ??
      null,
    lastGeneratedAt: readiness.artifacts.benchmarkPacket?.generatedAt ?? null,
    lastFinalizedAt: readiness.artifacts.benchmarkPacket?.finalizedAt ?? null,
  };
}

function buildGovernedOperationalSummary(input: {
  operationalState: BuildingOperationalState;
  benchmarkWorkflow: SubmissionWorkflowSummary | null;
  reconciliationSummary: BuildingSourceReconciliationOverview;
  runtimeSummary: BuildingIntegrationRuntimeSummary;
}): BuildingGovernedOperationalSummary {
  const readiness = input.operationalState.readinessSummary;
  const benchmarkArtifact = buildArtifactSummary(readiness);

  return {
    buildingId: input.operationalState.buildingId,
    readinessSummary: readiness,
    issueSummary: input.operationalState.issueSummary,
    activeIssueCounts: input.operationalState.activeIssueCounts,
    complianceSummary: {
      primaryStatus: readiness.primaryStatus,
      qaVerdict: readiness.qaVerdict,
      reasonCodes: readiness.reasonCodes,
      reasonSummary: readiness.reasonSummary,
      benchmark: readiness.evaluations.benchmark,
    },
    artifactSummary: {
      benchmark: benchmarkArtifact,
    },
    reconciliationSummary: input.reconciliationSummary,
    runtimeSummary: input.runtimeSummary,
    submissionSummary: {
      benchmark: input.benchmarkWorkflow,
    },
    timestamps: {
      lastReadinessEvaluatedAt: readiness.lastReadinessEvaluatedAt,
      lastComplianceEvaluatedAt: readiness.lastComplianceEvaluatedAt,
      lastArtifactGeneratedAt: benchmarkArtifact.lastGeneratedAt,
      lastArtifactFinalizedAt: benchmarkArtifact.lastFinalizedAt,
      lastSubmissionTransitionAt: input.benchmarkWorkflow?.latestTransitionAt ?? null,
    },
  };
}

export async function listBuildingGovernedOperationalSummaries(params: {
  organizationId: string;
  buildingIds: string[];
}) {
  const buildingIds = Array.from(new Set(params.buildingIds)).filter(Boolean);

  if (buildingIds.length === 0) {
    return new Map<string, BuildingGovernedOperationalSummary>();
  }

  const [operationalStates, runtimeSummaries] = await Promise.all([
    listBuildingOperationalStates({
      organizationId: params.organizationId,
      buildingIds,
    }),
    listBuildingIntegrationRuntimeSummaries({
      organizationId: params.organizationId,
      buildingIds,
    }),
  ]);
  const reconciliationSummaries = await listBuildingSourceReconciliationOverviews({
    organizationId: params.organizationId,
    buildingIds,
  });

  const workflowSummaries = await listSubmissionWorkflowSummariesForArtifacts({
    organizationId: params.organizationId,
    benchmarkPacketIds: Array.from(
      new Set(
        Array.from(operationalStates.values())
          .map((state) => state.readinessSummary.artifacts.benchmarkPacket?.id ?? null)
          .filter((value): value is string => value != null),
      ),
    ),
  });

  const summaries = new Map<string, BuildingGovernedOperationalSummary>();
  for (const buildingId of buildingIds) {
    const operationalState = operationalStates.get(buildingId);
    if (!operationalState) {
      continue;
    }

    summaries.set(
      buildingId,
      buildGovernedOperationalSummary({
        operationalState,
        benchmarkWorkflow: operationalState.readinessSummary.artifacts.benchmarkPacket?.id
          ? workflowSummaries.benchmarkByPacketId.get(
              operationalState.readinessSummary.artifacts.benchmarkPacket.id,
            ) ?? null
          : null,
        reconciliationSummary:
          reconciliationSummaries.get(buildingId) ?? EMPTY_RECONCILIATION_SUMMARY,
        runtimeSummary: runtimeSummaries.get(buildingId) ?? EMPTY_RUNTIME_SUMMARY,
      }),
    );
  }

  return summaries;
}

export async function getBuildingGovernedOperationalSummary(params: {
  organizationId: string;
  buildingId: string;
}) {
  const summaries = await listBuildingGovernedOperationalSummaries({
    organizationId: params.organizationId,
    buildingIds: [params.buildingId],
  });

  const summary = summaries.get(params.buildingId);
  if (!summary) {
    throw new NotFoundError("Building not found");
  }

  return summary;
}
