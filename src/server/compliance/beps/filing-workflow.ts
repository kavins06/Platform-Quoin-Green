import type {
  ActorType,
  ComplianceCycle,
  EvidenceArtifactType,
  FilingStatus,
  Prisma,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { ComplianceProvenanceError } from "../provenance";
import { markBepsFilingPacketsStaleTx } from "./filing-packets";

const ALLOWED_STATUS_TRANSITIONS: Record<FilingStatus, FilingStatus[]> = {
  DRAFT: ["GENERATED", "FILED", "REJECTED"],
  GENERATED: ["DRAFT", "FILED", "REJECTED"],
  FILED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: ["DRAFT", "GENERATED", "FILED"],
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function assertTenantScopedBuilding(
  tx: Prisma.TransactionClient,
  organizationId: string,
  buildingId: string,
) {
  const building = await tx.building.findFirst({
    where: {
      id: buildingId,
      organizationId,
    },
    select: { id: true },
  });

  if (!building) {
    throw new ComplianceProvenanceError("Building not found for filing workflow");
  }
}

async function assertTenantScopedComplianceRun(
  tx: Prisma.TransactionClient,
  organizationId: string,
  buildingId: string,
  complianceRunId: string | null | undefined,
) {
  if (!complianceRunId) {
    return;
  }

  const complianceRun = await tx.complianceRun.findFirst({
    where: {
      id: complianceRunId,
      organizationId,
      buildingId,
    },
    select: { id: true },
  });

  if (!complianceRun) {
    throw new ComplianceProvenanceError("Compliance run not found for filing workflow");
  }
}

async function assertTenantScopedSourceArtifact(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sourceArtifactId: string | null | undefined,
) {
  if (!sourceArtifactId) {
    return;
  }

  const sourceArtifact = await tx.sourceArtifact.findUnique({
    where: {
      id: sourceArtifactId,
    },
    select: {
      id: true,
      organizationId: true,
    },
  });

  if (
    !sourceArtifact ||
    (sourceArtifact.organizationId !== null &&
      sourceArtifact.organizationId !== organizationId)
  ) {
    throw new ComplianceProvenanceError("Source artifact not found for filing workflow");
  }
}

async function createFilingEvent(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    buildingId: string;
    filingRecordId: string;
    action: "CREATED" | "STATUS_TRANSITION" | "EVIDENCE_LINKED" | "EVALUATION_REFRESH";
    fromStatus?: FilingStatus | null;
    toStatus?: FilingStatus | null;
    notes?: string | null;
    eventPayload?: Record<string, unknown>;
    createdByType: ActorType;
    createdById?: string | null;
  },
) {
  return tx.filingRecordEvent.create({
    data: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      filingRecordId: input.filingRecordId,
      action: input.action,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      notes: input.notes ?? null,
      eventPayload: toJson(input.eventPayload ?? {}),
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
    },
  });
}

function resolveEvaluationStatus(existingStatus: FilingStatus | null) {
  if (!existingStatus) {
    return "GENERATED" as FilingStatus;
  }

  if (existingStatus === "DRAFT") {
    return "GENERATED" as FilingStatus;
  }

  return existingStatus;
}

export async function upsertBepsFilingRecordFromEvaluation(input: {
  organizationId: string;
  buildingId: string;
  filingYear: number;
  complianceCycle: ComplianceCycle;
  complianceRunId: string;
  filingPayload: Record<string, unknown>;
  packetUri?: string | null;
  createdByType: ActorType;
  createdById?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await assertTenantScopedBuilding(tx, input.organizationId, input.buildingId);
    await assertTenantScopedComplianceRun(
      tx,
      input.organizationId,
      input.buildingId,
      input.complianceRunId,
    );

    const existing = await tx.filingRecord.findUnique({
      where: {
        buildingId_filingType_filingYear_complianceCycle: {
          buildingId: input.buildingId,
          filingType: "BEPS_COMPLIANCE",
          filingYear: input.filingYear,
          complianceCycle: input.complianceCycle,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    const nextStatus = resolveEvaluationStatus(existing?.status ?? null);
    const filingRecord = await tx.filingRecord.upsert({
      where: {
        buildingId_filingType_filingYear_complianceCycle: {
          buildingId: input.buildingId,
          filingType: "BEPS_COMPLIANCE",
          filingYear: input.filingYear,
          complianceCycle: input.complianceCycle,
        },
      },
      create: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        filingType: "BEPS_COMPLIANCE",
        filingYear: input.filingYear,
        complianceCycle: input.complianceCycle,
        complianceRunId: input.complianceRunId,
        status: nextStatus,
        filingPayload: toJson(input.filingPayload),
        packetUri: input.packetUri ?? null,
        filedAt: null,
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      },
      update: {
        complianceRunId: input.complianceRunId,
        status: nextStatus,
        filingPayload: toJson(input.filingPayload),
        packetUri: input.packetUri ?? null,
      },
    });

    if (existing) {
      await markBepsFilingPacketsStaleTx(tx, {
        filingRecordId: filingRecord.id,
      });
    }

    if (!existing) {
      await createFilingEvent(tx, {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        filingRecordId: filingRecord.id,
        action: "CREATED",
        fromStatus: null,
        toStatus: filingRecord.status,
        notes: "Governed BEPS filing created from evaluation output.",
        eventPayload: {
          filingYear: input.filingYear,
          complianceCycle: input.complianceCycle,
          complianceRunId: input.complianceRunId,
        },
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      });
    } else if (existing.status !== filingRecord.status) {
      await createFilingEvent(tx, {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        filingRecordId: filingRecord.id,
        action: "STATUS_TRANSITION",
        fromStatus: existing.status,
        toStatus: filingRecord.status,
        notes: "BEPS evaluation refreshed the filing into generated state.",
        eventPayload: {
          reason: "EVALUATION_REFRESH",
          filingYear: input.filingYear,
          complianceCycle: input.complianceCycle,
          complianceRunId: input.complianceRunId,
        },
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      });
    }

    await createFilingEvent(tx, {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      filingRecordId: filingRecord.id,
      action: "EVALUATION_REFRESH",
      fromStatus: existing?.status ?? null,
      toStatus: filingRecord.status,
      notes: "Governed BEPS evaluation payload refreshed.",
      eventPayload: {
        filingYear: input.filingYear,
        complianceCycle: input.complianceCycle,
        complianceRunId: input.complianceRunId,
      },
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
    });

    return tx.filingRecord.findUniqueOrThrow({
      where: { id: filingRecord.id },
      include: {
        complianceRun: {
          include: {
            calculationManifest: true,
          },
        },
        evidenceArtifacts: {
          orderBy: { createdAt: "desc" },
        },
        events: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
  });
}

export async function transitionBepsFilingRecord(input: {
  organizationId: string;
  buildingId: string;
  filingRecordId: string;
  nextStatus: FilingStatus;
  notes?: string | null;
  createdByType: ActorType;
  createdById?: string | null;
  filedAt?: Date | null;
}) {
  return prisma.$transaction(async (tx) => {
    const filingRecord = await tx.filingRecord.findFirst({
      where: {
        id: input.filingRecordId,
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        filingType: "BEPS_COMPLIANCE",
      },
      include: {
        evidenceArtifacts: {
          orderBy: { createdAt: "desc" },
        },
        events: {
          orderBy: { createdAt: "desc" },
        },
        complianceRun: {
          include: {
            calculationManifest: true,
          },
        },
      },
    });

    if (!filingRecord) {
      throw new ComplianceProvenanceError("BEPS filing record not found");
    }

    if (filingRecord.status === input.nextStatus) {
      return filingRecord;
    }

    const allowedTransitions = ALLOWED_STATUS_TRANSITIONS[filingRecord.status];
    if (!allowedTransitions.includes(input.nextStatus)) {
      throw new ComplianceProvenanceError(
        `Invalid BEPS filing transition from ${filingRecord.status} to ${input.nextStatus}`,
      );
    }

    const nextFiledAt =
      input.nextStatus === "FILED"
        ? input.filedAt ?? filingRecord.filedAt ?? new Date()
        : filingRecord.filedAt;

    const updated = await tx.filingRecord.update({
      where: { id: filingRecord.id },
      data: {
        status: input.nextStatus,
        filedAt: nextFiledAt,
      },
    });

    await markBepsFilingPacketsStaleTx(tx, {
      filingRecordId: filingRecord.id,
    });

    await createFilingEvent(tx, {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      filingRecordId: filingRecord.id,
      action: "STATUS_TRANSITION",
      fromStatus: filingRecord.status,
      toStatus: input.nextStatus,
      notes: input.notes ?? null,
      eventPayload: {
        filingYear: filingRecord.filingYear,
        complianceCycle: filingRecord.complianceCycle,
        filedAt: nextFiledAt?.toISOString() ?? null,
      },
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
    });

    return tx.filingRecord.findUniqueOrThrow({
      where: { id: updated.id },
      include: {
        complianceRun: {
          include: {
            calculationManifest: true,
          },
        },
        evidenceArtifacts: {
          orderBy: { createdAt: "desc" },
        },
        events: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
  });
}

export async function attachEvidenceToBepsFilingRecord(input: {
  organizationId: string;
  buildingId: string;
  filingRecordId: string;
  artifactType: EvidenceArtifactType;
  name: string;
  artifactRef?: string | null;
  sourceArtifactId?: string | null;
  bepsEvidenceKind:
    | "PATHWAY_SUPPORT"
    | "PRESCRIPTIVE_SUPPORT"
    | "ACP_SUPPORT"
    | "EXEMPTION_SUPPORT"
    | "NOT_APPLICABLE_SUPPORT";
  pathway?: "PERFORMANCE" | "STANDARD_TARGET" | "PRESCRIPTIVE" | "TRAJECTORY" | null;
  metadata?: Record<string, unknown>;
  createdByType: ActorType;
  createdById?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const filingRecord = await tx.filingRecord.findFirst({
      where: {
        id: input.filingRecordId,
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        filingType: "BEPS_COMPLIANCE",
      },
      select: {
        id: true,
        filingYear: true,
        complianceCycle: true,
        status: true,
      },
    });

    if (!filingRecord) {
      throw new ComplianceProvenanceError("BEPS filing record not found");
    }

    await assertTenantScopedSourceArtifact(
      tx,
      input.organizationId,
      input.sourceArtifactId,
    );

    const evidenceArtifact = await tx.evidenceArtifact.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        filingRecordId: input.filingRecordId,
        sourceArtifactId: input.sourceArtifactId ?? null,
        artifactType: input.artifactType,
        name: input.name,
        artifactRef: input.artifactRef ?? null,
        metadata: toJson({
          ...(input.metadata ?? {}),
          bepsEvidenceKind: input.bepsEvidenceKind,
          pathway: input.pathway ?? null,
          filingYear: filingRecord.filingYear,
          complianceCycle: filingRecord.complianceCycle,
        }),
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
      },
    });

    await markBepsFilingPacketsStaleTx(tx, {
      filingRecordId: input.filingRecordId,
    });

    await createFilingEvent(tx, {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      filingRecordId: input.filingRecordId,
      action: "EVIDENCE_LINKED",
      fromStatus: filingRecord.status,
      toStatus: filingRecord.status,
      notes: `Linked ${input.bepsEvidenceKind} evidence to BEPS filing.`,
      eventPayload: {
        evidenceArtifactId: evidenceArtifact.id,
        bepsEvidenceKind: input.bepsEvidenceKind,
        pathway: input.pathway ?? null,
      },
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
    });

    return evidenceArtifact;
  });
}
