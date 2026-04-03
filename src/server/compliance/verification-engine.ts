import crypto from "node:crypto";
import type {
  Prisma,
  VerificationItemCategory,
  VerificationItemStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { NotFoundError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import { LATEST_SNAPSHOT_ORDER } from "@/server/lib/compliance-snapshots";
import { validateBenchmarkYearData } from "./data-quality";

type VerificationArtifactLink = {
  id: string;
  name: string;
  artifactKind: "EVIDENCE" | "SOURCE";
};

type VerificationEvaluationItem = {
  category: VerificationItemCategory;
  key: string;
  status: VerificationItemStatus;
  explanation: string;
  evidenceRefs: string[];
  evidenceLinks: VerificationArtifactLink[];
};

type VerificationEvaluationSummary = {
  passedCount: number;
  failedCount: number;
  needsReviewCount: number;
};

export type VerificationEvaluationResult = {
  items: VerificationEvaluationItem[];
  summary: VerificationEvaluationSummary;
};

type VerificationContext = {
  building: {
    id: string;
    organizationId: string;
    name: string;
    address: string;
    propertyType: string;
    grossSquareFeet: number;
    doeeBuildingId: string | null;
    espmPropertyId: bigint | null;
    espmShareStatus: string;
  };
  meters: Array<{
    id: string;
    meterType: string;
    isActive: boolean;
    name: string;
  }>;
  readings: Array<{
    id: string;
    meterId: string | null;
    meterType: string;
    periodStart: Date;
    periodEnd: Date;
  }>;
  latestSnapshot: {
    id: string;
    energyStarScore: number | null;
    sourceEui: number | null;
    snapshotDate: Date;
  } | null;
  syncState: {
    status: string;
    lastSuccessfulSyncAt: Date | null;
  } | null;
  evidenceArtifacts: Array<{
    id: string;
    name: string;
    metadata: Prisma.JsonValue;
    sourceArtifactId: string | null;
    sourceArtifact: {
      id: string;
      name: string;
    } | null;
  }>;
  sourceArtifacts: Array<{
    id: string;
    name: string;
    metadata: Prisma.JsonValue;
  }>;
  requestItems: Array<{
    id: string;
    category: string;
    status: string;
    sourceArtifactId: string | null;
    evidenceArtifactId: string | null;
    sourceArtifact: { id: string; name: string } | null;
    evidenceArtifact: { id: string; name: string } | null;
  }>;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractBenchmarkingKind(metadata: Prisma.JsonValue) {
  const record = toRecord(metadata);
  const benchmarking = toRecord(record["benchmarking"]);
  const rawKind = benchmarking["kind"] ?? record["kind"];
  return typeof rawKind === "string" ? rawKind : null;
}

function uniqueArtifactLinks(links: VerificationArtifactLink[]) {
  return Array.from(new Map(links.map((link) => [link.id, link])).values());
}

function linksFromEvidenceArtifacts(
  artifacts: VerificationContext["evidenceArtifacts"],
  predicate: (artifact: VerificationContext["evidenceArtifacts"][number]) => boolean,
) {
  const links: VerificationArtifactLink[] = [];

  for (const artifact of artifacts.filter(predicate)) {
    links.push({
      id: artifact.id,
      name: artifact.name,
      artifactKind: "EVIDENCE",
    });
    if (artifact.sourceArtifact) {
      links.push({
        id: artifact.sourceArtifact.id,
        name: artifact.sourceArtifact.name,
        artifactKind: "SOURCE",
      });
    }
  }

  return uniqueArtifactLinks(links);
}

function linksFromRequestCategories(
  requestItems: VerificationContext["requestItems"],
  categories: string[],
) {
  const links: VerificationArtifactLink[] = [];

  for (const item of requestItems.filter((requestItem) => categories.includes(requestItem.category))) {
    if (item.evidenceArtifact) {
      links.push({
        id: item.evidenceArtifact.id,
        name: item.evidenceArtifact.name,
        artifactKind: "EVIDENCE",
      });
    }
    if (item.sourceArtifact) {
      links.push({
        id: item.sourceArtifact.id,
        name: item.sourceArtifact.name,
        artifactKind: "SOURCE",
      });
    }
  }

  return uniqueArtifactLinks(links);
}

function buildItem(
  category: VerificationItemCategory,
  key: string,
  status: VerificationItemStatus,
  explanation: string,
  links: VerificationArtifactLink[],
): VerificationEvaluationItem {
  return {
    category,
    key,
    status,
    explanation,
    evidenceRefs: links.map((link) => link.id),
    evidenceLinks: uniqueArtifactLinks(links),
  };
}

async function loadVerificationContext(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
}): Promise<VerificationContext> {
  const yearStart = new Date(Date.UTC(params.reportingYear, 0, 1));
  const yearEnd = new Date(Date.UTC(params.reportingYear, 11, 31));

  const [
    building,
    meters,
    readings,
    latestSnapshot,
    syncState,
    evidenceArtifacts,
    sourceArtifacts,
    requestItems,
  ] = await Promise.all([
    prisma.building.findFirst({
      where: {
        id: params.buildingId,
        organizationId: params.organizationId,
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        address: true,
        propertyType: true,
        grossSquareFeet: true,
        doeeBuildingId: true,
        espmPropertyId: true,
        espmShareStatus: true,
      },
    }),
    prisma.meter.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
      },
      orderBy: [{ meterType: "asc" }, { name: "asc" }],
      select: {
        id: true,
        meterType: true,
        isActive: true,
        name: true,
      },
    }),
    prisma.energyReading.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        periodEnd: { gte: yearStart },
        periodStart: { lte: yearEnd },
      },
      orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }, { ingestedAt: "desc" }],
      select: {
        id: true,
        meterId: true,
        meterType: true,
        periodStart: true,
        periodEnd: true,
      },
    }),
    prisma.complianceSnapshot.findFirst({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
      },
      orderBy: LATEST_SNAPSHOT_ORDER,
      select: {
        id: true,
        energyStarScore: true,
        sourceEui: true,
        snapshotDate: true,
      },
    }),
    prisma.portfolioManagerSyncState.findFirst({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        status: true,
        lastSuccessfulSyncAt: true,
      },
    }),
    prisma.evidenceArtifact.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
      },
      include: {
        sourceArtifact: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.sourceArtifact.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
      },
      select: {
        id: true,
        name: true,
        metadata: true,
      },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.benchmarkRequestItem.findMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        OR: [{ reportingYear: params.reportingYear }, { reportingYear: null }],
      },
      include: {
        sourceArtifact: {
          select: {
            id: true,
            name: true,
          },
        },
        evidenceArtifact: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ isRequired: "desc" }, { updatedAt: "desc" }],
    }),
  ]);

  if (!building) {
    throw new NotFoundError("Building not found for verification evaluation");
  }

  return {
    building,
    meters,
    readings,
    latestSnapshot,
    syncState,
    evidenceArtifacts,
    sourceArtifacts,
    requestItems,
  };
}

export async function computeVerificationEvaluation(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
}): Promise<VerificationEvaluationResult> {
  const context = await loadVerificationContext(params);
  const coverage = validateBenchmarkYearData(context.readings, params.reportingYear);
  const items: VerificationEvaluationItem[] = [];

  if (!context.building.name.trim() || !context.building.address.trim()) {
    items.push(
      buildItem(
        "PROPERTY_METADATA",
        "property_metadata",
        "FAIL",
        "Property metadata is incomplete. Building name or address is missing.",
        [],
      ),
    );
  } else if (context.building.propertyType === "OTHER") {
    items.push(
      buildItem(
        "PROPERTY_METADATA",
        "property_metadata",
        "NEEDS_REVIEW",
        "Property metadata exists, but the property type is set to Other and should be confirmed before verifier handoff.",
        [],
      ),
    );
  } else {
    items.push(
      buildItem(
        "PROPERTY_METADATA",
        "property_metadata",
        "PASS",
        `Property metadata is present and the property type is ${context.building.propertyType.toLowerCase()}.`,
        [],
      ),
    );
  }

  const gfaLinks = uniqueArtifactLinks([
    ...linksFromRequestCategories(context.requestItems, [
      "GROSS_FLOOR_AREA_SUPPORT",
      "AREA_ANALYSIS_DRAWINGS",
    ]),
    ...linksFromEvidenceArtifacts(
      context.evidenceArtifacts,
      (artifact) => {
        const kind = extractBenchmarkingKind(artifact.metadata);
        return kind === "GFA_CORRECTION" || kind === "GFA_SUPPORT";
      },
    ),
  ]);

  if (!context.building.grossSquareFeet || context.building.grossSquareFeet <= 0) {
    items.push(
      buildItem(
        "GFA",
        "gross_floor_area",
        "FAIL",
        "Gross floor area is missing or invalid on the building record.",
        gfaLinks,
      ),
    );
  } else if (gfaLinks.length === 0) {
    items.push(
      buildItem(
        "GFA",
        "gross_floor_area",
        "NEEDS_REVIEW",
        "Gross floor area is present, but no supporting evidence is currently linked.",
        [],
      ),
    );
  } else {
    items.push(
      buildItem(
        "GFA",
        "gross_floor_area",
        "PASS",
        "Gross floor area is present and supporting evidence is linked.",
        gfaLinks,
      ),
    );
  }

  const activeMeters = context.meters.filter((meter) => meter.isActive);
  const meterRosterLinks = linksFromRequestCategories(context.requestItems, [
    "METER_ROSTER_SUPPORT",
    "UTILITY_BILLS",
  ]);
  const readingMeterIds = new Set(
    context.readings.map((reading) => reading.meterId).filter((value): value is string => !!value),
  );
  const metersWithoutReadings = activeMeters.filter((meter) => !readingMeterIds.has(meter.id));

  if (activeMeters.length === 0) {
    items.push(
      buildItem(
        "METER_COMPLETENESS",
        "meter_completeness",
        "FAIL",
        "No active meters are linked to the building.",
        meterRosterLinks,
      ),
    );
  } else if (context.readings.length === 0) {
    items.push(
      buildItem(
        "METER_COMPLETENESS",
        "meter_completeness",
        "FAIL",
        "Meters exist, but no annual energy readings were found for the reporting year.",
        meterRosterLinks,
      ),
    );
  } else if (metersWithoutReadings.length > 0) {
    items.push(
      buildItem(
        "METER_COMPLETENESS",
        "meter_completeness",
        "NEEDS_REVIEW",
        `Some active meters do not have linked annual readings: ${metersWithoutReadings
          .map((meter) => meter.name)
          .join(", ")}.`,
        meterRosterLinks,
      ),
    );
  } else {
    items.push(
      buildItem(
        "METER_COMPLETENESS",
        "meter_completeness",
        "PASS",
        `All ${activeMeters.length} active meter(s) have annual energy readings.`,
        meterRosterLinks,
      ),
    );
  }

  const utilityBillLinks = linksFromRequestCategories(context.requestItems, ["UTILITY_BILLS"]);
  if (coverage.verdict === "FAIL") {
    const reasons: string[] = [];
    if (coverage.missingCoverageStreams.length > 0) {
      reasons.push(`gaps in ${coverage.missingCoverageStreams.join(", ")}`);
    }
    if (coverage.overlapStreams.length > 0) {
      reasons.push(`overlaps in ${coverage.overlapStreams.join(", ")}`);
    }

    items.push(
      buildItem(
        "DATA_COVERAGE",
        "data_coverage",
        "FAIL",
        `Annual data coverage is incomplete for Jan 1-Dec 31: ${reasons.join("; ")}.`,
        utilityBillLinks,
      ),
    );
  } else {
    items.push(
      buildItem(
        "DATA_COVERAGE",
        "data_coverage",
        "PASS",
        "Annual data coverage spans Jan 1-Dec 31 without gaps or overlaps.",
        utilityBillLinks,
      ),
    );
  }

  if (
    context.latestSnapshot?.energyStarScore != null ||
    context.latestSnapshot?.sourceEui != null
  ) {
    items.push(
      buildItem(
        "METRIC_AVAILABILITY",
        "metric_availability",
        "PASS",
        "At least one benchmarking metric is available from the latest compliance snapshot.",
        [],
      ),
    );
  } else {
    items.push(
      buildItem(
        "METRIC_AVAILABILITY",
        "metric_availability",
        "FAIL",
        "Neither ENERGY STAR score nor source EUI is currently available for the reporting year.",
        [],
      ),
    );
  }

  const pmLinks = linksFromRequestCategories(context.requestItems, ["PORTFOLIO_MANAGER_ACCESS"]);
  if (!context.building.espmPropertyId || context.building.espmShareStatus !== "LINKED") {
    items.push(
      buildItem(
        "PM_LINKAGE",
        "portfolio_manager_linkage",
        "FAIL",
        "Portfolio Manager linkage is incomplete. The property is not linked and shared for Quoin sync.",
        pmLinks,
      ),
    );
  } else if (!context.syncState) {
    items.push(
      buildItem(
        "PM_LINKAGE",
        "portfolio_manager_linkage",
        "NEEDS_REVIEW",
        "Portfolio Manager linkage exists, but Quoin has no recorded sync state yet.",
        pmLinks,
      ),
    );
  } else if (context.syncState.status !== "SUCCEEDED") {
    items.push(
      buildItem(
        "PM_LINKAGE",
        "portfolio_manager_linkage",
        context.syncState.status === "PARTIAL" ? "NEEDS_REVIEW" : "FAIL",
        `Portfolio Manager linkage exists, but the latest sync status is ${context.syncState.status.toLowerCase()}.`,
        pmLinks,
      ),
    );
  } else {
    items.push(
      buildItem(
        "PM_LINKAGE",
        "portfolio_manager_linkage",
        "PASS",
        "Portfolio Manager property linkage is active and the latest sync succeeded.",
        pmLinks,
      ),
    );
  }

  const dqcLinks = uniqueArtifactLinks([
    ...linksFromEvidenceArtifacts(
      context.evidenceArtifacts,
      (artifact) => extractBenchmarkingKind(artifact.metadata) === "DQC_REPORT",
    ),
    ...linksFromRequestCategories(context.requestItems, ["DATA_QUALITY_CHECKER_SUPPORT"]),
  ]);
  const dqcArtifact = context.evidenceArtifacts.find(
    (artifact) => extractBenchmarkingKind(artifact.metadata) === "DQC_REPORT",
  );
  if (dqcArtifact) {
    items.push(
      buildItem(
        "DQC",
        "data_quality_checker",
        "PASS",
        "A Data Quality Checker artifact is linked for benchmarking review.",
        dqcLinks,
      ),
    );
  } else {
    items.push(
      buildItem(
        "DQC",
        "data_quality_checker",
        "NEEDS_REVIEW",
        "No Data Quality Checker artifact is linked yet. Flag this for verifier review or upload support.",
        dqcLinks,
      ),
    );
  }

  const summary: VerificationEvaluationSummary = {
    passedCount: items.filter((item) => item.status === "PASS").length,
    failedCount: items.filter((item) => item.status === "FAIL").length,
    needsReviewCount: items.filter((item) => item.status === "NEEDS_REVIEW").length,
  };

  return { items, summary };
}

export async function evaluateVerification(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
}): Promise<VerificationEvaluationResult> {
  const logger = createLogger({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    procedure: "verification.evaluate",
  });
  const evaluation = await computeVerificationEvaluation(params);
  const createdAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.verificationItemResult.deleteMany({
      where: {
        organizationId: params.organizationId,
        buildingId: params.buildingId,
        reportingYear: params.reportingYear,
      },
    });

    for (const item of evaluation.items) {
      await tx.verificationItemResult.create({
        data: {
          id: crypto.randomUUID(),
          organizationId: params.organizationId,
          buildingId: params.buildingId,
          reportingYear: params.reportingYear,
          category: item.category,
          key: item.key,
          status: item.status,
          explanation: item.explanation,
          evidenceRefs: item.evidenceRefs,
          createdAt,
        },
      });
    }
  });

  logger.info("Verification evaluation completed", {
    reportingYear: params.reportingYear,
    passedCount: evaluation.summary.passedCount,
    failedCount: evaluation.summary.failedCount,
    needsReviewCount: evaluation.summary.needsReviewCount,
  });

  return evaluation;
}

export async function listVerificationResults(params: {
  organizationId: string;
  buildingId: string;
  reportingYear: number;
}): Promise<VerificationEvaluationResult & { generatedAt: string }> {
  const evaluation = await evaluateVerification(params);

  return {
    ...evaluation,
    generatedAt: new Date().toISOString(),
  };
}
