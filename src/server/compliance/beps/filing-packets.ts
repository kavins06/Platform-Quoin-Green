import type {
  ActorType,
  BepsPacketType,
  BepsRequestItemStatus,
  Prisma,
} from "@/generated/prisma/client";
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
import { ComplianceProvenanceError } from "../provenance";

type BepsEvidenceKind =
  | "PATHWAY_SUPPORT"
  | "PRESCRIPTIVE_SUPPORT"
  | "ACP_SUPPORT"
  | "EXEMPTION_SUPPORT"
  | "NOT_APPLICABLE_SUPPORT";

type PacketWarningCode =
  | "NO_LINKED_EVIDENCE"
  | "MISSING_PATHWAY_SUPPORT_EVIDENCE"
  | "MISSING_PRESCRIPTIVE_SUPPORT_EVIDENCE"
  | "MISSING_ACP_SUPPORT_EVIDENCE"
  | "MISSING_NOT_APPLICABLE_SUPPORT_EVIDENCE"
  | "MISSING_REQUEST_ITEM"
  | "MISSING_DELAY_SUPPORT_EVIDENCE"
  | "MISSING_EXEMPTION_SUPPORT_EVIDENCE"
  | "MISSING_COMPLETED_ACTIONS_SUPPORT_EVIDENCE";

export type BepsFilingPacketExportFormat = "JSON" | "MARKDOWN" | "PDF";
type PacketDisposition = "READY" | "READY_WITH_WARNINGS" | "BLOCKED";

const DEFAULT_BEPS_PACKET_TYPE = "COMPLETED_ACTIONS" satisfies BepsPacketType;

const filingAssemblyInclude = {
  building: true,
  complianceRun: {
    include: {
      calculationManifest: true,
      ruleVersion: {
        include: {
          rulePackage: true,
        },
      },
      factorSetVersion: true,
    },
  },
  evidenceArtifacts: {
    include: {
      sourceArtifact: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  events: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  packets: {
    orderBy: [{ version: "desc" }],
    take: 1,
  },
} satisfies Prisma.FilingRecordInclude;

type FilingAssemblyRecordBase = Prisma.FilingRecordGetPayload<{
  include: typeof filingAssemblyInclude;
}>;

type FilingAssemblyRecord = Omit<FilingAssemblyRecordBase, "complianceRun"> & {
  complianceRun: NonNullable<FilingAssemblyRecordBase["complianceRun"]>;
};

type BepsRequestItemRecord = Prisma.BepsRequestItemGetPayload<{
  include: {
    sourceArtifact: true;
    evidenceArtifact: {
      include: {
        sourceArtifact: true;
      };
    };
    filingRecord: {
      select: {
        id: true;
        filingYear: true;
        complianceCycle: true;
      };
    };
  };
}>;

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function humanizeToken(value: string | null | undefined) {
  return (value ?? "unknown")
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatBepsPacketTypeLabel(packetType: BepsPacketType | null | undefined) {
  switch (packetType ?? DEFAULT_BEPS_PACKET_TYPE) {
    case "PATHWAY_SELECTION":
      return "Pathway Selection";
    case "COMPLETED_ACTIONS":
      return "Completed Actions";
    case "PRESCRIPTIVE_PHASE_1_AUDIT":
      return "Prescriptive Phase 1 Audit";
    case "PRESCRIPTIVE_PHASE_2_ACTION_PLAN":
      return "Prescriptive Phase 2 Action Plan";
    case "PRESCRIPTIVE_PHASE_3_IMPLEMENTATION":
      return "Prescriptive Phase 3 Implementation";
    case "PRESCRIPTIVE_PHASE_4_EVALUATION":
      return "Prescriptive Phase 4 Evaluation";
    case "DELAY_REQUEST":
      return "Delay Request";
    case "EXEMPTION_REQUEST":
      return "Exemption Request";
    case "ACP_SUPPORT":
      return "ACP Support";
    default:
      return humanizeToken(packetType);
  }
}

function formatBepsRequestCategory(category: string) {
  return humanizeToken(category);
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

function normalizeBepsPacketType(packetType: BepsPacketType | null | undefined) {
  return packetType ?? DEFAULT_BEPS_PACKET_TYPE;
}

function isRequestItemBlocking(status: BepsRequestItemStatus) {
  return status === "BLOCKED" || status === "NOT_REQUESTED" || status === "REQUESTED";
}

function isRequestItemWarning(status: BepsRequestItemStatus) {
  return status === "RECEIVED";
}

async function createPacketEvent(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    buildingId: string;
    filingRecordId: string;
    action: "PACKET_GENERATED" | "PACKET_FINALIZED";
    notes: string;
    eventPayload: Record<string, unknown>;
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
      notes: input.notes,
      eventPayload: toJson(input.eventPayload),
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
    },
  });
}

function getBepsEvaluationPayload(filingPayload: unknown) {
  const payload = toRecord(filingPayload);
  return toRecord(payload["bepsEvaluation"]);
}

function getEvidenceKind(metadata: unknown): BepsEvidenceKind | null {
  const record = toRecord(metadata);
  const value = record["bepsEvidenceKind"];
  return value === "PATHWAY_SUPPORT" ||
    value === "PRESCRIPTIVE_SUPPORT" ||
    value === "ACP_SUPPORT" ||
    value === "EXEMPTION_SUPPORT" ||
    value === "NOT_APPLICABLE_SUPPORT"
    ? value
    : null;
}

function hasEvidenceKind(
  evidenceManifest: Array<{ bepsEvidenceKind: BepsEvidenceKind | null }>,
  kind: BepsEvidenceKind,
) {
  return evidenceManifest.some((entry) => entry.bepsEvidenceKind === kind);
}

export function buildBepsFilingPacketWarnings(input: {
  selectedPathway: string | null;
  overallStatus: string | null;
  alternativeComplianceAgreementId: string | null;
  evidenceManifest: Array<{ bepsEvidenceKind: BepsEvidenceKind | null }>;
}) {
  const warnings: Array<{
    code: PacketWarningCode;
    severity: "WARNING";
    message: string;
  }> = [];

  if (input.evidenceManifest.length === 0) {
    warnings.push({
      code: "NO_LINKED_EVIDENCE",
      severity: "WARNING",
      message: "No evidence artifacts are currently linked to this BEPS filing.",
    });
  }

  if (
    input.selectedPathway === "PERFORMANCE" ||
    input.selectedPathway === "STANDARD_TARGET" ||
    input.selectedPathway === "TRAJECTORY"
  ) {
    if (!hasEvidenceKind(input.evidenceManifest, "PATHWAY_SUPPORT")) {
      warnings.push({
        code: "MISSING_PATHWAY_SUPPORT_EVIDENCE",
        severity: "WARNING",
        message: "No pathway support evidence is linked for the selected BEPS pathway.",
      });
    }
  }

  if (
    input.selectedPathway === "PRESCRIPTIVE" &&
    !hasEvidenceKind(input.evidenceManifest, "PRESCRIPTIVE_SUPPORT")
  ) {
    warnings.push({
      code: "MISSING_PRESCRIPTIVE_SUPPORT_EVIDENCE",
      severity: "WARNING",
      message: "No prescriptive support evidence is linked for the selected BEPS pathway.",
    });
  }

  if (
    input.alternativeComplianceAgreementId &&
    !hasEvidenceKind(input.evidenceManifest, "ACP_SUPPORT")
  ) {
    warnings.push({
      code: "MISSING_ACP_SUPPORT_EVIDENCE",
      severity: "WARNING",
      message: "An alternative compliance agreement is referenced, but no ACP support evidence is linked.",
    });
  }

  if (
    input.overallStatus === "NOT_APPLICABLE" &&
    !hasEvidenceKind(input.evidenceManifest, "NOT_APPLICABLE_SUPPORT") &&
    !hasEvidenceKind(input.evidenceManifest, "EXEMPTION_SUPPORT")
  ) {
    warnings.push({
      code: "MISSING_NOT_APPLICABLE_SUPPORT_EVIDENCE",
      severity: "WARNING",
      message: "This BEPS filing is marked not applicable, but no exemption/not-applicable support evidence is linked.",
    });
  }

  return warnings;
}

async function loadBepsFilingAssemblyContext(params: {
  organizationId: string;
  buildingId: string;
  filingRecordId: string;
}): Promise<FilingAssemblyRecord> {
  const filingRecord = await prisma.filingRecord.findFirst({
    where: {
      id: params.filingRecordId,
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    },
    include: filingAssemblyInclude,
  });

  if (!filingRecord) {
    throw new ComplianceProvenanceError("BEPS filing record not found for packet assembly");
  }

  if (!filingRecord.complianceRun) {
    throw new ComplianceProvenanceError(
      "BEPS filing record is missing its governed compliance run",
    );
  }

  return filingRecord as FilingAssemblyRecord;
}

async function loadBepsRequestItems(params: {
  organizationId: string;
  buildingId: string;
  filingRecordId: string;
  filingYear: number | null;
  complianceCycle: "CYCLE_1" | "CYCLE_2" | "CYCLE_3" | null;
  packetType: BepsPacketType;
}) {
  return prisma.bepsRequestItem.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      AND: [
        {
          OR: [
            { filingRecordId: params.filingRecordId },
            {
              filingRecordId: null,
              ...(params.filingYear != null ? { filingYear: params.filingYear } : {}),
              ...(params.complianceCycle != null
                ? { complianceCycle: params.complianceCycle }
                : {}),
            },
            {
              filingRecordId: null,
              filingYear: null,
              complianceCycle: null,
            },
          ],
        },
        {
          OR: [{ packetType: params.packetType }, { packetType: null }],
        },
      ],
    },
    include: {
      sourceArtifact: true,
      evidenceArtifact: {
        include: {
          sourceArtifact: true,
        },
      },
      filingRecord: {
        select: {
          id: true,
          filingYear: true,
          complianceCycle: true,
        },
      },
    },
    orderBy: [{ isRequired: "desc" }, { dueDate: "asc" }, { updatedAt: "desc" }],
  });
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
        "BEPS request source artifact is not available for this building",
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
        "BEPS request evidence artifact is not available for this building",
      );
    }
  }
}

function getRequiredEvidenceKindsForPacketType(packetType: BepsPacketType) {
  switch (packetType) {
    case "PATHWAY_SELECTION":
      return ["PATHWAY_SUPPORT"] satisfies BepsEvidenceKind[];
    case "COMPLETED_ACTIONS":
      return ["PATHWAY_SUPPORT"] satisfies BepsEvidenceKind[];
    case "PRESCRIPTIVE_PHASE_1_AUDIT":
    case "PRESCRIPTIVE_PHASE_2_ACTION_PLAN":
    case "PRESCRIPTIVE_PHASE_3_IMPLEMENTATION":
    case "PRESCRIPTIVE_PHASE_4_EVALUATION":
      return ["PRESCRIPTIVE_SUPPORT"] satisfies BepsEvidenceKind[];
    case "DELAY_REQUEST":
      return ["PATHWAY_SUPPORT"] satisfies BepsEvidenceKind[];
    case "EXEMPTION_REQUEST":
      return ["EXEMPTION_SUPPORT", "NOT_APPLICABLE_SUPPORT"] satisfies BepsEvidenceKind[];
    case "ACP_SUPPORT":
      return ["ACP_SUPPORT"] satisfies BepsEvidenceKind[];
    default:
      return [];
  }
}

function getDeliverableSpecificFields(
  packetType: BepsPacketType,
  evaluation: Record<string, unknown>,
  inputSummary: Record<string, unknown>,
) {
  const selectedPathway =
    typeof evaluation["selectedPathway"] === "string"
      ? (evaluation["selectedPathway"] as string)
      : null;
  const pathwayResults = toRecord(evaluation["pathwayResults"]);
  const pathwayEligibility = toRecord(evaluation["pathwayEligibility"]);
  const alternativeCompliance = toRecord(evaluation["alternativeCompliance"]);

  switch (packetType) {
    case "PATHWAY_SELECTION":
      return {
        focus: "Selected pathway, eligibility, and supporting context.",
        requestedPathway: selectedPathway,
        eligibility: pathwayEligibility,
        supportingContext: {
          scoreEligible: inputSummary["scoreEligible"] ?? null,
          propertyType: inputSummary["propertyType"] ?? null,
          ownershipType: inputSummary["ownershipType"] ?? null,
        },
      };
    case "COMPLETED_ACTIONS":
      return {
        focus: "Final pathway outcome, readiness to file, and supporting evidence.",
        pathwayResults,
        alternativeCompliance,
      };
    case "PRESCRIPTIVE_PHASE_1_AUDIT":
      return {
        phase: "PHASE_1_AUDIT",
        focus: "Energy audit deliverables and prescriptive pathway readiness.",
        prescriptiveStatus: pathwayResults["prescriptive"] ?? pathwayResults,
      };
    case "PRESCRIPTIVE_PHASE_2_ACTION_PLAN":
      return {
        phase: "PHASE_2_ACTION_PLAN",
        focus: "Action plan support and milestone planning for prescriptive compliance.",
        prescriptiveStatus: pathwayResults["prescriptive"] ?? pathwayResults,
      };
    case "PRESCRIPTIVE_PHASE_3_IMPLEMENTATION":
      return {
        phase: "PHASE_3_IMPLEMENTATION",
        focus: "Implementation support and installation evidence for prescriptive work.",
        prescriptiveStatus: pathwayResults["prescriptive"] ?? pathwayResults,
      };
    case "PRESCRIPTIVE_PHASE_4_EVALUATION":
      return {
        phase: "PHASE_4_EVALUATION",
        focus: "Evaluation and verification evidence for prescriptive completion.",
        prescriptiveStatus: pathwayResults["prescriptive"] ?? pathwayResults,
      };
    case "DELAY_REQUEST":
      return {
        focus: "Delay request support and current compliance context.",
        alternativeCompliance,
        currentStatus: evaluation["overallStatus"] ?? null,
      };
    case "EXEMPTION_REQUEST":
      return {
        focus: "Exemption or not-applicable support package.",
        currentStatus: evaluation["overallStatus"] ?? null,
        reasonCodes: toArray(evaluation["reasonCodes"]),
      };
    case "ACP_SUPPORT":
      return {
        focus: "Alternative compliance payment or agreement support.",
        alternativeCompliance,
        currentStatus: evaluation["overallStatus"] ?? null,
      };
    default:
      return {};
  }
}

function buildBepsPacketDisposition(input: {
  filingStatus: string | null;
  packetType: BepsPacketType;
  requestItems: BepsRequestItemRecord[];
  blockers: string[];
  warnings: Array<{ code: string; message: string }>;
}) {
  const hasBlockingRequests = input.requestItems.some(
    (item) => item.isRequired && isRequestItemBlocking(item.status),
  );

  if (input.filingStatus === "REJECTED" || input.blockers.length > 0 || hasBlockingRequests) {
    return "BLOCKED" satisfies PacketDisposition;
  }

  const hasWarningRequests = input.requestItems.some(
    (item) => item.isRequired && isRequestItemWarning(item.status),
  );

  if (input.warnings.length > 0 || hasWarningRequests) {
    return "READY_WITH_WARNINGS" satisfies PacketDisposition;
  }

  return "READY" satisfies PacketDisposition;
}

export function assembleBepsFilingPacketPayload(input: {
  filingRecord: FilingAssemblyRecord;
  packetType: BepsPacketType;
  requestItems: BepsRequestItemRecord[];
}) {
  const filingRecord = input.filingRecord;
  const packetType = normalizeBepsPacketType(input.packetType);
  const evaluation = getBepsEvaluationPayload(filingRecord.filingPayload);
  const inputSummary = toRecord(evaluation["inputSummary"]);
  const governance =
    Object.keys(toRecord(evaluation["governance"])).length > 0
      ? toRecord(evaluation["governance"])
      : {
          rulePackageKey: filingRecord.complianceRun.ruleVersion.rulePackage.key,
          ruleVersion: filingRecord.complianceRun.ruleVersion.version,
          factorSetKey: filingRecord.complianceRun.factorSetVersion.key,
          factorSetVersion: filingRecord.complianceRun.factorSetVersion.version,
        };

  const filingEvidenceManifest = filingRecord.evidenceArtifacts.map((artifact) => ({
    manifestType: "FILING_EVIDENCE",
    id: artifact.id,
    artifactType: artifact.artifactType,
    bepsEvidenceKind: getEvidenceKind(artifact.metadata),
    name: artifact.name,
    artifactRef: artifact.artifactRef,
    sourceArtifactId: artifact.sourceArtifactId,
    sourceArtifactName: artifact.sourceArtifact?.name ?? null,
    sourceArtifactType: artifact.sourceArtifact?.artifactType ?? null,
    sourceArtifactUrl: artifact.sourceArtifact?.externalUrl ?? null,
    createdAt: artifact.createdAt.toISOString(),
    metadata: toRecord(artifact.metadata),
  }));

  const evidenceManifest = [
    ...filingEvidenceManifest,
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

  const warnings = buildBepsFilingPacketWarnings({
    selectedPathway:
      typeof evaluation["selectedPathway"] === "string"
        ? (evaluation["selectedPathway"] as string)
        : null,
    overallStatus:
      typeof evaluation["overallStatus"] === "string"
        ? (evaluation["overallStatus"] as string)
        : null,
    alternativeComplianceAgreementId:
      typeof toRecord(inputSummary["canonicalRefs"])["alternativeComplianceAgreementId"] ===
      "string"
        ? (toRecord(inputSummary["canonicalRefs"])[
            "alternativeComplianceAgreementId"
          ] as string)
        : null,
    evidenceManifest: filingEvidenceManifest,
  });

  const requiredEvidenceKinds = getRequiredEvidenceKindsForPacketType(packetType);
  for (const evidenceKind of requiredEvidenceKinds) {
    if (
      evidenceKind === "EXEMPTION_SUPPORT" ||
      evidenceKind === "NOT_APPLICABLE_SUPPORT"
    ) {
      if (
        !hasEvidenceKind(filingEvidenceManifest, "EXEMPTION_SUPPORT") &&
        !hasEvidenceKind(filingEvidenceManifest, "NOT_APPLICABLE_SUPPORT")
      ) {
        warnings.push({
          code: "MISSING_EXEMPTION_SUPPORT_EVIDENCE",
          severity: "WARNING",
          message: `${formatBepsPacketTypeLabel(packetType)} is missing exemption or not-applicable support evidence.`,
        });
      }
      continue;
    }

    if (!hasEvidenceKind(filingEvidenceManifest, evidenceKind)) {
      warnings.push({
        code:
          evidenceKind === "ACP_SUPPORT"
            ? "MISSING_ACP_SUPPORT_EVIDENCE"
            : evidenceKind === "PRESCRIPTIVE_SUPPORT"
              ? "MISSING_PRESCRIPTIVE_SUPPORT_EVIDENCE"
              : evidenceKind === "PATHWAY_SUPPORT"
                ? packetType === "COMPLETED_ACTIONS"
                  ? "MISSING_COMPLETED_ACTIONS_SUPPORT_EVIDENCE"
                  : packetType === "DELAY_REQUEST"
                    ? "MISSING_DELAY_SUPPORT_EVIDENCE"
                    : "MISSING_PATHWAY_SUPPORT_EVIDENCE"
                : "MISSING_PATHWAY_SUPPORT_EVIDENCE",
        severity: "WARNING",
        message: `${formatBepsPacketTypeLabel(packetType)} is missing ${humanizeToken(
          evidenceKind,
        ).toLowerCase()} evidence.`,
      });
    }
  }

  for (const requestItem of input.requestItems) {
    if (requestItem.isRequired && requestItem.status !== "VERIFIED") {
      warnings.push({
        code: "MISSING_REQUEST_ITEM",
        severity: requestItem.status === "BLOCKED" ? "WARNING" : "WARNING",
        message: `${requestItem.title} is still outstanding for ${formatBepsPacketTypeLabel(packetType).toLowerCase()}.`,
      });
    }
  }

  const eventHistory = filingRecord.events
    .filter(
      (event) => event.action !== "PACKET_GENERATED" && event.action !== "PACKET_FINALIZED",
    )
    .map((event) => ({
    id: event.id,
    action: event.action,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    notes: event.notes,
    createdByType: event.createdByType,
    createdById: event.createdById,
    createdAt: event.createdAt.toISOString(),
    eventPayload: toRecord(event.eventPayload),
    }));

  const blockers = [
    ...input.requestItems
      .filter((item) => item.isRequired && isRequestItemBlocking(item.status))
      .map((item) => `${item.title} is still ${humanizeToken(item.status).toLowerCase()}.`),
    ...(filingRecord.status === "REJECTED"
      ? ["Filing is currently rejected and needs to be updated before delivery is complete."]
      : []),
    ...((packetType === "PRESCRIPTIVE_PHASE_1_AUDIT" ||
      packetType === "PRESCRIPTIVE_PHASE_2_ACTION_PLAN" ||
      packetType === "PRESCRIPTIVE_PHASE_3_IMPLEMENTATION" ||
      packetType === "PRESCRIPTIVE_PHASE_4_EVALUATION") &&
    (typeof evaluation["selectedPathway"] !== "string" ||
      evaluation["selectedPathway"] !== "PRESCRIPTIVE")
      ? ["Selected pathway is not prescriptive for this filing."]
      : []),
    ...(packetType === "EXEMPTION_REQUEST" &&
    typeof evaluation["overallStatus"] === "string" &&
    evaluation["overallStatus"] !== "NOT_APPLICABLE"
      ? ["Current BEPS evaluation is not marked exempt or not applicable."]
      : []),
    ...(packetType === "ACP_SUPPORT" &&
    typeof toRecord(evaluation["alternativeCompliance"])["agreementRequired"] === "boolean" &&
    !toRecord(evaluation["alternativeCompliance"])["agreementRequired"]
      ? ["Current BEPS evaluation does not indicate ACP support is required."]
      : []),
  ];

  const disposition = buildBepsPacketDisposition({
    filingStatus: filingRecord.status,
    packetType,
    requestItems: input.requestItems,
    blockers,
    warnings,
  });

  const packetPayload = {
    packetKind: "BEPS_DELIVERY_PACKET",
    packetSummary: {
      packetType,
      packetTypeLabel: formatBepsPacketTypeLabel(packetType),
      disposition,
      filingStatus: filingRecord.status,
      overallStatus:
        typeof evaluation["overallStatus"] === "string"
          ? evaluation["overallStatus"]
          : null,
      warningsCount: warnings.length,
      blockersCount: blockers.length,
    },
    deliverableContext: {
      packetType,
      packetTypeLabel: formatBepsPacketTypeLabel(packetType),
      selectedPathway:
        typeof evaluation["selectedPathway"] === "string"
          ? evaluation["selectedPathway"]
          : null,
      deliverableSpecificFields: getDeliverableSpecificFields(
        packetType,
        evaluation,
        inputSummary,
      ),
    },
    filingSummary: {
      filingRecordId: filingRecord.id,
      filingType: filingRecord.filingType,
      filingYear: filingRecord.filingYear,
      complianceCycle: filingRecord.complianceCycle,
      filingStatus: filingRecord.status,
      filedAt: filingRecord.filedAt?.toISOString() ?? null,
    },
    buildingContext: {
      organizationId: filingRecord.organizationId,
      buildingId: filingRecord.buildingId,
      buildingName: filingRecord.building.name,
      address: filingRecord.building.address,
      propertyType: filingRecord.building.propertyType,
      ownershipType: filingRecord.building.ownershipType,
      grossSquareFeet: filingRecord.building.grossSquareFeet,
    },
    pathwaySummary: {
      selectedPathway:
        typeof evaluation["selectedPathway"] === "string"
          ? evaluation["selectedPathway"]
          : null,
      overallStatus:
        typeof evaluation["overallStatus"] === "string"
          ? evaluation["overallStatus"]
          : null,
      pathwayEligibility: toRecord(evaluation["pathwayEligibility"]),
      pathwayResults: toRecord(evaluation["pathwayResults"]),
    },
    complianceResult: {
      evaluation,
      alternativeCompliance: toRecord(evaluation["alternativeCompliance"]),
      reasonCodes: toArray(evaluation["reasonCodes"]),
      findings: toArray(evaluation["findings"]),
    },
    governance: {
      rulePackageKey:
        governance["rulePackageKey"] ?? filingRecord.complianceRun.ruleVersion.rulePackage.key,
      ruleVersion: governance["ruleVersion"] ?? filingRecord.complianceRun.ruleVersion.version,
      factorSetKey:
        governance["factorSetKey"] ?? filingRecord.complianceRun.factorSetVersion.key,
      factorSetVersion:
        governance["factorSetVersion"] ?? filingRecord.complianceRun.factorSetVersion.version,
      ruleVersionId: filingRecord.complianceRun.ruleVersionId,
      factorSetVersionId: filingRecord.complianceRun.factorSetVersionId,
      complianceRunId: filingRecord.complianceRun.id,
      calculationManifestId: filingRecord.complianceRun.calculationManifest?.id ?? null,
      implementationKey:
        filingRecord.complianceRun.calculationManifest?.implementationKey ?? null,
      codeVersion: filingRecord.complianceRun.calculationManifest?.codeVersion ?? null,
      executedAt: filingRecord.complianceRun.executedAt.toISOString(),
    },
    metricsUsed: {
      inputSummary,
      currentSnapshotRef: filingRecord.complianceRun.inputSnapshotRef,
      currentSnapshotHash: filingRecord.complianceRun.inputSnapshotHash,
    },
    milestoneContext: {
      filingYear: filingRecord.filingYear,
      complianceCycle: filingRecord.complianceCycle,
      filingStatus: filingRecord.status,
    },
    requestSummary: {
      total: input.requestItems.length,
      required: input.requestItems.filter((item) => item.isRequired).length,
      verified: input.requestItems.filter((item) => item.status === "VERIFIED").length,
      blocked: input.requestItems.filter((item) => item.status === "BLOCKED").length,
      outstanding: input.requestItems.filter(
        (item) => item.isRequired && item.status !== "VERIFIED",
      ).length,
      items: input.requestItems.map((item) => ({
        id: item.id,
        filingRecordId: item.filingRecordId,
        complianceCycle: item.complianceCycle,
        filingYear: item.filingYear,
        packetType: item.packetType,
        category: item.category,
        categoryLabel: formatBepsRequestCategory(item.category),
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
    },
    evidenceManifest,
    workflowHistory: {
      filingStatus: filingRecord.status,
      eventCount: eventHistory.length,
      events: eventHistory,
    },
    warnings,
    blockers,
  };

  const upstreamFingerprint = {
    packetType,
    filingRecord: {
      id: filingRecord.id,
      status: filingRecord.status,
      updatedAt: filingRecord.updatedAt.toISOString(),
      complianceRunId: filingRecord.complianceRunId,
      filingPayload: toRecord(filingRecord.filingPayload),
    },
    evidenceArtifacts: filingRecord.evidenceArtifacts.map((artifact) => ({
      id: artifact.id,
      artifactType: artifact.artifactType,
      sourceArtifactId: artifact.sourceArtifactId,
      metadata: toRecord(artifact.metadata),
      createdAt: artifact.createdAt.toISOString(),
    })),
    requestItems: input.requestItems.map((item) => ({
      id: item.id,
      packetType: item.packetType,
      status: item.status,
      sourceArtifactId: item.sourceArtifactId,
      evidenceArtifactId: item.evidenceArtifactId,
      updatedAt: item.updatedAt.toISOString(),
    })),
    filingEvents: eventHistory,
  };

  return {
    packetPayload,
    packetHash: hashDeterministicJson({
      packetPayload,
      upstreamFingerprint,
    }),
  };
}

export async function markBepsFilingPacketsStaleTx(
  tx: Prisma.TransactionClient,
  params: {
    filingRecordId: string;
  },
) {
  return tx.filingPacket.updateMany({
    where: {
      filingRecordId: params.filingRecordId,
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

export async function markBepsFilingPacketsStale(params: {
  organizationId: string;
  buildingId: string;
  filingRecordId: string;
}) {
  return prisma.$transaction((tx) =>
    markBepsFilingPacketsStaleTx(tx, {
      filingRecordId: params.filingRecordId,
    }),
  );
}

export async function listBepsRequestItems(params: {
  organizationId: string;
  buildingId: string;
  filingRecordId?: string;
  filingYear?: number;
  complianceCycle?: "CYCLE_1" | "CYCLE_2" | "CYCLE_3";
  packetType?: BepsPacketType;
}) {
  const packetTypeFilter = params.packetType
    ? [{ OR: [{ packetType: params.packetType }, { packetType: null }] }]
    : [];
  const scopedGenericFilter = {
    filingRecordId: null,
    ...(params.filingYear != null ? { filingYear: params.filingYear } : {}),
    ...(params.complianceCycle ? { complianceCycle: params.complianceCycle } : {}),
  };
  const genericScopeFilter =
    params.filingYear != null || params.complianceCycle
      ? [
          ...(params.filingYear != null
            ? [{ OR: [{ filingYear: params.filingYear }, { filingYear: null }] }]
            : []),
          ...(params.complianceCycle
            ? [{ OR: [{ complianceCycle: params.complianceCycle }, { complianceCycle: null }] }]
            : []),
        ]
      : [];

  return prisma.bepsRequestItem.findMany({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      AND: [
        ...packetTypeFilter,
        ...(params.filingRecordId
          ? [
              {
                OR: [
                  { filingRecordId: params.filingRecordId },
                  scopedGenericFilter,
                  {
                    filingRecordId: null,
                    filingYear: null,
                    complianceCycle: null,
                  },
                ],
              },
            ]
          : genericScopeFilter),
      ],
    },
    include: {
      sourceArtifact: true,
      evidenceArtifact: {
        include: {
          sourceArtifact: true,
        },
      },
      filingRecord: {
        select: {
          id: true,
          filingYear: true,
          complianceCycle: true,
          status: true,
        },
      },
    },
    orderBy: [{ isRequired: "desc" }, { dueDate: "asc" }, { updatedAt: "desc" }],
  });
}

export async function upsertBepsRequestItem(input: {
  organizationId: string;
  buildingId: string;
  requestItemId?: string;
  filingRecordId?: string | null;
  complianceCycle?: "CYCLE_1" | "CYCLE_2" | "CYCLE_3" | null;
  filingYear?: number | null;
  packetType?: BepsPacketType | null;
  category:
    | "PATHWAY_SELECTION_SUPPORT"
    | "COMPLETED_ACTIONS_EVIDENCE"
    | "ENERGY_AUDIT"
    | "ACTION_PLAN_SUPPORT"
    | "IMPLEMENTATION_DOCUMENTATION"
    | "EVALUATION_MONITORING_DOCUMENTATION"
    | "DELAY_SUBSTANTIATION"
    | "EXEMPTION_SUBSTANTIATION"
    | "ACP_SUPPORT_DOCS"
    | "OTHER_PATHWAY_EVIDENCE";
  title: string;
  status?: BepsRequestItemStatus;
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
      ? await tx.bepsRequestItem.findFirst({
          where: {
            id: input.requestItemId,
            organizationId: input.organizationId,
            buildingId: input.buildingId,
          },
          select: { id: true, filingRecordId: true, filingYear: true },
        })
      : null;

    if (input.requestItemId && !existing) {
      throw new ComplianceProvenanceError("BEPS request item not found");
    }

    if (input.filingRecordId) {
      const filingRecord = await tx.filingRecord.findFirst({
        where: {
          id: input.filingRecordId,
          organizationId: input.organizationId,
          buildingId: input.buildingId,
        },
        select: { id: true, filingYear: true, complianceCycle: true },
      });

      if (!filingRecord) {
        throw new ComplianceProvenanceError("BEPS filing record not found for request item");
      }
    }

    const requestItem = existing
      ? await tx.bepsRequestItem.update({
          where: { id: existing.id },
          data: {
            filingRecordId:
              input.filingRecordId !== undefined ? input.filingRecordId : existing.filingRecordId,
            complianceCycle:
              input.complianceCycle !== undefined
                ? input.complianceCycle
                : undefined,
            filingYear: input.filingYear !== undefined ? input.filingYear : existing.filingYear,
            packetType: input.packetType !== undefined ? input.packetType : undefined,
            category: input.category,
            title: input.title,
            status: input.status ?? undefined,
            isRequired: input.isRequired ?? undefined,
            dueDate: input.dueDate === undefined ? undefined : input.dueDate,
            assignedTo: input.assignedTo === undefined ? undefined : input.assignedTo,
            requestedFrom:
              input.requestedFrom === undefined ? undefined : input.requestedFrom,
            notes: input.notes === undefined ? undefined : input.notes,
            sourceArtifactId:
              input.sourceArtifactId === undefined ? undefined : input.sourceArtifactId,
            evidenceArtifactId:
              input.evidenceArtifactId === undefined ? undefined : input.evidenceArtifactId,
          },
          include: {
            sourceArtifact: true,
            evidenceArtifact: {
              include: { sourceArtifact: true },
            },
            filingRecord: {
              select: {
                id: true,
                filingYear: true,
                complianceCycle: true,
              },
            },
          },
        })
      : await tx.bepsRequestItem.create({
          data: {
            organizationId: input.organizationId,
            buildingId: input.buildingId,
            filingRecordId: input.filingRecordId ?? null,
            complianceCycle: input.complianceCycle ?? null,
            filingYear: input.filingYear ?? null,
            packetType: input.packetType ?? null,
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
              include: { sourceArtifact: true },
            },
            filingRecord: {
              select: {
                id: true,
                filingYear: true,
                complianceCycle: true,
              },
            },
          },
        });

    const filingRecordIdsToStale = new Set<string>();
    if (requestItem.filingRecordId) {
      filingRecordIdsToStale.add(requestItem.filingRecordId);
    } else if (requestItem.filingYear != null || requestItem.complianceCycle != null) {
      const relatedFilings = await tx.filingRecord.findMany({
        where: {
          organizationId: input.organizationId,
          buildingId: input.buildingId,
          ...(requestItem.filingYear != null ? { filingYear: requestItem.filingYear } : {}),
          ...(requestItem.complianceCycle != null
            ? { complianceCycle: requestItem.complianceCycle }
            : {}),
        },
        select: { id: true },
      });

      for (const filing of relatedFilings) {
        filingRecordIdsToStale.add(filing.id);
      }
    }

    for (const filingRecordId of Array.from(filingRecordIdsToStale)) {
      await markBepsFilingPacketsStaleTx(tx, {
        filingRecordId,
      });
    }

    return requestItem;
  });
}

export async function generateBepsFilingPacket(input: {
  organizationId: string;
  buildingId: string;
  filingRecordId: string;
  packetType?: BepsPacketType;
  createdByType: ActorType;
  createdById?: string | null;
  requestId?: string | null;
}) {
  const packetType = normalizeBepsPacketType(input.packetType);
  const filingRecord = await loadBepsFilingAssemblyContext(input);
  const requestItems = await loadBepsRequestItems({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    filingRecordId: input.filingRecordId,
    filingYear: filingRecord.filingYear ?? null,
    complianceCycle: filingRecord.complianceCycle,
    packetType,
  });
  const { packetPayload, packetHash } = assembleBepsFilingPacketPayload({
    filingRecord,
    packetType,
    requestItems,
  });
  const latestPacket = await prisma.filingPacket.findFirst({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      filingRecordId: input.filingRecordId,
      packetType,
    },
    orderBy: [{ version: "desc" }],
  });

  if (
    latestPacket &&
    latestPacket.packetHash === packetHash &&
    latestPacket.status !== "STALE"
  ) {
    return prisma.filingPacket.findUniqueOrThrow({
      where: { id: latestPacket.id },
      include: {
        filingRecord: {
          include: {
            evidenceArtifacts: {
              orderBy: { createdAt: "desc" },
            },
            events: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });
  }

  const packet = await prisma.$transaction(async (tx) => {
    await markBepsFilingPacketsStaleTx(tx, {
      filingRecordId: input.filingRecordId,
    });

    const packet = await tx.filingPacket.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        filingRecordId: input.filingRecordId,
        packetType,
        filingYear: filingRecord.filingYear,
        complianceCycle: filingRecord.complianceCycle,
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
    });

    await createPacketEvent(tx, {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      filingRecordId: input.filingRecordId,
      action: "PACKET_GENERATED",
      notes: `Generated ${formatBepsPacketTypeLabel(packetType)} packet version ${packet.version}.`,
      eventPayload: {
        packetId: packet.id,
        packetType,
        packetVersion: packet.version,
        packetHash,
        packetStatus: "GENERATED",
      },
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
    });

    return tx.filingPacket.findUniqueOrThrow({
      where: { id: packet.id },
      include: {
        filingRecord: {
          include: {
            evidenceArtifacts: {
              orderBy: { createdAt: "desc" },
            },
            events: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });
  });

  await createAuditLog({
    actorType: input.createdByType,
    actorId: input.createdById ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    action: "COMPLIANCE_ARTIFACT_GENERATED",
    inputSnapshot: {
      artifactType: "BEPS_FILING_PACKET",
      filingRecordId: input.filingRecordId,
      packetType,
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

export async function finalizeBepsFilingPacket(input: {
  organizationId: string;
  buildingId: string;
  filingRecordId: string;
  packetType?: BepsPacketType;
  createdByType: ActorType;
  createdById?: string | null;
  requestId?: string | null;
}) {
  const packetType = normalizeBepsPacketType(input.packetType);
  const finalized = await prisma.$transaction(async (tx) => {
    const packet = await tx.filingPacket.findFirst({
      where: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        filingRecordId: input.filingRecordId,
        packetType,
      },
      orderBy: [{ version: "desc" }],
      include: {
        filingRecord: {
          include: {
            evidenceArtifacts: {
              orderBy: { createdAt: "desc" },
            },
            events: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    if (!packet) {
      throw new ComplianceProvenanceError("BEPS filing packet not found for finalization");
    }

    if (packet.status === "STALE") {
      throw new ComplianceProvenanceError("BEPS filing packet cannot be finalized while stale");
    }

    if (packet.status === "FINALIZED") {
      return packet;
    }

    if (packet.status !== "GENERATED") {
      throw new ComplianceProvenanceError(
        `BEPS filing packet cannot be finalized from status ${packet.status}`,
      );
    }

    const payload = toRecord(packet.packetPayload);
    const packetSummary = toRecord(payload["packetSummary"]);
    if (packetSummary["disposition"] === "BLOCKED") {
      throw new ComplianceProvenanceError(
        `${formatBepsPacketTypeLabel(packetType)} packet cannot be finalized while blockers remain`,
      );
    }

    const finalizedAt = new Date();
    const finalized = await tx.filingPacket.update({
      where: { id: packet.id },
      data: {
        status: "FINALIZED",
        finalizedAt,
        finalizedByType: input.createdByType,
        finalizedById: input.createdById ?? null,
      },
    });

    await createPacketEvent(tx, {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      filingRecordId: input.filingRecordId,
      action: "PACKET_FINALIZED",
      notes: `Finalized ${formatBepsPacketTypeLabel(packetType)} packet version ${packet.version}.`,
      eventPayload: {
        packetId: packet.id,
        packetType,
        packetVersion: packet.version,
        packetHash: packet.packetHash,
        finalizedAt: finalizedAt.toISOString(),
      },
      createdByType: input.createdByType,
      createdById: input.createdById ?? null,
    });

    return tx.filingPacket.findUniqueOrThrow({
      where: { id: finalized.id },
      include: {
        filingRecord: {
          include: {
            evidenceArtifacts: {
              orderBy: { createdAt: "desc" },
            },
            events: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });
  });

  await createAuditLog({
    actorType: input.createdByType,
    actorId: input.createdById ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    action: "COMPLIANCE_ARTIFACT_FINALIZED",
    inputSnapshot: {
      artifactType: "BEPS_FILING_PACKET",
      filingRecordId: input.filingRecordId,
      packetType,
      packetId: finalized.id,
      version: finalized.version,
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

export async function getLatestBepsFilingPacket(params: {
  organizationId: string;
  buildingId: string;
  filingRecordId: string;
  packetType?: BepsPacketType;
}) {
  const packetType = normalizeBepsPacketType(params.packetType);
  const latestPacket = await prisma.filingPacket.findFirst({
    where: {
      organizationId: params.organizationId,
      buildingId: params.buildingId,
      filingRecordId: params.filingRecordId,
      packetType,
    },
    orderBy: [{ version: "desc" }],
    include: {
      filingRecord: {
        include: {
          evidenceArtifacts: {
            orderBy: { createdAt: "desc" },
          },
          events: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  if (
    !latestPacket ||
    latestPacket.status === "STALE" ||
    latestPacket.status === "FINALIZED"
  ) {
    return latestPacket;
  }

  const filingRecord = await loadBepsFilingAssemblyContext({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    filingRecordId: params.filingRecordId,
  });
  const requestItems = await loadBepsRequestItems({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    filingRecordId: params.filingRecordId,
    filingYear: filingRecord.filingYear ?? null,
    complianceCycle: filingRecord.complianceCycle,
    packetType,
  });
  const { packetHash } = assembleBepsFilingPacketPayload({
    filingRecord,
    packetType,
    requestItems,
  });

  if (packetHash === latestPacket.packetHash) {
    return latestPacket;
  }

  return prisma.filingPacket.update({
    where: { id: latestPacket.id },
    data: {
      status: "STALE",
      staleMarkedAt: new Date(),
    },
    include: {
      filingRecord: {
        include: {
          evidenceArtifacts: {
            orderBy: { createdAt: "desc" },
          },
          events: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });
}

export async function getBepsFilingPacketManifest(params: {
  organizationId: string;
  buildingId: string;
  filingRecordId: string;
  packetType?: BepsPacketType;
}) {
  const packet = await getLatestBepsFilingPacket(params);
  if (!packet) {
    return null;
  }

  const payload = toRecord(packet.packetPayload);
  const summary = toRecord(payload["packetSummary"]);

  return {
    id: packet.id,
    packetType: packet.packetType,
    packetTypeLabel: formatBepsPacketTypeLabel(packet.packetType),
    version: packet.version,
    status: packet.status,
    packetHash: packet.packetHash,
    disposition: summary["disposition"] ?? "BLOCKED",
    evidenceManifest: toArray(payload["evidenceManifest"]),
    warnings: toArray(payload["warnings"]),
    blockers: toArray(payload["blockers"]),
    requestSummary: toRecord(payload["requestSummary"]),
    deliverableContext: toRecord(payload["deliverableContext"]),
  };
}

function buildPacketExportDocument(packet: NonNullable<
  Awaited<ReturnType<typeof getLatestBepsFilingPacket>>
>) {
  const packetPayload = toRecord(packet.packetPayload);
  const filingSummary = toRecord(packetPayload["filingSummary"]);
  const buildingContext = toRecord(packetPayload["buildingContext"]);
  const pathwaySummary = toRecord(packetPayload["pathwaySummary"]);
  const complianceResult = toRecord(packetPayload["complianceResult"]);
  const governance = toRecord(packetPayload["governance"]);
  const evidenceManifest = toArray(packetPayload["evidenceManifest"]);
  const workflowHistory = toRecord(packetPayload["workflowHistory"]);
  const warnings = toArray(packetPayload["warnings"]);
  const blockers = toArray(packetPayload["blockers"]);
  const requestSummary = toRecord(packetPayload["requestSummary"]);
  const deliverableContext = toRecord(packetPayload["deliverableContext"]);

  return {
    exportVersion: "beps-filing-packet-export-v1",
    packet: {
      id: packet.id,
      packetType: packet.packetType,
      packetTypeLabel: formatBepsPacketTypeLabel(packet.packetType),
      version: packet.version,
      status: packet.status,
      packetHash: packet.packetHash,
      generatedAt: packet.generatedAt.toISOString(),
      staleMarkedAt: packet.staleMarkedAt?.toISOString() ?? null,
      finalizedAt: packet.finalizedAt?.toISOString() ?? null,
      finalizedByType: packet.finalizedByType ?? null,
      finalizedById: packet.finalizedById ?? null,
    },
    packetSummary: toRecord(packetPayload["packetSummary"]),
    filingSummary,
    buildingContext,
    pathwaySummary,
    complianceResult,
    governance,
    evidenceManifest,
    workflowHistory,
    warnings,
    blockers,
    requestSummary,
    deliverableContext,
  };
}

function renderPacketMarkdown(packetExport: ReturnType<typeof buildPacketExportDocument>) {
  const filingSummary = toRecord(packetExport.filingSummary);
  const buildingContext = toRecord(packetExport.buildingContext);
  const pathwaySummary = toRecord(packetExport.pathwaySummary);
  const complianceResult = toRecord(packetExport.complianceResult);
  const governance = toRecord(packetExport.governance);
  const packet = toRecord(packetExport.packet);
  const deliverableContext = toRecord(packetExport.deliverableContext);

  return [
    `# ${packet["packetTypeLabel"] ?? "BEPS Filing"} Packet`,
    "",
    "## Packet",
    `- Packet ID: ${packet["id"] ?? ""}`,
    `- Deliverable Type: ${packet["packetTypeLabel"] ?? packet["packetType"] ?? ""}`,
    `- Version: ${packet["version"] ?? ""}`,
    `- Status: ${packet["status"] ?? ""}`,
    `- Hash: ${packet["packetHash"] ?? ""}`,
    `- Generated At: ${packet["generatedAt"] ?? ""}`,
    `- Finalized At: ${packet["finalizedAt"] ?? "null"}`,
    "",
    "## Filing Summary",
    `- Filing Record ID: ${filingSummary["filingRecordId"] ?? ""}`,
    `- Filing Type: ${filingSummary["filingType"] ?? ""}`,
    `- Filing Year: ${filingSummary["filingYear"] ?? ""}`,
    `- Compliance Cycle: ${filingSummary["complianceCycle"] ?? ""}`,
    `- Filing Status: ${filingSummary["filingStatus"] ?? ""}`,
    "",
    "## Deliverable Context",
    `- Selected Pathway: ${deliverableContext["selectedPathway"] ?? ""}`,
    "```json",
    stringifyDeterministicJson(deliverableContext),
    "```",
    "",
    "## Building Context",
    `- Organization ID: ${buildingContext["organizationId"] ?? ""}`,
    `- Building ID: ${buildingContext["buildingId"] ?? ""}`,
    `- Building Name: ${buildingContext["buildingName"] ?? ""}`,
    `- Address: ${buildingContext["address"] ?? ""}`,
    `- Property Type: ${buildingContext["propertyType"] ?? ""}`,
    `- Ownership Type: ${buildingContext["ownershipType"] ?? ""}`,
    `- Gross Square Feet: ${buildingContext["grossSquareFeet"] ?? ""}`,
    "",
    "## Compliance Result",
    `- Selected Pathway: ${pathwaySummary["selectedPathway"] ?? ""}`,
    `- Overall Status: ${pathwaySummary["overallStatus"] ?? ""}`,
    "",
    "### Governance",
    `- Rule Package: ${governance["rulePackageKey"] ?? ""}`,
    `- Rule Version: ${governance["ruleVersion"] ?? ""}`,
    `- Factor Set: ${governance["factorSetKey"] ?? ""}`,
    `- Factor Set Version: ${governance["factorSetVersion"] ?? ""}`,
    "",
    "### Calculation Detail",
    "```json",
    stringifyDeterministicJson(complianceResult),
    "```",
    "",
    "### Evidence Manifest",
    "```json",
    stringifyDeterministicJson(packetExport.evidenceManifest),
    "```",
    "",
    "### Workflow History",
    "```json",
    stringifyDeterministicJson(packetExport.workflowHistory),
    "```",
    "",
    "### Warnings",
    "```json",
    stringifyDeterministicJson(packetExport.warnings),
    "```",
    "",
    "### Blockers",
    "```json",
    stringifyDeterministicJson(packetExport.blockers),
    "```",
    "",
  ].join("\n");
}

function buildBepsNextActions(packetExport: ReturnType<typeof buildPacketExportDocument>) {
  const actions: string[] = [];
  const blockers = packetExport.blockers.map(String);
  const warnings = packetExport.warnings
    .map((warning) => toRecord(warning)["message"])
    .filter((value): value is string => typeof value === "string");
  const requestSummary = toRecord(packetExport.requestSummary);
  const outstanding = Number(requestSummary["outstanding"] ?? 0);

  if (blockers.length > 0) {
    actions.push(...blockers.slice(0, 3).map((message) => `Resolve blocker: ${message}`));
  } else if (warnings.length > 0) {
    actions.push(...warnings.slice(0, 3).map((message) => `Address warning: ${message}`));
  }

  if (outstanding > 0) {
    actions.push(`Verify the remaining ${outstanding} required BEPS request item(s).`);
  }

  if (actions.length === 0) {
    actions.push("Packet is ready for internal review or consultant handoff.");
  }

  return actions.slice(0, 4);
}

function collectScalarEntries(
  record: Record<string, unknown>,
  prefix = "",
): PacketDocumentEntry[] {
  const entries: PacketDocumentEntry[] = [];

  for (const [key, value] of Object.entries(record)) {
    const label = prefix ? `${prefix} ${humanizeToken(key)}` : humanizeToken(key);

    if (
      value == null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      entries.push({ label, value: toDisplayValue(value) });
      continue;
    }

    if (Array.isArray(value)) {
      if (value.every((entry) => entry == null || typeof entry !== "object")) {
        entries.push({ label, value: toDisplayValue(value) });
      }
      continue;
    }

    if (typeof value === "object") {
      entries.push(...collectScalarEntries(toRecord(value), label));
    }
  }

  return entries;
}

function buildBepsPacketRenderDocument(
  packetExport: ReturnType<typeof buildPacketExportDocument>,
): PacketRenderDocument {
  const packet = toRecord(packetExport.packet);
  const filingSummary = toRecord(packetExport.filingSummary);
  const buildingContext = toRecord(packetExport.buildingContext);
  const pathwaySummary = toRecord(packetExport.pathwaySummary);
  const complianceResult = toRecord(packetExport.complianceResult);
  const governance = toRecord(packetExport.governance);
  const requestSummary = toRecord(packetExport.requestSummary);
  const deliverableContext = toRecord(packetExport.deliverableContext);
  const packetSummaryRecord = toRecord(packetExport.packetSummary);
  const disposition =
    typeof packetSummaryRecord["disposition"] === "string"
      ? (packetSummaryRecord["disposition"] as PacketDisposition)
      : "BLOCKED";
  const dispositionTone =
    disposition === "READY"
      ? "success"
      : disposition === "READY_WITH_WARNINGS"
        ? "warning"
        : "danger";

  const evidenceRows = packetExport.evidenceManifest.map((entry) => {
    const record = toRecord(entry);
    return [
      toDisplayValue(record["manifestType"]),
      toDisplayValue(record["name"]),
      toDisplayValue(record["bepsEvidenceKind"]),
      toDisplayValue(record["createdAt"]),
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

  const deliverableFields = collectScalarEntries(
    toRecord(deliverableContext["deliverableSpecificFields"]),
  );

  const warnings = packetExport.warnings
    .map((warning) => toRecord(warning)["message"])
    .filter((value): value is string => typeof value === "string");
  const blockers = packetExport.blockers.map(String);
  const metadata: PacketDocumentEntry[] = [
    { label: "Building", value: toDisplayValue(buildingContext["buildingName"]) },
    {
      label: "Deliverable",
      value: toDisplayValue(packet["packetTypeLabel"] ?? packet["packetType"]),
    },
    { label: "Filing year", value: toDisplayValue(filingSummary["filingYear"]) },
    { label: "Compliance cycle", value: toDisplayValue(filingSummary["complianceCycle"]) },
    { label: "Packet version", value: `v${toDisplayValue(packet["version"])}` },
    { label: "Generated", value: toDisplayValue(packet["generatedAt"]) },
  ];

  return {
    title: `${toDisplayValue(packet["packetTypeLabel"] ?? packet["packetType"])} Packet`,
    subtitle: `${toDisplayValue(buildingContext["buildingName"])} - ${toDisplayValue(
      filingSummary["complianceCycle"],
    )} filing year ${toDisplayValue(filingSummary["filingYear"])}`,
    disposition: {
      label: humanizeToken(disposition),
      tone: dispositionTone,
    },
    metadata,
    summary: buildBepsNextActions(packetExport),
    sections: [
      {
        title: "Building and filing context",
        entries: [
          { label: "Address", value: toDisplayValue(buildingContext["address"]) },
          { label: "Property type", value: toDisplayValue(buildingContext["propertyType"]) },
          { label: "Ownership type", value: toDisplayValue(buildingContext["ownershipType"]) },
          {
            label: "Gross floor area",
            value: toDisplayValue(buildingContext["grossSquareFeet"]),
          },
          { label: "Filing status", value: toDisplayValue(filingSummary["filingStatus"]) },
          { label: "Filing type", value: toDisplayValue(filingSummary["filingType"]) },
        ],
      },
      {
        title: "Pathway and deliverable context",
        entries: [
          {
            label: "Selected pathway",
            value: toDisplayValue(deliverableContext["selectedPathway"]),
          },
          {
            label: "Deliverable type",
            value: toDisplayValue(packet["packetTypeLabel"] ?? packet["packetType"]),
          },
          ...deliverableFields,
        ],
      },
      {
        title: "Compliance and evaluation summary",
        entries: [
          {
            label: "Overall BEPS status",
            value: toDisplayValue(pathwaySummary["overallStatus"]),
          },
          {
            label: "Selected pathway",
            value: toDisplayValue(pathwaySummary["selectedPathway"]),
          },
          {
            label: "Reason codes",
            value: toDisplayValue(toArray(complianceResult["reasonCodes"]).length),
          },
          {
            label: "Findings",
            value: toDisplayValue(toArray(complianceResult["findings"]).length),
          },
        ],
      },
      {
        title: "Request and checklist summary",
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
          columns: ["Manifest type", "Name", "Evidence kind", "Created"],
          rows:
            evidenceRows.length > 0
              ? evidenceRows
              : [["No linked evidence", "-", "-", "-"]],
        },
      },
      {
        title: "Governance metadata",
        entries: [
          { label: "Rule package", value: toDisplayValue(governance["rulePackageKey"]) },
          { label: "Rule version", value: toDisplayValue(governance["ruleVersion"]) },
          { label: "Factor set", value: toDisplayValue(governance["factorSetKey"]) },
          { label: "Factor set version", value: toDisplayValue(governance["factorSetVersion"]) },
          { label: "Compliance run", value: toDisplayValue(governance["complianceRunId"]) },
          { label: "Packet hash", value: toDisplayValue(packet["packetHash"]) },
        ],
      },
      {
        title: "Next actions",
        bullets: buildBepsNextActions(packetExport),
      },
    ],
    appendices: [
      {
        title: "Structured deliverable context appendix",
        content: stringifyDeterministicJson(deliverableContext),
      },
      {
        title: "Compliance result appendix",
        content: stringifyDeterministicJson(complianceResult),
      },
    ],
  };
}

export async function exportBepsFilingPacket(input: {
  organizationId: string;
  buildingId: string;
  filingRecordId: string;
  packetType?: BepsPacketType;
  format: BepsFilingPacketExportFormat;
  createdByType?: ActorType;
  createdById?: string | null;
  requestId?: string | null;
}) {
  const logger = createLogger({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    procedure: "bepsPackets.export",
  });
  const packet = await getLatestBepsFilingPacket({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    filingRecordId: input.filingRecordId,
    packetType: input.packetType,
  });

  if (!packet) {
    throw new ComplianceProvenanceError("BEPS filing packet not found for export");
  }

  const packetExport = buildPacketExportDocument(packet);
  const buildingContext = toRecord(packetExport.buildingContext);
  const filingSummary = toRecord(packetExport.filingSummary);
  const baseFileName = [
    slugifyFileSegment(buildingContext["buildingName"] as string | undefined),
    slugifyFileSegment(filingSummary["complianceCycle"] as string | undefined),
    filingSummary["filingYear"] ?? "filing",
    slugifyFileSegment(packet.packetType),
    `packet-v${packet.version}`,
  ].join("_");

  if (input.format === "MARKDOWN") {
    const content = renderPacketMarkdown(packetExport);
    const result = {
      packetId: packet.id,
      version: packet.version,
      status: packet.status,
      packetHash: packet.packetHash,
      format: input.format,
      fileName: `${baseFileName}.md`,
      contentType: "text/markdown",
      encoding: "utf-8" as const,
      content,
    };

    await createAuditLog({
      actorType: input.createdByType ?? "SYSTEM",
      actorId: input.createdById ?? null,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      action: "COMPLIANCE_ARTIFACT_EXPORTED",
      inputSnapshot: {
        artifactType: "BEPS_FILING_PACKET",
        filingRecordId: input.filingRecordId,
        packetId: packet.id,
        packetType: packet.packetType,
        version: packet.version,
        format: input.format,
      },
      outputSnapshot: {
        fileName: result.fileName,
        contentType: result.contentType,
        packetHash: packet.packetHash,
      },
      requestId: input.requestId ?? null,
    });

    return result;
  }

  if (input.format === "PDF") {
    try {
      const content = await renderPacketDocumentPdfBase64(
        buildBepsPacketRenderDocument(packetExport),
      );
      const result = {
        packetId: packet.id,
        version: packet.version,
        status: packet.status,
        packetHash: packet.packetHash,
        format: input.format,
        fileName: `${baseFileName}.pdf`,
        contentType: "application/pdf",
        encoding: "base64" as const,
        content,
      };

      await createAuditLog({
        actorType: input.createdByType ?? "SYSTEM",
        actorId: input.createdById ?? null,
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        action: "COMPLIANCE_ARTIFACT_EXPORTED",
        inputSnapshot: {
          artifactType: "BEPS_FILING_PACKET",
          filingRecordId: input.filingRecordId,
          packetId: packet.id,
          packetType: packet.packetType,
          version: packet.version,
          format: input.format,
        },
        outputSnapshot: {
          fileName: result.fileName,
          contentType: result.contentType,
          packetHash: packet.packetHash,
        },
        requestId: input.requestId ?? null,
      });

      return result;
    } catch (error) {
      logger.error("BEPS packet PDF export failed", {
        error,
        packetId: packet.id,
        filingRecordId: input.filingRecordId,
        packetType: packet.packetType,
        format: input.format,
      });
      throw new PacketExportError("BEPS packet PDF export failed.", {
        details: {
          packetId: packet.id,
          filingRecordId: input.filingRecordId,
          packetType: packet.packetType,
          format: input.format,
        },
        cause: error,
      });
    }
  }

  const content = stringifyDeterministicJson(packetExport);
  const result = {
    packetId: packet.id,
    version: packet.version,
    status: packet.status,
    packetHash: packet.packetHash,
    format: input.format,
    fileName: `${baseFileName}.json`,
    contentType: "application/json",
    encoding: "utf-8" as const,
    content,
  };

  await createAuditLog({
    actorType: input.createdByType ?? "SYSTEM",
    actorId: input.createdById ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    action: "COMPLIANCE_ARTIFACT_EXPORTED",
    inputSnapshot: {
      artifactType: "BEPS_FILING_PACKET",
      filingRecordId: input.filingRecordId,
      packetId: packet.id,
      packetType: packet.packetType,
      version: packet.version,
      format: input.format,
    },
    outputSnapshot: {
      fileName: result.fileName,
      contentType: result.contentType,
      packetHash: packet.packetHash,
    },
    requestId: input.requestId ?? null,
  });

  return result;
}

export async function listBepsFilingPackets(params: {
  organizationId: string;
  buildingId?: string;
  filingRecordId?: string;
  packetType?: BepsPacketType;
  limit: number;
}) {
  return prisma.filingPacket.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.buildingId ? { buildingId: params.buildingId } : {}),
      ...(params.filingRecordId ? { filingRecordId: params.filingRecordId } : {}),
      ...(params.packetType ? { packetType: params.packetType } : {}),
    },
    orderBy: [{ generatedAt: "desc" }, { version: "desc" }],
    take: params.limit,
    include: {
      filingRecord: {
        select: {
          id: true,
          status: true,
          filingYear: true,
          complianceCycle: true,
        },
      },
    },
  });
}
