import type {
  ActorType,
  BenchmarkPacketStatus,
  BenchmarkRequestItemStatus,
  Prisma,
} from "@/generated/prisma";
import { createAuditLog } from "@/server/lib/audit-log";
import { prisma } from "@/server/lib/db";
import {
  hashDeterministicJson,
  slugifyFileSegment,
  stringifyDeterministicJson,
} from "@/server/lib/deterministic-json";
import { PacketExportError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import {
  renderPacketDocumentPdfBase64,
  type PacketDocumentEntry,
  type PacketRenderDocument,
} from "@/server/rendering/packet-documents";
import { describePortfolioManagerSyncState } from "./portfolio-manager-sync";
import { ComplianceProvenanceError } from "./provenance";
import { reconcileBenchmarkSubmissionWorkflowTx } from "./submission-workflows";
import {
  computeVerificationEvaluation,
  evaluateVerification,
  type VerificationEvaluationResult,
} from "./verification-engine";

export type BenchmarkPacketExportFormat = "JSON" | "MARKDOWN" | "PDF";

type PacketDisposition = "READY" | "READY_WITH_WARNINGS" | "BLOCKED";

const benchmarkSubmissionInclude = {
  building: true,
  ruleVersion: {
    include: {
      rulePackage: true,
    },
  },
  factorSetVersion: true,
  complianceRun: {
    include: {
      calculationManifest: true,
    },
  },
  evidenceArtifacts: {
    include: {
      sourceArtifact: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  benchmarkPackets: {
    orderBy: [{ version: "desc" }],
    take: 1,
  },
} satisfies Prisma.BenchmarkSubmissionInclude;

type BenchmarkSubmissionAssembly = Prisma.BenchmarkSubmissionGetPayload<{
  include: typeof benchmarkSubmissionInclude;
}>;

type BenchmarkRequestItemRecord = Prisma.BenchmarkRequestItemGetPayload<{
  include: {
    sourceArtifact: true;
    evidenceArtifact: {
      include: {
        sourceArtifact: true;
      };
    };
  };
}>;

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function formatRequestCategory(category: string) {
  return category
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function humanizeToken(value: string | null | undefined) {
  return (value ?? "unknown")
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function isRequestItemBlocking(status: BenchmarkRequestItemStatus) {
  return status === "BLOCKED" || status === "NOT_REQUESTED" || status === "REQUESTED";
}

function isRequestItemWarning(status: BenchmarkRequestItemStatus) {
  return status === "RECEIVED";
}

function resolvePacketDisposition(input: {
  readinessStatus: string | null;
  requestItems: BenchmarkRequestItemRecord[];
  warnings: Array<{ code: string; message: string }>;
  verificationSummary?: VerificationEvaluationResult["summary"] | null;
}) {
  const hasBlockingRequests = input.requestItems.some(
    (item) => item.isRequired && isRequestItemBlocking(item.status),
  );

  if (
    input.readinessStatus === "BLOCKED" ||
    hasBlockingRequests ||
    (input.verificationSummary?.failedCount ?? 0) > 0
  ) {
    return "BLOCKED" satisfies PacketDisposition;
  }

  const hasWarningRequests = input.requestItems.some(
    (item) => item.isRequired && isRequestItemWarning(item.status),
  );

  if (
    input.warnings.length > 0 ||
    hasWarningRequests ||
    (input.verificationSummary?.needsReviewCount ?? 0) > 0
  ) {
    return "READY_WITH_WARNINGS" satisfies PacketDisposition;
  }

  return "READY" satisfies PacketDisposition;
}

function getBenchmarkReadinessPayload(submission: BenchmarkSubmissionAssembly) {
  const payload = toRecord(submission.submissionPayload);
  return toRecord(payload["readiness"]);
}

function getBenchmarkReadinessSummary(submission: BenchmarkSubmissionAssembly) {
  return toRecord(getBenchmarkReadinessPayload(submission)["summary"]);
}

function getBenchmarkReadinessGovernance(submission: BenchmarkSubmissionAssembly) {
  const readiness = getBenchmarkReadinessPayload(submission);
  const governance = toRecord(readiness["governance"]);

  if (Object.keys(governance).length > 0) {
    return governance;
  }

  return {
    rulePackageKey: submission.ruleVersion.rulePackage.key,
    ruleVersionId: submission.ruleVersion.id,
    ruleVersion: submission.ruleVersion.version,
    factorSetKey: submission.factorSetVersion.key,
    factorSetVersionId: submission.factorSetVersion.id,
    factorSetVersion: submission.factorSetVersion.version,
  };
}

function getDqcState(submission: BenchmarkSubmissionAssembly) {
  const summary = getBenchmarkReadinessSummary(submission);
  const evidence = submission.evidenceArtifacts
    .filter((artifact) => {
      const benchmarking = toRecord(artifact.metadata)["benchmarking"];
      const metadata = toRecord(
        benchmarking && typeof benchmarking === "object" && !Array.isArray(benchmarking)
          ? (benchmarking as Record<string, unknown>)
          : toRecord(artifact.metadata),
      );
      return metadata["kind"] === "DQC_REPORT";
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    state:
      typeof summary["dqcFreshnessState"] === "string"
        ? (summary["dqcFreshnessState"] as string)
        : "NOT_REQUIRED",
    latestEvidenceAt: evidence[0]?.createdAt.toISOString() ?? null,
    latestEvidenceName: evidence[0]?.name ?? null,
  };
}

async function loadBenchmarkSubmissionForPacket(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
}) {
  const submission = await prisma.benchmarkSubmission.findFirst({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      reportingYear: params.reportingYear,
    },
    include: benchmarkSubmissionInclude,
  });

  if (!submission) {
    throw new ComplianceProvenanceError(
      "Benchmark submission not found for verification packet assembly",
    );
  }

  return submission;
}

async function loadBenchmarkRequestItems(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
}) {
  return prisma.benchmarkRequestItem.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      OR: [{ reportingYear: params.reportingYear }, { reportingYear: null }],
    },
    include: {
      sourceArtifact: true,
      evidenceArtifact: {
        include: {
          sourceArtifact: true,
        },
      },
    },
    orderBy: [{ isRequired: "desc" }, { updatedAt: "desc" }, { createdAt: "asc" }],
  });
}

async function loadBenchmarkSyncState(params: {
  organizationId: string;
  buildingId: string;
}) {
  return prisma.portfolioManagerSyncState.findFirst({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    },
    orderBy: [{ updatedAt: "desc" }],
  });
}

async function loadBuildingMeters(params: {
  organizationId: string;
  buildingId: string;
}) {
  return prisma.meter.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    },
    orderBy: [{ meterType: "asc" }, { name: "asc" }],
  });
}

function buildPacketWarnings(input: {
  submission: BenchmarkSubmissionAssembly;
  requestItems: BenchmarkRequestItemRecord[];
  syncState: Awaited<ReturnType<typeof loadBenchmarkSyncState>>;
  verification?: VerificationEvaluationResult | null;
}) {
  const syncDiagnostics = describePortfolioManagerSyncState(input.syncState);
  const readiness = getBenchmarkReadinessPayload(input.submission);
  const summary = getBenchmarkReadinessSummary(input.submission);
  const findingMessages = toArray(readiness["findings"])
    .map((entry) => toRecord(entry))
    .filter((entry) => entry["status"] === "FAIL")
    .map((entry) => ({
      code: String(entry["code"] ?? "READINESS_FINDING"),
      severity: "ERROR" as const,
      message: String(entry["message"] ?? "Benchmark readiness finding requires attention."),
    }));

  const requestWarnings = input.requestItems
    .filter((item) => item.isRequired && item.status !== "VERIFIED")
    .map((item) => ({
      code: `REQUEST_${item.category}`,
      severity: item.status === "BLOCKED" ? ("ERROR" as const) : ("WARNING" as const),
      message:
        item.status === "BLOCKED"
          ? `${item.title} is blocked and still needed for verification readiness.`
          : `${item.title} is still outstanding for verification readiness.`,
    }));

  const warnings = [...findingMessages, ...requestWarnings];

  if (input.verification) {
    warnings.push(
      ...input.verification.items
        .filter((item) => item.status !== "PASS")
        .map((item) => ({
          code: `VERIFICATION_${item.key.toUpperCase()}`,
          severity: item.status === "FAIL" ? ("ERROR" as const) : ("WARNING" as const),
          message: item.explanation,
        })),
    );
  }

  if (
    input.syncState?.status === "FAILED" &&
    !warnings.some((warning) => warning.code === "PM_SYNC_FAILED")
  ) {
    warnings.push({
      code: "PM_SYNC_FAILED",
      severity: "WARNING",
      message:
        typeof syncDiagnostics?.message === "string" && syncDiagnostics.message
          ? syncDiagnostics.message
          : "Portfolio Manager sync has failed and may leave benchmarking data stale.",
    });
  }

  if (
    typeof summary["pmShareState"] === "string" &&
    summary["pmShareState"] !== "READY" &&
    !warnings.some((warning) => warning.code === "PM_SHARE_NOT_READY")
  ) {
    warnings.push({
      code: "PM_SHARE_NOT_READY",
      severity: "WARNING",
      message: "Portfolio Manager linkage or sharing is not fully ready.",
    });
  }

  return warnings;
}

export function assembleBenchmarkPacketPayload(input: {
  submission: BenchmarkSubmissionAssembly;
  requestItems: BenchmarkRequestItemRecord[];
  syncState: Awaited<ReturnType<typeof loadBenchmarkSyncState>>;
  meters: Awaited<ReturnType<typeof loadBuildingMeters>>;
  verification: VerificationEvaluationResult;
}) {
  const syncDiagnostics = describePortfolioManagerSyncState(input.syncState);
  const readiness = getBenchmarkReadinessPayload(input.submission);
  const summary = getBenchmarkReadinessSummary(input.submission);
  const governance = getBenchmarkReadinessGovernance(input.submission);
  const dqcState = getDqcState(input.submission);
  const warnings = buildPacketWarnings(input);
  const disposition = resolvePacketDisposition({
    readinessStatus: typeof readiness["status"] === "string" ? (readiness["status"] as string) : null,
    requestItems: input.requestItems,
    warnings,
    verificationSummary: input.verification.summary,
  });

  const coverageAnalysis = {
    annualCompleteness:
      typeof summary["coverageComplete"] === "boolean"
        ? summary["coverageComplete"]
        : false,
    missingCoverageStreams: toArray(summary["missingCoverageStreams"]).map(String),
    overlapStreams: toArray(summary["overlapStreams"]).map(String),
    gapDetails: toArray(summary["gapDetails"]),
    overlapDetails: toArray(summary["overlapDetails"]),
    streamCoverage: toArray(summary["streamCoverage"]),
  };

  const evidenceManifest = [
    ...input.submission.evidenceArtifacts.map((artifact) => ({
      manifestType: "BENCHMARK_SUBMISSION_EVIDENCE",
      id: artifact.id,
      artifactType: artifact.artifactType,
      name: artifact.name,
      artifactRef: artifact.artifactRef,
      sourceArtifactId: artifact.sourceArtifactId,
      sourceArtifactName: artifact.sourceArtifact?.name ?? null,
      sourceArtifactType: artifact.sourceArtifact?.artifactType ?? null,
      sourceArtifactUrl: artifact.sourceArtifact?.externalUrl ?? null,
      createdAt: artifact.createdAt.toISOString(),
      metadata: toRecord(artifact.metadata),
    })),
    ...input.requestItems.flatMap((item) => {
      const entries: Array<Record<string, unknown>> = [];
      if (item.sourceArtifact) {
        entries.push({
          manifestType: "REQUEST_SOURCE",
          requestItemId: item.id,
          requestTitle: item.title,
          sourceArtifactId: item.sourceArtifact.id,
          name: item.sourceArtifact.name,
          sourceArtifactType: item.sourceArtifact.artifactType,
          sourceArtifactUrl: item.sourceArtifact.externalUrl,
          createdAt: item.sourceArtifact.createdAt.toISOString(),
        });
      }
      if (item.evidenceArtifact) {
        entries.push({
          manifestType: "REQUEST_EVIDENCE",
          requestItemId: item.id,
          requestTitle: item.title,
          evidenceArtifactId: item.evidenceArtifact.id,
          artifactType: item.evidenceArtifact.artifactType,
          name: item.evidenceArtifact.name,
          artifactRef: item.evidenceArtifact.artifactRef,
          sourceArtifactId: item.evidenceArtifact.sourceArtifactId,
          sourceArtifactName: item.evidenceArtifact.sourceArtifact?.name ?? null,
          sourceArtifactType: item.evidenceArtifact.sourceArtifact?.artifactType ?? null,
          sourceArtifactUrl: item.evidenceArtifact.sourceArtifact?.externalUrl ?? null,
          createdAt: item.evidenceArtifact.createdAt.toISOString(),
        });
      }
      return entries;
    }),
  ];

  const requestSummary = {
    total: input.requestItems.length,
    required: input.requestItems.filter((item) => item.isRequired).length,
    verified: input.requestItems.filter((item) => item.status === "VERIFIED").length,
    blocked: input.requestItems.filter((item) => item.status === "BLOCKED").length,
    outstanding: input.requestItems.filter(
      (item) => item.isRequired && item.status !== "VERIFIED",
    ).length,
    items: input.requestItems.map((item) => ({
      id: item.id,
      reportingYear: item.reportingYear,
      category: item.category,
      categoryLabel: formatRequestCategory(item.category),
      title: item.title,
      status: item.status,
      isRequired: item.isRequired,
      dueDate: item.dueDate?.toISOString() ?? null,
      assignedTo: item.assignedTo,
      requestedFrom: item.requestedFrom,
      notes: item.notes,
      sourceArtifactId: item.sourceArtifactId,
      evidenceArtifactId: item.evidenceArtifactId,
      updatedAt: item.updatedAt.toISOString(),
    })),
  };

  const packetPayload = {
    packetKind: "BENCHMARK_VERIFICATION_WORKPAPER",
    packetSummary: {
      disposition,
      benchmarkSubmissionStatus: input.submission.status,
      readinessStatus:
        typeof readiness["status"] === "string" ? readiness["status"] : input.submission.status,
      readinessEvaluatedAt: input.submission.readinessEvaluatedAt?.toISOString() ?? null,
      warningsCount: warnings.length,
    },
    buildingIdentity: {
      organizationId: input.submission.organizationId,
      buildingId: input.submission.buildingId,
      buildingName: input.submission.building.name,
      address: input.submission.building.address,
      propertyType: input.submission.building.propertyType,
      ownershipType: input.submission.building.ownershipType,
      grossSquareFeet: input.submission.building.grossSquareFeet,
      portfolioManagerPropertyId: input.submission.building.espmPropertyId?.toString() ?? null,
      dcRealPropertyUniqueId: input.submission.building.doeeBuildingId,
    },
    reportingContext: {
      reportingYear: input.submission.reportingYear,
      benchmarkSubmissionId: input.submission.id,
      benchmarkSubmissionStatus: input.submission.status,
      submittedAt: input.submission.submittedAt?.toISOString() ?? null,
    },
    portfolioManagerLinkage: {
      propertyLinked: !!input.submission.building.espmPropertyId,
      propertyId: input.submission.building.espmPropertyId?.toString() ?? null,
      shareStatus: input.submission.building.espmShareStatus,
      syncStatus: input.syncState?.status ?? "NOT_STARTED",
      lastAttemptedSyncAt: input.syncState?.lastAttemptedSyncAt?.toISOString() ?? null,
      lastSuccessfulSyncAt: input.syncState?.lastSuccessfulSyncAt?.toISOString() ?? null,
      failedStep: syncDiagnostics?.failedStep ?? null,
      retryable: syncDiagnostics?.retryable ?? null,
      syncErrorMessage: syncDiagnostics?.message ?? null,
    },
    benchmarkingReadiness: {
      readiness,
      summary,
      governance,
    },
    coverageAnalysis,
    meterInventory: {
      totalMeters: input.meters.length,
      activeMeters: input.meters.filter((meter) => meter.isActive).length,
      meters: input.meters.map((meter) => ({
        id: meter.id,
        name: meter.name,
        meterType: meter.meterType,
        unit: meter.unit,
        espmMeterId: meter.espmMeterId?.toString() ?? null,
        isActive: meter.isActive,
      })),
    },
    dataQualityChecker: dqcState,
    verificationSummary: {
      summary: input.verification.summary,
      items: input.verification.items.map((item) => ({
        category: item.category,
        key: item.key,
        status: item.status,
        explanation: item.explanation,
        evidenceRefs: item.evidenceRefs,
        evidenceLinks: item.evidenceLinks,
      })),
    },
    evidenceManifest,
    requestSummary,
    warnings,
    blockers: warnings
      .filter((warning) => warning.severity === "ERROR")
      .map((warning) => warning.message),
    provenance: {
      complianceRunId: input.submission.complianceRunId,
      calculationManifestId: input.submission.complianceRun?.calculationManifest?.id ?? null,
      rulePackageKey: input.submission.ruleVersion.rulePackage.key,
      ruleVersionId: input.submission.ruleVersion.id,
      ruleVersion: input.submission.ruleVersion.version,
      factorSetKey: input.submission.factorSetVersion.key,
      factorSetVersionId: input.submission.factorSetVersion.id,
      factorSetVersion: input.submission.factorSetVersion.version,
    },
  };

  const upstreamFingerprint = {
    benchmarkSubmission: {
      id: input.submission.id,
      updatedAt: input.submission.updatedAt.toISOString(),
      status: input.submission.status,
      readinessEvaluatedAt: input.submission.readinessEvaluatedAt?.toISOString() ?? null,
      submissionPayload: input.submission.submissionPayload,
      evidenceArtifacts: input.submission.evidenceArtifacts.map((artifact) => ({
        id: artifact.id,
        createdAt: artifact.createdAt.toISOString(),
        metadata: artifact.metadata,
        sourceArtifactId: artifact.sourceArtifactId,
      })),
    },
    requestItems: input.requestItems.map((item) => ({
      id: item.id,
      status: item.status,
      reportingYear: item.reportingYear,
      sourceArtifactId: item.sourceArtifactId,
      evidenceArtifactId: item.evidenceArtifactId,
      updatedAt: item.updatedAt.toISOString(),
    })),
    verification: {
      summary: input.verification.summary,
      items: input.verification.items.map((item) => ({
        category: item.category,
        key: item.key,
        status: item.status,
        explanation: item.explanation,
        evidenceRefs: item.evidenceRefs,
      })),
    },
    syncState: input.syncState
      ? {
          id: input.syncState.id,
          updatedAt: input.syncState.updatedAt.toISOString(),
          status: input.syncState.status,
          lastAttemptedSyncAt: input.syncState.lastAttemptedSyncAt?.toISOString() ?? null,
          lastSuccessfulSyncAt: input.syncState.lastSuccessfulSyncAt?.toISOString() ?? null,
          diagnostics: syncDiagnostics,
        }
      : null,
    meters: input.meters.map((meter) => ({
      id: meter.id,
      createdAt: meter.createdAt.toISOString(),
      espmMeterId: meter.espmMeterId?.toString() ?? null,
      meterType: meter.meterType,
      unit: meter.unit,
      isActive: meter.isActive,
    })),
  };

  return {
    packetPayload,
    packetHash: hashDeterministicJson({ packetPayload, upstreamFingerprint }),
  };
}

async function loadPacketAssemblyContext(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
}) {
  const [submission, requestItems, syncState, meters] = await Promise.all([
    loadBenchmarkSubmissionForPacket(params),
    loadBenchmarkRequestItems(params),
    loadBenchmarkSyncState(params),
    loadBuildingMeters(params),
  ]);

  return {
    submission,
    requestItems,
    syncState,
    meters,
  };
}

async function ensureArtifactScope(params: {
  organizationId: string;
  buildingId: string;
  sourceArtifactId?: string | null;
  evidenceArtifactId?: string | null;
}) {
  if (params.sourceArtifactId) {
    const sourceArtifact = await prisma.sourceArtifact.findFirst({
      where: {
        id: params.sourceArtifactId,
        organizationId: params.organizationId,
        OR: [{ buildingId: params.buildingId }, { buildingId: null }],
      },
      select: { id: true },
    });

    if (!sourceArtifact) {
      throw new ComplianceProvenanceError(
        "Benchmark request source artifact is not available for this building",
      );
    }
  }

  if (params.evidenceArtifactId) {
    const evidenceArtifact = await prisma.evidenceArtifact.findFirst({
      where: {
        id: params.evidenceArtifactId,
        organizationId: params.organizationId,
        OR: [{ buildingId: params.buildingId }, { buildingId: null }],
      },
      select: { id: true },
    });

    if (!evidenceArtifact) {
      throw new ComplianceProvenanceError(
        "Benchmark request evidence artifact is not available for this building",
      );
    }
  }
}

export async function markBenchmarkPacketsStaleTx(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    buildingId: string;
    reportingYear?: number | null;
    benchmarkSubmissionId?: string | null;
  },
) {
  let benchmarkSubmissionIds: string[] = [];

  if (params.benchmarkSubmissionId) {
    benchmarkSubmissionIds = [params.benchmarkSubmissionId];
  } else {
    const submissions = await tx.benchmarkSubmission.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        ...(params.reportingYear != null ? { reportingYear: params.reportingYear } : {}),
      },
      select: { id: true },
    });
    benchmarkSubmissionIds = submissions.map((submission) => submission.id);
  }

  if (benchmarkSubmissionIds.length === 0) {
    return { count: 0 };
  }

  return tx.benchmarkPacket.updateMany({
    where: {
      benchmarkSubmissionId: { in: benchmarkSubmissionIds },
      status: {
        in: ["GENERATED"],
      },
    },
    data: {
      status: "STALE",
      staleMarkedAt: new Date(),
    },
  });
}

async function ensureBenchmarkPacketStaleness(submission: BenchmarkSubmissionAssembly) {
  const latestPacket = submission.benchmarkPackets[0] ?? null;
  if (
    !latestPacket ||
    latestPacket.status === "STALE" ||
    latestPacket.status === "FINALIZED"
  ) {
    return latestPacket;
  }

  const context = await loadPacketAssemblyContext({
    organizationId: submission.organizationId,
    buildingId: submission.buildingId,
    reportingYear: submission.reportingYear,
  });
  const verification = await computeVerificationEvaluation({
    organizationId: submission.organizationId,
    buildingId: submission.buildingId,
    reportingYear: submission.reportingYear,
  });

  const { packetHash } = assembleBenchmarkPacketPayload({
    ...context,
    verification,
  });
  if (packetHash === latestPacket.packetHash) {
    return latestPacket;
  }

  return prisma.benchmarkPacket.update({
    where: { id: latestPacket.id },
    data: {
      status: "STALE",
      staleMarkedAt: new Date(),
    },
  });
}

export async function listBenchmarkRequestItems(params: {
  organizationId: string;
  buildingId: string;
  reportingYear?: number;
}) {
  return prisma.benchmarkRequestItem.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      ...(params.reportingYear != null
        ? { OR: [{ reportingYear: params.reportingYear }, { reportingYear: null }] }
        : {}),
    },
    include: {
      sourceArtifact: true,
      evidenceArtifact: {
        include: {
          sourceArtifact: true,
        },
      },
    },
    orderBy: [{ isRequired: "desc" }, { dueDate: "asc" }, { updatedAt: "desc" }],
  });
}

export async function upsertBenchmarkRequestItem(input: {
  organizationId: string;
  buildingId: string;
  requestItemId?: string;
  reportingYear?: number | null;
  category:
    | "DC_REAL_PROPERTY_ID"
    | "GROSS_FLOOR_AREA_SUPPORT"
    | "AREA_ANALYSIS_DRAWINGS"
    | "PROPERTY_USE_DETAILS_SUPPORT"
    | "METER_ROSTER_SUPPORT"
    | "UTILITY_BILLS"
    | "PORTFOLIO_MANAGER_ACCESS"
    | "DATA_QUALITY_CHECKER_SUPPORT"
    | "THIRD_PARTY_VERIFICATION_SUPPORT"
    | "OTHER_BENCHMARKING_SUPPORT";
  title: string;
  status?: BenchmarkRequestItemStatus;
  isRequired?: boolean;
  dueDate?: Date | null;
  assignedTo?: string | null;
  requestedFrom?: string | null;
  notes?: string | null;
  sourceArtifactId?: string | null;
  evidenceArtifactId?: string | null;
  createdByType: ActorType;
  createdById?: string | null;
}) {
  await ensureArtifactScope({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    sourceArtifactId: input.sourceArtifactId,
    evidenceArtifactId: input.evidenceArtifactId,
  });

  return prisma.$transaction(async (tx) => {
    const existing = input.requestItemId
      ? await tx.benchmarkRequestItem.findFirst({
          where: {
            id: input.requestItemId,
            organizationId: input.organizationId,
            buildingId: input.buildingId,
          },
          select: { id: true, reportingYear: true },
        })
      : null;

    if (input.requestItemId && !existing) {
      throw new ComplianceProvenanceError("Benchmark request item not found");
    }

    const requestItem = existing
      ? await tx.benchmarkRequestItem.update({
          where: { id: existing.id },
          data: {
            reportingYear:
              input.reportingYear !== undefined ? input.reportingYear : existing.reportingYear,
            category: input.category,
            title: input.title,
            status: input.status ?? undefined,
            isRequired: input.isRequired ?? undefined,
            dueDate: input.dueDate !== undefined ? input.dueDate : undefined,
            assignedTo: input.assignedTo !== undefined ? input.assignedTo : undefined,
            requestedFrom:
              input.requestedFrom !== undefined ? input.requestedFrom : undefined,
            notes: input.notes !== undefined ? input.notes : undefined,
            sourceArtifactId:
              input.sourceArtifactId !== undefined ? input.sourceArtifactId : undefined,
            evidenceArtifactId:
              input.evidenceArtifactId !== undefined ? input.evidenceArtifactId : undefined,
          },
          include: {
            sourceArtifact: true,
            evidenceArtifact: {
              include: {
                sourceArtifact: true,
              },
            },
          },
        })
      : await tx.benchmarkRequestItem.create({
          data: {
            organizationId: input.organizationId,
            buildingId: input.buildingId,
            reportingYear: input.reportingYear ?? null,
            category: input.category,
            title: input.title,
            status: input.status ?? "REQUESTED",
            isRequired: input.isRequired ?? true,
            dueDate: input.dueDate ?? null,
            assignedTo: input.assignedTo ?? null,
            requestedFrom: input.requestedFrom ?? null,
            notes: input.notes ?? null,
            sourceArtifactId: input.sourceArtifactId ?? null,
            evidenceArtifactId: input.evidenceArtifactId ?? null,
            createdByType: input.createdByType,
            createdById: input.createdById ?? null,
          },
          include: {
            sourceArtifact: true,
            evidenceArtifact: {
              include: {
                sourceArtifact: true,
              },
            },
          },
        });

    await markBenchmarkPacketsStaleTx(tx, {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      reportingYear: requestItem.reportingYear,
    });

    return requestItem;
  });
}

export async function listBenchmarkPackets(params: {
  organizationId: string;
  buildingId: string;
  limit?: number;
}) {
  return prisma.benchmarkPacket.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    },
    orderBy: [{ generatedAt: "desc" }, { version: "desc" }],
    take: params.limit ?? 20,
    include: {
      benchmarkSubmission: {
        select: {
          id: true,
          reportingYear: true,
          status: true,
        },
      },
    },
  });
}

export async function generateBenchmarkPacket(input: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
  createdByType: ActorType;
  createdById?: string | null;
  requestId?: string | null;
}) {
  const verification = await evaluateVerification({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    reportingYear: input.reportingYear,
  });
  const context = await loadPacketAssemblyContext({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    reportingYear: input.reportingYear,
  });
  const latestPacket = context.submission.benchmarkPackets[0] ?? null;
  const { packetPayload, packetHash } = assembleBenchmarkPacketPayload({
    ...context,
    verification,
  });

  if (latestPacket && latestPacket.packetHash === packetHash && latestPacket.status !== "STALE") {
    return prisma.benchmarkPacket.findUniqueOrThrow({
      where: { id: latestPacket.id },
      include: {
        benchmarkSubmission: true,
      },
    });
  }

  const packet = await prisma.$transaction(async (tx) => {
    await markBenchmarkPacketsStaleTx(tx, {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      benchmarkSubmissionId: context.submission.id,
    });

    const packet = await tx.benchmarkPacket.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        benchmarkSubmissionId: context.submission.id,
        reportingYear: input.reportingYear,
        version: (latestPacket?.version ?? 0) + 1,
        status: "GENERATED",
        packetHash,
        packetPayload: toJson(packetPayload),
        generatedAt: new Date(),
        staleMarkedAt: null,
        finalizedAt: null,
        finalizedByType: null,
        finalizedById: null,
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      },
      include: {
        benchmarkSubmission: true,
      },
    });

    await reconcileBenchmarkSubmissionWorkflowTx(tx, {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      packet,
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
      requestId: input.requestId ?? null,
    });

    return packet;
  });

  await createAuditLog({
    actorType: input.createdByType,
    actorId: input.createdById ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    action: "COMPLIANCE_ARTIFACT_GENERATED",
    inputSnapshot: {
      artifactType: "BENCHMARK_VERIFICATION_PACKET",
      reportingYear: input.reportingYear,
      benchmarkSubmissionId: context.submission.id,
    },
    outputSnapshot: {
      packetId: packet.id,
      version: packet.version,
      status: packet.status,
      packetHash: packet.packetHash,
    },
    requestId: input.requestId ?? null,
  });

  return packet;
}

export async function getLatestBenchmarkPacket(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
}) {
  const submission = await prisma.benchmarkSubmission.findFirst({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      reportingYear: params.reportingYear,
    },
    include: benchmarkSubmissionInclude,
  });

  if (!submission) {
    return null;
  }

  await ensureBenchmarkPacketStaleness(submission);

  return prisma.benchmarkPacket.findFirst({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      reportingYear: params.reportingYear,
    },
    orderBy: [{ version: "desc" }],
    include: {
      benchmarkSubmission: true,
    },
  });
}

export async function getBenchmarkPacketManifest(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
}) {
  const packet = await getLatestBenchmarkPacket(params);
  if (!packet) {
    return null;
  }

  const payload = toRecord(packet.packetPayload);
  const packetSummary = toRecord(payload["packetSummary"]);

  return {
    id: packet.id,
    version: packet.version,
    status: packet.status,
    packetHash: packet.packetHash,
    reportingYear: packet.reportingYear,
    disposition: packetSummary["disposition"] ?? "BLOCKED",
    warnings: toArray(payload["warnings"]),
    blockers: toArray(payload["blockers"]),
    evidenceManifest: toArray(payload["evidenceManifest"]),
    verificationSummary: toRecord(payload["verificationSummary"]),
    requestSummary: toRecord(payload["requestSummary"]),
    benchmarkingReadiness: toRecord(payload["benchmarkingReadiness"]),
  };
}

export async function finalizeBenchmarkPacket(input: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
  createdByType: ActorType;
  createdById?: string | null;
  requestId?: string | null;
}) {
  const latestPacket = await getLatestBenchmarkPacket({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    reportingYear: input.reportingYear,
  });

  if (!latestPacket) {
    throw new ComplianceProvenanceError("Benchmark packet not found for finalization");
  }

  if (latestPacket.status === "STALE") {
    throw new ComplianceProvenanceError("Benchmark packet cannot be finalized while stale");
  }

  if (latestPacket.status === "FINALIZED") {
    return latestPacket;
  }

  const payload = toRecord(latestPacket.packetPayload);
  const packetSummary = toRecord(payload["packetSummary"]);
  if (packetSummary["disposition"] === "BLOCKED") {
    throw new ComplianceProvenanceError(
      "Benchmark packet cannot be finalized while verification blockers remain",
    );
  }

  const finalized = await prisma.$transaction(async (tx) => {
    const updated = await tx.benchmarkPacket.update({
      where: { id: latestPacket.id },
      data: {
        status: "FINALIZED",
        finalizedAt: new Date(),
        finalizedByType: input.createdByType,
        finalizedById: input.createdById ?? null,
      },
      include: {
        benchmarkSubmission: true,
      },
    });

    await reconcileBenchmarkSubmissionWorkflowTx(tx, {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      packet: updated,
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
      requestId: input.requestId ?? null,
    });

    return updated;
  });

  await createAuditLog({
    actorType: input.createdByType,
    actorId: input.createdById ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    action: "COMPLIANCE_ARTIFACT_FINALIZED",
    inputSnapshot: {
      artifactType: "BENCHMARK_VERIFICATION_PACKET",
      reportingYear: input.reportingYear,
      packetId: latestPacket.id,
      version: latestPacket.version,
    },
    outputSnapshot: {
      packetId: finalized.id,
      version: finalized.version,
      status: finalized.status,
      finalizedAt: finalized.finalizedAt?.toISOString() ?? null,
    },
    requestId: input.requestId ?? null,
  });

  return finalized;
}

function toDisplayValue(value: unknown) {
  if (value == null) {
    return "None";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? "None" : value.map(String).join(", ");
  }

  if (typeof value === "number") {
    return value.toLocaleString("en-US");
  }

  return String(value);
}

function buildBenchmarkPacketExportDocument(
  packet: NonNullable<Awaited<ReturnType<typeof getLatestBenchmarkPacket>>>,
) {
  const payload = toRecord(packet.packetPayload);
  return {
    exportVersion: "benchmark-verification-packet-export-v1",
    packet: {
      id: packet.id,
      version: packet.version,
      status: packet.status,
      packetHash: packet.packetHash,
      generatedAt: packet.generatedAt.toISOString(),
      staleMarkedAt: packet.staleMarkedAt?.toISOString() ?? null,
      finalizedAt: packet.finalizedAt?.toISOString() ?? null,
      finalizedByType: packet.finalizedByType ?? null,
      finalizedById: packet.finalizedById ?? null,
    },
    packetSummary: toRecord(payload["packetSummary"]),
    buildingIdentity: toRecord(payload["buildingIdentity"]),
    reportingContext: toRecord(payload["reportingContext"]),
    portfolioManagerLinkage: toRecord(payload["portfolioManagerLinkage"]),
    benchmarkingReadiness: toRecord(payload["benchmarkingReadiness"]),
    coverageAnalysis: toRecord(payload["coverageAnalysis"]),
    meterInventory: toRecord(payload["meterInventory"]),
    dataQualityChecker: toRecord(payload["dataQualityChecker"]),
    verificationSummary: toRecord(payload["verificationSummary"]),
    evidenceManifest: toArray(payload["evidenceManifest"]),
    requestSummary: toRecord(payload["requestSummary"]),
    warnings: toArray(payload["warnings"]),
    blockers: toArray(payload["blockers"]),
    provenance: toRecord(payload["provenance"]),
    payload,
  };
}

function buildBenchmarkNextActions(packetExport: ReturnType<typeof buildBenchmarkPacketExportDocument>) {
  const actions: string[] = [];
  const blockers = packetExport.blockers.map(String);
  const warnings = packetExport.warnings
    .map((warning) => toRecord(warning)["message"])
    .filter((value): value is string => typeof value === "string");
  const portfolioManagerLinkage = toRecord(packetExport.portfolioManagerLinkage);
  const requestSummary = toRecord(packetExport.requestSummary);
  const outstanding = Number(requestSummary["outstanding"] ?? 0);

  if (blockers.length > 0) {
    actions.push(...blockers.slice(0, 3).map((message) => `Resolve blocker: ${message}`));
  } else if (warnings.length > 0) {
    actions.push(...warnings.slice(0, 3).map((message) => `Address warning: ${message}`));
  }

  if (
    typeof portfolioManagerLinkage["syncStatus"] === "string" &&
    portfolioManagerLinkage["syncStatus"] !== "SUCCEEDED"
  ) {
    actions.push(
      `Refresh Portfolio Manager data after resolving ${humanizeToken(
        portfolioManagerLinkage["failedStep"] as string | undefined,
      ).toLowerCase()} issues.`,
    );
  }

  if (outstanding > 0) {
    actions.push(`Verify the remaining ${outstanding} required benchmarking request item(s).`);
  }

  if (actions.length === 0) {
    actions.push("Packet is ready for verifier review and consultant handoff.");
  }

  return actions.slice(0, 4);
}

function buildBenchmarkPacketRenderDocument(
  packetExport: ReturnType<typeof buildBenchmarkPacketExportDocument>,
): PacketRenderDocument {
  const packet = toRecord(packetExport.packet);
  const packetSummary = toRecord(packetExport.packetSummary);
  const buildingIdentity = toRecord(packetExport.buildingIdentity);
  const reportingContext = toRecord(packetExport.reportingContext);
  const portfolioManagerLinkage = toRecord(packetExport.portfolioManagerLinkage);
  const benchmarkingReadiness = toRecord(packetExport.benchmarkingReadiness);
  const readinessSummary = toRecord(benchmarkingReadiness["summary"]);
  const readinessGovernance = toRecord(benchmarkingReadiness["governance"]);
  const coverageAnalysis = toRecord(packetExport.coverageAnalysis);
  const meterInventory = toRecord(packetExport.meterInventory);
  const dataQualityChecker = toRecord(packetExport.dataQualityChecker);
  const verificationSummary = toRecord(packetExport.verificationSummary);
  const verificationCounts = toRecord(verificationSummary["summary"]);
  const requestSummary = toRecord(packetExport.requestSummary);
  const warnings = packetExport.warnings
    .map((warning) => toRecord(warning)["message"])
    .filter((value): value is string => typeof value === "string");
  const blockers = packetExport.blockers.map(String);

  const evidenceRows = packetExport.evidenceManifest.map((entry) => {
    const record = toRecord(entry);
    return [
      toDisplayValue(record["manifestType"]),
      toDisplayValue(record["name"]),
      toDisplayValue(record["sourceArtifactName"] ?? record["sourceArtifactType"]),
      toDisplayValue(record["createdAt"]),
    ];
  });

  const meterRows = toArray(meterInventory["meters"]).map((entry) => {
    const record = toRecord(entry);
    return [
      toDisplayValue(record["name"]),
      toDisplayValue(record["meterType"]),
      toDisplayValue(record["unit"]),
      toDisplayValue(record["espmMeterId"]),
      toDisplayValue(record["isActive"]),
    ];
  });

  const requestRows = toArray(requestSummary["items"]).map((entry) => {
    const record = toRecord(entry);
    return [
      toDisplayValue(record["title"]),
      toDisplayValue(record["categoryLabel"] ?? record["category"]),
      toDisplayValue(record["status"]),
      toDisplayValue(record["isRequired"]),
      toDisplayValue(record["dueDate"]),
    ];
  });

  const verificationRows = toArray(verificationSummary["items"]).map((entry) => {
    const record = toRecord(entry);
    const evidenceLinks = toArray(record["evidenceLinks"]).map((link) => {
      const linkRecord = toRecord(link);
      return toDisplayValue(linkRecord["name"]);
    });

    return [
      toDisplayValue(record["category"]),
      toDisplayValue(record["status"]),
      toDisplayValue(record["explanation"]),
      evidenceLinks.length > 0 ? evidenceLinks.join(", ") : "None",
    ];
  });

  const disposition =
    typeof packetSummary["disposition"] === "string"
      ? (packetSummary["disposition"] as PacketDisposition)
      : "BLOCKED";
  const dispositionTone =
    disposition === "READY"
      ? "success"
      : disposition === "READY_WITH_WARNINGS"
        ? "warning"
        : "danger";

  const metadata: PacketDocumentEntry[] = [
    { label: "Building", value: toDisplayValue(buildingIdentity["buildingName"]) },
    { label: "Reporting year", value: toDisplayValue(reportingContext["reportingYear"]) },
    { label: "Packet version", value: `v${toDisplayValue(packet["version"])}` },
    { label: "Packet status", value: toDisplayValue(packet["status"]) },
    { label: "Generated", value: toDisplayValue(packet["generatedAt"]) },
    { label: "Finalized", value: toDisplayValue(packet["finalizedAt"]) },
  ];

  return {
    title: "Benchmark Verification Packet",
    subtitle: `${toDisplayValue(buildingIdentity["buildingName"])} - reporting year ${toDisplayValue(
      reportingContext["reportingYear"],
    )}`,
    disposition: {
      label: humanizeToken(disposition),
      tone: dispositionTone,
    },
    metadata,
    summary: buildBenchmarkNextActions(packetExport),
    sections: [
      {
        title: "Building and reporting summary",
        entries: [
          { label: "Address", value: toDisplayValue(buildingIdentity["address"]) },
          { label: "Property type", value: toDisplayValue(buildingIdentity["propertyType"]) },
          { label: "Ownership type", value: toDisplayValue(buildingIdentity["ownershipType"]) },
          {
            label: "Gross floor area",
            value: toDisplayValue(buildingIdentity["grossSquareFeet"]),
          },
        ],
      },
      {
        title: "Current readiness disposition",
        entries: [
          { label: "Disposition", value: humanizeToken(disposition) },
          {
            label: "Benchmarking readiness",
            value: toDisplayValue(packetSummary["readinessStatus"]),
          },
          {
            label: "Submission status",
            value: toDisplayValue(reportingContext["benchmarkSubmissionStatus"]),
          },
          {
            label: "Warnings count",
            value: toDisplayValue(packetSummary["warningsCount"]),
          },
        ],
      },
      {
        title: "Portfolio Manager linkage summary",
        entries: [
          {
            label: "Property linked",
            value: toDisplayValue(portfolioManagerLinkage["propertyLinked"]),
          },
          { label: "Property ID", value: toDisplayValue(portfolioManagerLinkage["propertyId"]) },
          {
            label: "Share status",
            value: toDisplayValue(portfolioManagerLinkage["shareStatus"]),
          },
          { label: "Sync status", value: toDisplayValue(portfolioManagerLinkage["syncStatus"]) },
          {
            label: "Last successful sync",
            value: toDisplayValue(portfolioManagerLinkage["lastSuccessfulSyncAt"]),
          },
          {
            label: "Sync diagnostics",
            value: toDisplayValue(portfolioManagerLinkage["syncErrorMessage"]),
          },
        ],
      },
      {
        title: "DC Real Property Unique ID",
        entries: [
          {
            label: "Current value",
            value: toDisplayValue(buildingIdentity["dcRealPropertyUniqueId"]),
          },
          {
            label: "State",
            value: toDisplayValue(readinessSummary["propertyIdState"]),
          },
        ],
      },
      {
        title: "Annual data coverage summary",
        entries: [
          {
            label: "Annual completeness",
            value: toDisplayValue(coverageAnalysis["annualCompleteness"]),
          },
          {
            label: "Missing streams",
            value: toDisplayValue(coverageAnalysis["missingCoverageStreams"]),
          },
          {
            label: "Overlap streams",
            value: toDisplayValue(coverageAnalysis["overlapStreams"]),
          },
        ],
        table: {
          columns: ["Stream", "Coverage state", "Notes"],
          rows: toArray(coverageAnalysis["streamCoverage"]).map((entry) => {
            const record = toRecord(entry);
            return [
              toDisplayValue(record["streamName"] ?? record["stream"]),
              toDisplayValue(record["status"] ?? record["coverageState"]),
              toDisplayValue(record["notes"] ?? record["detail"]),
            ];
          }),
        },
      },
      {
        title: "Meter inventory summary",
        entries: [
          {
            label: "Total meters",
            value: toDisplayValue(meterInventory["totalMeters"]),
          },
          {
            label: "Active meters",
            value: toDisplayValue(meterInventory["activeMeters"]),
          },
        ],
        table: {
          columns: ["Meter", "Type", "Unit", "ESPM meter", "Active"],
          rows: meterRows.length > 0 ? meterRows : [["No meters found", "-", "-", "-", "-"]],
        },
      },
      {
        title: "Data Quality Checker state",
        entries: [
          { label: "Freshness state", value: toDisplayValue(dataQualityChecker["state"]) },
          {
            label: "Latest evidence",
            value: toDisplayValue(dataQualityChecker["latestEvidenceName"]),
          },
          {
            label: "Latest evidence date",
            value: toDisplayValue(dataQualityChecker["latestEvidenceAt"]),
          },
        ],
      },
      {
        title: "Verification summary",
        entries: [
          { label: "Passed", value: toDisplayValue(verificationCounts["passedCount"]) },
          { label: "Failed", value: toDisplayValue(verificationCounts["failedCount"]) },
          {
            label: "Needs review",
            value: toDisplayValue(verificationCounts["needsReviewCount"]),
          },
        ],
        table: {
          columns: ["Check", "Status", "Explanation", "Evidence"],
          rows:
            verificationRows.length > 0
              ? verificationRows
              : [["No verification items", "-", "-", "-"]],
        },
      },
      {
        title: "Verification request and checklist summary",
        entries: [
          { label: "Total items", value: toDisplayValue(requestSummary["total"]) },
          { label: "Required", value: toDisplayValue(requestSummary["required"]) },
          { label: "Verified", value: toDisplayValue(requestSummary["verified"]) },
          { label: "Outstanding", value: toDisplayValue(requestSummary["outstanding"]) },
        ],
        table: {
          columns: ["Title", "Category", "Status", "Required", "Due"],
          rows:
            requestRows.length > 0
              ? requestRows
              : [["No request items", "-", "-", "-", "-"]],
        },
      },
      {
        title: "Blockers and warnings",
        bullets:
          blockers.length > 0 || warnings.length > 0
            ? [...blockers, ...warnings]
            : ["No blockers or warnings are currently recorded."],
      },
      {
        title: "Evidence manifest",
        table: {
          columns: ["Manifest type", "Name", "Source", "Created"],
          rows:
            evidenceRows.length > 0
              ? evidenceRows
              : [["No linked evidence", "-", "-", "-"]],
        },
      },
      {
        title: "Governance and generation metadata",
        entries: [
          { label: "Rule package", value: toDisplayValue(readinessGovernance["rulePackageKey"]) },
          { label: "Rule version", value: toDisplayValue(readinessGovernance["ruleVersion"]) },
          { label: "Factor set", value: toDisplayValue(readinessGovernance["factorSetKey"]) },
          {
            label: "Factor set version",
            value: toDisplayValue(readinessGovernance["factorSetVersion"]),
          },
          { label: "Packet hash", value: toDisplayValue(packet["packetHash"]) },
        ],
      },
    ],
  };
}

function renderBenchmarkPacketMarkdown(
  packetExport: ReturnType<typeof buildBenchmarkPacketExportDocument>,
) {
  const packet = toRecord(packetExport.packet);
  const packetSummary = toRecord(packetExport.packetSummary);
  const buildingIdentity = toRecord(packetExport.buildingIdentity);
  const reportingContext = toRecord(packetExport.reportingContext);
  const pmLinkage = toRecord(packetExport.portfolioManagerLinkage);
  const dqcState = toRecord(packetExport.dataQualityChecker);
  const verificationSummary = toRecord(packetExport.verificationSummary);
  const verificationCounts = toRecord(verificationSummary["summary"]);
  const verificationItems = toArray(verificationSummary["items"]);

  return [
    "# Benchmark Verification Packet",
    "",
    "## Packet",
    `- Packet ID: ${packet["id"] ?? ""}`,
    `- Version: ${packet["version"] ?? ""}`,
    `- Status: ${packet["status"] ?? ""}`,
    `- Disposition: ${packetSummary["disposition"] ?? ""}`,
    `- Generated At: ${packet["generatedAt"] ?? ""}`,
    `- Finalized At: ${packet["finalizedAt"] ?? "None"}`,
    "",
    "## Building and Reporting Context",
    `- Building: ${buildingIdentity["buildingName"] ?? ""}`,
    `- Address: ${buildingIdentity["address"] ?? ""}`,
    `- Reporting Year: ${reportingContext["reportingYear"] ?? ""}`,
    `- Portfolio Manager Property: ${pmLinkage["propertyId"] ?? "None"}`,
    `- DC Real Property Unique ID: ${buildingIdentity["dcRealPropertyUniqueId"] ?? "None"}`,
    "",
    "## Data Quality Checker",
    `- Freshness State: ${dqcState["state"] ?? ""}`,
    `- Latest Evidence: ${dqcState["latestEvidenceName"] ?? "None"}`,
    "",
    "## Verification Summary",
    `- Passed: ${verificationCounts["passedCount"] ?? 0}`,
    `- Failed: ${verificationCounts["failedCount"] ?? 0}`,
    `- Needs Review: ${verificationCounts["needsReviewCount"] ?? 0}`,
    ...verificationItems.map((entry) => {
      const record = toRecord(entry);
      return `- ${record["category"] ?? "CHECK"}: ${record["status"] ?? ""} - ${record["explanation"] ?? ""}`;
    }),
    "",
    "## Next Recommended Actions",
    ...buildBenchmarkNextActions(packetExport).map((action) => `- ${action}`),
    "",
    "## Structured Packet Data",
    "```json",
    stringifyDeterministicJson(packetExport),
    "```",
    "",
  ].join("\n");
}

export async function exportBenchmarkPacket(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
  format: BenchmarkPacketExportFormat;
  createdByType?: ActorType;
  createdById?: string | null;
  requestId?: string | null;
}) {
  const logger = createLogger({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    procedure: "benchmarkPackets.export",
  });
  const packet = await getLatestBenchmarkPacket(params);
  if (!packet) {
    throw new ComplianceProvenanceError("Benchmark packet not found for export");
  }

  const packetExport = buildBenchmarkPacketExportDocument(packet);
  const buildingIdentity = toRecord(packetExport.buildingIdentity);
  const baseFileName = [
    slugifyFileSegment(buildingIdentity["buildingName"] as string | undefined),
    params.reportingYear,
    `benchmark-packet-v${packet.version}`,
  ].join("_");

  if (params.format === "MARKDOWN") {
    const result = {
      packetId: packet.id,
      version: packet.version,
      status: packet.status,
      packetHash: packet.packetHash,
      format: "MARKDOWN" as const,
      fileName: `${baseFileName}.md`,
      contentType: "text/markdown",
      encoding: "utf-8" as const,
      content: renderBenchmarkPacketMarkdown(packetExport),
    };

    await createAuditLog({
      actorType: params.createdByType ?? "SYSTEM",
      actorId: params.createdById ?? null,
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      action: "COMPLIANCE_ARTIFACT_EXPORTED",
      inputSnapshot: {
        artifactType: "BENCHMARK_VERIFICATION_PACKET",
        packetId: packet.id,
        version: packet.version,
        format: params.format,
      },
      outputSnapshot: {
        fileName: result.fileName,
        contentType: result.contentType,
        packetHash: packet.packetHash,
      },
      requestId: params.requestId ?? null,
    });

    return result;
  }

  if (params.format === "PDF") {
    try {
      const content = await renderPacketDocumentPdfBase64(
        buildBenchmarkPacketRenderDocument(packetExport),
      );

      const result = {
        packetId: packet.id,
        version: packet.version,
        status: packet.status,
        packetHash: packet.packetHash,
        format: "PDF" as const,
        fileName: `${baseFileName}.pdf`,
        contentType: "application/pdf",
        encoding: "base64" as const,
        content,
      };

      await createAuditLog({
        actorType: params.createdByType ?? "SYSTEM",
        actorId: params.createdById ?? null,
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        action: "COMPLIANCE_ARTIFACT_EXPORTED",
        inputSnapshot: {
          artifactType: "BENCHMARK_VERIFICATION_PACKET",
          packetId: packet.id,
          version: packet.version,
          format: params.format,
        },
        outputSnapshot: {
          fileName: result.fileName,
          contentType: result.contentType,
          packetHash: packet.packetHash,
        },
        requestId: params.requestId ?? null,
      });

      return result;
    } catch (error) {
      logger.error("Benchmark packet PDF export failed", {
        error,
        packetId: packet.id,
        reportingYear: params.reportingYear,
        format: params.format,
      });
      throw new PacketExportError("Benchmark packet PDF export failed.", {
        details: {
          packetId: packet.id,
          reportingYear: params.reportingYear,
          format: params.format,
        },
        cause: error,
      });
    }
  }

  const result = {
    packetId: packet.id,
    version: packet.version,
    status: packet.status,
    packetHash: packet.packetHash,
    format: "JSON" as const,
    fileName: `${baseFileName}.json`,
    contentType: "application/json",
    encoding: "utf-8" as const,
    content: stringifyDeterministicJson(packetExport),
  };

  await createAuditLog({
    actorType: params.createdByType ?? "SYSTEM",
    actorId: params.createdById ?? null,
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    action: "COMPLIANCE_ARTIFACT_EXPORTED",
    inputSnapshot: {
      artifactType: "BENCHMARK_VERIFICATION_PACKET",
      packetId: packet.id,
      version: packet.version,
      format: params.format,
    },
    outputSnapshot: {
      fileName: result.fileName,
      contentType: result.contentType,
      packetHash: packet.packetHash,
    },
    requestId: params.requestId ?? null,
  });

  return result;
}

export function getBenchmarkPacketStatusDisplay(status: BenchmarkPacketStatus | "NONE") {
  switch (status) {
    case "FINALIZED":
      return { label: "Finalized", tone: "success" as const };
    case "GENERATED":
      return { label: "Generated", tone: "info" as const };
    case "STALE":
      return { label: "Needs refresh", tone: "warning" as const };
    case "DRAFT":
      return { label: "Draft", tone: "muted" as const };
    default:
      return { label: "Not started", tone: "muted" as const };
  }
}
