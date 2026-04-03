import type {
  ActorType,
  BepsPathway,
  ComplianceCycle,
  Prisma,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { ComplianceProvenanceError } from "../provenance";
import type {
  BepsAlternativeComplianceAgreementRecord,
  BepsCanonicalInputState,
  BepsPrescriptiveItemRecord,
  BepsPathwayType,
} from "./types";

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toPathwayType(pathway: BepsPathway): BepsPathwayType {
  if (
    pathway === "PERFORMANCE" ||
    pathway === "STANDARD_TARGET" ||
    pathway === "PRESCRIPTIVE" ||
    pathway === "TRAJECTORY"
  ) {
    return pathway;
  }

  throw new ComplianceProvenanceError(`Unsupported BEPS pathway value: ${pathway}`);
}

function toPrismaPathway(pathway: BepsPathwayType): BepsPathway {
  if (
    pathway === "PERFORMANCE" ||
    pathway === "STANDARD_TARGET" ||
    pathway === "PRESCRIPTIVE" ||
    pathway === "TRAJECTORY"
  ) {
    return pathway;
  }

  throw new ComplianceProvenanceError(`Unsupported BEPS pathway value: ${pathway}`);
}

function mapPrescriptiveItem(item: {
  id: string;
  itemKey: string;
  name: string;
  milestoneName: string | null;
  isRequired: boolean;
  pointsPossible: number;
  pointsEarned: number | null;
  status:
    | "PLANNED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "APPROVED"
    | "WAIVED"
    | "REJECTED";
  completedAt: Date | null;
  approvedAt: Date | null;
  dueAt: Date | null;
  sourceArtifactId: string | null;
  metadata: unknown;
}): BepsPrescriptiveItemRecord {
  return {
    ...item,
    completedAt: item.completedAt?.toISOString() ?? null,
    approvedAt: item.approvedAt?.toISOString() ?? null,
    dueAt: item.dueAt?.toISOString() ?? null,
    metadata: toRecord(item.metadata),
  };
}

function aggregatePrescriptiveItems(items: BepsPrescriptiveItemRecord[]) {
  const progressStatuses = new Set(["COMPLETED", "APPROVED", "WAIVED"]);
  const satisfiedStatuses = new Set(["APPROVED", "WAIVED"]);
  const requiredItems = items.filter((item) => item.isRequired);
  const satisfiedRequiredItemCount = requiredItems.filter((item) =>
    satisfiedStatuses.has(item.status),
  ).length;
  const pointsNeeded = requiredItems.reduce(
    (sum, item) => sum + (item.pointsPossible ?? 0),
    0,
  );
  const pointsEarned = items.reduce((sum, item) => {
    if (!progressStatuses.has(item.status)) {
      return sum;
    }

    return sum + (item.pointsEarned ?? item.pointsPossible ?? 0);
  }, 0);

  return {
    pointsEarned: items.length > 0 ? pointsEarned : null,
    pointsNeeded: requiredItems.length > 0 ? pointsNeeded : null,
    requirementsMet:
      requiredItems.length > 0 ? satisfiedRequiredItemCount === requiredItems.length : null,
    requiredItemCount: requiredItems.length,
    satisfiedRequiredItemCount,
    itemsCount: items.length,
  };
}

async function assertTenantBuilding(
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
    throw new ComplianceProvenanceError("Building not found for organization");
  }
}

async function assertScopedSourceArtifact(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sourceArtifactId: string | null | undefined,
) {
  if (!sourceArtifactId) {
    return;
  }

  const artifact = await tx.sourceArtifact.findUnique({
    where: {
      id: sourceArtifactId,
    },
    select: {
      id: true,
      organizationId: true,
    },
  });

  if (
    !artifact ||
    (artifact.organizationId !== null && artifact.organizationId !== organizationId)
  ) {
    throw new ComplianceProvenanceError("Source artifact not found for organization");
  }
}

async function assertScopedSnapshot(
  tx: Prisma.TransactionClient,
  organizationId: string,
  buildingId: string,
  snapshotId: string | null | undefined,
) {
  if (!snapshotId) {
    return;
  }

  const snapshot = await tx.complianceSnapshot.findFirst({
    where: {
      id: snapshotId,
      organizationId,
      buildingId,
    },
    select: { id: true },
  });

  if (!snapshot) {
    throw new ComplianceProvenanceError(
      "Compliance snapshot not found for canonical BEPS metric input",
    );
  }
}

export async function getCanonicalBepsInputState(params: {
  organizationId: string;
  buildingId: string;
  cycle: ComplianceCycle;
  filingYear: number;
  effectiveAt?: Date;
}) {
  const effectiveAt = params.effectiveAt ?? new Date();
  const [metricInput, prescriptiveItemsRaw, agreement] = await Promise.all([
    prisma.bepsMetricInput.findFirst({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        complianceCycle: params.cycle,
        filingYear: params.filingYear,
      },
    }),
    prisma.bepsPrescriptiveItem.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        complianceCycle: params.cycle,
        filingYear: params.filingYear,
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.bepsAlternativeComplianceAgreement.findFirst({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        complianceCycle: params.cycle,
        filingYear: params.filingYear,
        status: "ACTIVE",
        effectiveFrom: { lte: effectiveAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }],
      },
      orderBy: [{ effectiveFrom: "desc" }, { updatedAt: "desc" }],
    }),
  ]);

  const prescriptiveItems = prescriptiveItemsRaw.map(mapPrescriptiveItem);

  const state: BepsCanonicalInputState = {
    metricInput: metricInput
      ? {
          id: metricInput.id,
          filingYear: metricInput.filingYear,
          complianceCycle: metricInput.complianceCycle,
          baselineYearStart: metricInput.baselineYearStart,
          baselineYearEnd: metricInput.baselineYearEnd,
          evaluationYearStart: metricInput.evaluationYearStart,
          evaluationYearEnd: metricInput.evaluationYearEnd,
          comparisonYear: metricInput.comparisonYear,
          delayedCycle1OptionApplied: metricInput.delayedCycle1OptionApplied,
          baselineAdjustedSiteEui: metricInput.baselineAdjustedSiteEui,
          evaluationAdjustedSiteEui: metricInput.evaluationAdjustedSiteEui,
          baselineWeatherNormalizedSiteEui: metricInput.baselineWeatherNormalizedSiteEui,
          evaluationWeatherNormalizedSiteEui:
            metricInput.evaluationWeatherNormalizedSiteEui,
          baselineWeatherNormalizedSourceEui:
            metricInput.baselineWeatherNormalizedSourceEui,
          evaluationWeatherNormalizedSourceEui:
            metricInput.evaluationWeatherNormalizedSourceEui,
          baselineEnergyStarScore: metricInput.baselineEnergyStarScore,
          evaluationEnergyStarScore: metricInput.evaluationEnergyStarScore,
          baselineSnapshotId: metricInput.baselineSnapshotId,
          evaluationSnapshotId: metricInput.evaluationSnapshotId,
          sourceArtifactId: metricInput.sourceArtifactId,
          notesJson: toRecord(metricInput.notesJson),
        }
      : null,
    prescriptiveItems,
    prescriptiveSummary: aggregatePrescriptiveItems(prescriptiveItems),
    alternativeComplianceAgreement: agreement
      ? ({
          id: agreement.id,
          agreementIdentifier: agreement.agreementIdentifier,
          pathway: toPathwayType(agreement.pathway),
          multiplier: agreement.multiplier,
          status: agreement.status,
          effectiveFrom: agreement.effectiveFrom.toISOString(),
          effectiveTo: agreement.effectiveTo?.toISOString() ?? null,
          sourceArtifactId: agreement.sourceArtifactId,
          agreementPayload: toRecord(agreement.agreementPayload),
        } satisfies BepsAlternativeComplianceAgreementRecord)
      : null,
  };

  return state;
}

export async function upsertBepsPrescriptiveItemRecord(input: {
  organizationId: string;
  buildingId: string;
  complianceCycle: ComplianceCycle;
  filingYear: number;
  itemKey: string;
  name: string;
  milestoneName?: string | null;
  isRequired?: boolean;
  pointsPossible?: number;
  pointsEarned?: number | null;
  status:
    | "PLANNED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "APPROVED"
    | "WAIVED"
    | "REJECTED";
  completedAt?: Date | null;
  approvedAt?: Date | null;
  dueAt?: Date | null;
  sourceArtifactId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return prisma.$transaction(async (tx) => {
    await assertTenantBuilding(tx, input.organizationId, input.buildingId);
    await assertScopedSourceArtifact(tx, input.organizationId, input.sourceArtifactId);

    return tx.bepsPrescriptiveItem.upsert({
      where: {
        buildingId_complianceCycle_filingYear_itemKey: {
          buildingId: input.buildingId,
          complianceCycle: input.complianceCycle,
          filingYear: input.filingYear,
          itemKey: input.itemKey,
        },
      },
      create: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        complianceCycle: input.complianceCycle,
        filingYear: input.filingYear,
        itemKey: input.itemKey,
        name: input.name,
        milestoneName: input.milestoneName ?? null,
        isRequired: input.isRequired ?? true,
        pointsPossible: input.pointsPossible ?? 0,
        pointsEarned: input.pointsEarned ?? null,
        status: input.status,
        completedAt: input.completedAt ?? null,
        approvedAt: input.approvedAt ?? null,
        dueAt: input.dueAt ?? null,
        sourceArtifactId: input.sourceArtifactId ?? null,
        metadata: toJson(input.metadata ?? {}),
      },
      update: {
        name: input.name,
        milestoneName: input.milestoneName ?? null,
        isRequired: input.isRequired ?? true,
        pointsPossible: input.pointsPossible ?? 0,
        pointsEarned: input.pointsEarned ?? null,
        status: input.status,
        completedAt: input.completedAt ?? null,
        approvedAt: input.approvedAt ?? null,
        dueAt: input.dueAt ?? null,
        sourceArtifactId: input.sourceArtifactId ?? null,
        metadata: toJson(input.metadata ?? {}),
      },
    });
  });
}

export async function upsertBepsAlternativeComplianceAgreementRecord(input: {
  organizationId: string;
  buildingId: string;
  complianceCycle: ComplianceCycle;
  filingYear: number;
  agreementIdentifier: string;
  pathway: BepsPathwayType;
  multiplier: number;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "EXPIRED";
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  sourceArtifactId?: string | null;
  agreementPayload?: Record<string, unknown>;
  producedByType?: ActorType;
  producedById?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await assertTenantBuilding(tx, input.organizationId, input.buildingId);
    await assertScopedSourceArtifact(tx, input.organizationId, input.sourceArtifactId);

    if (input.status === "ACTIVE") {
      await tx.bepsAlternativeComplianceAgreement.updateMany({
        where: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          complianceCycle: input.complianceCycle,
          filingYear: input.filingYear,
          status: "ACTIVE",
          NOT: {
            agreementIdentifier: input.agreementIdentifier,
          },
        },
        data: {
          status: "SUPERSEDED",
          agreementPayload: toJson({
            supersededBy: input.agreementIdentifier,
            supersededAt: new Date().toISOString(),
          }),
        },
      });
    }

    return tx.bepsAlternativeComplianceAgreement.upsert({
      where: {
        buildingId_complianceCycle_filingYear_agreementIdentifier: {
          buildingId: input.buildingId,
          complianceCycle: input.complianceCycle,
          filingYear: input.filingYear,
          agreementIdentifier: input.agreementIdentifier,
        },
      },
      create: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        complianceCycle: input.complianceCycle,
        filingYear: input.filingYear,
        agreementIdentifier: input.agreementIdentifier,
        pathway: toPrismaPathway(input.pathway),
        multiplier: input.multiplier,
        status: input.status,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        sourceArtifactId: input.sourceArtifactId ?? null,
        agreementPayload: toJson({
          ...(input.agreementPayload ?? {}),
          producedByType: input.producedByType ?? "USER",
          producedById: input.producedById ?? null,
        }),
      },
      update: {
        pathway: toPrismaPathway(input.pathway),
        multiplier: input.multiplier,
        status: input.status,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        sourceArtifactId: input.sourceArtifactId ?? null,
        agreementPayload: toJson({
          ...(input.agreementPayload ?? {}),
          producedByType: input.producedByType ?? "USER",
          producedById: input.producedById ?? null,
        }),
      },
    });
  });
}

export async function upsertBepsMetricInputRecord(input: {
  organizationId: string;
  buildingId: string;
  complianceCycle: ComplianceCycle;
  filingYear: number;
  baselineYearStart?: number | null;
  baselineYearEnd?: number | null;
  evaluationYearStart?: number | null;
  evaluationYearEnd?: number | null;
  comparisonYear?: number | null;
  delayedCycle1OptionApplied?: boolean;
  baselineAdjustedSiteEui?: number | null;
  evaluationAdjustedSiteEui?: number | null;
  baselineWeatherNormalizedSiteEui?: number | null;
  evaluationWeatherNormalizedSiteEui?: number | null;
  baselineWeatherNormalizedSourceEui?: number | null;
  evaluationWeatherNormalizedSourceEui?: number | null;
  baselineEnergyStarScore?: number | null;
  evaluationEnergyStarScore?: number | null;
  baselineSnapshotId?: string | null;
  evaluationSnapshotId?: string | null;
  sourceArtifactId?: string | null;
  notesJson?: Record<string, unknown>;
}) {
  return prisma.$transaction(async (tx) => {
    await assertTenantBuilding(tx, input.organizationId, input.buildingId);
    await assertScopedSnapshot(tx, input.organizationId, input.buildingId, input.baselineSnapshotId);
    await assertScopedSnapshot(
      tx,
      input.organizationId,
      input.buildingId,
      input.evaluationSnapshotId,
    );
    await assertScopedSourceArtifact(tx, input.organizationId, input.sourceArtifactId);

    return tx.bepsMetricInput.upsert({
      where: {
        buildingId_complianceCycle_filingYear: {
          buildingId: input.buildingId,
          complianceCycle: input.complianceCycle,
          filingYear: input.filingYear,
        },
      },
      create: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        complianceCycle: input.complianceCycle,
        filingYear: input.filingYear,
        baselineYearStart: input.baselineYearStart ?? null,
        baselineYearEnd: input.baselineYearEnd ?? null,
        evaluationYearStart: input.evaluationYearStart ?? null,
        evaluationYearEnd: input.evaluationYearEnd ?? null,
        comparisonYear: input.comparisonYear ?? null,
        delayedCycle1OptionApplied: input.delayedCycle1OptionApplied ?? false,
        baselineAdjustedSiteEui: input.baselineAdjustedSiteEui ?? null,
        evaluationAdjustedSiteEui: input.evaluationAdjustedSiteEui ?? null,
        baselineWeatherNormalizedSiteEui:
          input.baselineWeatherNormalizedSiteEui ?? null,
        evaluationWeatherNormalizedSiteEui:
          input.evaluationWeatherNormalizedSiteEui ?? null,
        baselineWeatherNormalizedSourceEui:
          input.baselineWeatherNormalizedSourceEui ?? null,
        evaluationWeatherNormalizedSourceEui:
          input.evaluationWeatherNormalizedSourceEui ?? null,
        baselineEnergyStarScore: input.baselineEnergyStarScore ?? null,
        evaluationEnergyStarScore: input.evaluationEnergyStarScore ?? null,
        baselineSnapshotId: input.baselineSnapshotId ?? null,
        evaluationSnapshotId: input.evaluationSnapshotId ?? null,
        sourceArtifactId: input.sourceArtifactId ?? null,
        notesJson: toJson(input.notesJson ?? {}),
      },
      update: {
        baselineYearStart: input.baselineYearStart ?? null,
        baselineYearEnd: input.baselineYearEnd ?? null,
        evaluationYearStart: input.evaluationYearStart ?? null,
        evaluationYearEnd: input.evaluationYearEnd ?? null,
        comparisonYear: input.comparisonYear ?? null,
        delayedCycle1OptionApplied: input.delayedCycle1OptionApplied ?? false,
        baselineAdjustedSiteEui: input.baselineAdjustedSiteEui ?? null,
        evaluationAdjustedSiteEui: input.evaluationAdjustedSiteEui ?? null,
        baselineWeatherNormalizedSiteEui:
          input.baselineWeatherNormalizedSiteEui ?? null,
        evaluationWeatherNormalizedSiteEui:
          input.evaluationWeatherNormalizedSiteEui ?? null,
        baselineWeatherNormalizedSourceEui:
          input.baselineWeatherNormalizedSourceEui ?? null,
        evaluationWeatherNormalizedSourceEui:
          input.evaluationWeatherNormalizedSourceEui ?? null,
        baselineEnergyStarScore: input.baselineEnergyStarScore ?? null,
        evaluationEnergyStarScore: input.evaluationEnergyStarScore ?? null,
        baselineSnapshotId: input.baselineSnapshotId ?? null,
        evaluationSnapshotId: input.evaluationSnapshotId ?? null,
        sourceArtifactId: input.sourceArtifactId ?? null,
        notesJson: toJson(input.notesJson ?? {}),
      },
    });
  });
}
