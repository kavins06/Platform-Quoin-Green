import type {
  ActorType,
  BenchmarkSubmissionStatus,
} from "@/generated/prisma/client";
import { createLogger } from "@/server/lib/logger";
import { evaluateBenchmarkingComplianceForBuilding } from "./compliance-engine";
import { refreshBenchmarkingDataIssues } from "./data-issues";
import {
  type EvidenceArtifactDraft,
  upsertBenchmarkSubmissionRecord,
} from "./provenance";
import { evaluateVerification } from "./verification-engine";

export {
  BENCHMARK_FINDING_CODES,
  evaluateBenchmarkReadinessData,
  normalizeBenchmarkFactorConfig,
  normalizeBenchmarkRuleConfig,
  type BenchmarkApplicabilityBandConfig,
  type BenchmarkBuildingInput,
  type BenchmarkEvidenceInput,
  type BenchmarkFactorConfig,
  type BenchmarkFinding,
  type BenchmarkFindingCode,
  type BenchmarkReadinessResult,
  type BenchmarkReadingInput,
  type BenchmarkRuleConfig,
  type BenchmarkSubmissionContext,
} from "./benchmarking-core";

export async function evaluateBenchmarkingReadiness(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
  submissionContext?: import("./benchmarking-core").BenchmarkSubmissionContext | null;
  producedByType: ActorType;
  producedById?: string | null;
  requestId?: string | null;
}) {
  return evaluateBenchmarkingComplianceForBuilding({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    reportingYear: params.reportingYear,
    submissionContext: params.submissionContext ?? null,
    producedByType: params.producedByType,
    producedById: params.producedById ?? null,
    requestId: params.requestId ?? null,
  });
}

export async function evaluateAndUpsertBenchmarkSubmission(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
  submissionContext?: import("./benchmarking-core").BenchmarkSubmissionContext | null;
  explicitStatus?: BenchmarkSubmissionStatus | null;
  submittedAt?: Date | null;
  producedByType: ActorType;
  producedById?: string | null;
  requestId?: string | null;
  additionalSubmissionPayload?: Record<string, unknown>;
  evidenceArtifacts?: EvidenceArtifactDraft[];
}) {
  const logger = createLogger({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    procedure: "benchmarking.evaluateAndUpsert",
    requestId: params.requestId ?? null,
  });
  const evaluation = await evaluateBenchmarkingComplianceForBuilding({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    reportingYear: params.reportingYear,
    submissionContext: params.submissionContext ?? null,
    producedByType: params.producedByType,
    producedById: params.producedById ?? null,
    requestId: params.requestId ?? null,
  });

  const derivedStatus =
    evaluation.engineResult.status === "BLOCKED" || evaluation.readiness.status !== "READY"
      ? "BLOCKED"
      : "READY";
  const status = params.explicitStatus ?? derivedStatus;
  const submissionPayload = {
    readiness: evaluation.readiness,
    complianceEngine: evaluation.engineResult,
    ...(params.additionalSubmissionPayload ?? {}),
    ...(params.submissionContext?.gfaCorrectionRequired !== undefined
      ? {
          benchmarkingContext: {
            gfaCorrectionRequired: params.submissionContext.gfaCorrectionRequired,
          },
        }
      : {}),
  };

  const benchmarkSubmission = await upsertBenchmarkSubmissionRecord({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    reportingYear: params.reportingYear,
    ruleVersionId: evaluation.ruleVersion.id,
    factorSetVersionId: evaluation.factorSetVersion.id,
    complianceRunId: evaluation.provenance.complianceRun.id,
    status,
    readinessEvaluatedAt: new Date(evaluation.readiness.evaluatedAt),
    submissionPayload,
    submittedAt: params.submittedAt ?? null,
    createdByType: params.producedByType,
    createdById: params.producedById ?? null,
    evidenceArtifacts: params.evidenceArtifacts,
  });

  const verification = await evaluateVerification({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    reportingYear: params.reportingYear,
  });

  const readinessSummary = await refreshBenchmarkingDataIssues({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    reportingYear: params.reportingYear,
    engineResult: evaluation.engineResult,
    verification,
    actorType: params.producedByType,
    actorId: params.producedById ?? null,
    requestId: params.requestId ?? null,
  });

  logger.info("Benchmark submission refreshed", {
    reportingYear: params.reportingYear,
    status: benchmarkSubmission.status,
    readinessStatus: evaluation.readiness.status,
    benchmarkSubmissionId: benchmarkSubmission.id,
    complianceRunId: evaluation.provenance.complianceRun.id,
    submissionReadinessState: readinessSummary.state,
  });

  return {
    benchmarkSubmission,
    readiness: evaluation.readiness,
    provenance: evaluation.provenance,
    engineResult: evaluation.engineResult,
  };
}
