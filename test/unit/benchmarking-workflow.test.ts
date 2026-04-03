import { describe, expect, it } from "vitest";
import {
  BENCHMARK_FINDING_CODES,
  evaluateBenchmarkReadinessData,
} from "@/server/compliance/benchmarking";

const baseBuilding = {
  id: "building_1",
  organizationId: "org_1",
  grossSquareFeet: 100000,
  ownershipType: "PRIVATE" as const,
  doeeBuildingId: "RPUID-123456",
  espmPropertyId: 123456,
  espmShareStatus: "LINKED" as const,
};

const baseRuleConfig = {
  propertyIdPattern: "^RPUID-[0-9]{6}$",
  dqcFreshnessDays: 30,
  verification: {
    minimumGrossSquareFeet: 50000,
    requiredReportingYears: [2025],
    evidenceKind: "VERIFICATION",
  },
  gfaCorrection: {
    evidenceKind: "GFA_CORRECTION",
  },
};

const baseFactorConfig = {
  dqcFreshnessDays: 30,
  applicabilityBands: [
    {
      ownershipType: "PRIVATE" as const,
      minimumGrossSquareFeet: 10000,
      maximumGrossSquareFeet: 24999,
      label: "PRIVATE_10K_TO_24_999",
      verificationYears: [2027],
      verificationCadenceYears: 6,
      deadlineType: "MAY_1_FOLLOWING_YEAR" as const,
    },
    {
      ownershipType: "PRIVATE" as const,
      minimumGrossSquareFeet: 25000,
      maximumGrossSquareFeet: 49999,
      label: "PRIVATE_25K_TO_49_999",
      verificationYears: [2024, 2027],
      verificationCadenceYears: 6,
      deadlineType: "MAY_1_FOLLOWING_YEAR" as const,
    },
    {
      ownershipType: "PRIVATE" as const,
      minimumGrossSquareFeet: 50000,
      label: "PRIVATE_50K_PLUS",
      verificationYears: [2024, 2027],
      verificationCadenceYears: 6,
      deadlineType: "MAY_1_FOLLOWING_YEAR" as const,
    },
    {
      ownershipType: "DISTRICT" as const,
      minimumGrossSquareFeet: 10000,
      label: "DISTRICT_10K_PLUS",
      deadlineType: "WITHIN_DAYS_OF_BENCHMARK_GENERATION" as const,
      deadlineDaysFromGeneration: 60,
      manualSubmissionAllowedWhenNotBenchmarkable: true,
    },
  ],
};

function monthReadings(reportingYear = 2025) {
  return [
    { periodStart: new Date(`${reportingYear}-01-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-01-31T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-02-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-02-28T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-03-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-03-31T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-04-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-04-30T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-05-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-05-31T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-06-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-06-30T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-07-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-07-31T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-08-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-08-31T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-09-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-09-30T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-10-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-10-31T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-11-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-11-30T00:00:00.000Z`) },
    { periodStart: new Date(`${reportingYear}-12-01T00:00:00.000Z`), periodEnd: new Date(`${reportingYear}-12-31T00:00:00.000Z`) },
  ].map((reading) => ({
    ...reading,
    meterId: "meter_1",
    meterType: "ELECTRIC",
    source: "CSV_UPLOAD",
  }));
}

function freshEvidence(kind: string, reportingYear = 2025) {
  const checkedAt = `${reportingYear + 1}-01-10T00:00:00.000Z`;
  return {
    id: `${kind}_${reportingYear}`,
    artifactType: "PM_REPORT" as const,
    name: kind,
    artifactRef: kind,
    createdAt: new Date(checkedAt),
    metadata: {
      benchmarking: {
        kind,
        reportingYear,
        checkedAt,
      },
    },
    benchmarkSubmission: null,
  };
}

describe("benchmarking workflow", () => {
  it("passes readiness for a complete reporting year", () => {
    const result = evaluateBenchmarkReadinessData({
      building: baseBuilding,
      readings: monthReadings(2027),
      evidenceArtifacts: [freshEvidence("DQC_REPORT", 2027), freshEvidence("VERIFICATION", 2027)],
      reportingYear: 2027,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2028-01-15T00:00:00.000Z"),
    });

    expect(result.status).toBe("READY");
    expect(result.reasonCodes).toEqual([]);
    expect(result.summary.coverageComplete).toBe(true);
    expect(result.summary.ownershipTypeUsed).toBe("PRIVATE");
    expect(result.summary.minimumGrossSquareFeet).toBe(50000);
    expect(result.summary.requiredReportingYears).toEqual([2024, 2027]);
    expect(result.summary.dqcFreshnessState).toBe("FRESH");
    expect(result.summary.verificationRequired).toBe(true);
    expect(result.summary.verificationEvidencePresent).toBe(true);
  });

  it("blocks readiness when reporting-year coverage is missing", () => {
    const readings = monthReadings().filter((reading) => reading.periodStart.getUTCMonth() !== 5);

    const result = evaluateBenchmarkReadinessData({
      building: baseBuilding,
      readings,
      evidenceArtifacts: [freshEvidence("DQC_REPORT"), freshEvidence("VERIFICATION")],
      reportingYear: 2025,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.reasonCodes).toContain(BENCHMARK_FINDING_CODES.missingCoverage);
  });

  it("blocks readiness on overlapping billing periods", () => {
    const readings = monthReadings();
    readings[1] = {
      ...readings[1],
      periodStart: new Date("2025-01-15T00:00:00.000Z"),
      periodEnd: new Date("2025-02-15T00:00:00.000Z"),
    };

    const result = evaluateBenchmarkReadinessData({
      building: baseBuilding,
      readings,
      evidenceArtifacts: [freshEvidence("DQC_REPORT"), freshEvidence("VERIFICATION")],
      reportingYear: 2025,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.reasonCodes).toContain(BENCHMARK_FINDING_CODES.overlappingBills);
  });

  it("allows readings whose next period starts on the previous end date", () => {
    const readings = monthReadings();
    readings[1] = {
      ...readings[1],
      periodStart: new Date("2025-01-31T00:00:00.000Z"),
      periodEnd: new Date("2025-02-28T00:00:00.000Z"),
    };

    const result = evaluateBenchmarkReadinessData({
      building: baseBuilding,
      readings,
      evidenceArtifacts: [freshEvidence("DQC_REPORT"), freshEvidence("VERIFICATION")],
      reportingYear: 2025,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect(result.reasonCodes).not.toContain(BENCHMARK_FINDING_CODES.overlappingBills);
  });

  it("blocks readiness when the DC property identifier is missing", () => {
    const result = evaluateBenchmarkReadinessData({
      building: {
        ...baseBuilding,
        doeeBuildingId: null,
      },
      readings: monthReadings(),
      evidenceArtifacts: [freshEvidence("DQC_REPORT"), freshEvidence("VERIFICATION")],
      reportingYear: 2025,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.reasonCodes).toContain(BENCHMARK_FINDING_CODES.missingPropertyId);
  });

  it("blocks readiness when PM sharing is stale or DQC evidence is missing", () => {
    const result = evaluateBenchmarkReadinessData({
      building: {
        ...baseBuilding,
        espmShareStatus: "UNLINKED",
      },
      readings: monthReadings(),
      evidenceArtifacts: [],
      reportingYear: 2025,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.reasonCodes).toContain(BENCHMARK_FINDING_CODES.pmNotShared);
    expect(result.reasonCodes).toContain(BENCHMARK_FINDING_CODES.dqcStale);
  });

  it("blocks readiness when verification is required but evidence is missing", () => {
    const result = evaluateBenchmarkReadinessData({
      building: baseBuilding,
      readings: monthReadings(2027),
      evidenceArtifacts: [freshEvidence("DQC_REPORT", 2027)],
      reportingYear: 2027,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2028-01-15T00:00:00.000Z"),
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.summary.verificationRequired).toBe(true);
    expect(result.reasonCodes).toContain(
      BENCHMARK_FINDING_CODES.verificationEvidenceMissing,
    );
  });

  it("marks private buildings below 10k as out of scope instead of blocking them", () => {
    const result = evaluateBenchmarkReadinessData({
      building: {
        ...baseBuilding,
        grossSquareFeet: 9000,
      },
      readings: [],
      evidenceArtifacts: [],
      reportingYear: 2025,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect(result.status).toBe("READY");
    expect(result.summary.scopeState).toBe("OUT_OF_SCOPE");
    expect(result.summary.ownershipTypeUsed).toBe("PRIVATE");
    expect(result.summary.propertyIdState).toBe("NOT_REQUIRED");
    expect(result.summary.minimumGrossSquareFeet).toBeNull();
    expect(result.summary.deadlineType).toBeNull();
  });

  it("requires verification for private 10k-24,999 buildings starting in 2027 and every 6 years after", () => {
    const building = {
      ...baseBuilding,
      grossSquareFeet: 20000,
    };

    const result2027 = evaluateBenchmarkReadinessData({
      building,
      readings: monthReadings(),
      evidenceArtifacts: [freshEvidence("DQC_REPORT", 2027)],
      reportingYear: 2027,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2028-01-15T00:00:00.000Z"),
    });
    const result2033 = evaluateBenchmarkReadinessData({
      building,
      readings: monthReadings(2033),
      evidenceArtifacts: [freshEvidence("DQC_REPORT", 2033)],
      reportingYear: 2033,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2034-01-15T00:00:00.000Z"),
    });
    const result2026 = evaluateBenchmarkReadinessData({
      building,
      readings: monthReadings(),
      evidenceArtifacts: [freshEvidence("DQC_REPORT", 2026)],
      reportingYear: 2026,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2027-01-15T00:00:00.000Z"),
    });

    expect(result2027.summary.verificationRequired).toBe(true);
    expect(result2033.summary.verificationRequired).toBe(true);
    expect(result2026.summary.verificationRequired).toBe(false);
    expect(result2027.summary.applicabilityBandLabel).toBe("PRIVATE_10K_TO_24_999");
    expect(result2027.summary.minimumGrossSquareFeet).toBe(10000);
    expect(result2027.summary.maximumGrossSquareFeet).toBe(24999);
    expect(result2027.summary.verificationCadenceYears).toBe(6);
    expect(result2027.summary.requiredReportingYears).toEqual([2027]);
    expect(result2027.summary.submissionDueDate).toBe("2028-05-01T00:00:00.000Z");
  });

  it("surfaces manual-path governance metadata only for district/manual benchmarking bands", () => {
    const privateResult = evaluateBenchmarkReadinessData({
      building: {
        ...baseBuilding,
        grossSquareFeet: 30000,
      },
      readings: monthReadings(2027),
      evidenceArtifacts: [freshEvidence("DQC_REPORT", 2027), freshEvidence("VERIFICATION", 2027)],
      reportingYear: 2027,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2028-01-15T00:00:00.000Z"),
    });

    const districtResult = evaluateBenchmarkReadinessData({
      building: {
        ...baseBuilding,
        ownershipType: "DISTRICT",
        grossSquareFeet: 15000,
      },
      readings: monthReadings(2027),
      evidenceArtifacts: [freshEvidence("DQC_REPORT", 2027)],
      reportingYear: 2027,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2028-01-15T00:00:00.000Z"),
    });

    expect(privateResult.summary.manualSubmissionAllowedWhenNotBenchmarkable).toBe(false);
    expect(districtResult.summary.manualSubmissionAllowedWhenNotBenchmarkable).toBe(true);
  });

  it("uses the district/public 60-day relative deadline rule", () => {
    const result = evaluateBenchmarkReadinessData({
      building: {
        ...baseBuilding,
        ownershipType: "DISTRICT",
        grossSquareFeet: 15000,
      },
      readings: monthReadings(),
      evidenceArtifacts: [freshEvidence("DQC_REPORT")],
      reportingYear: 2025,
      ruleConfig: baseRuleConfig,
      factorConfig: baseFactorConfig,
      evaluatedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect(result.summary.scopeState).toBe("IN_SCOPE");
    expect(result.summary.ownershipTypeUsed).toBe("DISTRICT");
    expect(result.summary.applicabilityBandLabel).toBe("DISTRICT_10K_PLUS");
    expect(result.summary.minimumGrossSquareFeet).toBe(10000);
    expect(result.summary.requiredReportingYears).toEqual([]);
    expect(result.summary.deadlineType).toBe("WITHIN_DAYS_OF_BENCHMARK_GENERATION");
    expect(result.summary.deadlineDaysFromGeneration).toBe(60);
    expect(result.summary.submissionDueDate).toBeNull();
    expect(result.summary.manualSubmissionAllowedWhenNotBenchmarkable).toBe(true);
    expect(result.summary.verificationRequired).toBe(false);
  });
});
