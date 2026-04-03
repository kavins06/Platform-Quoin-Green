import type {
  ActorType,
  BenchmarkSubmission,
  DataIssueSeverity,
  DataIssueSource,
  DataIssueStatus,
  DataIssueType,
  Prisma,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import { NotFoundError, ValidationError, WorkflowStateError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import {
  derivePrimaryComplianceStatus,
  extractComplianceEngineResult,
  summarizeReasonCodes,
  type ComplianceEngineSurfaceResult,
  type PrimaryComplianceSurfaceStatus,
} from "@/server/compliance/compliance-surface";
import {
  refreshBuildingSourceReconciliation,
  type BuildingSourceReconciliationSummary,
} from "@/server/compliance/source-reconciliation";
import { listSubmissionWorkflowSummariesForArtifacts, type SubmissionWorkflowSummary } from "@/server/compliance/submission-workflows";
import type {
  ComplianceEngineQaIssue,
  ComplianceEngineResult,
} from "./compliance-engine";

export const BUILDING_READINESS_STATE = {
  DATA_INCOMPLETE: "DATA_INCOMPLETE",
  READY_FOR_REVIEW: "READY_FOR_REVIEW",
  READY_TO_SUBMIT: "READY_TO_SUBMIT",
  SUBMITTED: "SUBMITTED",
} as const;

export type BuildingReadinessState =
  (typeof BUILDING_READINESS_STATE)[keyof typeof BUILDING_READINESS_STATE];

type DataIssueStatusFilter = "ACTIVE" | "ALL";
type IssueRefreshScope = "BENCHMARKING" | "SYSTEM";

type IssueCandidate = {
  issueKey: string;
  reportingYear: number | null;
  issueType: DataIssueType;
  severity: DataIssueSeverity;
  title: string;
  description: string;
  requiredAction: string;
  source: DataIssueSource;
  metadata: Record<string, unknown>;
};

type VerificationIssueInput = {
  category: string;
  status: string;
  explanation: string;
  evidenceRefs: string[];
};

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

type ActiveIssueInput = {
  id: string;
  issueType: DataIssueType;
  severity: DataIssueSeverity;
  status: DataIssueStatus;
  title: string;
  description: string;
  requiredAction: string;
};

type ReadinessInput = {
  buildingId: string;
  openIssues: ActiveIssueInput[];
  benchmark: {
    surface: ComplianceEngineSurfaceResult | null;
    evaluation: ComplianceEvaluationSummary | null;
    submission: BenchmarkSubmissionArtifactReference | null;
    packet: PacketArtifactReference | null;
    workflow: SubmissionWorkflowSummary | null;
  };
};

export interface BenchmarkSubmissionArtifactReference {
  id: string;
  status: string;
  reportingYear: number;
  complianceRunId: string | null;
  lastReadinessEvaluatedAt: string | null;
  lastComplianceEvaluatedAt: string | null;
}

export interface PacketArtifactReference {
  id: string;
  status: string;
  reportingYear: number | null;
  filingYear: number | null;
  complianceCycle: string | null;
  generatedAt: string;
  finalizedAt: string | null;
}

export interface ComplianceEvaluationSummary {
  scope: "BENCHMARKING" | "BEPS";
  recordId: string;
  status: string | null;
  applicability: string | null;
  qaVerdict: string | null;
  ruleVersion: string | null;
  metricUsed: string | null;
  reasonCodes: string[];
  reasonSummary: string;
  decision: {
    meetsStandard: boolean | null;
    blocked: boolean;
    insufficientData: boolean;
  };
  reportingYear: number | null;
  filingYear: number | null;
  complianceCycle: string | null;
  complianceRunId: string | null;
  lastComplianceEvaluatedAt: string | null;
}

export interface BuildingReadinessSummary {
  state: BuildingReadinessState;
  blockingIssueCount: number;
  warningIssueCount: number;
  primaryStatus: PrimaryComplianceSurfaceStatus;
  qaVerdict: string | null;
  reasonCodes: string[];
  reasonSummary: string;
  nextAction: {
    title: string;
    reason: string;
    href: string;
  };
  lastReadinessEvaluatedAt: string | null;
  lastComplianceEvaluatedAt: string | null;
  lastPacketGeneratedAt: string | null;
  lastPacketFinalizedAt: string | null;
  evaluations: {
    benchmark: ComplianceEvaluationSummary | null;
  };
  artifacts: {
    benchmarkSubmission: BenchmarkSubmissionArtifactReference | null;
    benchmarkPacket: PacketArtifactReference | null;
  };
}

export interface BuildingIssueSummary extends BuildingReadinessSummary {
  buildingId: string;
  openIssues: Array<{
    id: string;
    reportingYear: number | null;
    issueType: DataIssueType;
    severity: DataIssueSeverity;
    status: DataIssueStatus;
    title: string;
    description: string;
    requiredAction: string;
    source: DataIssueSource;
    detectedAt: string;
    resolvedAt: string | null;
    metadata: Record<string, unknown>;
  }>;
}

export interface BuildingOperationalState {
  buildingId: string;
  readinessSummary: BuildingReadinessSummary;
  issueSummary: {
    openIssues: BuildingIssueSummary["openIssues"];
  };
  activeIssueCounts: {
    blocking: number;
    warning: number;
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asComplianceEngineResult(payload: unknown): ComplianceEngineResult | null {
  const engine = extractComplianceEngineResult(payload)?.raw;
  return engine ? (engine as unknown as ComplianceEngineResult) : null;
}

function issueHref(buildingId: string) {
  return `/buildings/${buildingId}#workflow`;
}

function qaIssueDefinition(issueType: string) {
  switch (issueType) {
    case "MISSING_MONTHS":
      return {
        issueType: "MISSING_MONTHS" as const,
        severity: "BLOCKING" as const,
        title: "Missing reporting months",
        requiredAction:
          "Load the missing utility months for the reporting year and rerun readiness.",
      };
    case "OVERLAPPING_PERIODS":
      return {
        issueType: "OVERLAPPING_PERIODS" as const,
        severity: "BLOCKING" as const,
        title: "Overlapping billing periods",
        requiredAction:
          "Correct the overlapping billing periods and rerun readiness.",
      };
    case "INCOMPLETE_TWELVE_MONTH_COVERAGE":
      return {
        issueType: "INCOMPLETE_TWELVE_MONTH_COVERAGE" as const,
        severity: "BLOCKING" as const,
        title: "Incomplete annual coverage",
        requiredAction:
          "Bring the building to a full Jan 1-Dec 31 annual coverage set before review.",
      };
    case "NO_DIRECT_YEAR_READINGS":
      return {
        issueType: "DIRECT_READINGS_MISSING" as const,
        severity: "WARNING" as const,
        title: "Direct annual readings missing",
        requiredAction:
          "Confirm the direct-year readings or document why canonical metrics are being used.",
      };
    case "UNRESOLVED_REPORTING_YEAR":
      return {
        issueType: "DIRECT_READINGS_MISSING" as const,
        severity: "WARNING" as const,
        title: "Reporting year could not be resolved",
        requiredAction:
          "Confirm the correct reporting year inputs and rerun the compliance evaluation.",
      };
    default:
      return null;
  }
}

function verificationIssueDefinition(item: Pick<VerificationIssueInput, "category" | "status">) {
  switch (item.category) {
    case "PROPERTY_METADATA":
      return {
        issueType: "BUILDING_METADATA_INCOMPLETE" as const,
        severity: item.status === "FAIL" ? ("BLOCKING" as const) : ("WARNING" as const),
        title: "Building metadata needs attention",
        requiredAction:
          "Complete or confirm the building identity and property type details.",
      };
    case "GFA":
      return {
        issueType: "GFA_SUPPORT_MISSING" as const,
        severity: item.status === "FAIL" ? ("BLOCKING" as const) : ("WARNING" as const),
        title: "Gross floor area support is missing",
        requiredAction:
          "Attach gross floor area support or area analysis evidence and rerun verification.",
      };
    case "METER_COMPLETENESS":
      return {
        issueType: "METER_MAPPING_MISSING" as const,
        severity: item.status === "FAIL" ? ("BLOCKING" as const) : ("WARNING" as const),
        title: "Meter mapping is incomplete",
        requiredAction:
          "Complete the meter roster and confirm annual readings for every active meter.",
      };
    case "METRIC_AVAILABILITY":
      return {
        issueType: "METRIC_AVAILABILITY_MISSING" as const,
        severity: "BLOCKING" as const,
        title: "Benchmarking metrics are missing",
        requiredAction:
          "Refresh or load the missing score or source EUI inputs before review.",
      };
    case "PM_LINKAGE":
      return {
        issueType: "PM_SYNC_REQUIRED" as const,
        severity: item.status === "FAIL" ? ("BLOCKING" as const) : ("WARNING" as const),
        title: "Portfolio Manager linkage needs attention",
        requiredAction:
          "Repair Portfolio Manager access or rerun sync before moving to review.",
      };
    case "DQC":
      return {
        issueType: "DQC_SUPPORT_MISSING" as const,
        severity: "WARNING" as const,
        title: "Data Quality Checker support is missing",
        requiredAction:
          "Attach Data Quality Checker support or document verifier follow-up.",
      };
    default:
      return null;
  }
}

function buildQaIssueCandidates(input: {
  scope: IssueRefreshScope;
  reportingYear: number;
  qaIssues: ComplianceEngineQaIssue[];
}) {
  return input.qaIssues
    .map((qaIssue) => {
      const definition = qaIssueDefinition(qaIssue.issueType);
      if (!definition) {
        return null;
      }

      return {
        issueKey: `${input.scope.toLowerCase()}:${input.reportingYear}:${definition.issueType}`,
        reportingYear: input.reportingYear,
        issueType: definition.issueType,
        severity: definition.severity,
        title: definition.title,
        description: qaIssue.message,
        requiredAction: definition.requiredAction,
        source: "QA" as const,
        metadata: {
          scope: input.scope,
          qaIssueType: qaIssue.issueType,
          qaDetails: qaIssue.details,
        },
      } satisfies IssueCandidate;
    })
    .filter(isPresent);
}

function buildVerificationIssueCandidates(input: {
  reportingYear: number;
  items: VerificationIssueInput[];
}) {
  return input.items
    .filter((item) => item.status !== "PASS" && item.category !== "DATA_COVERAGE")
    .map((item) => {
      const definition = verificationIssueDefinition(item);
      if (!definition) {
        return null;
      }

      return {
        issueKey: `benchmarking:${input.reportingYear}:${definition.issueType}`,
        reportingYear: input.reportingYear,
        issueType: definition.issueType,
        severity: definition.severity,
        title: definition.title,
        description: item.explanation,
        requiredAction: definition.requiredAction,
        source: "QA" as const,
        metadata: {
          scope: "BENCHMARKING",
          verificationCategory: item.category,
          verificationStatus: item.status,
          evidenceRefs: item.evidenceRefs,
        },
      } satisfies IssueCandidate;
    })
    .filter(isPresent);
}

function buildSourceReconciliationIssueCandidates(input: {
  summary: BuildingSourceReconciliationSummary;
}) {
  const candidates: IssueCandidate[] = [];
  const issueKeyPrefix =
    input.summary.referenceYear != null
      ? `system:${input.summary.referenceYear}:reconciliation`
      : "system:reconciliation";
  const blockingConflicts = input.summary.conflicts.filter(
    (conflict) => conflict.severity === "BLOCKING",
  );
  const warningConflicts = input.summary.conflicts.filter(
    (conflict) => conflict.severity === "WARNING",
  );

  if (blockingConflicts.length > 0) {
    candidates.push({
      issueKey: `${issueKeyPrefix}:conflict`,
      reportingYear: input.summary.referenceYear,
      issueType: "METER_MAPPING_MISSING",
      severity: "BLOCKING",
      title: "Canonical source conflicts require review",
      description:
        blockingConflicts[0]?.message ??
        "Canonical source totals or meter mappings conflict across ingestion sources.",
      requiredAction:
        "Review the conflicting source records and resolve the affected meter mapping or consumption mismatch before moving forward.",
      source: "SYSTEM",
      metadata: {
        reconciliationStatus: input.summary.status,
        conflictCount: blockingConflicts.length,
        conflictCodes: blockingConflicts.map((conflict) => conflict.code),
      },
    });
  }

  if (warningConflicts.length > 0) {
    candidates.push({
      issueKey: `${issueKeyPrefix}:incomplete`,
      reportingYear: input.summary.referenceYear,
      issueType: "PM_SYNC_REQUIRED",
      severity: "WARNING",
      title: "Canonical source linkage is incomplete",
      description:
        warningConflicts[0]?.message ??
        "One or more source linkages are incomplete for the current canonical source summary.",
      requiredAction:
        "Complete the missing source linkage or rerun the affected sync before relying on the canonical source summary.",
      source: "SYSTEM",
      metadata: {
        reconciliationStatus: input.summary.status,
        incompleteCount: warningConflicts.length,
        conflictCodes: warningConflicts.map((conflict) => conflict.code),
      },
    });
  }

  return candidates;
}

function isActiveIssue(status: DataIssueStatus) {
  return status === "OPEN" || status === "IN_PROGRESS";
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function maxIsoTimestamp(...values: Array<string | null>) {
  const timestamps = values.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  if (timestamps.length === 0) {
    return null;
  }

  return timestamps.reduce((latest, current) =>
    new Date(current).getTime() > new Date(latest).getTime() ? current : latest,
  );
}

function buildEvaluationSummary(input: {
  scope: "BENCHMARKING" | "BEPS";
  recordId: string;
  reportingYear?: number | null;
  filingYear?: number | null;
  complianceCycle?: string | null;
  engine: ComplianceEngineSurfaceResult | null;
  complianceRunId: string | null;
  lastComplianceEvaluatedAt: Date | null;
}): ComplianceEvaluationSummary | null {
  if (!input.engine) {
    return null;
  }

  return {
    scope: input.scope,
    recordId: input.recordId,
    status: input.engine.status,
    applicability:
      typeof input.engine.raw?.applicability === "string"
        ? input.engine.raw.applicability
        : null,
    qaVerdict: input.engine.qaVerdict,
    ruleVersion: input.engine.ruleVersion,
    metricUsed: input.engine.metricUsed,
    reasonCodes: input.engine.reasonCodes,
    reasonSummary: summarizeReasonCodes(input.engine.reasonCodes),
    decision: input.engine.decision,
    reportingYear: input.reportingYear ?? null,
    filingYear: input.filingYear ?? null,
    complianceCycle: input.complianceCycle ?? null,
    complianceRunId: input.complianceRunId,
    lastComplianceEvaluatedAt: toIsoString(input.lastComplianceEvaluatedAt),
  };
}

type BenchmarkSubmissionSource = Pick<
  BenchmarkSubmission,
  "id" | "status" | "reportingYear" | "complianceRunId" | "readinessEvaluatedAt"
> & {
  submissionPayload: unknown;
  complianceRun: {
    id: string;
    executedAt: Date;
  } | null;
  benchmarkPackets: Array<{
    id: string;
    status: string;
    reportingYear: number;
    generatedAt: Date;
    finalizedAt: Date | null;
  }>;
};

function normalizeBenchmarkState(
  record: BenchmarkSubmissionSource | null,
  workflow: SubmissionWorkflowSummary | null,
) {
  const surface = record ? extractComplianceEngineResult(record.submissionPayload) : null;
  const evaluation = record
    ? buildEvaluationSummary({
        scope: "BENCHMARKING",
        recordId: record.id,
        reportingYear: record.reportingYear,
        engine: surface,
        complianceRunId: record.complianceRunId,
        lastComplianceEvaluatedAt: record.complianceRun?.executedAt ?? null,
      })
    : null;
  const submission = record
    ? {
        id: record.id,
        status: record.status,
        reportingYear: record.reportingYear,
        complianceRunId: record.complianceRunId,
        lastReadinessEvaluatedAt: toIsoString(record.readinessEvaluatedAt),
        lastComplianceEvaluatedAt: toIsoString(record.complianceRun?.executedAt),
      }
    : null;
  const latestPacket = record?.benchmarkPackets[0] ?? null;
  const packet = latestPacket
    ? {
        id: latestPacket.id,
        status: latestPacket.status,
        reportingYear: latestPacket.reportingYear,
        filingYear: null,
        complianceCycle: null,
        generatedAt: latestPacket.generatedAt.toISOString(),
        finalizedAt: toIsoString(latestPacket.finalizedAt),
      }
    : null;

  return {
    surface,
    evaluation,
    submission,
    packet,
    workflow,
  };
}

function deriveReadinessState(input: ReadinessInput): BuildingReadinessSummary {
  const activeIssues = input.openIssues.filter((issue) => isActiveIssue(issue.status));
  const blockingIssues = activeIssues.filter((issue) => issue.severity === "BLOCKING");
  const warningIssues = activeIssues.filter((issue) => issue.severity === "WARNING");
  const href = issueHref(input.buildingId);
  const primaryStatus = derivePrimaryComplianceStatus({
    benchmark: input.benchmark.surface,
    beps: null,
  });
  const reasonCodes = input.benchmark.surface?.reasonCodes ?? [];
  const baseSummary = {
    primaryStatus,
    qaVerdict: input.benchmark.surface?.qaVerdict ?? null,
    reasonCodes,
    reasonSummary: summarizeReasonCodes(reasonCodes),
    lastReadinessEvaluatedAt:
      input.benchmark.submission?.lastReadinessEvaluatedAt ?? null,
    lastComplianceEvaluatedAt: input.benchmark.evaluation?.lastComplianceEvaluatedAt ?? null,
    lastPacketGeneratedAt: input.benchmark.packet?.generatedAt ?? null,
    lastPacketFinalizedAt: input.benchmark.packet?.finalizedAt ?? null,
    evaluations: {
      benchmark: input.benchmark.evaluation,
    },
    artifacts: {
      benchmarkSubmission: input.benchmark.submission,
      benchmarkPacket: input.benchmark.packet,
    },
  } satisfies Omit<
    BuildingReadinessSummary,
    "state" | "blockingIssueCount" | "warningIssueCount" | "nextAction"
  >;

  if (blockingIssues.length > 0) {
    const issue = blockingIssues[0];
    return {
      ...baseSummary,
      state: BUILDING_READINESS_STATE.DATA_INCOMPLETE,
      blockingIssueCount: blockingIssues.length,
      warningIssueCount: warningIssues.length,
      nextAction: {
        title: issue.requiredAction,
        reason: issue.description,
        href,
      },
    };
  }

  if (
    input.benchmark.workflow?.state === "SUBMITTED" ||
    input.benchmark.workflow?.state === "COMPLETED" ||
    input.benchmark.submission?.status === "SUBMITTED" ||
    input.benchmark.submission?.status === "ACCEPTED"
  ) {
    return {
      ...baseSummary,
      state: BUILDING_READINESS_STATE.SUBMITTED,
      blockingIssueCount: 0,
      warningIssueCount: warningIssues.length,
      nextAction: {
        title: "Monitor submission outcome",
        reason: "The latest submission has already been recorded for this building.",
        href,
      },
    };
  }

  if (
    input.benchmark.workflow?.state === "APPROVED_FOR_SUBMISSION" ||
    input.benchmark.submission?.status === "READY"
  ) {
    return {
      ...baseSummary,
      state: BUILDING_READINESS_STATE.READY_TO_SUBMIT,
      blockingIssueCount: 0,
      warningIssueCount: warningIssues.length,
      nextAction: {
        title: "Submit the benchmarking package",
        reason: "Benchmarking is ready and no blocking data issues remain.",
        href,
      },
    };
  }

  return {
    ...baseSummary,
    state: BUILDING_READINESS_STATE.READY_FOR_REVIEW,
    blockingIssueCount: 0,
    warningIssueCount: warningIssues.length,
    nextAction: {
      title:
        input.benchmark.workflow?.state === "READY_FOR_REVIEW" ||
        input.benchmark.workflow?.state === "NEEDS_CORRECTION" ||
        input.benchmark.submission?.complianceRunId
          ? "Review the latest compliance result"
          : "Run the latest evaluation",
      reason:
        input.benchmark.workflow?.state === "READY_FOR_REVIEW" ||
        input.benchmark.workflow?.state === "NEEDS_CORRECTION" ||
        input.benchmark.submission?.complianceRunId
          ? "No blocking issues remain. Review the latest governed result before submission."
          : "The building no longer has blocking data issues, but a current evaluation still needs to be reviewed.",
      href,
    },
  };
}

async function syncIssueCandidates(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number | null;
  scope: IssueRefreshScope;
  candidates: IssueCandidate[];
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}) {
  const now = new Date();
  const scopePrefix =
    params.reportingYear != null
      ? `${params.scope.toLowerCase()}:${params.reportingYear}:`
      : `${params.scope.toLowerCase()}:`;
  const existing = await prisma.dataIssue.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      issueKey: {
        startsWith: scopePrefix,
      },
    },
    orderBy: [{ detectedAt: "asc" }],
  });

  const existingByKey = new Map(existing.map((issue) => [issue.issueKey, issue]));
  const nextKeys = new Set(params.candidates.map((candidate) => candidate.issueKey));

  const createdIssueIds: string[] = [];
  const reopenedIssueIds: string[] = [];
  const resolvedIssueIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const candidate of params.candidates) {
      const current = existingByKey.get(candidate.issueKey);

      if (!current) {
        const created = await tx.dataIssue.create({
          data: {
            organizationId: params.organizationId,
            buildingId: params.buildingId,
            reportingYear: candidate.reportingYear,
            issueKey: candidate.issueKey,
            issueType: candidate.issueType,
            severity: candidate.severity,
            status: "OPEN",
            title: candidate.title,
            description: candidate.description,
            requiredAction: candidate.requiredAction,
            source: candidate.source,
            metadata: toInputJson(candidate.metadata),
            detectedAt: now,
          },
        });
        createdIssueIds.push(created.id);
        continue;
      }

      const shouldReopen =
        current.status === "RESOLVED" || current.status === "DISMISSED";

      const updated = await tx.dataIssue.update({
        where: { id: current.id },
        data: {
          reportingYear: candidate.reportingYear,
          issueType: candidate.issueType,
          severity: candidate.severity,
          status: shouldReopen
            ? "OPEN"
            : current.status === "IN_PROGRESS"
              ? "IN_PROGRESS"
              : "OPEN",
          title: candidate.title,
          description: candidate.description,
          requiredAction: candidate.requiredAction,
          source: candidate.source,
          metadata: toInputJson(candidate.metadata),
          detectedAt: shouldReopen ? now : current.detectedAt,
          resolvedAt: shouldReopen ? null : current.resolvedAt,
        },
      });

      if (shouldReopen) {
        reopenedIssueIds.push(updated.id);
      }
    }

    for (const current of existing) {
      if (nextKeys.has(current.issueKey)) {
        continue;
      }

      if (current.status === "OPEN" || current.status === "IN_PROGRESS") {
        const updated = await tx.dataIssue.update({
          where: { id: current.id },
          data: {
            status: "RESOLVED",
            resolvedAt: now,
          },
        });
        resolvedIssueIds.push(updated.id);
      }
    }
  });

  const refreshChanged =
    createdIssueIds.length > 0 ||
    reopenedIssueIds.length > 0 ||
    resolvedIssueIds.length > 0;

  if (refreshChanged) {
    await createAuditLog({
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      action: "DATA_ISSUES_REFRESHED",
      inputSnapshot: {
        scope: params.scope,
        reportingYear: params.reportingYear,
      },
      outputSnapshot: {
        createdIssueIds,
        reopenedIssueIds,
        resolvedIssueIds,
      },
      requestId: params.requestId ?? null,
    });
  }

  return {
    createdIssueIds,
    reopenedIssueIds,
    resolvedIssueIds,
    refreshChanged,
  };
}

export async function listBuildingOperationalStates(params: {
  organizationId: string;
  buildingIds: string[];
}) {
  const buildingIds = Array.from(new Set(params.buildingIds));

  if (buildingIds.length === 0) {
    return new Map<string, BuildingOperationalState>();
  }

  const [openIssues, benchmarkSubmissions] = await Promise.all([
    prisma.dataIssue.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: {
          in: buildingIds,
        },
        status: {
          in: ["OPEN", "IN_PROGRESS"],
        },
      },
      orderBy: [{ severity: "desc" }, { detectedAt: "asc" }],
    }),
    prisma.benchmarkSubmission.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: {
          in: buildingIds,
        },
      },
      distinct: ["buildingId"],
      orderBy: [
        { buildingId: "asc" },
        { reportingYear: "desc" },
        { updatedAt: "desc" },
      ],
      select: {
        id: true,
        buildingId: true,
        status: true,
        reportingYear: true,
        complianceRunId: true,
        readinessEvaluatedAt: true,
        submissionPayload: true,
        complianceRun: {
          select: {
            id: true,
            executedAt: true,
          },
        },
        benchmarkPackets: {
          orderBy: [{ generatedAt: "desc" }, { version: "desc" }],
          take: 1,
          select: {
            id: true,
            status: true,
            reportingYear: true,
            generatedAt: true,
            finalizedAt: true,
          },
        },
      },
    }),
  ]);

  const issuesByBuildingId = new Map<string, BuildingIssueSummary["openIssues"]>();
  for (const issue of openIssues) {
    const existing = issuesByBuildingId.get(issue.buildingId) ?? [];
    existing.push({
      id: issue.id,
      reportingYear: issue.reportingYear,
      issueType: issue.issueType,
      severity: issue.severity,
      status: issue.status,
      title: issue.title,
      description: issue.description,
      requiredAction: issue.requiredAction,
      source: issue.source,
      detectedAt: issue.detectedAt.toISOString(),
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      metadata: toRecord(issue.metadata),
    });
    issuesByBuildingId.set(issue.buildingId, existing);
  }

  const latestBenchmarkByBuildingId = new Map(
    benchmarkSubmissions.map((submission) => [submission.buildingId, submission]),
  );

  const workflowSummaries = await listSubmissionWorkflowSummariesForArtifacts({
    organizationId: params.organizationId,
    benchmarkPacketIds: Array.from(
      new Set(
        benchmarkSubmissions
          .map((submission) => submission.benchmarkPackets[0]?.id ?? null)
          .filter((value): value is string => value != null),
      ),
    ),
  });

  const states = new Map<string, BuildingOperationalState>();
  for (const buildingId of buildingIds) {
    const openBuildingIssues = issuesByBuildingId.get(buildingId) ?? [];
    const latestBenchmark = latestBenchmarkByBuildingId.get(buildingId) ?? null;
    const benchmark = normalizeBenchmarkState(
      latestBenchmark,
      latestBenchmark?.benchmarkPackets[0]?.id
        ? workflowSummaries.benchmarkByPacketId.get(latestBenchmark.benchmarkPackets[0].id) ??
            null
        : null,
    );
    const readinessSummary = deriveReadinessState({
      buildingId,
      openIssues: openBuildingIssues,
      benchmark,
    });

    states.set(buildingId, {
      buildingId,
      readinessSummary,
      issueSummary: {
        openIssues: openBuildingIssues,
      },
      activeIssueCounts: {
        blocking: openBuildingIssues.filter((issue) => issue.severity === "BLOCKING").length,
        warning: openBuildingIssues.filter((issue) => issue.severity === "WARNING").length,
      },
    });
  }

  return states;
}

export async function getBuildingOperationalState(params: {
  organizationId: string;
  buildingId: string;
}): Promise<BuildingOperationalState> {
  const building = await prisma.building.findFirst({
    where: {
      id: params.buildingId,
      organizationId: params.organizationId,
    },
    select: { id: true },
  });

  if (!building) {
    throw new NotFoundError("Building not found");
  }

  const states = await listBuildingOperationalStates({
    organizationId: params.organizationId,
    buildingIds: [params.buildingId],
  });

  return (
    states.get(params.buildingId) ?? {
      buildingId: params.buildingId,
      readinessSummary: deriveReadinessState({
        buildingId: params.buildingId,
        openIssues: [],
        benchmark: normalizeBenchmarkState(null, null),
      }),
      issueSummary: {
        openIssues: [],
      },
      activeIssueCounts: {
        blocking: 0,
        warning: 0,
      },
    }
  );
}

export async function getBuildingIssueSummary(params: {
  organizationId: string;
  buildingId: string;
}): Promise<BuildingIssueSummary> {
  const operationalState = await getBuildingOperationalState(params);
  return {
    buildingId: params.buildingId,
    ...operationalState.readinessSummary,
    openIssues: operationalState.issueSummary.openIssues,
  };
}

export async function listBuildingDataIssues(params: {
  organizationId: string;
  buildingId: string;
  status?: DataIssueStatusFilter;
}) {
  return prisma.dataIssue.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      ...(params.status === "ACTIVE"
        ? {
            status: {
              in: ["OPEN", "IN_PROGRESS"],
            },
          }
        : {}),
    },
    orderBy: [{ status: "asc" }, { severity: "desc" }, { detectedAt: "asc" }],
  });
}

export async function listPortfolioDataIssues(params: {
  organizationId: string;
  status?: DataIssueStatusFilter;
  limit?: number;
}) {
  return prisma.dataIssue.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.status === "ACTIVE"
        ? {
            status: {
              in: ["OPEN", "IN_PROGRESS"],
            },
          }
        : {}),
    },
    orderBy: [{ severity: "desc" }, { detectedAt: "asc" }],
    take: params.limit ?? 200,
  });
}

export async function refreshBenchmarkingDataIssues(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
  engineResult: ComplianceEngineResult;
  verification: {
    items: VerificationIssueInput[];
  };
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}) {
  const logger = createLogger({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    requestId: params.requestId ?? null,
    procedure: "dataIssues.refreshBenchmarking",
  });

  const previous = await getBuildingOperationalState({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
  });

  const candidates = [
    ...buildQaIssueCandidates({
      scope: "BENCHMARKING",
      reportingYear: params.reportingYear,
      qaIssues: params.engineResult.qa.issues,
    }),
    ...buildVerificationIssueCandidates({
      reportingYear: params.reportingYear,
      items: params.verification.items,
    }),
  ];

  const syncResult = await syncIssueCandidates({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    reportingYear: params.reportingYear,
    scope: "BENCHMARKING",
    candidates,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    requestId: params.requestId ?? null,
  });

  const next = await getBuildingOperationalState({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
  });

  if (previous.readinessSummary.state !== next.readinessSummary.state) {
    await createAuditLog({
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      action: "BUILDING_READINESS_CHANGED",
      inputSnapshot: {
        previousState: previous.readinessSummary.state,
      },
      outputSnapshot: {
        nextState: next.readinessSummary.state,
        reportingYear: params.reportingYear,
      },
      requestId: params.requestId ?? null,
    });
  }

  logger.info("Benchmarking data issues refreshed", {
    reportingYear: params.reportingYear,
    createdCount: syncResult.createdIssueIds.length,
    reopenedCount: syncResult.reopenedIssueIds.length,
    resolvedCount: syncResult.resolvedIssueIds.length,
    readinessState: next.readinessSummary.state,
  });

  return next.readinessSummary;
}

export async function refreshSourceReconciliationDataIssues(params: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}) {
  const logger = createLogger({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    requestId: params.requestId ?? null,
    procedure: "dataIssues.refreshSourceReconciliation",
  });

  const previous = await getBuildingOperationalState({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
  });

  const reconciliationSummary = await refreshBuildingSourceReconciliation({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    requestId: params.requestId ?? null,
  });

  const syncResult = await syncIssueCandidates({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    reportingYear: reconciliationSummary.referenceYear,
    scope: "SYSTEM",
    candidates: buildSourceReconciliationIssueCandidates({
      summary: reconciliationSummary,
    }),
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    requestId: params.requestId ?? null,
  });

  const next = await getBuildingOperationalState({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
  });

  if (previous.readinessSummary.state !== next.readinessSummary.state) {
    await createAuditLog({
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      action: "BUILDING_READINESS_CHANGED",
      inputSnapshot: {
        previousState: previous.readinessSummary.state,
      },
      outputSnapshot: {
        nextState: next.readinessSummary.state,
        reconciliationStatus: reconciliationSummary.status,
      },
      requestId: params.requestId ?? null,
    });
  }

  logger.info("Source reconciliation issues refreshed", {
    createdCount: syncResult.createdIssueIds.length,
    reopenedCount: syncResult.reopenedIssueIds.length,
    resolvedCount: syncResult.resolvedIssueIds.length,
    readinessState: next.readinessSummary.state,
    reconciliationStatus: reconciliationSummary.status,
  });

  return {
    reconciliationSummary,
    readinessSummary: next.readinessSummary,
  };
}

export async function refreshBuildingIssuesAfterDataChange(params: {
  organizationId: string;
  buildingId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}) {
  await refreshSourceReconciliationDataIssues({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    requestId: params.requestId ?? null,
  });

  const latestBenchmarkSubmission = await prisma.benchmarkSubmission.findFirst({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    },
    orderBy: [{ reportingYear: "desc" }, { updatedAt: "desc" }],
    select: {
      reportingYear: true,
      submissionPayload: true,
    },
  });

  if (latestBenchmarkSubmission) {
    const verificationItems = await prisma.verificationItemResult.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        reportingYear: latestBenchmarkSubmission.reportingYear,
      },
      orderBy: [{ createdAt: "asc" }],
    });

    const engineResult = asComplianceEngineResult(latestBenchmarkSubmission.submissionPayload);
    if (engineResult) {
      await refreshBenchmarkingDataIssues({
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        reportingYear: latestBenchmarkSubmission.reportingYear,
        engineResult,
        verification: { items: verificationItems },
        actorType: params.actorType,
        actorId: params.actorId ?? null,
        requestId: params.requestId ?? null,
      });
    }
  }

  return getBuildingIssueSummary({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
  });
}

export async function updateDataIssueStatus(params: {
  organizationId: string;
  buildingId: string;
  issueId: string;
  nextStatus: Extract<DataIssueStatus, "IN_PROGRESS" | "RESOLVED" | "DISMISSED">;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}) {
  const issue = await prisma.dataIssue.findFirst({
    where: {
      id: params.issueId,
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    },
  });

  if (!issue) {
    throw new NotFoundError("Data issue not found");
  }

  if (params.nextStatus === "IN_PROGRESS") {
    if (issue.status === "RESOLVED" || issue.status === "DISMISSED") {
      throw new WorkflowStateError("Cannot move a closed issue back to in progress manually.");
    }
  }

  if (
    (params.nextStatus === "RESOLVED" || params.nextStatus === "DISMISSED") &&
    issue.severity === "BLOCKING"
  ) {
    throw new ValidationError(
      "Blocking issues must resolve through re-evaluation after the data condition is fixed.",
    );
  }

  const nextResolvedAt =
    params.nextStatus === "RESOLVED" || params.nextStatus === "DISMISSED"
      ? new Date()
      : null;

  const updated = await prisma.dataIssue.update({
    where: { id: issue.id },
    data: {
      status: params.nextStatus,
      resolvedAt: nextResolvedAt,
    },
  });

  await createAuditLog({
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    action: "DATA_ISSUE_STATUS_UPDATED",
    inputSnapshot: {
      issueId: issue.id,
      fromStatus: issue.status,
    },
    outputSnapshot: {
      toStatus: updated.status,
      issueType: updated.issueType,
    },
    requestId: params.requestId ?? null,
  });

  return updated;
}
