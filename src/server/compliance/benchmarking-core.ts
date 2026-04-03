import type {
  BuildingOwnershipType,
  EspmShareStatus,
  EvidenceArtifactType,
} from "@/generated/prisma/client";
import {
  type BenchmarkYearDataValidationResult,
  validateBenchmarkYearData,
} from "./data-quality";

export const BENCHMARK_FINDING_CODES = {
  benchmarkingScopeIdentified: "BENCHMARKING_SCOPE_IDENTIFIED",
  benchmarkingDeadlineDetermined: "BENCHMARKING_DEADLINE_DETERMINED",
  missingPropertyId: "MISSING_PROPERTY_ID",
  missingCoverage: "MISSING_COVERAGE",
  overlappingBills: "OVERLAPPING_BILLS",
  pmNotShared: "PM_NOT_SHARED",
  dqcStale: "DQC_STALE",
  verificationRequired: "VERIFICATION_REQUIRED",
  verificationEvidenceMissing: "VERIFICATION_EVIDENCE_MISSING",
  gfaEvidenceMissing: "GFA_EVIDENCE_MISSING",
} as const;

export type BenchmarkFindingCode =
  (typeof BENCHMARK_FINDING_CODES)[keyof typeof BENCHMARK_FINDING_CODES];

export interface BenchmarkReadingInput {
  meterId?: string | null;
  meterType: string;
  source: string;
  periodStart: Date;
  periodEnd: Date;
}

export interface BenchmarkBuildingInput {
  id: string;
  organizationId: string;
  grossSquareFeet: number;
  ownershipType: BuildingOwnershipType;
  doeeBuildingId: string | null;
  espmPropertyId: bigint | number | null;
  espmShareStatus: EspmShareStatus;
}

export interface BenchmarkEvidenceInput {
  id: string;
  artifactType: EvidenceArtifactType;
  name: string;
  artifactRef: string | null;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
  benchmarkSubmission: {
    id: string;
    reportingYear: number;
  } | null;
}

export interface BenchmarkRuleConfig {
  propertyIdPattern?: string | null;
  dqcFreshnessDays?: number | null;
  verification?: {
    minimumGrossSquareFeet?: number | null;
    requiredReportingYears?: number[] | null;
    evidenceKind?: string | null;
  } | null;
  gfaCorrection?: {
    evidenceKind?: string | null;
  } | null;
}

export interface BenchmarkApplicabilityBandConfig {
  ownershipType: BuildingOwnershipType;
  minimumGrossSquareFeet: number;
  maximumGrossSquareFeet?: number | null;
  label?: string | null;
  verificationYears?: number[] | null;
  verificationCadenceYears?: number | null;
  deadlineType?: "MAY_1_FOLLOWING_YEAR" | "WITHIN_DAYS_OF_BENCHMARK_GENERATION" | null;
  deadlineDaysFromGeneration?: number | null;
  manualSubmissionAllowedWhenNotBenchmarkable?: boolean | null;
}

export interface BenchmarkFactorConfig {
  dqcFreshnessDays?: number | null;
  applicabilityBands?: BenchmarkApplicabilityBandConfig[] | null;
}

export interface BenchmarkSubmissionContext {
  id?: string;
  status?: string;
  gfaCorrectionRequired?: boolean;
}

export interface BenchmarkFinding {
  code: BenchmarkFindingCode;
  status: "PASS" | "FAIL";
  severity: "INFO" | "ERROR";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkReadinessResult {
  reportingYear: number;
  evaluatedAt: string;
  status: "READY" | "BLOCKED";
  blocking: boolean;
  reasonCodes: BenchmarkFindingCode[];
  findings: BenchmarkFinding[];
  governance?: {
    rulePackageKey: string;
    ruleVersionId: string;
    ruleVersion: string;
    factorSetKey: string;
    factorSetVersionId: string;
    factorSetVersion: string;
    ownershipTypeUsed: BuildingOwnershipType;
    applicabilityBandLabel: string | null;
    minimumGrossSquareFeet: number | null;
    maximumGrossSquareFeet: number | null;
    requiredReportingYears: number[];
    verificationCadenceYears: number | null;
    deadlineType:
      | "MAY_1_FOLLOWING_YEAR"
      | "WITHIN_DAYS_OF_BENCHMARK_GENERATION"
      | null;
    submissionDueDate: string | null;
    deadlineDaysFromGeneration: number | null;
    manualSubmissionAllowedWhenNotBenchmarkable: boolean;
  };
  summary: {
    scopeState: "IN_SCOPE" | "OUT_OF_SCOPE";
    ownershipTypeUsed: BuildingOwnershipType;
    applicabilityBandLabel: string | null;
    minimumGrossSquareFeet: number | null;
    maximumGrossSquareFeet: number | null;
    requiredReportingYears: number[];
    verificationCadenceYears: number | null;
    deadlineType:
      | "MAY_1_FOLLOWING_YEAR"
      | "WITHIN_DAYS_OF_BENCHMARK_GENERATION"
      | null;
    submissionDueDate: string | null;
    deadlineDaysFromGeneration: number | null;
    manualSubmissionAllowedWhenNotBenchmarkable: boolean;
    coverageComplete: boolean;
    missingCoverageStreams: string[];
    overlapStreams: string[];
    propertyIdState: "PRESENT" | "MISSING" | "INVALID" | "NOT_REQUIRED";
    pmShareState: "READY" | "NOT_READY" | "NOT_REQUIRED";
    dqcFreshnessState: "FRESH" | "STALE" | "MISSING" | "NOT_REQUIRED";
    verificationRequired: boolean;
    verificationEvidencePresent: boolean;
    gfaEvidenceRequired: boolean;
    gfaEvidencePresent: boolean;
  };
}

function addUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function getNestedObject(value: Record<string, unknown> | null | undefined, key: string) {
  const nested = value?.[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return null;
  }

  return nested as Record<string, unknown>;
}

export function normalizeBenchmarkRuleConfig(config: Record<string, unknown>): BenchmarkRuleConfig {
  const requirements = getNestedObject(config, "requirements");
  return (requirements ?? config) as BenchmarkRuleConfig;
}

export function normalizeBenchmarkFactorConfig(
  config: Record<string, unknown>,
): BenchmarkFactorConfig {
  const benchmarking = getNestedObject(config, "benchmarking");
  return (benchmarking ?? config) as BenchmarkFactorConfig;
}

function extractBenchmarkingMetadata(metadata: Record<string, unknown> | null | undefined) {
  const benchmarking = getNestedObject(metadata, "benchmarking");
  return benchmarking ?? metadata ?? {};
}

function extractEvidenceKind(evidence: BenchmarkEvidenceInput) {
  const metadata = extractBenchmarkingMetadata(evidence.metadata);
  const rawKind = metadata["kind"];
  return typeof rawKind === "string" ? rawKind : null;
}

function extractEvidenceReportingYear(evidence: BenchmarkEvidenceInput) {
  if (evidence.benchmarkSubmission?.reportingYear != null) {
    return evidence.benchmarkSubmission.reportingYear;
  }

  const metadata = extractBenchmarkingMetadata(evidence.metadata);
  const rawYear = metadata["reportingYear"];
  return typeof rawYear === "number" ? rawYear : null;
}

function extractEvidenceTimestamp(evidence: BenchmarkEvidenceInput) {
  const metadata = extractBenchmarkingMetadata(evidence.metadata);
  const rawCheckedAt = metadata["checkedAt"];
  if (typeof rawCheckedAt === "string") {
    const parsed = new Date(rawCheckedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return evidence.createdAt;
}

function evaluatePropertyId(
  building: BenchmarkBuildingInput,
  ruleConfig: BenchmarkRuleConfig,
): {
  state: "PRESENT" | "MISSING" | "INVALID";
  finding: BenchmarkFinding;
} {
  const propertyId = building.doeeBuildingId?.trim() ?? "";
  const pattern = ruleConfig.propertyIdPattern ? new RegExp(ruleConfig.propertyIdPattern) : null;

  if (!propertyId) {
    return {
      state: "MISSING",
      finding: {
        code: BENCHMARK_FINDING_CODES.missingPropertyId,
        status: "FAIL",
        severity: "ERROR",
        message: "DC Real Property Unique ID is missing.",
      },
    };
  }

  if (pattern && !pattern.test(propertyId)) {
    return {
      state: "INVALID",
      finding: {
        code: BENCHMARK_FINDING_CODES.missingPropertyId,
        status: "FAIL",
        severity: "ERROR",
        message: "DC Real Property Unique ID is present but does not match the configured format.",
        metadata: {
          propertyId,
          pattern: ruleConfig.propertyIdPattern,
        },
      },
    };
  }

  return {
    state: "PRESENT",
    finding: {
      code: BENCHMARK_FINDING_CODES.missingPropertyId,
      status: "PASS",
      severity: "INFO",
      message: "DC Real Property Unique ID is present.",
      metadata: {
        propertyId,
      },
    },
  };
}

function evaluatePmShare(building: BenchmarkBuildingInput): {
  state: "READY" | "NOT_READY";
  finding: BenchmarkFinding;
} {
  if (!building.espmPropertyId || building.espmShareStatus !== "LINKED") {
    return {
      state: "NOT_READY",
      finding: {
        code: BENCHMARK_FINDING_CODES.pmNotShared,
        status: "FAIL",
        severity: "ERROR",
        message: "ENERGY STAR Portfolio Manager sharing/exchange is not ready.",
        metadata: {
          espmPropertyId: building.espmPropertyId ? String(building.espmPropertyId) : null,
          espmShareStatus: building.espmShareStatus,
        },
      },
    };
  }

  return {
    state: "READY",
    finding: {
      code: BENCHMARK_FINDING_CODES.pmNotShared,
      status: "PASS",
      severity: "INFO",
      message: "ENERGY STAR Portfolio Manager sharing/exchange is ready.",
      metadata: {
        espmPropertyId: String(building.espmPropertyId),
        espmShareStatus: building.espmShareStatus,
      },
    },
  };
}

function determineVerificationRequirement(
  building: BenchmarkBuildingInput,
  reportingYear: number,
  ruleConfig: BenchmarkRuleConfig,
) {
  const minimumGrossSquareFeet = ruleConfig.verification?.minimumGrossSquareFeet ?? 0;
  const requiredReportingYears = ruleConfig.verification?.requiredReportingYears ?? [];

  return (
    requiredReportingYears.includes(reportingYear) &&
    building.grossSquareFeet >= minimumGrossSquareFeet
  );
}

function normalizeApplicabilityBands(
  factorConfig: BenchmarkFactorConfig,
): BenchmarkApplicabilityBandConfig[] {
  return Array.isArray(factorConfig.applicabilityBands)
    ? factorConfig.applicabilityBands.filter(
        (band): band is BenchmarkApplicabilityBandConfig =>
          band != null &&
          typeof band === "object" &&
          typeof band.minimumGrossSquareFeet === "number" &&
          (band.ownershipType === "PRIVATE" || band.ownershipType === "DISTRICT"),
      )
    : [];
}

function findBenchmarkApplicabilityBand(
  building: BenchmarkBuildingInput,
  factorConfig: BenchmarkFactorConfig,
) {
  const bands = normalizeApplicabilityBands(factorConfig);
  return (
    bands.find((band) => {
      if (band.ownershipType !== building.ownershipType) {
        return false;
      }

      if (building.grossSquareFeet < band.minimumGrossSquareFeet) {
        return false;
      }

      if (
        typeof band.maximumGrossSquareFeet === "number" &&
        building.grossSquareFeet > band.maximumGrossSquareFeet
      ) {
        return false;
      }

      return true;
    }) ?? null
  );
}

function isVerificationYearForBand(
  reportingYear: number,
  band: BenchmarkApplicabilityBandConfig | null,
) {
  if (!band) {
    return false;
  }

  const verificationYears = Array.isArray(band.verificationYears)
    ? band.verificationYears.filter((year): year is number => Number.isFinite(year))
    : [];

  if (verificationYears.includes(reportingYear)) {
    return true;
  }

  const cadenceYears = band.verificationCadenceYears;
  if (
    typeof cadenceYears !== "number" ||
    cadenceYears <= 0 ||
    verificationYears.length === 0
  ) {
    return false;
  }

  const anchorYear = Math.max(...verificationYears);
  return reportingYear > anchorYear && (reportingYear - anchorYear) % cadenceYears === 0;
}

function resolveBenchmarkingDeadline(
  reportingYear: number,
  band: BenchmarkApplicabilityBandConfig | null,
) {
  if (!band?.deadlineType) {
    return {
      deadlineType: null,
      submissionDueDate: null,
      deadlineDaysFromGeneration: null,
    };
  }

  if (band.deadlineType === "MAY_1_FOLLOWING_YEAR") {
    return {
      deadlineType: band.deadlineType,
      submissionDueDate: new Date(Date.UTC(reportingYear + 1, 4, 1)).toISOString(),
      deadlineDaysFromGeneration: null,
    };
  }

  return {
    deadlineType: band.deadlineType,
    submissionDueDate: null,
    deadlineDaysFromGeneration: band.deadlineDaysFromGeneration ?? 60,
  };
}

function findEvidenceForYear(
  evidenceArtifacts: BenchmarkEvidenceInput[],
  reportingYear: number,
  kind: string,
) {
  return evidenceArtifacts.filter((artifact) => {
    return (
      extractEvidenceKind(artifact) === kind &&
      extractEvidenceReportingYear(artifact) === reportingYear
    );
  });
}

export function evaluateBenchmarkReadinessData(input: {
  building: BenchmarkBuildingInput;
  readings: BenchmarkReadingInput[];
  evidenceArtifacts: BenchmarkEvidenceInput[];
  reportingYear: number;
  ruleConfig?: BenchmarkRuleConfig;
  factorConfig?: BenchmarkFactorConfig;
  submissionContext?: BenchmarkSubmissionContext | null;
  evaluatedAt?: Date;
}): BenchmarkReadinessResult {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const ruleConfig = input.ruleConfig ?? {};
  const factorConfig = input.factorConfig ?? {};
  const applicabilityBand = findBenchmarkApplicabilityBand(input.building, factorConfig);
  const scopeState = applicabilityBand ? "IN_SCOPE" : "OUT_OF_SCOPE";
  const deadline = resolveBenchmarkingDeadline(input.reportingYear, applicabilityBand);
  const manualSubmissionAllowedWhenNotBenchmarkable =
    applicabilityBand?.manualSubmissionAllowedWhenNotBenchmarkable ?? false;

  if (scopeState === "OUT_OF_SCOPE") {
    const findings: BenchmarkFinding[] = [
      {
        code: BENCHMARK_FINDING_CODES.benchmarkingScopeIdentified,
        status: "PASS",
        severity: "INFO",
        message:
          "Building is outside the governed benchmarking scope bands for the requested reporting year.",
        metadata: {
          ownershipType: input.building.ownershipType,
          grossSquareFeet: input.building.grossSquareFeet,
        },
      },
      {
        code: BENCHMARK_FINDING_CODES.benchmarkingDeadlineDetermined,
        status: "PASS",
        severity: "INFO",
        message: "No governed benchmarking deadline applies because the building is out of scope.",
      },
      {
        code: BENCHMARK_FINDING_CODES.verificationRequired,
        status: "PASS",
        severity: "INFO",
        message:
          "Third-party verification is not required because the building is outside the governed benchmarking scope bands.",
      },
    ];

    return {
      reportingYear: input.reportingYear,
      evaluatedAt: evaluatedAt.toISOString(),
      status: "READY",
      blocking: false,
      reasonCodes: [],
      findings,
      summary: {
        scopeState,
        ownershipTypeUsed: input.building.ownershipType,
        applicabilityBandLabel: null,
        minimumGrossSquareFeet: null,
        maximumGrossSquareFeet: null,
        requiredReportingYears: [],
        verificationCadenceYears: null,
        deadlineType: null,
        submissionDueDate: null,
        deadlineDaysFromGeneration: null,
        manualSubmissionAllowedWhenNotBenchmarkable,
        coverageComplete: false,
        missingCoverageStreams: [],
        overlapStreams: [],
        propertyIdState: "NOT_REQUIRED",
        pmShareState: "NOT_REQUIRED",
        dqcFreshnessState: "NOT_REQUIRED",
        verificationRequired: false,
        verificationEvidencePresent: false,
        gfaEvidenceRequired: false,
        gfaEvidencePresent: false,
      },
    };
  }

  const coverage: BenchmarkYearDataValidationResult = validateBenchmarkYearData(
    input.readings,
    input.reportingYear,
  );
  const propertyId = evaluatePropertyId(input.building, ruleConfig);
  const pmShare = evaluatePmShare(input.building);
  const dqcFreshnessDays = factorConfig.dqcFreshnessDays ?? ruleConfig.dqcFreshnessDays ?? 30;
  const dqcArtifacts = findEvidenceForYear(input.evidenceArtifacts, input.reportingYear, "DQC_REPORT");
  const freshestDqc = dqcArtifacts
    .map((artifact) => extractEvidenceTimestamp(artifact))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const dqcState =
    !freshestDqc
      ? "MISSING"
      : addUtcDays(freshestDqc, dqcFreshnessDays) < evaluatedAt
        ? "STALE"
        : "FRESH";
  const verificationRequired =
    normalizeApplicabilityBands(factorConfig).length > 0
      ? isVerificationYearForBand(input.reportingYear, applicabilityBand)
      : determineVerificationRequirement(input.building, input.reportingYear, ruleConfig);
  const verificationEvidenceKind = ruleConfig.verification?.evidenceKind ?? "VERIFICATION";
  const verificationArtifacts = findEvidenceForYear(
    input.evidenceArtifacts,
    input.reportingYear,
    verificationEvidenceKind,
  );
  const verificationEvidencePresent = verificationArtifacts.length > 0;
  const gfaEvidenceKind = ruleConfig.gfaCorrection?.evidenceKind ?? "GFA_CORRECTION";
  const gfaCorrectionRequired = input.submissionContext?.gfaCorrectionRequired ?? false;
  const gfaArtifacts = findEvidenceForYear(input.evidenceArtifacts, input.reportingYear, gfaEvidenceKind);
  const gfaEvidencePresent = gfaArtifacts.length > 0;

  const findings: BenchmarkFinding[] = [];

  findings.push({
    code: BENCHMARK_FINDING_CODES.benchmarkingScopeIdentified,
    status: "PASS",
    severity: "INFO",
    message: "Benchmarking scope was resolved from the active governed rule set.",
    metadata: {
      ownershipType: input.building.ownershipType,
      grossSquareFeet: input.building.grossSquareFeet,
      applicabilityBandLabel: applicabilityBand?.label ?? null,
      minimumGrossSquareFeet: applicabilityBand?.minimumGrossSquareFeet ?? null,
      maximumGrossSquareFeet: applicabilityBand?.maximumGrossSquareFeet ?? null,
    },
  });
  findings.push({
    code: BENCHMARK_FINDING_CODES.benchmarkingDeadlineDetermined,
    status: "PASS",
    severity: "INFO",
    message:
      deadline.deadlineType === "MAY_1_FOLLOWING_YEAR"
        ? "Private benchmarking deadline resolves to May 1 of the following year."
        : "District/public benchmarking deadline resolves relative to benchmark generation.",
    metadata: {
      deadlineType: deadline.deadlineType,
      submissionDueDate: deadline.submissionDueDate,
      deadlineDaysFromGeneration: deadline.deadlineDaysFromGeneration,
      manualSubmissionAllowedWhenNotBenchmarkable,
    },
  });
  findings.push(propertyId.finding);

  if (coverage.verdict === "FAIL" && coverage.missingCoverageStreams.length > 0) {
    findings.push({
      code: BENCHMARK_FINDING_CODES.missingCoverage,
      status: "FAIL",
      severity: "ERROR",
      message: "Utility data does not fully cover the reporting year without gaps.",
      metadata: {
        missingCoverageStreams: coverage.missingCoverageStreams,
        gapDetails: coverage.gapDetails,
      },
    });
  } else {
    findings.push({
      code: BENCHMARK_FINDING_CODES.missingCoverage,
      status: "PASS",
      severity: "INFO",
      message: "Utility data covers the full reporting year.",
      metadata: {
        streamCoverage: coverage.streamCoverage,
      },
    });
  }

  if (coverage.verdict === "FAIL" && coverage.overlapStreams.length > 0) {
    findings.push({
      code: BENCHMARK_FINDING_CODES.overlappingBills,
      status: "FAIL",
      severity: "ERROR",
      message: "Overlapping billing periods were detected in utility data.",
      metadata: {
        overlapStreams: coverage.overlapStreams,
        overlapDetails: coverage.overlapDetails,
      },
    });
  } else {
    findings.push({
      code: BENCHMARK_FINDING_CODES.overlappingBills,
      status: "PASS",
      severity: "INFO",
      message: "No overlapping billing periods were detected.",
    });
  }

  findings.push(pmShare.finding);

  if (dqcState === "FRESH") {
    findings.push({
      code: BENCHMARK_FINDING_CODES.dqcStale,
      status: "PASS",
      severity: "INFO",
      message: "Data Quality Checker evidence is fresh enough for submission.",
      metadata: {
        checkedAt: freshestDqc?.toISOString() ?? null,
        freshnessDays: dqcFreshnessDays,
      },
    });
  } else {
    findings.push({
      code: BENCHMARK_FINDING_CODES.dqcStale,
      status: "FAIL",
      severity: "ERROR",
      message:
        dqcState === "MISSING"
          ? "Data Quality Checker evidence is missing."
          : "Data Quality Checker evidence is stale.",
      metadata: {
        checkedAt: freshestDqc?.toISOString() ?? null,
        freshnessDays: dqcFreshnessDays,
      },
    });
  }

  findings.push({
    code: BENCHMARK_FINDING_CODES.verificationRequired,
    status: "PASS",
    severity: "INFO",
    message: verificationRequired
      ? "Third-party verification is required for this building/year."
      : "Third-party verification is not required for this building/year.",
    metadata: {
      reportingYear: input.reportingYear,
      grossSquareFeet: input.building.grossSquareFeet,
      applicabilityBandLabel: applicabilityBand?.label ?? null,
      minimumGrossSquareFeet:
        applicabilityBand?.minimumGrossSquareFeet ??
        ruleConfig.verification?.minimumGrossSquareFeet ??
        null,
      maximumGrossSquareFeet: applicabilityBand?.maximumGrossSquareFeet ?? null,
      requiredReportingYears: applicabilityBand
        ? (applicabilityBand.verificationYears ?? [])
        : (ruleConfig.verification?.requiredReportingYears ?? []),
      verificationCadenceYears: applicabilityBand?.verificationCadenceYears ?? null,
    },
  });

  if (verificationRequired && !verificationEvidencePresent) {
    findings.push({
      code: BENCHMARK_FINDING_CODES.verificationEvidenceMissing,
      status: "FAIL",
      severity: "ERROR",
      message: "Required third-party verification evidence is missing.",
      metadata: {
        evidenceKind: verificationEvidenceKind,
      },
    });
  } else {
    findings.push({
      code: BENCHMARK_FINDING_CODES.verificationEvidenceMissing,
      status: "PASS",
      severity: "INFO",
      message: verificationRequired
        ? "Required verification evidence is present."
        : "Verification evidence is not required.",
      metadata: {
        evidenceKind: verificationEvidenceKind,
      },
    });
  }

  if (gfaCorrectionRequired && !gfaEvidencePresent) {
    findings.push({
      code: BENCHMARK_FINDING_CODES.gfaEvidenceMissing,
      status: "FAIL",
      severity: "ERROR",
      message: "Gross floor area correction evidence is required but missing.",
      metadata: {
        evidenceKind: gfaEvidenceKind,
      },
    });
  } else {
    findings.push({
      code: BENCHMARK_FINDING_CODES.gfaEvidenceMissing,
      status: "PASS",
      severity: "INFO",
      message: gfaCorrectionRequired
        ? "Gross floor area correction evidence is present."
        : "Gross floor area correction evidence is not required.",
      metadata: {
        evidenceKind: gfaEvidenceKind,
      },
    });
  }

  const blockingFindings = findings.filter((finding) => finding.status === "FAIL");
  const reasonCodes = blockingFindings.map((finding) => finding.code);

  return {
    reportingYear: input.reportingYear,
    evaluatedAt: evaluatedAt.toISOString(),
    status: blockingFindings.length > 0 ? "BLOCKED" : "READY",
    blocking: blockingFindings.length > 0,
    reasonCodes,
    findings,
    summary: {
      scopeState,
      ownershipTypeUsed: input.building.ownershipType,
      applicabilityBandLabel: applicabilityBand?.label ?? null,
      minimumGrossSquareFeet:
        applicabilityBand?.minimumGrossSquareFeet ??
        ruleConfig.verification?.minimumGrossSquareFeet ??
        null,
      maximumGrossSquareFeet: applicabilityBand?.maximumGrossSquareFeet ?? null,
      requiredReportingYears: applicabilityBand
        ? (applicabilityBand.verificationYears ?? [])
        : (ruleConfig.verification?.requiredReportingYears ?? []),
      verificationCadenceYears: applicabilityBand?.verificationCadenceYears ?? null,
      deadlineType: deadline.deadlineType,
      submissionDueDate: deadline.submissionDueDate,
      deadlineDaysFromGeneration: deadline.deadlineDaysFromGeneration,
      manualSubmissionAllowedWhenNotBenchmarkable,
      coverageComplete: coverage.coverageComplete,
      missingCoverageStreams: coverage.missingCoverageStreams,
      overlapStreams: coverage.overlapStreams,
      propertyIdState: propertyId.state,
      pmShareState: pmShare.state,
      dqcFreshnessState: dqcState,
      verificationRequired,
      verificationEvidencePresent,
      gfaEvidenceRequired: gfaCorrectionRequired,
      gfaEvidencePresent,
    },
  };
}
