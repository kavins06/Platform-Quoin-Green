import benchmarkingFixtures from "../../../test/fixtures/governed-regressions/benchmarking.json";
import bepsCycle1Fixtures from "../../../test/fixtures/governed-regressions/beps-cycle-1.json";
import bepsCycle2Fixtures from "../../../test/fixtures/governed-regressions/beps-cycle-2.json";
import {
  evaluateBenchmarkReadinessData,
  normalizeBenchmarkFactorConfig,
  normalizeBenchmarkRuleConfig,
  type BenchmarkEvidenceInput,
  type BenchmarkReadingInput,
} from "@/server/compliance/benchmarking-core";
import { evaluateBepsData } from "@/server/compliance/beps/beps-evaluator";
import {
  normalizeBepsFactorConfig,
  normalizeBepsRuleConfig,
} from "@/server/compliance/beps/config";
import type {
  BepsCanonicalInputState,
  BepsHistoricalMetricPoint,
  BepsSnapshotInput,
  BepsBuildingInput,
} from "@/server/compliance/beps/types";

export type GovernedRegressionFixtureSetKey =
  | "benchmarking-core-v1"
  | "beps-cycle-1-core-v1"
  | "beps-cycle-2-core-v1";

export interface GovernedRegressionCaseResult {
  fixtureSetKey: GovernedRegressionFixtureSetKey;
  caseId: string;
  caseName: string;
  passed: boolean;
  assertions: Array<{
    field: string;
    expected: unknown;
    actual: unknown;
    passed: boolean;
  }>;
}

export interface GovernedRegressionRunResult {
  fixtureSetKey: GovernedRegressionFixtureSetKey;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passed: boolean;
  cases: GovernedRegressionCaseResult[];
}

interface BenchmarkingFixture {
  id: string;
  name: string;
  reportingYear: number;
  evaluatedAt: string;
  building: {
    id: string;
    organizationId: string;
    grossSquareFeet: number;
    ownershipType: "PRIVATE" | "DISTRICT";
    doeeBuildingId: string | null;
    espmPropertyId: number | null;
    espmShareStatus: "PENDING" | "LINKED" | "FAILED" | "UNLINKED";
  };
  readings: Array<{
    meterType: string;
    source: string;
    periodStart: string;
    periodEnd: string;
  }>;
  evidenceArtifacts: Array<{
    id: string;
    artifactType:
      | "CALCULATION_OUTPUT"
      | "ENERGY_DATA"
      | "PM_REPORT"
      | "OWNER_ATTESTATION"
      | "SYSTEM_NOTE"
      | "OTHER";
    name: string;
    artifactRef: string | null;
    createdAt: string;
    metadata: Record<string, unknown> | null;
    benchmarkSubmission: {
      id: string;
      reportingYear: number;
    } | null;
  }>;
  expected: {
    status?: "READY" | "BLOCKED";
    reasonCodes?: string[];
    scopeState?: "IN_SCOPE" | "OUT_OF_SCOPE";
    verificationRequired?: boolean;
  };
}

interface BepsFixture {
  id: string;
  name: string;
  cycle: "CYCLE_1" | "CYCLE_2";
  evaluatedAt: string;
  building: BepsBuildingInput;
  snapshot: {
    id: string;
    snapshotDate: string;
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
    penaltyInputsJson: Record<string, unknown> | null;
  } | null;
  historicalMetrics: Array<{
    id: string;
    snapshotDate: string;
    siteEui: number | null;
    weatherNormalizedSiteEui: number | null;
    weatherNormalizedSourceEui: number | null;
    energyStarScore: number | null;
  }>;
  canonicalInputs: BepsCanonicalInputState;
  expected: {
    overallStatus?: "COMPLIANT" | "NON_COMPLIANT" | "PENDING_DATA" | "NOT_APPLICABLE";
    selectedPathway?: "PERFORMANCE" | "STANDARD_TARGET" | "PRESCRIPTIVE" | "TRAJECTORY" | null;
    reasonCodes?: string[];
    recommendedPenaltyAmount?: number | null;
  };
}

function toDate(value: string) {
  return new Date(value);
}

function toBenchmarkReadings(
  readings: BenchmarkingFixture["readings"],
): BenchmarkReadingInput[] {
  return readings.map((reading) => ({
    meterType: reading.meterType,
    source: reading.source,
    periodStart: toDate(reading.periodStart),
    periodEnd: toDate(reading.periodEnd),
  }));
}

function toBenchmarkEvidence(
  evidenceArtifacts: BenchmarkingFixture["evidenceArtifacts"],
): BenchmarkEvidenceInput[] {
  return evidenceArtifacts.map((artifact) => ({
    id: artifact.id,
    artifactType: artifact.artifactType,
    name: artifact.name,
    artifactRef: artifact.artifactRef,
    createdAt: toDate(artifact.createdAt),
    metadata: artifact.metadata,
    benchmarkSubmission: artifact.benchmarkSubmission,
  }));
}

function toBepsSnapshot(snapshot: BepsFixture["snapshot"]): BepsSnapshotInput | null {
  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    snapshotDate: toDate(snapshot.snapshotDate),
  };
}

function toBepsHistoricalMetrics(
  metrics: BepsFixture["historicalMetrics"],
): BepsHistoricalMetricPoint[] {
  return metrics.map((metric) => ({
    ...metric,
    snapshotDate: toDate(metric.snapshotDate),
  }));
}

function buildAssertions(
  entries: Array<{
    field: string;
    expected: unknown;
    actual: unknown;
  }>,
) {
  return entries.map((entry) => ({
    ...entry,
    passed: JSON.stringify(entry.expected) === JSON.stringify(entry.actual),
  }));
}

function runBenchmarkingFixture(params: {
  fixtureSetKey: GovernedRegressionFixtureSetKey;
  fixture: BenchmarkingFixture;
  ruleConfig: Record<string, unknown>;
  factorConfig: Record<string, unknown>;
}): GovernedRegressionCaseResult {
  const result = evaluateBenchmarkReadinessData({
    building: {
      ...params.fixture.building,
      espmPropertyId: params.fixture.building.espmPropertyId,
    },
    readings: toBenchmarkReadings(params.fixture.readings),
    evidenceArtifacts: toBenchmarkEvidence(params.fixture.evidenceArtifacts),
    reportingYear: params.fixture.reportingYear,
    evaluatedAt: toDate(params.fixture.evaluatedAt),
    ruleConfig: normalizeBenchmarkRuleConfig(params.ruleConfig),
    factorConfig: normalizeBenchmarkFactorConfig(params.factorConfig),
  });

  const assertions = buildAssertions([
    ...(params.fixture.expected.status !== undefined
      ? [
          {
            field: "status",
            expected: params.fixture.expected.status,
            actual: result.status,
          },
        ]
      : []),
    ...(params.fixture.expected.reasonCodes !== undefined
      ? [
          {
            field: "reasonCodes",
            expected: params.fixture.expected.reasonCodes,
            actual: result.reasonCodes,
          },
        ]
      : []),
    ...(params.fixture.expected.scopeState !== undefined
      ? [
          {
            field: "summary.scopeState",
            expected: params.fixture.expected.scopeState,
            actual: result.summary.scopeState,
          },
        ]
      : []),
    ...(params.fixture.expected.verificationRequired !== undefined
      ? [
          {
            field: "summary.verificationRequired",
            expected: params.fixture.expected.verificationRequired,
            actual: result.summary.verificationRequired,
          },
        ]
      : []),
  ]);

  return {
    fixtureSetKey: params.fixtureSetKey,
    caseId: params.fixture.id,
    caseName: params.fixture.name,
    passed: assertions.every((assertion) => assertion.passed),
    assertions,
  };
}

async function runBepsFixture(params: {
  fixtureSetKey: GovernedRegressionFixtureSetKey;
  fixture: BepsFixture;
  ruleConfig: Record<string, unknown>;
  factorConfig: Record<string, unknown>;
}): Promise<GovernedRegressionCaseResult> {
  const result = await evaluateBepsData({
    building: params.fixture.building,
    cycle: params.fixture.cycle,
    snapshot: toBepsSnapshot(params.fixture.snapshot),
    historicalMetrics: toBepsHistoricalMetrics(params.fixture.historicalMetrics),
    canonicalInputs: params.fixture.canonicalInputs,
    evaluatedAt: toDate(params.fixture.evaluatedAt),
    ruleConfig: normalizeBepsRuleConfig(params.ruleConfig),
    factorConfig: normalizeBepsFactorConfig(params.factorConfig),
  });

  const assertions = buildAssertions([
    ...(params.fixture.expected.overallStatus !== undefined
      ? [
          {
            field: "overallStatus",
            expected: params.fixture.expected.overallStatus,
            actual: result.overallStatus,
          },
        ]
      : []),
    ...(params.fixture.expected.selectedPathway !== undefined
      ? [
          {
            field: "selectedPathway",
            expected: params.fixture.expected.selectedPathway,
            actual: result.selectedPathway,
          },
        ]
      : []),
    ...(params.fixture.expected.reasonCodes !== undefined
      ? [
          {
            field: "reasonCodes",
            expected: params.fixture.expected.reasonCodes,
            actual: result.reasonCodes,
          },
        ]
      : []),
    ...(params.fixture.expected.recommendedPenaltyAmount !== undefined
      ? [
          {
            field: "alternativeCompliance.recommended.amountDue",
            expected: params.fixture.expected.recommendedPenaltyAmount,
            actual: result.alternativeCompliance.recommended?.amountDue ?? null,
          },
        ]
      : []),
  ]);

  return {
    fixtureSetKey: params.fixtureSetKey,
    caseId: params.fixture.id,
    caseName: params.fixture.name,
    passed: assertions.every((assertion) => assertion.passed),
    assertions,
  };
}

export async function runGovernedRegressionFixtureSet(params: {
  fixtureSetKey: GovernedRegressionFixtureSetKey;
  ruleConfig: Record<string, unknown>;
  factorConfig: Record<string, unknown>;
}): Promise<GovernedRegressionRunResult> {
  let cases: GovernedRegressionCaseResult[];

  switch (params.fixtureSetKey) {
    case "benchmarking-core-v1":
      cases = (benchmarkingFixtures as BenchmarkingFixture[]).map((fixture) =>
        runBenchmarkingFixture({
          fixtureSetKey: params.fixtureSetKey,
          fixture,
          ruleConfig: params.ruleConfig,
          factorConfig: params.factorConfig,
        }),
      );
      break;
    case "beps-cycle-1-core-v1":
      cases = await Promise.all(
        (bepsCycle1Fixtures as BepsFixture[]).map((fixture) =>
          runBepsFixture({
            fixtureSetKey: params.fixtureSetKey,
            fixture,
            ruleConfig: params.ruleConfig,
            factorConfig: params.factorConfig,
          }),
        ),
      );
      break;
    case "beps-cycle-2-core-v1":
      cases = await Promise.all(
        (bepsCycle2Fixtures as BepsFixture[]).map((fixture) =>
          runBepsFixture({
            fixtureSetKey: params.fixtureSetKey,
            fixture,
            ruleConfig: params.ruleConfig,
            factorConfig: params.factorConfig,
          }),
        ),
      );
      break;
    default:
      cases = [];
  }

  const passedCases = cases.filter((item) => item.passed).length;

  return {
    fixtureSetKey: params.fixtureSetKey,
    totalCases: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    passed: cases.every((item) => item.passed),
    cases,
  };
}
