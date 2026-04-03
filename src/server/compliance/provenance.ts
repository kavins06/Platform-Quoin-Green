import { Prisma, type ActorType, type ComplianceCycle } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { hashDeterministicJson } from "@/server/lib/deterministic-json";
import type { BuildingSelectedPathwayValue } from "@/lib/contracts/beps";

export const BOOTSTRAP_RULE_PACKAGE_KEYS = {
  benchmarking2025: "DC_BENCHMARKING_2025",
  bepsCycle1: "DC_BEPS_CYCLE_1",
  bepsCycle2: "DC_BEPS_CYCLE_2",
} as const;

export const BOOTSTRAP_FACTOR_SET_KEY = "DC_CURRENT_STANDARDS";

export class ComplianceProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComplianceProvenanceError";
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function resolveCodeVersion(explicitCodeVersion?: string) {
  return (
    explicitCodeVersion ??
    process.env["VERCEL_GIT_COMMIT_SHA"] ??
    process.env["GITHUB_SHA"] ??
    "dev"
  );
}

export interface CreateRuleVersionInput {
  rulePackageId: string;
  version: string;
  status?: "DRAFT" | "CANDIDATE" | "ACTIVE" | "SUPERSEDED";
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  implementationKey: string;
  sourceArtifactId?: string | null;
  sourceMetadata?: Record<string, unknown>;
  configJson?: Record<string, unknown>;
}

export async function createRuleVersion(input: CreateRuleVersionInput) {
  return prisma.$transaction(async (tx) => {
    const rulePackage = await tx.rulePackage.findUnique({
      where: { id: input.rulePackageId },
      select: { id: true },
    });
    if (!rulePackage) {
      throw new ComplianceProvenanceError("Rule package not found");
    }

    if (input.sourceArtifactId) {
      const sourceArtifact = await tx.sourceArtifact.findUnique({
        where: { id: input.sourceArtifactId },
        select: { id: true },
      });
      if (!sourceArtifact) {
        throw new ComplianceProvenanceError("Rule source artifact not found");
      }
    }

    if (input.status === "ACTIVE") {
      await tx.ruleVersion.updateMany({
        where: {
          rulePackageId: input.rulePackageId,
          status: "ACTIVE",
        },
        data: {
          status: "SUPERSEDED",
        },
      });
    }

    return tx.ruleVersion.create({
      data: {
        rulePackageId: input.rulePackageId,
        version: input.version,
        status: input.status ?? "DRAFT",
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        implementationKey: input.implementationKey,
        sourceArtifactId: input.sourceArtifactId ?? null,
        sourceMetadata: toJson(input.sourceMetadata ?? {}),
        configJson: toJson(input.configJson ?? {}),
      },
    });
  });
}

export interface CreateFactorSetVersionInput {
  key: string;
  version: string;
  status?: "DRAFT" | "CANDIDATE" | "ACTIVE" | "SUPERSEDED";
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  sourceArtifactId?: string | null;
  sourceMetadata?: Record<string, unknown>;
  factorsJson?: Record<string, unknown>;
}

export async function createFactorSetVersion(input: CreateFactorSetVersionInput) {
  return prisma.$transaction(async (tx) => {
    if (input.sourceArtifactId) {
      const sourceArtifact = await tx.sourceArtifact.findUnique({
        where: { id: input.sourceArtifactId },
        select: { id: true },
      });
      if (!sourceArtifact) {
        throw new ComplianceProvenanceError("Factor set source artifact not found");
      }
    }

    if (input.status === "ACTIVE") {
      await tx.factorSetVersion.updateMany({
        where: {
          key: input.key,
          status: "ACTIVE",
        },
        data: {
          status: "SUPERSEDED",
        },
      });
    }

    return tx.factorSetVersion.create({
      data: {
        key: input.key,
        version: input.version,
        status: input.status ?? "DRAFT",
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        sourceArtifactId: input.sourceArtifactId ?? null,
        sourceMetadata: toJson(input.sourceMetadata ?? {}),
        factorsJson: toJson(input.factorsJson ?? {}),
      },
    });
  });
}

export async function getActiveRuleVersion(rulePackageKey: string, effectiveAt = new Date()) {
  const rulePackage = await prisma.rulePackage.findUnique({
    where: { key: rulePackageKey },
    select: { id: true },
  });

  if (!rulePackage) {
    throw new ComplianceProvenanceError(
      `No rule package found for key ${rulePackageKey}`,
    );
  }

  return getActiveRuleVersionByPackageId(rulePackage.id, effectiveAt);
}

export async function getActiveRuleVersionByPackageId(
  rulePackageId: string,
  effectiveAt = new Date(),
) {
  const version = await prisma.ruleVersion.findFirst({
    where: {
      rulePackageId,
      status: "ACTIVE",
      effectiveFrom: { lte: effectiveAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });

  if (!version) {
    throw new ComplianceProvenanceError(
      `No active rule version found for rule package ${rulePackageId}`,
    );
  }

  return version;
}

export async function getActiveFactorSetVersion(factorSetKey: string, effectiveAt = new Date()) {
  const version = await prisma.factorSetVersion.findFirst({
    where: {
      key: factorSetKey,
      status: "ACTIVE",
      effectiveFrom: { lte: effectiveAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });

  if (!version) {
    throw new ComplianceProvenanceError(
      `No active factor set found for key ${factorSetKey}`,
    );
  }

  return version;
}

export interface ProvenanceSnapshotData {
  triggerType: "PIPELINE_RUN" | "ESPM_SYNC" | "MANUAL" | "SCORE_CHANGE";
  pipelineRunId?: string | null;
  energyStarScore?: number | null;
  siteEui?: number | null;
  sourceEui?: number | null;
  weatherNormalizedSiteEui?: number | null;
  weatherNormalizedSourceEui?: number | null;
  complianceStatus: "COMPLIANT" | "AT_RISK" | "NON_COMPLIANT" | "EXEMPT" | "PENDING_DATA";
  complianceGap?: number | null;
  estimatedPenalty?: number | null;
  dataQualityScore?: number | null;
  activePathway?: BuildingSelectedPathwayValue | null;
  targetScore?: number | null;
  targetEui?: number | null;
  penaltyInputsJson?: Record<string, unknown> | null;
}

export interface EvidenceArtifactDraft {
  artifactType: "CALCULATION_OUTPUT" | "ENERGY_DATA" | "PM_REPORT" | "OWNER_ATTESTATION" | "SYSTEM_NOTE" | "OTHER";
  name: string;
  artifactRef?: string | null;
  metadata?: Record<string, unknown>;
  sourceArtifactId?: string | null;
}

export interface RecordComplianceEvaluationInput {
  organizationId: string;
  buildingId: string;
  ruleVersionId: string;
  factorSetVersionId: string;
  pipelineRunId?: string | null;
  runType: "SNAPSHOT_REFRESH" | "BENCHMARKING_EVALUATION" | "BEPS_EVALUATION";
  status?: "PENDING" | "SUCCEEDED" | "FAILED";
  inputSnapshotRef: string;
  inputSnapshotPayload: Record<string, unknown>;
  resultPayload: Record<string, unknown>;
  producedByType: ActorType;
  producedById?: string | null;
  manifest: {
    implementationKey: string;
    codeVersion?: string;
    payload?: Record<string, unknown>;
    executedAt?: Date;
  };
  snapshotData?: ProvenanceSnapshotData;
  evidenceArtifacts?: EvidenceArtifactDraft[];
}

export async function recordComplianceEvaluation(input: RecordComplianceEvaluationInput) {
  const inputSnapshotHash = hashDeterministicJson(input.inputSnapshotPayload);
  const executedAt = input.manifest.executedAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    const building = await tx.building.findFirst({
      where: {
        id: input.buildingId,
        organizationId: input.organizationId,
      },
      select: { id: true, organizationId: true },
    });
    if (!building) {
      throw new ComplianceProvenanceError("Building not found for organization");
    }

    const ruleVersion = await tx.ruleVersion.findUnique({
      where: { id: input.ruleVersionId },
      select: { id: true },
    });
    if (!ruleVersion) {
      throw new ComplianceProvenanceError("Rule version not found");
    }

    const factorSetVersion = await tx.factorSetVersion.findUnique({
      where: { id: input.factorSetVersionId },
      select: { id: true },
    });
    if (!factorSetVersion) {
      throw new ComplianceProvenanceError("Factor set version not found");
    }

    if (input.pipelineRunId) {
      const pipelineRun = await tx.pipelineRun.findFirst({
        where: {
          id: input.pipelineRunId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          buildingId: true,
        },
      });
      if (!pipelineRun || pipelineRun.buildingId !== input.buildingId) {
        throw new ComplianceProvenanceError("Pipeline run does not match building scope");
      }
    }

    const complianceRun = await tx.complianceRun.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        ruleVersionId: input.ruleVersionId,
        factorSetVersionId: input.factorSetVersionId,
        pipelineRunId: input.pipelineRunId ?? null,
        runType: input.runType,
        status: input.status ?? "SUCCEEDED",
        inputSnapshotRef: input.inputSnapshotRef,
        inputSnapshotHash,
        resultPayload: toJson(input.resultPayload),
        producedByType: input.producedByType,
        producedById: input.producedById ?? null,
        executedAt,
      },
    });

    const manifest = await tx.calculationManifest.create({
      data: {
        complianceRunId: complianceRun.id,
        ruleVersionId: input.ruleVersionId,
        factorSetVersionId: input.factorSetVersionId,
        codeVersion: resolveCodeVersion(input.manifest.codeVersion),
        implementationKey: input.manifest.implementationKey,
        inputSnapshotRef: input.inputSnapshotRef,
        inputSnapshotHash,
        manifestPayload: toJson(input.manifest.payload ?? {}),
        executedAt,
      },
    });

    let complianceSnapshot = null;
    if (input.snapshotData) {
      complianceSnapshot = await tx.complianceSnapshot.create({
        data: {
          buildingId: input.buildingId,
          organizationId: input.organizationId,
          pipelineRunId: input.snapshotData.pipelineRunId ?? input.pipelineRunId ?? null,
          complianceRunId: complianceRun.id,
          triggerType: input.snapshotData.triggerType,
          energyStarScore: input.snapshotData.energyStarScore ?? null,
          siteEui: input.snapshotData.siteEui ?? null,
          sourceEui: input.snapshotData.sourceEui ?? null,
          weatherNormalizedSiteEui: input.snapshotData.weatherNormalizedSiteEui ?? null,
          weatherNormalizedSourceEui:
            input.snapshotData.weatherNormalizedSourceEui ?? null,
          complianceStatus: input.snapshotData.complianceStatus,
          complianceGap: input.snapshotData.complianceGap ?? null,
          estimatedPenalty: input.snapshotData.estimatedPenalty ?? null,
          dataQualityScore: input.snapshotData.dataQualityScore ?? null,
          activePathway: input.snapshotData.activePathway ?? null,
          targetScore: input.snapshotData.targetScore ?? null,
          targetEui: input.snapshotData.targetEui ?? null,
          penaltyInputsJson: toJson(input.snapshotData.penaltyInputsJson ?? {}),
        },
      });
    }

    const artifactsToCreate: EvidenceArtifactDraft[] = [
      {
        artifactType: "CALCULATION_OUTPUT",
        name: "Compliance run result payload",
        artifactRef: complianceSnapshot
          ? `compliance_snapshot:${complianceSnapshot.id}`
          : `compliance_run:${complianceRun.id}`,
        metadata: {
          complianceRunId: complianceRun.id,
          complianceSnapshotId: complianceSnapshot?.id ?? null,
        },
      },
      ...(input.evidenceArtifacts ?? []),
    ];

    if (artifactsToCreate.length > 0) {
      for (const artifact of artifactsToCreate) {
        if (artifact.sourceArtifactId) {
          const sourceArtifact = await tx.sourceArtifact.findUnique({
            where: { id: artifact.sourceArtifactId },
            select: { id: true },
          });
          if (!sourceArtifact) {
            throw new ComplianceProvenanceError("Evidence source artifact not found");
          }
        }

        await tx.evidenceArtifact.create({
          data: {
            organizationId: input.organizationId,
            buildingId: input.buildingId,
            complianceRunId: complianceRun.id,
            sourceArtifactId: artifact.sourceArtifactId ?? null,
            artifactType: artifact.artifactType,
            name: artifact.name,
            artifactRef: artifact.artifactRef ?? null,
            metadata: toJson(artifact.metadata ?? {}),
            createdByType: input.producedByType,
            createdById: input.producedById ?? null,
          },
        });
      }
    }

    return {
      complianceRun,
      manifest,
      complianceSnapshot,
    };
  });
}

export interface CreateBenchmarkSubmissionInput {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
  ruleVersionId: string;
  factorSetVersionId: string;
  complianceRunId?: string | null;
  status?: "DRAFT" | "IN_REVIEW" | "READY" | "BLOCKED" | "SUBMITTED" | "ACCEPTED" | "REJECTED";
  readinessEvaluatedAt?: Date | null;
  submissionPayload?: Record<string, unknown>;
  submittedAt?: Date | null;
  createdByType: ActorType;
  createdById?: string | null;
}

export async function createBenchmarkSubmissionRecord(input: CreateBenchmarkSubmissionInput) {
  return prisma.$transaction(async (tx) => {
    const building = await tx.building.findFirst({
      where: {
        id: input.buildingId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!building) {
      throw new ComplianceProvenanceError("Building not found for benchmark submission");
    }

    const [ruleVersion, factorSetVersion] = await Promise.all([
      tx.ruleVersion.findUnique({
        where: { id: input.ruleVersionId },
        select: { id: true },
      }),
      tx.factorSetVersion.findUnique({
        where: { id: input.factorSetVersionId },
        select: { id: true },
      }),
    ]);

    if (!ruleVersion) {
      throw new ComplianceProvenanceError("Rule version not found for benchmark submission");
    }
    if (!factorSetVersion) {
      throw new ComplianceProvenanceError("Factor set version not found for benchmark submission");
    }

    if (input.complianceRunId) {
      const complianceRun = await tx.complianceRun.findFirst({
        where: {
          id: input.complianceRunId,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
        },
        select: { id: true },
      });
      if (!complianceRun) {
        throw new ComplianceProvenanceError("Compliance run not found for benchmark submission");
      }
    }

    return tx.benchmarkSubmission.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        reportingYear: input.reportingYear,
        ruleVersionId: input.ruleVersionId,
        factorSetVersionId: input.factorSetVersionId,
        complianceRunId: input.complianceRunId ?? null,
        status: input.status ?? "DRAFT",
        readinessEvaluatedAt: input.readinessEvaluatedAt ?? null,
        submissionPayload: toJson(input.submissionPayload ?? {}),
        submittedAt: input.submittedAt ?? null,
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      },
    });
  });
}

export interface UpsertBenchmarkSubmissionInput extends CreateBenchmarkSubmissionInput {
  evidenceArtifacts?: EvidenceArtifactDraft[];
}

export async function upsertBenchmarkSubmissionRecord(input: UpsertBenchmarkSubmissionInput) {
  return prisma.$transaction(async (tx) => {
    const building = await tx.building.findFirst({
      where: {
        id: input.buildingId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!building) {
      throw new ComplianceProvenanceError("Building not found for benchmark submission");
    }

    const [ruleVersion, factorSetVersion] = await Promise.all([
      tx.ruleVersion.findUnique({
        where: { id: input.ruleVersionId },
        select: { id: true },
      }),
      tx.factorSetVersion.findUnique({
        where: { id: input.factorSetVersionId },
        select: { id: true },
      }),
    ]);

    if (!ruleVersion) {
      throw new ComplianceProvenanceError("Rule version not found for benchmark submission");
    }
    if (!factorSetVersion) {
      throw new ComplianceProvenanceError("Factor set version not found for benchmark submission");
    }

    if (input.complianceRunId) {
      const complianceRun = await tx.complianceRun.findFirst({
        where: {
          id: input.complianceRunId,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
        },
        select: { id: true },
      });
      if (!complianceRun) {
        throw new ComplianceProvenanceError("Compliance run not found for benchmark submission");
      }
    }

    const benchmarkSubmission = await tx.benchmarkSubmission.upsert({
      where: {
        buildingId_reportingYear: {
          buildingId: input.buildingId,
          reportingYear: input.reportingYear,
        },
      },
      create: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        reportingYear: input.reportingYear,
        ruleVersionId: input.ruleVersionId,
        factorSetVersionId: input.factorSetVersionId,
        complianceRunId: input.complianceRunId ?? null,
        status: input.status ?? "DRAFT",
        readinessEvaluatedAt: input.readinessEvaluatedAt ?? null,
        submissionPayload: toJson(input.submissionPayload ?? {}),
        submittedAt: input.submittedAt ?? null,
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      },
      update: {
        ruleVersionId: input.ruleVersionId,
        factorSetVersionId: input.factorSetVersionId,
        complianceRunId: input.complianceRunId ?? null,
        status: input.status ?? "DRAFT",
        readinessEvaluatedAt: input.readinessEvaluatedAt ?? null,
        submissionPayload: toJson(input.submissionPayload ?? {}),
        submittedAt: input.submittedAt ?? null,
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      },
    });

    for (const artifact of input.evidenceArtifacts ?? []) {
      if (artifact.sourceArtifactId) {
        const sourceArtifact = await tx.sourceArtifact.findUnique({
          where: { id: artifact.sourceArtifactId },
          select: { id: true },
        });
        if (!sourceArtifact) {
          throw new ComplianceProvenanceError("Evidence source artifact not found");
        }
      }

      await tx.evidenceArtifact.create({
        data: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          benchmarkSubmissionId: benchmarkSubmission.id,
          sourceArtifactId: artifact.sourceArtifactId ?? null,
          artifactType: artifact.artifactType,
          name: artifact.name,
          artifactRef: artifact.artifactRef ?? null,
          metadata: toJson(artifact.metadata ?? {}),
          createdByType: input.createdByType,
          createdById: input.createdById ?? null,
        },
      });
    }

    return benchmarkSubmission;
  });
}

export interface CreateFilingRecordInput {
  organizationId: string;
  buildingId: string;
  filingType: "BENCHMARKING" | "BEPS_COMPLIANCE" | "BEPS_EXEMPTION" | "BEPS_PATHWAY";
  filingYear?: number | null;
  complianceCycle?: ComplianceCycle | null;
  benchmarkSubmissionId?: string | null;
  complianceRunId?: string | null;
  status?: "DRAFT" | "GENERATED" | "FILED" | "ACCEPTED" | "REJECTED";
  filingPayload?: Record<string, unknown>;
  packetUri?: string | null;
  filedAt?: Date | null;
  createdByType: ActorType;
  createdById?: string | null;
}

export async function createFilingRecord(input: CreateFilingRecordInput) {
  return prisma.$transaction(async (tx) => {
    const building = await tx.building.findFirst({
      where: {
        id: input.buildingId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!building) {
      throw new ComplianceProvenanceError("Building not found for filing record");
    }

    if (input.benchmarkSubmissionId) {
      const benchmarkSubmission = await tx.benchmarkSubmission.findFirst({
        where: {
          id: input.benchmarkSubmissionId,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
        },
        select: { id: true },
      });
      if (!benchmarkSubmission) {
        throw new ComplianceProvenanceError("Benchmark submission not found for filing record");
      }
    }

    if (input.complianceRunId) {
      const complianceRun = await tx.complianceRun.findFirst({
        where: {
          id: input.complianceRunId,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
        },
        select: { id: true },
      });
      if (!complianceRun) {
        throw new ComplianceProvenanceError("Compliance run not found for filing record");
      }
    }

    return tx.filingRecord.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        filingType: input.filingType,
        filingYear: input.filingYear ?? null,
        complianceCycle: input.complianceCycle ?? null,
        benchmarkSubmissionId: input.benchmarkSubmissionId ?? null,
        complianceRunId: input.complianceRunId ?? null,
        status: input.status ?? "DRAFT",
        filingPayload: toJson(input.filingPayload ?? {}),
        packetUri: input.packetUri ?? null,
        filedAt: input.filedAt ?? null,
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      },
    });
  });
}

export interface UpsertFilingRecordInput extends CreateFilingRecordInput {
  evidenceArtifacts?: EvidenceArtifactDraft[];
}

export async function upsertFilingRecord(input: UpsertFilingRecordInput) {
  if (input.filingYear == null || input.complianceCycle == null) {
    throw new ComplianceProvenanceError(
      "Canonical filing upsert requires filingYear and complianceCycle",
    );
  }

  const filingYear = input.filingYear;
  const complianceCycle = input.complianceCycle;

  return prisma.$transaction(async (tx) => {
    const building = await tx.building.findFirst({
      where: {
        id: input.buildingId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!building) {
      throw new ComplianceProvenanceError("Building not found for filing record");
    }

    if (input.benchmarkSubmissionId) {
      const benchmarkSubmission = await tx.benchmarkSubmission.findFirst({
        where: {
          id: input.benchmarkSubmissionId,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
        },
        select: { id: true },
      });
      if (!benchmarkSubmission) {
        throw new ComplianceProvenanceError("Benchmark submission not found for filing record");
      }
    }

    if (input.complianceRunId) {
      const complianceRun = await tx.complianceRun.findFirst({
        where: {
          id: input.complianceRunId,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
        },
        select: { id: true },
      });
      if (!complianceRun) {
        throw new ComplianceProvenanceError("Compliance run not found for filing record");
      }
    }

    const filingRecord = await tx.filingRecord.upsert({
      where: {
        buildingId_filingType_filingYear_complianceCycle: {
          buildingId: input.buildingId,
          filingType: input.filingType,
          filingYear,
          complianceCycle,
        },
      },
      create: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        filingType: input.filingType,
        filingYear,
        complianceCycle,
        benchmarkSubmissionId: input.benchmarkSubmissionId ?? null,
        complianceRunId: input.complianceRunId ?? null,
        status: input.status ?? "DRAFT",
        filingPayload: toJson(input.filingPayload ?? {}),
        packetUri: input.packetUri ?? null,
        filedAt: input.filedAt ?? null,
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      },
      update: {
        benchmarkSubmissionId: input.benchmarkSubmissionId ?? null,
        complianceRunId: input.complianceRunId ?? null,
        status: input.status ?? "DRAFT",
        filingPayload: toJson(input.filingPayload ?? {}),
        packetUri: input.packetUri ?? null,
        filedAt: input.filedAt ?? null,
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      },
    });

    for (const artifact of input.evidenceArtifacts ?? []) {
      if (artifact.sourceArtifactId) {
        const sourceArtifact = await tx.sourceArtifact.findUnique({
          where: { id: artifact.sourceArtifactId },
          select: { id: true },
        });
        if (!sourceArtifact) {
          throw new ComplianceProvenanceError("Evidence source artifact not found");
        }
      }

      await tx.evidenceArtifact.create({
        data: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          filingRecordId: filingRecord.id,
          sourceArtifactId: artifact.sourceArtifactId ?? null,
          artifactType: artifact.artifactType,
          name: artifact.name,
          artifactRef: artifact.artifactRef ?? null,
          metadata: toJson(artifact.metadata ?? {}),
          createdByType: input.createdByType,
          createdById: input.createdById ?? null,
        },
      });
    }

    return filingRecord;
  });
}
