import type { ActorType, ComplianceCycle } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import {
  DATA_QUALITY_ISSUE_TYPES,
  type DataQualityError,
  NotFoundError,
} from "@/server/lib/errors";
import { getLatestComplianceSnapshot } from "@/server/lib/compliance-snapshots";
import { createLogger } from "@/server/lib/logger";
import { validateBenchmarkYearData } from "./data-quality";
import {
  BOOTSTRAP_FACTOR_SET_KEY,
  BOOTSTRAP_RULE_PACKAGE_KEYS,
  getActiveFactorSetVersion,
  getActiveRuleVersion,
  recordComplianceEvaluation,
} from "./provenance";
import {
  evaluateBenchmarkReadinessData,
  normalizeBenchmarkFactorConfig,
  normalizeBenchmarkRuleConfig,
  type BenchmarkEvidenceInput,
  type BenchmarkReadinessResult,
  type BenchmarkReadingInput,
  type BenchmarkSubmissionContext,
} from "./benchmarking-core";
import { evaluateBepsApplicability } from "./beps/applicability";
import { getCanonicalBepsInputState } from "./beps/canonical-inputs";
import { resolveGovernedFilingYear } from "./beps/config";
import { getActiveBepsCycleContext } from "./beps/cycle-registry";
import { evaluateBepsData } from "./beps/beps-evaluator";
import { refreshDerivedBepsMetricInput } from "./beps/metric-derivation";
import type {
  BepsEvaluationOverrides,
  BepsEvaluationResult,
  BepsMetricBasis,
  BepsPathwayType,
  BepsSnapshotInput,
} from "./beps/types";
import { toBuildingSelectedPathway } from "@/lib/contracts/beps";

const COMPLIANCE_ENGINE_REASON_CODES = {
  qaGateFailed: "QA_GATE_FAILED",
  qaYearUnresolved: "QA_YEAR_UNRESOLVED",
  qaDirectYearReadingsMissing: "QA_DIRECT_YEAR_READINGS_MISSING",
} as const;

export const COMPLIANCE_ENGINE_STATUS = {
  COMPUTED: "COMPUTED",
  BLOCKED: "BLOCKED",
  UNRESOLVED: "UNRESOLVED",
} as const;

export const COMPLIANCE_ENGINE_APPLICABILITY = {
  APPLICABLE: "APPLICABLE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
  UNKNOWN: "UNKNOWN",
} as const;

export const COMPLIANCE_ENGINE_QA_GATE = {
  PASSED: "PASSED",
  PROCEEDED_WITH_WARNINGS: "PROCEEDED_WITH_WARNINGS",
  BLOCKED: "BLOCKED",
} as const;

export type ComplianceEngineScope = "BENCHMARKING" | "BEPS";
export type ComplianceEngineStatus =
  (typeof COMPLIANCE_ENGINE_STATUS)[keyof typeof COMPLIANCE_ENGINE_STATUS];
export type ComplianceEngineApplicability =
  (typeof COMPLIANCE_ENGINE_APPLICABILITY)[keyof typeof COMPLIANCE_ENGINE_APPLICABILITY];
export type ComplianceEngineQaGate =
  (typeof COMPLIANCE_ENGINE_QA_GATE)[keyof typeof COMPLIANCE_ENGINE_QA_GATE];

export interface ComplianceEngineQaIssue {
  issueType: string;
  message: string;
  details: Record<string, unknown>;
}

export interface ComplianceEngineQaResult {
  verdict: "PASS" | "WARN" | "FAIL";
  gate: ComplianceEngineQaGate;
  targetYear: number | null;
  issues: ComplianceEngineQaIssue[];
}

export interface ComplianceEngineResult {
  engineVersion: "v1";
  scope: ComplianceEngineScope;
  status: ComplianceEngineStatus;
  applicability: ComplianceEngineApplicability;
  reportingYear: number;
  rulePackageKey: string;
  ruleVersionId: string;
  ruleVersion: string;
  factorSetKey: string;
  factorSetVersionId: string;
  factorSetVersion: string;
  metricUsed: string | null;
  qa: ComplianceEngineQaResult;
  reasonCodes: string[];
  decision: {
    meetsStandard: boolean | null;
    blocked: boolean;
    insufficientData: boolean;
  };
  domainResult: Record<string, unknown>;
}

type ComplianceProvenance = Awaited<ReturnType<typeof recordComplianceEvaluation>>;

export interface BenchmarkComplianceRequest {
  scope: "BENCHMARKING";
  organizationId: string;
  buildingId: string;
  reportingYear: number;
  submissionContext?: BenchmarkSubmissionContext | null;
  producedByType: ActorType;
  producedById?: string | null;
  requestId?: string | null;
}

export interface BenchmarkComplianceEvaluation {
  scope: "BENCHMARKING";
  engineResult: ComplianceEngineResult;
  readiness: BenchmarkReadinessResult;
  provenance: ComplianceProvenance;
  ruleVersion: {
    id: string;
    version: string;
    implementationKey: string;
  };
  factorSetVersion: {
    id: string;
    key: string;
    version: string;
  };
}

export interface BepsComplianceRequest {
  scope: "BEPS";
  organizationId: string;
  buildingId: string;
  cycle: ComplianceCycle;
  reportingYear?: number | null;
  overrides?: BepsEvaluationOverrides;
  producedByType: ActorType;
  producedById?: string | null;
  requestId?: string | null;
}

export interface BepsComplianceEvaluation {
  scope: "BEPS";
  engineResult: ComplianceEngineResult;
  evaluation: BepsEvaluationResult | null;
  provenance: ComplianceProvenance;
  ruleVersion: {
    id: string;
    version: string;
    implementationKey: string;
  };
  factorSetVersion: {
    id: string;
    key: string;
    version: string;
  };
  filingYear: number;
}

export type ComplianceEngineRequest =
  | BenchmarkComplianceRequest
  | BepsComplianceRequest;

export type ComplianceEngineEvaluation =
  | BenchmarkComplianceEvaluation
  | BepsComplianceEvaluation;

function toJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapQaIssues(issues: DataQualityError[]): ComplianceEngineQaIssue[] {
  return issues.map((issue) => ({
    issueType: issue.issueType,
    message: issue.message,
    details: toJsonObject(issue.details),
  }));
}

function createQaResult(input: {
  verdict: "PASS" | "WARN" | "FAIL";
  targetYear: number | null;
  issues: ComplianceEngineQaIssue[];
}): ComplianceEngineQaResult {
  return {
    verdict: input.verdict,
    gate:
      input.verdict === "PASS"
        ? COMPLIANCE_ENGINE_QA_GATE.PASSED
        : input.verdict === "WARN"
          ? COMPLIANCE_ENGINE_QA_GATE.PROCEEDED_WITH_WARNINGS
          : COMPLIANCE_ENGINE_QA_GATE.BLOCKED,
    targetYear: input.targetYear,
    issues: input.issues,
  };
}

function resolveQaReasonCodes(qa: ComplianceEngineQaResult): string[] {
  if (qa.gate === COMPLIANCE_ENGINE_QA_GATE.BLOCKED) {
    return [COMPLIANCE_ENGINE_REASON_CODES.qaGateFailed];
  }

  if (qa.gate !== COMPLIANCE_ENGINE_QA_GATE.PROCEEDED_WITH_WARNINGS) {
    return [];
  }

  const issueTypes = new Set(qa.issues.map((issue) => issue.issueType));
  if (issueTypes.has(DATA_QUALITY_ISSUE_TYPES.UNRESOLVED_REPORTING_YEAR)) {
    return [COMPLIANCE_ENGINE_REASON_CODES.qaYearUnresolved];
  }

  if (issueTypes.has(DATA_QUALITY_ISSUE_TYPES.NO_DIRECT_YEAR_READINGS)) {
    return [COMPLIANCE_ENGINE_REASON_CODES.qaDirectYearReadingsMissing];
  }

  return [];
}

function toSnapshotInput(snapshot: {
  id: string;
  snapshotDate: Date;
  energyStarScore: number | null;
  siteEui: number | null;
  sourceEui: number | null;
  weatherNormalizedSiteEui: number | null;
  weatherNormalizedSourceEui: number | null;
  complianceStatus: string;
  complianceGap: number | null;
  estimatedPenalty: number | null;
  dataQualityScore: number | null;
  activePathway: string | null;
  targetEui: number | null;
  penaltyInputsJson: unknown;
} | null): BepsSnapshotInput | null {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    penaltyInputsJson: toJsonObject(snapshot.penaltyInputsJson),
  };
}

function resolveBepsMetricUsed(evaluation: BepsEvaluationResult): BepsMetricBasis | null {
  if (!evaluation.selectedPathway) {
    return null;
  }

  const lookup: Partial<Record<BepsPathwayType, BepsMetricBasis | null>> = {
    PERFORMANCE: evaluation.pathwayResults.performance?.metricBasis ?? null,
    STANDARD_TARGET: evaluation.pathwayResults.standardTarget?.metricBasis ?? null,
    PRESCRIPTIVE: evaluation.pathwayResults.prescriptive?.metricBasis ?? null,
    TRAJECTORY: evaluation.pathwayResults.trajectory?.metricBasis ?? null,
  };

  return lookup[evaluation.selectedPathway] ?? null;
}

async function evaluateBenchmarkingCompliance(
  input: BenchmarkComplianceRequest,
): Promise<BenchmarkComplianceEvaluation> {
  const logger = createLogger({
    requestId: input.requestId ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    userId: input.producedById ?? null,
    procedure: "compliance-engine.benchmarking",
  });

  await createAuditLog({
    actorType: input.producedByType,
    actorId: input.producedById ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    action: "COMPLIANCE_ENGINE_BENCHMARKING_STARTED",
    inputSnapshot: {
      reportingYear: input.reportingYear,
      submissionContext: input.submissionContext ?? null,
    },
    requestId: input.requestId ?? null,
  });

  try {
    const [building, readings, evidenceArtifacts, activeRuleVersion, activeFactorSetVersion] =
      await Promise.all([
        prisma.building.findFirst({
          where: {
            id: input.buildingId,
            organizationId: input.organizationId,
          },
          select: {
            id: true,
            organizationId: true,
            grossSquareFeet: true,
            ownershipType: true,
            doeeBuildingId: true,
            espmPropertyId: true,
            espmShareStatus: true,
          },
        }),
        prisma.energyReading.findMany({
          where: {
            buildingId: input.buildingId,
            organizationId: input.organizationId,
            periodEnd: {
              gte: new Date(Date.UTC(input.reportingYear, 0, 1)),
            },
            periodStart: {
              lte: new Date(Date.UTC(input.reportingYear, 11, 31)),
            },
          },
          orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }],
          select: {
            meterId: true,
            meterType: true,
            source: true,
            periodStart: true,
            periodEnd: true,
          },
        }),
        prisma.evidenceArtifact.findMany({
          where: {
            organizationId: input.organizationId,
            buildingId: input.buildingId,
          },
          include: {
            benchmarkSubmission: {
              select: {
                id: true,
                reportingYear: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        getActiveRuleVersion(BOOTSTRAP_RULE_PACKAGE_KEYS.benchmarking2025),
        getActiveFactorSetVersion(BOOTSTRAP_FACTOR_SET_KEY),
      ]);

    if (!building) {
      throw new NotFoundError("Building not found for compliance evaluation");
    }

    const qaValidation = validateBenchmarkYearData(readings, input.reportingYear);
    const qa = createQaResult({
      verdict: qaValidation.verdict,
      targetYear: input.reportingYear,
      issues: mapQaIssues(qaValidation.issues),
    });

    const ruleConfig = normalizeBenchmarkRuleConfig(toJsonObject(activeRuleVersion.configJson));
    const factorConfig = normalizeBenchmarkFactorConfig(
      toJsonObject(activeFactorSetVersion.factorsJson),
    );
    const baseReadiness = evaluateBenchmarkReadinessData({
      building,
      readings: readings as BenchmarkReadingInput[],
      evidenceArtifacts: evidenceArtifacts.map(
        (artifact): BenchmarkEvidenceInput => ({
          id: artifact.id,
          artifactType: artifact.artifactType,
          name: artifact.name,
          artifactRef: artifact.artifactRef,
          createdAt: artifact.createdAt,
          metadata: toJsonObject(artifact.metadata),
          benchmarkSubmission: artifact.benchmarkSubmission,
        }),
      ),
      reportingYear: input.reportingYear,
      ruleConfig,
      factorConfig,
      submissionContext: input.submissionContext ?? null,
    });

    const readiness: BenchmarkReadinessResult = {
      ...baseReadiness,
      governance: {
        rulePackageKey: BOOTSTRAP_RULE_PACKAGE_KEYS.benchmarking2025,
        ruleVersionId: activeRuleVersion.id,
        ruleVersion: activeRuleVersion.version,
        factorSetKey: BOOTSTRAP_FACTOR_SET_KEY,
        factorSetVersionId: activeFactorSetVersion.id,
        factorSetVersion: activeFactorSetVersion.version,
        ownershipTypeUsed: baseReadiness.summary.ownershipTypeUsed,
        applicabilityBandLabel: baseReadiness.summary.applicabilityBandLabel,
        minimumGrossSquareFeet: baseReadiness.summary.minimumGrossSquareFeet,
        maximumGrossSquareFeet: baseReadiness.summary.maximumGrossSquareFeet,
        requiredReportingYears: baseReadiness.summary.requiredReportingYears,
        verificationCadenceYears: baseReadiness.summary.verificationCadenceYears,
        deadlineType: baseReadiness.summary.deadlineType,
        submissionDueDate: baseReadiness.summary.submissionDueDate,
        deadlineDaysFromGeneration: baseReadiness.summary.deadlineDaysFromGeneration,
        manualSubmissionAllowedWhenNotBenchmarkable:
          baseReadiness.summary.manualSubmissionAllowedWhenNotBenchmarkable,
      },
    };

    const reasonCodes = [...resolveQaReasonCodes(qa), ...readiness.reasonCodes];

    const engineResult: ComplianceEngineResult = {
      engineVersion: "v1",
      scope: "BENCHMARKING",
      status:
        qa.gate === COMPLIANCE_ENGINE_QA_GATE.BLOCKED || readiness.blocking
          ? COMPLIANCE_ENGINE_STATUS.BLOCKED
          : COMPLIANCE_ENGINE_STATUS.COMPUTED,
      applicability:
        readiness.summary.scopeState === "OUT_OF_SCOPE"
          ? COMPLIANCE_ENGINE_APPLICABILITY.NOT_APPLICABLE
          : COMPLIANCE_ENGINE_APPLICABILITY.APPLICABLE,
      reportingYear: input.reportingYear,
      rulePackageKey: BOOTSTRAP_RULE_PACKAGE_KEYS.benchmarking2025,
      ruleVersionId: activeRuleVersion.id,
      ruleVersion: activeRuleVersion.version,
      factorSetKey: BOOTSTRAP_FACTOR_SET_KEY,
      factorSetVersionId: activeFactorSetVersion.id,
      factorSetVersion: activeFactorSetVersion.version,
      metricUsed: "ANNUAL_BENCHMARKING_READINESS",
      qa,
      reasonCodes,
      decision: {
        meetsStandard: readiness.status === "READY",
        blocked:
          qa.gate === COMPLIANCE_ENGINE_QA_GATE.BLOCKED || readiness.blocking,
        insufficientData: qa.gate === COMPLIANCE_ENGINE_QA_GATE.BLOCKED,
      },
      domainResult: {
        readiness,
      },
    };

    const provenance = await recordComplianceEvaluation({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      ruleVersionId: activeRuleVersion.id,
      factorSetVersionId: activeFactorSetVersion.id,
      runType: "BENCHMARKING_EVALUATION",
      status: "SUCCEEDED",
      inputSnapshotRef: `benchmarking:${input.reportingYear}`,
      inputSnapshotPayload: {
        reportingYear: input.reportingYear,
        building,
        submissionContext: input.submissionContext ?? null,
        readings,
        evidenceArtifactIds: evidenceArtifacts.map((artifact) => artifact.id),
      },
      resultPayload: {
        engineResult,
        readiness,
      },
      producedByType: input.producedByType,
      producedById: input.producedById ?? null,
      manifest: {
        implementationKey: "compliance-engine/benchmarking-v1",
        payload: {
          rulePackageKey: BOOTSTRAP_RULE_PACKAGE_KEYS.benchmarking2025,
          factorSetKey: BOOTSTRAP_FACTOR_SET_KEY,
          reportingYear: input.reportingYear,
          qa,
        },
      },
      evidenceArtifacts: [
        {
          artifactType: "CALCULATION_OUTPUT",
          name: `Benchmark readiness result ${input.reportingYear}`,
          artifactRef: `benchmarking_readiness:${input.reportingYear}`,
          metadata: {
            benchmarking: {
              kind: "READINESS_RESULT",
              reportingYear: input.reportingYear,
              status: readiness.status,
              reasonCodes: readiness.reasonCodes,
              qa,
            },
          },
        },
      ],
    });

    await createAuditLog({
      actorType: input.producedByType,
      actorId: input.producedById ?? null,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      action: "COMPLIANCE_ENGINE_BENCHMARKING_SUCCEEDED",
      outputSnapshot: {
        reportingYear: input.reportingYear,
        complianceRunId: provenance.complianceRun.id,
        status: engineResult.status,
        qaVerdict: qa.verdict,
        reasonCodes,
      },
      requestId: input.requestId ?? null,
    });

    logger.info("Benchmarking compliance evaluated", {
      reportingYear: input.reportingYear,
      complianceRunId: provenance.complianceRun.id,
      status: engineResult.status,
      qaVerdict: qa.verdict,
    });

    return {
      scope: "BENCHMARKING",
      engineResult,
      readiness,
      provenance,
      ruleVersion: {
        id: activeRuleVersion.id,
        version: activeRuleVersion.version,
        implementationKey: activeRuleVersion.implementationKey,
      },
      factorSetVersion: {
        id: activeFactorSetVersion.id,
        key: activeFactorSetVersion.key,
        version: activeFactorSetVersion.version,
      },
    };
  } catch (error) {
    await createAuditLog({
      actorType: input.producedByType,
      actorId: input.producedById ?? null,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      action: "COMPLIANCE_ENGINE_BENCHMARKING_FAILED",
      errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      outputSnapshot: {
        reportingYear: input.reportingYear,
      },
      requestId: input.requestId ?? null,
    });
    throw error;
  }
}

async function evaluateBepsCompliance(input: BepsComplianceRequest): Promise<BepsComplianceEvaluation> {
  const logger = createLogger({
    requestId: input.requestId ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    userId: input.producedById ?? null,
    procedure: "compliance-engine.beps",
  });

  await createAuditLog({
    actorType: input.producedByType,
    actorId: input.producedById ?? null,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    action: "COMPLIANCE_ENGINE_BEPS_STARTED",
    inputSnapshot: {
      cycle: input.cycle,
      reportingYear: input.reportingYear ?? null,
      overrides: input.overrides ?? {},
    },
    requestId: input.requestId ?? null,
  });

  try {
    const [building, latestSnapshot, historicalMetrics, cycleContext] = await Promise.all([
      prisma.building.findFirst({
        where: {
          id: input.buildingId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          organizationId: true,
          grossSquareFeet: true,
          propertyType: true,
          ownershipType: true,
          yearBuilt: true,
          bepsTargetScore: true,
          complianceCycle: true,
          selectedPathway: true,
          baselineYear: true,
          targetEui: true,
          maxPenaltyExposure: true,
          isEnergyStarScoreEligible: true,
        },
      }),
      getLatestComplianceSnapshot(prisma, {
        buildingId: input.buildingId,
        organizationId: input.organizationId,
        select: {
          id: true,
          snapshotDate: true,
          energyStarScore: true,
          siteEui: true,
          sourceEui: true,
          weatherNormalizedSiteEui: true,
          weatherNormalizedSourceEui: true,
          complianceStatus: true,
          complianceGap: true,
          estimatedPenalty: true,
          dataQualityScore: true,
          activePathway: true,
          targetEui: true,
          penaltyInputsJson: true,
        },
      }),
      prisma.complianceSnapshot.findMany({
        where: {
          buildingId: input.buildingId,
          organizationId: input.organizationId,
        },
        orderBy: [{ snapshotDate: "asc" }, { id: "asc" }],
        select: {
          id: true,
          snapshotDate: true,
          siteEui: true,
          weatherNormalizedSiteEui: true,
          weatherNormalizedSourceEui: true,
          energyStarScore: true,
        },
      }),
      getActiveBepsCycleContext(input.cycle),
    ]);

    if (!building) {
      throw new NotFoundError("Building not found for BEPS compliance evaluation");
    }

    const filingYear = resolveGovernedFilingYear(
      input.cycle,
      cycleContext.ruleConfig,
      cycleContext.factorConfig,
      input.overrides?.filingYear ?? input.reportingYear ?? null,
    );

    await refreshDerivedBepsMetricInput({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      cycle: input.cycle,
      filingYear,
      ruleConfig: cycleContext.ruleConfig,
      factorConfig: cycleContext.factorConfig,
    });

    const canonicalInputs = await getCanonicalBepsInputState({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      cycle: input.cycle,
      filingYear,
    });

    const qaTargetYear =
      canonicalInputs.metricInput?.evaluationYearEnd ??
      canonicalInputs.metricInput?.comparisonYear ??
      latestSnapshot?.snapshotDate.getUTCFullYear() ??
      null;

    const qaReadings =
      qaTargetYear == null
        ? []
        : await prisma.energyReading.findMany({
            where: {
              organizationId: input.organizationId,
              buildingId: input.buildingId,
              periodEnd: {
                gte: new Date(Date.UTC(qaTargetYear, 0, 1)),
              },
              periodStart: {
                lte: new Date(Date.UTC(qaTargetYear, 11, 31)),
              },
            },
            orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }],
            select: {
              meterId: true,
              meterType: true,
              source: true,
              periodStart: true,
              periodEnd: true,
            },
          });

    const qaValidation =
      qaTargetYear == null
        ? null
        : qaReadings.length === 0 &&
            (canonicalInputs.metricInput != null || latestSnapshot != null)
          ? null
          : validateBenchmarkYearData(qaReadings, qaTargetYear);

    const qa =
      qaTargetYear == null
        ? createQaResult({
            verdict: "WARN",
            targetYear: null,
            issues: [
              {
                issueType: DATA_QUALITY_ISSUE_TYPES.UNRESOLVED_REPORTING_YEAR,
                message:
                  "BEPS QA could not resolve a canonical annual coverage year from the current input state.",
                details: {
                  cycle: input.cycle,
                  filingYear,
                  metricInputId: canonicalInputs.metricInput?.id ?? null,
                  latestSnapshotId: latestSnapshot?.id ?? null,
                },
              },
            ],
          })
        : qaReadings.length === 0 &&
            (canonicalInputs.metricInput != null || latestSnapshot != null)
          ? createQaResult({
              verdict: "WARN",
              targetYear: qaTargetYear,
              issues: [
                {
                  issueType: DATA_QUALITY_ISSUE_TYPES.NO_DIRECT_YEAR_READINGS,
                  message:
                    "BEPS QA could not verify direct annual readings for the evaluation year and proceeded using canonical metric inputs or the latest compliance snapshot.",
                  details: {
                    cycle: input.cycle,
                    filingYear,
                    targetYear: qaTargetYear,
                    metricInputId: canonicalInputs.metricInput?.id ?? null,
                    latestSnapshotId: latestSnapshot?.id ?? null,
                  },
                },
              ],
            })
        : createQaResult({
            verdict: qaValidation!.verdict,
            targetYear: qaTargetYear,
            issues: mapQaIssues(qaValidation!.issues),
          });

    const governance = {
      cycleId: cycleContext.registry.cycleId,
      rulePackageKey: cycleContext.rulePackage.key,
      ruleVersion: cycleContext.ruleVersion.version,
      factorSetKey: cycleContext.factorSetVersion.key,
      factorSetVersion: cycleContext.factorSetVersion.version,
    };
    const applicabilityResult = evaluateBepsApplicability({
      building,
      cycle: input.cycle,
      ruleConfig: cycleContext.ruleConfig,
      factorConfig: cycleContext.factorConfig,
      filingYear,
    });

    let evaluation: BepsEvaluationResult | null = null;
    let metricUsed: string | null = null;
    let status: ComplianceEngineStatus = COMPLIANCE_ENGINE_STATUS.BLOCKED;
    let decisionMeetsStandard: boolean | null = null;
    let reasonCodes: string[] = resolveQaReasonCodes(qa);
    let applicability: ComplianceEngineApplicability = applicabilityResult.applicable
      ? COMPLIANCE_ENGINE_APPLICABILITY.APPLICABLE
      : COMPLIANCE_ENGINE_APPLICABILITY.NOT_APPLICABLE;

    if (qa.gate !== COMPLIANCE_ENGINE_QA_GATE.BLOCKED) {
      evaluation = await evaluateBepsData({
        building,
        cycle: input.cycle,
        snapshot: toSnapshotInput(latestSnapshot),
        historicalMetrics,
        canonicalInputs,
        ruleConfig: cycleContext.ruleConfig,
        factorConfig: cycleContext.factorConfig,
        overrides: input.overrides ?? {},
      });
      evaluation.governance = governance;
      metricUsed = resolveBepsMetricUsed(evaluation);
      status =
        evaluation.overallStatus === "PENDING_DATA"
          ? COMPLIANCE_ENGINE_STATUS.BLOCKED
          : COMPLIANCE_ENGINE_STATUS.COMPUTED;
      decisionMeetsStandard = evaluation.overallStatus === "COMPLIANT";
      reasonCodes = [...reasonCodes, ...evaluation.reasonCodes];
      applicability = evaluation.applicable
        ? COMPLIANCE_ENGINE_APPLICABILITY.APPLICABLE
        : COMPLIANCE_ENGINE_APPLICABILITY.NOT_APPLICABLE;
    }

    const engineResult: ComplianceEngineResult = {
      engineVersion: "v1",
      scope: "BEPS",
      status,
      applicability,
      reportingYear: filingYear,
      rulePackageKey: cycleContext.rulePackage.key,
      ruleVersionId: cycleContext.ruleVersion.id,
      ruleVersion: cycleContext.ruleVersion.version,
      factorSetKey: cycleContext.factorSetVersion.key,
      factorSetVersionId: cycleContext.factorSetVersion.id,
      factorSetVersion: cycleContext.factorSetVersion.version,
      metricUsed,
      qa,
      reasonCodes: Array.from(new Set(reasonCodes)),
      decision: {
        meetsStandard: decisionMeetsStandard,
        blocked: status === COMPLIANCE_ENGINE_STATUS.BLOCKED,
        insufficientData: qa.gate === COMPLIANCE_ENGINE_QA_GATE.BLOCKED,
      },
      domainResult:
        evaluation == null
          ? {
              applicability: applicabilityResult,
              governance,
              filingYear,
              status: "INSUFFICIENT_DATA",
            }
          : {
              evaluation,
            },
    };

    const provenance = await recordComplianceEvaluation({
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      ruleVersionId: cycleContext.ruleVersion.id,
      factorSetVersionId: cycleContext.factorSetVersion.id,
      runType: "BEPS_EVALUATION",
      status: "SUCCEEDED",
      inputSnapshotRef: `beps:${input.cycle}:${filingYear}`,
      inputSnapshotPayload: {
        building,
        latestSnapshot: toSnapshotInput(latestSnapshot),
        canonicalInputs,
        historicalMetrics,
        cycle: input.cycle,
        overrides: input.overrides ?? {},
        filingYear,
      },
      resultPayload: {
        engineResult,
        evaluation,
        governance,
      },
      producedByType: input.producedByType,
      producedById: input.producedById ?? null,
      manifest: {
        implementationKey: "compliance-engine/beps-v1",
        payload: {
          cycle: input.cycle,
          cycleId: cycleContext.registry.cycleId,
          filingYear,
          rulePackageKey: governance.rulePackageKey,
          ruleVersion: governance.ruleVersion,
          factorSetKey: governance.factorSetKey,
          factorSetVersion: governance.factorSetVersion,
          qa,
        },
      },
      snapshotData: {
        triggerType: "MANUAL",
        complianceStatus:
          evaluation?.overallStatus === "COMPLIANT"
            ? "COMPLIANT"
            : evaluation?.overallStatus === "NOT_APPLICABLE"
              ? "EXEMPT"
              : evaluation?.overallStatus === "PENDING_DATA" ||
                  qa.gate === COMPLIANCE_ENGINE_QA_GATE.BLOCKED
                ? "PENDING_DATA"
                : "NON_COMPLIANT",
        energyStarScore: evaluation?.inputSummary.currentScore ?? null,
        siteEui:
          latestSnapshot?.siteEui ??
          evaluation?.inputSummary.currentAdjustedSiteEui ??
          null,
        sourceEui: latestSnapshot?.sourceEui ?? null,
        weatherNormalizedSiteEui:
          evaluation?.inputSummary.currentWeatherNormalizedSiteEui ??
          latestSnapshot?.weatherNormalizedSiteEui ??
          null,
        weatherNormalizedSourceEui:
          evaluation?.inputSummary.currentWeatherNormalizedSourceEui ??
          latestSnapshot?.weatherNormalizedSourceEui ??
          null,
        complianceGap:
          evaluation?.inputSummary.currentScore != null
            ? evaluation.inputSummary.currentScore - building.bepsTargetScore
            : null,
        estimatedPenalty: evaluation?.alternativeCompliance.recommended?.amountDue ?? null,
        dataQualityScore: latestSnapshot?.dataQualityScore ?? null,
        activePathway: toBuildingSelectedPathway(evaluation?.selectedPathway),
        targetScore: building.bepsTargetScore,
        targetEui: building.targetEui,
        penaltyInputsJson: {
          cycle: input.cycle,
          filingYear,
          ruleVersion: governance.ruleVersion,
          factorSetVersion: governance.factorSetVersion,
          qa,
          ...(evaluation?.inputSummary ?? {}),
        },
      },
      evidenceArtifacts: [
        {
          artifactType: "CALCULATION_OUTPUT",
          name: `BEPS evaluation ${input.cycle} ${filingYear}`,
          artifactRef: `beps_evaluation:${input.cycle}:${filingYear}`,
          metadata: {
            beps: {
              cycle: input.cycle,
              filingYear,
              overallStatus: evaluation?.overallStatus ?? "PENDING_DATA",
              selectedPathway: evaluation?.selectedPathway ?? null,
              reasonCodes: evaluation?.reasonCodes ?? [],
              governance,
              qa,
            },
          },
        },
      ],
    });

    await createAuditLog({
      actorType: input.producedByType,
      actorId: input.producedById ?? null,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      action: "COMPLIANCE_ENGINE_BEPS_SUCCEEDED",
      outputSnapshot: {
        cycle: input.cycle,
        filingYear,
        complianceRunId: provenance.complianceRun.id,
        status: engineResult.status,
        qaVerdict: qa.verdict,
        reasonCodes: engineResult.reasonCodes,
      },
      requestId: input.requestId ?? null,
    });

    logger.info("BEPS compliance evaluated", {
      cycle: input.cycle,
      filingYear,
      complianceRunId: provenance.complianceRun.id,
      status: engineResult.status,
      qaVerdict: qa.verdict,
    });

    return {
      scope: "BEPS",
      engineResult,
      evaluation,
      provenance,
      ruleVersion: {
        id: cycleContext.ruleVersion.id,
        version: cycleContext.ruleVersion.version,
        implementationKey: cycleContext.ruleVersion.implementationKey,
      },
      factorSetVersion: {
        id: cycleContext.factorSetVersion.id,
        key: cycleContext.factorSetVersion.key,
        version: cycleContext.factorSetVersion.version,
      },
      filingYear,
    };
  } catch (error) {
    await createAuditLog({
      actorType: input.producedByType,
      actorId: input.producedById ?? null,
      organizationId: input.organizationId,
      buildingId: input.buildingId,
      action: "COMPLIANCE_ENGINE_BEPS_FAILED",
      errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      outputSnapshot: {
        cycle: input.cycle,
        reportingYear: input.reportingYear ?? null,
      },
      requestId: input.requestId ?? null,
    });
    throw error;
  }
}

const complianceEngineHandlers: {
  [K in ComplianceEngineScope]: (
    input: Extract<ComplianceEngineRequest, { scope: K }>,
  ) => Promise<Extract<ComplianceEngineEvaluation, { scope: K }>>;
} = {
  BENCHMARKING: evaluateBenchmarkingCompliance,
  BEPS: evaluateBepsCompliance,
};

export async function evaluateCompliance(
  input: ComplianceEngineRequest,
): Promise<ComplianceEngineEvaluation> {
  if (input.scope === "BENCHMARKING") {
    return complianceEngineHandlers.BENCHMARKING(input);
  }

  return complianceEngineHandlers.BEPS(input);
}

export async function evaluateBenchmarkingComplianceForBuilding(
  input: Omit<BenchmarkComplianceRequest, "scope">,
) {
  return evaluateBenchmarkingCompliance({
    ...input,
    scope: "BENCHMARKING",
  });
}

export async function evaluateBepsComplianceForBuilding(
  input: Omit<BepsComplianceRequest, "scope">,
) {
  return evaluateBepsCompliance({
    ...input,
    scope: "BEPS",
  });
}
