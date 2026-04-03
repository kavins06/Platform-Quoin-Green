import type { BenchmarkPacketStatus } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import {
  getBenchmarkPacketManifest,
  getLatestBenchmarkPacket,
} from "@/server/compliance/benchmark-packets";
import {
  getSubmissionWorkflowDetailById,
  type SubmissionWorkflowDetail,
} from "@/server/compliance/submission-workflows";
import { getBuildingGovernedOperationalSummary } from "@/server/compliance/governed-operational-summary";
import { type BuildingReadinessState } from "@/server/compliance/data-issues";

export type OperationalArtifactKind = "BENCHMARK_VERIFICATION_PACKET";
export type OperationalArtifactStatus = BenchmarkPacketStatus | "NOT_STARTED";
export type ArtifactExportFormat = "JSON" | "MARKDOWN" | "PDF";

interface ArtifactExportMetadata {
  exportedAt: string | null;
  format: ArtifactExportFormat | null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface OperationalArtifactVersion {
  id: string;
  version: number;
  status: OperationalArtifactStatus;
  packetHash: string;
  generatedAt: string;
  finalizedAt: string | null;
  exportAvailable: boolean;
  lastExportedAt: string | null;
  lastExportFormat: ArtifactExportFormat | null;
}

export interface OperationalArtifactLatestExport {
  artifactId: string;
  version: number;
  exportedAt: string;
  format: ArtifactExportFormat | null;
}

export interface OperationalArtifactSourceContext {
  readinessState: BuildingReadinessState;
  primaryStatus: string;
  qaVerdict: string | null;
  reasonSummary: string;
  reportingYear: number | null;
  complianceRunId: string | null;
  readinessEvaluatedAt: string | null;
  complianceEvaluatedAt: string | null;
}

export interface OperationalArtifactWorkflow {
  kind: OperationalArtifactKind;
  label: string;
  packetType: null;
  sourceRecordId: string | null;
  status: OperationalArtifactStatus;
  disposition: string | null;
  canGenerate: boolean;
  canFinalize: boolean;
  exportFormats: ArtifactExportFormat[];
  latestArtifact: OperationalArtifactVersion | null;
  latestExport: OperationalArtifactLatestExport | null;
  history: OperationalArtifactVersion[];
  submissionWorkflow: SubmissionWorkflowDetail | null;
  blockersCount: number;
  warningCount: number;
  sourceContext: OperationalArtifactSourceContext;
}

export interface BuildingArtifactWorkspace {
  buildingId: string;
  benchmarkVerification: OperationalArtifactWorkflow;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function getExportMetadataByPacketId(
  auditLogs: Array<{
    timestamp: Date;
    inputSnapshot: unknown;
  }>,
) {
  const exportMetadata = new Map<string, ArtifactExportMetadata>();

  for (const log of auditLogs) {
    const inputSnapshot = toRecord(log.inputSnapshot);
    const packetId = asString(inputSnapshot["packetId"]);
    const format = asString(inputSnapshot["format"]);
    if (!packetId || exportMetadata.has(packetId)) {
      continue;
    }

    const exportFormat =
      format === "JSON" || format === "MARKDOWN" || format === "PDF"
        ? format
        : null;

    exportMetadata.set(packetId, {
      exportedAt: log.timestamp.toISOString(),
      format: exportFormat,
    });
  }

  return exportMetadata;
}

function buildArtifactVersion(
  packet: {
    id: string;
    version: number;
    status: OperationalArtifactStatus;
    packetHash: string;
    generatedAt: Date;
    finalizedAt: Date | null;
  },
  exportMetadataByPacketId: Map<string, ArtifactExportMetadata>,
): OperationalArtifactVersion {
  const exportMetadata = exportMetadataByPacketId.get(packet.id);

  return {
    id: packet.id,
    version: packet.version,
    status: packet.status,
    packetHash: packet.packetHash,
    generatedAt: packet.generatedAt.toISOString(),
    finalizedAt: toIso(packet.finalizedAt),
    exportAvailable: true,
    lastExportedAt: exportMetadata?.exportedAt ?? null,
    lastExportFormat: exportMetadata?.format ?? null,
  };
}

function buildLatestExportSummary(
  versions: OperationalArtifactVersion[],
): OperationalArtifactLatestExport | null {
  const latestExportedVersion = versions
    .filter((version) => version.lastExportedAt)
    .sort((left, right) =>
      (right.lastExportedAt ?? "").localeCompare(left.lastExportedAt ?? ""),
    )[0];

  if (!latestExportedVersion?.lastExportedAt) {
    return null;
  }

  return {
    artifactId: latestExportedVersion.id,
    version: latestExportedVersion.version,
    exportedAt: latestExportedVersion.lastExportedAt,
    format: latestExportedVersion.lastExportFormat,
  };
}

function buildSourceContext(
  governedSummary: Awaited<ReturnType<typeof getBuildingGovernedOperationalSummary>>,
): OperationalArtifactSourceContext {
  const readiness = governedSummary.readinessSummary;

  return {
    readinessState: readiness.state,
    primaryStatus: readiness.primaryStatus,
    qaVerdict: readiness.qaVerdict,
    reasonSummary: readiness.reasonSummary,
    reportingYear: readiness.evaluations.benchmark?.reportingYear ?? null,
    complianceRunId: readiness.evaluations.benchmark?.complianceRunId ?? null,
    readinessEvaluatedAt: readiness.lastReadinessEvaluatedAt,
    complianceEvaluatedAt: readiness.evaluations.benchmark?.lastComplianceEvaluatedAt ?? null,
  };
}

export async function getBuildingArtifactWorkspace(params: {
  organizationId: string;
  buildingId: string;
}): Promise<BuildingArtifactWorkspace> {
  const governedSummary = await getBuildingGovernedOperationalSummary({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
  });

  const benchmarkSubmissionId =
    governedSummary.readinessSummary.artifacts.benchmarkSubmission?.id ?? null;
  const benchmarkReportingYear =
    governedSummary.readinessSummary.artifacts.benchmarkSubmission?.reportingYear ??
    governedSummary.readinessSummary.evaluations.benchmark?.reportingYear ??
    null;

  const [benchmarkHistory, benchmarkManifest, benchmarkLatest, auditLogs, benchmarkWorkflow] =
    await Promise.all([
      benchmarkSubmissionId
        ? prisma.benchmarkPacket.findMany({
            where: {
              organizationId: params.organizationId,
              buildingId: params.buildingId,
              benchmarkSubmissionId,
            },
            orderBy: [{ version: "desc" }, { generatedAt: "desc" }],
            take: 8,
            select: {
              id: true,
              version: true,
              status: true,
              packetHash: true,
              generatedAt: true,
              finalizedAt: true,
            },
          })
        : Promise.resolve([]),
      benchmarkReportingYear != null
        ? getBenchmarkPacketManifest({
            organizationId: params.organizationId,
            buildingId: params.buildingId,
            reportingYear: benchmarkReportingYear,
          })
        : Promise.resolve(null),
      benchmarkReportingYear != null
        ? getLatestBenchmarkPacket({
            organizationId: params.organizationId,
            buildingId: params.buildingId,
            reportingYear: benchmarkReportingYear,
          })
        : Promise.resolve(null),
      prisma.auditLog.findMany({
        where: {
          organizationId: params.organizationId,
          buildingId: params.buildingId,
          action: "COMPLIANCE_ARTIFACT_EXPORTED",
        },
        orderBy: [{ timestamp: "desc" }],
        take: 100,
        select: {
          timestamp: true,
          inputSnapshot: true,
        },
      }),
      governedSummary.submissionSummary.benchmark?.id
        ? getSubmissionWorkflowDetailById({
            organizationId: params.organizationId,
            workflowId: governedSummary.submissionSummary.benchmark.id,
          })
        : Promise.resolve(null),
    ]);

  const exportMetadataByPacketId = getExportMetadataByPacketId(auditLogs);

  const benchmarkVersions = benchmarkHistory.map((packet) =>
    buildArtifactVersion(packet, exportMetadataByPacketId),
  );

  const benchmarkLatestVersion = benchmarkLatest
    ? buildArtifactVersion(benchmarkLatest, exportMetadataByPacketId)
    : null;

  return {
    buildingId: params.buildingId,
    benchmarkVerification: {
      kind: "BENCHMARK_VERIFICATION_PACKET",
      label: "Benchmark verification artifact",
      packetType: null,
      sourceRecordId: benchmarkSubmissionId,
      status: benchmarkLatest?.status ?? "NOT_STARTED",
      disposition:
        benchmarkManifest && typeof benchmarkManifest.disposition === "string"
          ? benchmarkManifest.disposition
          : null,
      canGenerate: benchmarkReportingYear != null && benchmarkSubmissionId != null,
      canFinalize:
        benchmarkLatest?.status === "GENERATED" &&
        benchmarkManifest?.disposition !== "BLOCKED",
      exportFormats: ["JSON", "MARKDOWN", "PDF"],
      latestArtifact: benchmarkLatestVersion,
      latestExport: buildLatestExportSummary(benchmarkVersions),
      history: benchmarkVersions,
      submissionWorkflow: benchmarkWorkflow,
      blockersCount: Array.isArray(benchmarkManifest?.blockers)
        ? benchmarkManifest.blockers.length
        : 0,
      warningCount: Array.isArray(benchmarkManifest?.warnings)
        ? benchmarkManifest.warnings.length
        : 0,
      sourceContext: buildSourceContext(governedSummary),
    },
  };
}
