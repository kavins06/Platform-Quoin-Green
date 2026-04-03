import "dotenv/config";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required");
}

const adapter = new PrismaPg({
  connectionString,
});
const prisma = new PrismaClient({ adapter });

const BEPS_CYCLE_1_FACTOR_SET_KEY = "DC_BEPS_CYCLE_1_FACTORS_V1";
const BEPS_CYCLE_2_FACTOR_SET_KEY = "DC_BEPS_CYCLE_2_FACTORS_V1";
const DEMO_ORG_SLUGS = [
  "meridian-capital",
  "district-housing",
  "foggy-bottom-hotels",
] as const;
const DEMO_USER_AUTH_IDS = [
  "supabase_user_meridian_admin_001",
  "supabase_user_dha_admin_001",
  "supabase_user_fbh_admin_001",
] as const;
const DEMO_BUILDING_NAMES = [
  "K Street Tower",
  "L Street Office Center",
  "Connecticut Avenue Plaza",
  "Columbia Heights Residences",
  "U Street Mixed-Use",
  "Anacostia Gardens",
  "Congress Heights Commons",
  "Petworth Place",
  "New Hampshire Suites",
  "M Street Boutique Hotel",
  "Ward 8 Services Annex",
] as const;
void DEMO_BUILDING_NAMES;
const BENCHMARKING_APPLICABILITY_BANDS = [
  {
    ownershipType: "PRIVATE",
    minimumGrossSquareFeet: 10000,
    maximumGrossSquareFeet: 24999,
    label: "PRIVATE_10K_TO_24_999",
    verificationYears: [2027],
    verificationCadenceYears: 6,
    deadlineType: "MAY_1_FOLLOWING_YEAR",
  },
  {
    ownershipType: "PRIVATE",
    minimumGrossSquareFeet: 25000,
    maximumGrossSquareFeet: 49999,
    label: "PRIVATE_25K_TO_49_999",
    verificationYears: [2024, 2027],
    verificationCadenceYears: 6,
    deadlineType: "MAY_1_FOLLOWING_YEAR",
  },
  {
    ownershipType: "PRIVATE",
    minimumGrossSquareFeet: 50000,
    label: "PRIVATE_50K_PLUS",
    verificationYears: [2024, 2027],
    verificationCadenceYears: 6,
    deadlineType: "MAY_1_FOLLOWING_YEAR",
  },
  {
    ownershipType: "DISTRICT",
    minimumGrossSquareFeet: 10000,
    label: "DISTRICT_10K_PLUS",
    deadlineType: "WITHIN_DAYS_OF_BENCHMARK_GENERATION",
    deadlineDaysFromGeneration: 60,
    manualSubmissionAllowedWhenNotBenchmarkable: true,
  },
] as const;
const BEPS_STANDARDS_TABLE = [
  {
    cycle: "CYCLE_1",
    pathway: "STANDARD_TARGET",
    propertyType: "OFFICE",
    metricType: "ENERGY_STAR_SCORE",
    targetValue: 71,
    maxGap: 15,
  },
  {
    cycle: "CYCLE_1",
    pathway: "STANDARD_TARGET",
    propertyType: "MULTIFAMILY",
    metricType: "ENERGY_STAR_SCORE",
    targetValue: 66,
    maxGap: 15,
  },
  {
    cycle: "CYCLE_1",
    pathway: "STANDARD_TARGET",
    propertyType: "MIXED_USE",
    metricType: "ENERGY_STAR_SCORE",
    targetValue: 66,
    maxGap: 15,
  },
  {
    cycle: "CYCLE_1",
    pathway: "STANDARD_TARGET",
    propertyType: "OTHER",
    metricType: "ENERGY_STAR_SCORE",
    targetValue: 54,
    maxGap: 15,
  },
  {
    cycle: "CYCLE_2",
    pathway: "STANDARD_TARGET",
    propertyType: "OFFICE",
    metricType: "ENERGY_STAR_SCORE",
    targetValue: 74,
    maxGap: 12,
  },
  {
    cycle: "CYCLE_2",
    pathway: "TRAJECTORY",
    propertyType: "OFFICE",
    metricType: "ADJUSTED_SITE_EUI_AVERAGE",
    year: 2028,
    targetValue: 85,
  },
  {
    cycle: "CYCLE_2",
    pathway: "TRAJECTORY",
    propertyType: "MULTIFAMILY",
    metricType: "ADJUSTED_SITE_EUI_AVERAGE",
    year: 2028,
    targetValue: 84,
  },
] as const;
const BEPS_CYCLE_1_FACTORS = {
  cycle: {
    filingYear: 2026,
    cycleStartYear: 2021,
    cycleEndYear: 2026,
    baselineYears: [2018, 2019],
    evaluationYears: [2026],
    baselineBenchmarkYear: 2019,
    complianceDeadline: "2026-12-31",
    delayedCycle1Option: {
      baselineYears: [2018, 2019],
      evaluationYears: [2026],
      comparisonYear: 2026,
      optionYear: 2021,
    },
  },
  applicability: {
    minGrossSquareFeetPrivate: 50000,
    minGrossSquareFeetDistrict: 10000,
    ownershipClassFallback: "PRIVATE",
    coveredPropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
    recentConstructionExemptionYears: 5,
    cycleStartYear: 2021,
    cycleEndYear: 2026,
    filingYear: 2026,
  },
  pathwayRouting: {
    performanceScoreThreshold: 55,
    prescriptiveAlwaysEligible: true,
    supportedPathways: ["PERFORMANCE", "STANDARD_TARGET", "PRESCRIPTIVE"],
  },
  performance: {
    requiredReductionFraction: 0.2,
    scoreEligibleMetric: "ADJUSTED_SITE_EUI_AVERAGE",
    nonScoreEligibleMetric: "WEATHER_NORMALIZED_SITE_EUI_AVERAGE",
    defaultBaselineYears: [2018, 2019],
    defaultEvaluationYears: [2026],
    delayedCycle1Option: {
      baselineYears: [2018, 2019],
      evaluationYears: [2026],
      comparisonYear: 2026,
      optionYear: 2021,
    },
  },
  standardTarget: {
    defaultMaxGap: 15,
    maxGapByPropertyType: {
      OFFICE: 15,
      MULTIFAMILY: 15,
      MIXED_USE: 15,
      OTHER: 15,
    },
    exactTargetScoresByPropertyType: {
      OFFICE: 71,
      MULTIFAMILY: 66,
      MIXED_USE: 66,
      OTHER: 54,
    },
    propertyTypeMappingConstraints: {
      MIXED_USE:
        "Quoin's MIXED_USE enum is coarser than the official standards table; this entry is a governed implementation mapping, not the regulation itself.",
      OTHER:
        "Quoin's OTHER enum is coarser than the official standards table; this entry is a governed implementation mapping, not the regulation itself.",
    },
    scoreEligibleMetric: "ENERGY_STAR_SCORE",
    nonScoreEligibleMetric: "WEATHER_NORMALIZED_SOURCE_EUI",
  },
  prescriptive: {
    defaultPointsNeeded: 25,
    pointsNeededByPropertyType: {
      OFFICE: 25,
      MULTIFAMILY: 25,
      MIXED_USE: 25,
      OTHER: 25,
    },
    complianceBasis: "APPROVED_MEASURES_AND_MILESTONES",
  },
  standardsTable: BEPS_STANDARDS_TABLE.filter((entry) => entry.cycle === "CYCLE_1"),
  alternativeCompliance: {
    penaltyPerSquareFoot: 10,
    maxPenaltyCap: 7500000,
    agreementRequired: true,
    allowedAgreementPathways: ["PERFORMANCE", "STANDARD_TARGET", "PRESCRIPTIVE"],
  },
} as const;

const BEPS_CYCLE_2_FACTORS = {
  cycle: {
    filingYear: 2028,
    cycleStartYear: 2028,
    cycleEndYear: 2032,
    baselineYears: [2024, 2025],
    evaluationYears: [2028],
    baselineBenchmarkYear: 2025,
    complianceDeadline: "2028-12-31",
  },
  applicability: {
    minGrossSquareFeetPrivate: 25000,
    minGrossSquareFeetDistrict: 10000,
    ownershipClassFallback: "PRIVATE",
    coveredPropertyTypes: ["OFFICE", "MULTIFAMILY", "MIXED_USE", "OTHER"],
    recentConstructionExemptionYears: 5,
    cycleStartYear: 2028,
    cycleEndYear: 2032,
    filingYear: 2028,
  },
  pathwayRouting: {
    performanceScoreThreshold: 60,
    prescriptiveAlwaysEligible: false,
    preferredPathway: "TRAJECTORY",
    supportedPathways: ["TRAJECTORY"],
  },
  performance: {
    requiredReductionFraction: 0.25,
    scoreEligibleMetric: "ADJUSTED_SITE_EUI_AVERAGE",
    nonScoreEligibleMetric: "WEATHER_NORMALIZED_SITE_EUI_AVERAGE",
    defaultBaselineYears: [2024, 2025],
    defaultEvaluationYears: [2028],
  },
  standardTarget: {
    defaultMaxGap: 12,
    maxGapByPropertyType: {
      OFFICE: 12,
      MULTIFAMILY: 12,
      MIXED_USE: 12,
      OTHER: 12,
    },
    exactTargetScoresByPropertyType: {
      OFFICE: 74,
      MULTIFAMILY: 68,
      MIXED_USE: 68,
      OTHER: 58,
    },
    scoreEligibleMetric: "ENERGY_STAR_SCORE",
    nonScoreEligibleMetric: "WEATHER_NORMALIZED_SOURCE_EUI",
  },
  prescriptive: {
    defaultPointsNeeded: 30,
    pointsNeededByPropertyType: {
      OFFICE: 30,
      MULTIFAMILY: 30,
      MIXED_USE: 30,
      OTHER: 30,
    },
    complianceBasis: "APPROVED_MEASURES_AND_MILESTONES",
  },
  trajectory: {
    metricBasis: "ADJUSTED_SITE_EUI_AVERAGE",
    targetYears: [2028],
    finalTargetYear: 2028,
  },
  standardsTable: BEPS_STANDARDS_TABLE.filter((entry) => entry.cycle === "CYCLE_2"),
  alternativeCompliance: {
    penaltyPerSquareFoot: 12,
    maxPenaltyCap: 9000000,
    agreementRequired: false,
    allowedAgreementPathways: ["TRAJECTORY"],
  },
} as const;

async function upsertGlobalSourceArtifact(input: {
  artifactType: "LAW" | "GUIDE" | "FORM" | "PM_EXPORT" | "UTILITY_FILE" | "CSV_UPLOAD" | "GENERATED_REPORT" | "OTHER";
  name: string;
  externalUrl?: string | null;
  metadata: Prisma.InputJsonValue;
}) {
  const existing = await prisma.sourceArtifact.findFirst({
    where: {
      organizationId: null,
      name: input.name,
    },
    select: { id: true },
  });

  const data = {
    artifactType: input.artifactType,
    name: input.name,
    externalUrl: input.externalUrl ?? null,
    metadata: input.metadata,
    createdByType: "SYSTEM" as const,
    createdById: "seed",
  };

  if (existing) {
    return prisma.sourceArtifact.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.sourceArtifact.create({
    data,
  });
}

async function upsertOrganization(input: Prisma.OrganizationUncheckedCreateInput) {
  return prisma.organization.upsert({
    where: { slug: input.slug },
    update: input,
    create: input,
  });
}

async function upsertUser(input: Prisma.UserUncheckedCreateInput) {
  return prisma.user.upsert({
    where: { authUserId: input.authUserId },
    update: input,
    create: input,
  });
}

async function upsertOrganizationMembership(input: {
  organizationId: string;
  userId: string;
  role: "ADMIN" | "MANAGER" | "ENGINEER" | "VIEWER";
}) {
  return prisma.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
    update: {
      role: input.role,
    },
    create: input,
  });
}

async function upsertBuildingByName(input: Prisma.BuildingUncheckedCreateInput) {
  const existing = await prisma.building.findFirst({
    where: {
      organizationId: input.organizationId,
      name: input.name,
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.building.update({
      where: { id: existing.id },
      data: input,
    });
  }

  return prisma.building.create({
    data: input,
  });
}

async function upsertComplianceSnapshotByDate(
  input: Prisma.ComplianceSnapshotUncheckedCreateInput,
) {
  const existing = await prisma.complianceSnapshot.findFirst({
    where: {
      buildingId: input.buildingId,
      organizationId: input.organizationId,
      snapshotDate: input.snapshotDate,
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.complianceSnapshot.update({
      where: { id: existing.id },
      data: input,
    });
  }

  return prisma.complianceSnapshot.create({
    data: input,
  });
}

async function clearExistingDemoTenantData() {
  const organizations = await prisma.organization.findMany({
    where: {
      slug: {
        in: [...DEMO_ORG_SLUGS],
      },
    },
    select: { id: true },
  });
  const users = await prisma.user.findMany({
    where: {
      authUserId: {
        in: [...DEMO_USER_AUTH_IDS],
      },
    },
    select: { id: true },
  });
  const orgIds = organizations.map((organization) => organization.id);
  const userIds = users.map((user) => user.id);

  if (orgIds.length === 0 && userIds.length === 0) {
    return;
  }

  console.log("Refreshing existing demo tenant seed data...");

  const buildingIds = (
    await prisma.building.findMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
      select: { id: true },
    })
  ).map((building) => building.id);

  if (buildingIds.length > 0) {
    const complianceRunIds = (
      await prisma.complianceRun.findMany({
        where: {
          buildingId: {
            in: buildingIds,
          },
        },
        select: { id: true },
      })
    ).map((run) => run.id);

    await prisma.financingPacket.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.financingCaseCandidate.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.financingCase.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.retrofitCandidate.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.operationalAnomaly.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.portfolioManagerSyncState.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.bepsAlternativeComplianceAgreement.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.bepsPrescriptiveItem.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.bepsMetricInput.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.filingPacket.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.filingRecordEvent.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.filingRecord.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.benchmarkSubmission.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.evidenceArtifact.deleteMany({
      where: {
        OR:
          complianceRunIds.length > 0
            ? [
                {
                  buildingId: {
                    in: buildingIds,
                  },
                },
                {
                  complianceRunId: {
                    in: complianceRunIds,
                  },
                },
              ]
            : [
                {
                  buildingId: {
                    in: buildingIds,
                  },
                },
              ],
      },
    });
    await prisma.sourceArtifact.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });
    await prisma.complianceSnapshot.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.greenButtonConnection.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.energyReading.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.meter.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    await prisma.driftAlert.deleteMany({
      where: {
        buildingId: {
          in: buildingIds,
        },
      },
    });
    if (complianceRunIds.length > 0) {
      await prisma.complianceRun.deleteMany({
        where: {
          id: {
            in: complianceRunIds,
          },
        },
      });
    }
    await prisma.pipelineRun.deleteMany({
      where: {
        organizationId: {
          in: orgIds,
        },
      },
    });
    await prisma.building.deleteMany({
      where: {
        id: {
          in: buildingIds,
        },
      },
    });
  }

  if (orgIds.length > 0 || userIds.length > 0) {
    await prisma.organizationMembership.deleteMany({
      where:
        orgIds.length > 0 && userIds.length > 0
          ? {
              OR: [
                {
                  organizationId: {
                    in: orgIds,
                  },
                },
                {
                  userId: {
                    in: userIds,
                  },
                },
              ],
            }
          : orgIds.length > 0
            ? {
                organizationId: {
                  in: orgIds,
                },
              }
            : {
                userId: {
                  in: userIds,
                },
              },
    });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });
  }

  if (orgIds.length > 0) {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: orgIds,
        },
      },
    });
  }
}
void clearExistingDemoTenantData;

async function main(): Promise<void> {
  console.log("Seeding database...");

  const benchmarkingSource = await upsertGlobalSourceArtifact({
    artifactType: "LAW",
    name: "DC benchmarking binding authority bootstrap metadata",
    externalUrl: "https://doee.dc.gov/",
    metadata: {
      note: "Bootstrap/demo metadata only. Replace with canonical citation package before production filings.",
      jurisdiction: "DC",
      authorityType: "binding",
      purpose: "Benchmarking rule bootstrap",
    },
  });

  const benchmarkingGuidanceSource = await upsertGlobalSourceArtifact({
    artifactType: "GUIDE",
    name: "DC benchmarking guidance bootstrap metadata",
    externalUrl: "https://doee.dc.gov/",
    metadata: {
      note: "Bootstrap/demo metadata only. Replace with canonical guidance citations before production filings.",
      jurisdiction: "DC",
      authorityType: "guidance",
      purpose: "Benchmarking readiness guidance bootstrap",
    },
  });

  const bepsSource = await upsertGlobalSourceArtifact({
    artifactType: "LAW",
    name: "DC BEPS Cycle 1 binding authority metadata",
    externalUrl:
      "https://doee.dc.gov/release/district-establishes-new-energy-performance-standards-buildings",
    metadata: {
      note: "Seeded from official DOEE program materials. Exact code-section citation package still needs curation before production filing use.",
      jurisdiction: "DC",
      authorityType: "binding",
      purpose: "BEPS Cycle 1 rule package",
      publishedDate: "2021-01-12",
    },
  });

  const bepsStandardsSource = await upsertGlobalSourceArtifact({
    artifactType: "GUIDE",
    name: "Guide to the 2021 Building Energy Performance Standards",
    externalUrl:
      "https://doee.dc.gov/sites/default/files/dc/sites/ddoe/publication/attachments/1_Guide%20to%20the%202021%20BEPS%20v1%203-30-21.pdf",
    metadata: {
      note: "Official DOEE standards guide used to seed governed Cycle 1 factors and applicability thresholds.",
      jurisdiction: "DC",
      authorityType: "official-standards",
      purpose: "BEPS Cycle 1 factor set",
    },
  });

  const bepsStandardsUpdateSource = await upsertGlobalSourceArtifact({
    artifactType: "GUIDE",
    name: "DOEE BEPS Monthly Update May 27 2021",
    externalUrl:
      "https://doee.dc.gov/sites/default/files/dc/sites/ddoe/service_content/attachments/BEPS_MonthlyUpdate_5-27-2021.pdf",
    metadata: {
      note: "Official DOEE monthly update containing sample target standards by property type for Cycle 1.",
      jurisdiction: "DC",
      authorityType: "supporting-guidance",
      purpose: "BEPS Cycle 1 target table support",
    },
  });

  const benchmarkingRulePackage = await prisma.rulePackage.upsert({
    where: {
      key: "DC_BENCHMARKING_2025",
    },
    update: {
      name: "DC Benchmarking Annual Submission Workflow",
      description:
        "Bootstrap annual DC benchmarking workflow package for deterministic readiness checks.",
    },
    create: {
      key: "DC_BENCHMARKING_2025",
      name: "DC Benchmarking Annual Submission Workflow",
      description:
        "Bootstrap annual DC benchmarking workflow package for deterministic readiness checks.",
    },
  });

  await prisma.ruleVersion.upsert({
    where: {
      rulePackageId_version: {
        rulePackageId: benchmarkingRulePackage.id,
        version: "bootstrap-2026-03-09",
      },
    },
    update: {
      sourceArtifactId: benchmarkingSource.id,
      status: "ACTIVE",
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      implementationKey: "benchmarking/readiness-v1",
      sourceMetadata: {
        bootstrap: true,
        note: "Structural seed only; not a full regulatory codification.",
        authority: {
          type: "binding",
          sourceArtifactId: benchmarkingSource.id,
          label: "DC benchmarking authority bootstrap metadata",
        },
        guidance: [
          {
            sourceArtifactId: benchmarkingGuidanceSource.id,
            label: "DC benchmarking readiness guidance bootstrap metadata",
          },
        ],
      },
      configJson: {
        workflow: "DC_BENCHMARKING_ANNUAL",
        note: "Bootstrap deterministic readiness configuration. Replace with canonically sourced rule metadata before production filing use.",
        requirements: {
          fullCalendarYearCoverage: true,
          disallowOverlaps: true,
          propertyIdRequired: true,
          pmShareStatusRequired: "LINKED",
          dqcEvidenceKind: "DQC_REPORT",
          dqcFreshnessDays: 30,
          verification: {
            evidenceKind: "VERIFICATION",
          },
          gfaCorrection: {
            evidenceKind: "GFA_CORRECTION",
          },
        },
      },
    },
    create: {
      rulePackageId: benchmarkingRulePackage.id,
      sourceArtifactId: benchmarkingSource.id,
      version: "bootstrap-2026-03-09",
      status: "ACTIVE",
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      implementationKey: "benchmarking/readiness-v1",
      sourceMetadata: {
        bootstrap: true,
        note: "Structural seed only; not a full regulatory codification.",
        authority: {
          type: "binding",
          sourceArtifactId: benchmarkingSource.id,
          label: "DC benchmarking authority bootstrap metadata",
        },
        guidance: [
          {
            sourceArtifactId: benchmarkingGuidanceSource.id,
            label: "DC benchmarking readiness guidance bootstrap metadata",
          },
        ],
      },
      configJson: {
        workflow: "DC_BENCHMARKING_ANNUAL",
        note: "Bootstrap deterministic readiness configuration. Replace with canonically sourced rule metadata before production filing use.",
        requirements: {
          fullCalendarYearCoverage: true,
          disallowOverlaps: true,
          propertyIdRequired: true,
          pmShareStatusRequired: "LINKED",
          dqcEvidenceKind: "DQC_REPORT",
          dqcFreshnessDays: 30,
          verification: {
            evidenceKind: "VERIFICATION",
          },
          gfaCorrection: {
            evidenceKind: "GFA_CORRECTION",
          },
        },
      },
    },
  });

  const bepsCycle1RulePackage = await prisma.rulePackage.upsert({
    where: {
      key: "DC_BEPS_CYCLE_1",
    },
    update: {
      name: "DC BEPS Cycle 1",
      description:
        "Bootstrap BEPS rule family used by current deterministic snapshot calculations.",
    },
    create: {
      key: "DC_BEPS_CYCLE_1",
      name: "DC BEPS Cycle 1",
      description:
        "Bootstrap BEPS rule family used by current deterministic snapshot calculations.",
    },
  });

  await prisma.ruleVersion.upsert({
    where: {
      rulePackageId_version: {
        rulePackageId: bepsCycle1RulePackage.id,
        version: "dc-cycle-1-2021-v1",
      },
    },
    update: {
      sourceArtifactId: bepsSource.id,
      status: "ACTIVE",
      effectiveFrom: new Date("2021-01-01T00:00:00.000Z"),
      implementationKey: "beps/evaluator-v1",
      sourceMetadata: {
        seeded: true,
        note: "Rule metadata is source-aware and governance-ready. Exact code-section granularity remains a follow-up citation task.",
        bindingAuthority: {
          type: "binding",
          sourceArtifactId: bepsSource.id,
          label: "District Establishes New Energy Performance Standards for Buildings",
          publishedDate: "2021-01-12",
        },
        officialStandards: [
          {
            sourceArtifactId: bepsStandardsSource.id,
            label: "Guide to the 2021 Building Energy Performance Standards",
          },
          {
            sourceArtifactId: bepsStandardsUpdateSource.id,
            label: "DOEE BEPS Monthly Update May 27 2021",
          },
        ],
        guidance: [
          {
            label:
              "Cycle 1 pathway adjustment examples and explanatory materials supporting the exact penalty fractions encoded in the BEPS engine.",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
        ],
        formulaSupport: {
          maxPenalty: {
            source: "20 DCMR § 3521.1",
            sourceArtifactId: bepsSource.id,
          },
          performancePenaltyAdjustment: {
            source: "20 DCMR § 3521.2 and Task Force example materials",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          standardTargetPenaltyAdjustment: {
            source: "20 DCMR § 3521.2 and Task Force example materials",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          prescriptivePenaltyAdjustment: {
            source: "20 DCMR § 3521.2 and Task Force example materials",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          delayedCycle1Option: {
            source: "20 DCMR § 3518.1(e)",
            sourceArtifactId: bepsSource.id,
          },
        },
      },
      configJson: {
        cycle: "CYCLE_1",
        filingYear: 2026,
        note: "Cycle 1 BEPS rule package metadata. Thresholds, rates, and target tables live in the governed factor set.",
        ruleFamily: "DC_BEPS_CYCLE_1",
        legalMetadata: {
          jurisdiction: "DC",
          program: "BEPS",
          cycleLabel: "Cycle 1",
          filingYear: 2026,
          complianceDeadline: "2026-12-31",
        },
        pathwayRouting: {
          prescriptiveAlwaysEligible: true,
          supportedPathways: ["PERFORMANCE", "STANDARD_TARGET", "PRESCRIPTIVE"],
        },
        implementationNotes: {
          formulaShape:
            "Performance, standard-target, prescriptive, and agreement-based alternative compliance adjustment formulas are implemented in code; numeric rule data is governed in the factor set.",
        },
      },
    },
    create: {
      rulePackageId: bepsCycle1RulePackage.id,
      sourceArtifactId: bepsSource.id,
      version: "dc-cycle-1-2021-v1",
      status: "ACTIVE",
      effectiveFrom: new Date("2021-01-01T00:00:00.000Z"),
      implementationKey: "beps/evaluator-v1",
      sourceMetadata: {
        seeded: true,
        note: "Rule metadata is source-aware and governance-ready. Exact code-section granularity remains a follow-up citation task.",
        bindingAuthority: {
          type: "binding",
          sourceArtifactId: bepsSource.id,
          label: "District Establishes New Energy Performance Standards for Buildings",
          publishedDate: "2021-01-12",
        },
        officialStandards: [
          {
            sourceArtifactId: bepsStandardsSource.id,
            label: "Guide to the 2021 Building Energy Performance Standards",
          },
          {
            sourceArtifactId: bepsStandardsUpdateSource.id,
            label: "DOEE BEPS Monthly Update May 27 2021",
          },
        ],
        guidance: [
          {
            label:
              "Cycle 1 pathway adjustment examples and explanatory materials supporting the exact penalty fractions encoded in the BEPS engine.",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
        ],
        formulaSupport: {
          maxPenalty: {
            source: "20 DCMR Â§ 3521.1",
            sourceArtifactId: bepsSource.id,
          },
          performancePenaltyAdjustment: {
            source: "20 DCMR Â§ 3521.2 and Task Force example materials",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          standardTargetPenaltyAdjustment: {
            source: "20 DCMR Â§ 3521.2 and Task Force example materials",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          prescriptivePenaltyAdjustment: {
            source: "20 DCMR Â§ 3521.2 and Task Force example materials",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          delayedCycle1Option: {
            source: "20 DCMR Â§ 3518.1(e)",
            sourceArtifactId: bepsSource.id,
          },
        },
      },
      configJson: {
        cycle: "CYCLE_1",
        filingYear: 2026,
        note: "Cycle 1 BEPS rule package metadata. Thresholds, rates, and target tables live in the governed factor set.",
        ruleFamily: "DC_BEPS_CYCLE_1",
        legalMetadata: {
          jurisdiction: "DC",
          program: "BEPS",
          cycleLabel: "Cycle 1",
          filingYear: 2026,
          complianceDeadline: "2026-12-31",
        },
        pathwayRouting: {
          prescriptiveAlwaysEligible: true,
          supportedPathways: ["PERFORMANCE", "STANDARD_TARGET", "PRESCRIPTIVE"],
        },
        implementationNotes: {
          formulaShape:
            "Performance, standard-target, prescriptive, and agreement-based alternative compliance adjustment formulas are implemented in code; numeric rule data is governed in the factor set.",
        },
      },
    },
  });

  const bepsCycle2RulePackage = await prisma.rulePackage.upsert({
    where: {
      key: "DC_BEPS_CYCLE_2",
    },
    update: {
      name: "DC BEPS Cycle 2",
      description:
        "Initial multi-cycle BEPS rule family used by Quoin's trajectory-aware engine.",
    },
    create: {
      key: "DC_BEPS_CYCLE_2",
      name: "DC BEPS Cycle 2",
      description:
        "Initial multi-cycle BEPS rule family used by Quoin's trajectory-aware engine.",
    },
  });

  await prisma.ruleVersion.upsert({
    where: {
      rulePackageId_version: {
        rulePackageId: bepsCycle2RulePackage.id,
        version: "dc-cycle-2-bootstrap-v1",
      },
    },
    update: {
      sourceArtifactId: bepsStandardsUpdateSource.id,
      status: "ACTIVE",
      effectiveFrom: new Date("2028-01-01T00:00:00.000Z"),
      implementationKey: "beps/evaluator-v2",
      sourceMetadata: {
        seeded: true,
        bootstrap: true,
        note:
          "Initial governed Cycle 2 seed for Quoin's multi-cycle engine. Replace with fully curated Cycle 2 regulatory citations before production filing use.",
        authority: {
          type: "supporting-guidance",
          sourceArtifactId: bepsStandardsUpdateSource.id,
          label: "Initial Cycle 2 bootstrap metadata",
        },
      },
      configJson: {
        cycle: "CYCLE_2",
        filingYear: 2028,
        note:
          "Initial Cycle 2 governed metadata for the multi-cycle engine. Trajectory targets and standards rows are defined in the factor set.",
        pathwayRouting: {
          preferredPathway: "TRAJECTORY",
          supportedPathways: ["TRAJECTORY"],
          prescriptiveAlwaysEligible: false,
        },
        trajectory: {
          metricBasis: "ADJUSTED_SITE_EUI_AVERAGE",
          targetYears: [2028],
          finalTargetYear: 2028,
        },
      },
    },
    create: {
      rulePackageId: bepsCycle2RulePackage.id,
      sourceArtifactId: bepsStandardsUpdateSource.id,
      version: "dc-cycle-2-bootstrap-v1",
      status: "ACTIVE",
      effectiveFrom: new Date("2028-01-01T00:00:00.000Z"),
      implementationKey: "beps/evaluator-v2",
      sourceMetadata: {
        seeded: true,
        bootstrap: true,
        note:
          "Initial governed Cycle 2 seed for Quoin's multi-cycle engine. Replace with fully curated Cycle 2 regulatory citations before production filing use.",
        authority: {
          type: "supporting-guidance",
          sourceArtifactId: bepsStandardsUpdateSource.id,
          label: "Initial Cycle 2 bootstrap metadata",
        },
      },
      configJson: {
        cycle: "CYCLE_2",
        filingYear: 2028,
        note:
          "Initial Cycle 2 governed metadata for the multi-cycle engine. Trajectory targets and standards rows are defined in the factor set.",
        pathwayRouting: {
          preferredPathway: "TRAJECTORY",
          supportedPathways: ["TRAJECTORY"],
          prescriptiveAlwaysEligible: false,
        },
        trajectory: {
          metricBasis: "ADJUSTED_SITE_EUI_AVERAGE",
          targetYears: [2028],
          finalTargetYear: 2028,
        },
      },
    },
  });

  await prisma.factorSetVersion.upsert({
    where: {
      key_version: {
        key: "DC_CURRENT_STANDARDS",
        version: "bootstrap-2026-03-09",
      },
    },
    update: {
      sourceArtifactId: benchmarkingGuidanceSource.id,
      status: "ACTIVE",
      effectiveFrom: new Date("2024-01-01T00:00:00.000Z"),
      sourceMetadata: {
        bootstrap: true,
        note: "Shared non-BEPS standards seed used by the benchmarking workflow and legacy ingestion utilities.",
      },
      factorsJson: {
        sourceSiteRatios: {
          ELECTRIC: 2.8,
          GAS: 1.05,
          STEAM: 1.45,
          OTHER: 1.0,
        },
        penaltyPerSquareFoot: 10,
        maxPenaltyCap: 7500000,
        benchmarking: {
          dqcFreshnessDays: 30,
          applicabilityBands: BENCHMARKING_APPLICABILITY_BANDS,
        },
      },
    },
    create: {
      key: "DC_CURRENT_STANDARDS",
      sourceArtifactId: benchmarkingGuidanceSource.id,
      version: "bootstrap-2026-03-09",
      status: "ACTIVE",
      effectiveFrom: new Date("2024-01-01T00:00:00.000Z"),
      sourceMetadata: {
        bootstrap: true,
        note: "Shared non-BEPS standards seed used by the benchmarking workflow and legacy ingestion utilities.",
      },
      factorsJson: {
        sourceSiteRatios: {
          ELECTRIC: 2.8,
          GAS: 1.05,
          STEAM: 1.45,
          OTHER: 1.0,
        },
        penaltyPerSquareFoot: 10,
        maxPenaltyCap: 7500000,
        benchmarking: {
          dqcFreshnessDays: 30,
          applicabilityBands: BENCHMARKING_APPLICABILITY_BANDS,
        },
      },
    },
  });

  const bepsCycle1FactorSetVersion = await prisma.factorSetVersion.upsert({
    where: {
      key_version: {
        key: BEPS_CYCLE_1_FACTOR_SET_KEY,
        version: "dc-cycle-1-factors-v1",
      },
    },
    update: {
      sourceArtifactId: bepsStandardsSource.id,
      status: "ACTIVE",
      effectiveFrom: new Date("2021-01-01T00:00:00.000Z"),
      sourceMetadata: {
        seeded: true,
        note:
          "Governed Cycle 1 factor payload. Numeric thresholds, exact formula inputs, and agreement hooks live here instead of in BEPS engine modules.",
        bindingAuthoritySourceArtifactId: bepsSource.id,
        officialStandardsSourceArtifactIds: [
          bepsStandardsSource.id,
          bepsStandardsUpdateSource.id,
        ],
        formulaSources: {
          maxPenalty: {
            citation: "20 DCMR § 3521.1",
            sourceArtifactId: bepsSource.id,
          },
          performanceAdjustment: {
            citation: "20 DCMR § 3521.2",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          standardTargetAdjustment: {
            citation: "20 DCMR § 3521.2",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          prescriptiveAdjustment: {
            citation: "20 DCMR § 3521.2",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          delayedCycle1Option: {
            citation: "20 DCMR § 3518.1(e)",
            sourceArtifactId: bepsSource.id,
          },
        },
        targetScoreNotes: {
          OFFICE: "Direct Office ENERGY STAR score threshold from DOEE Cycle 1 materials.",
          MULTIFAMILY:
            "Direct Multifamily Housing ENERGY STAR score threshold from DOEE Cycle 1 materials.",
          MIXED_USE:
            "Best-fit mapping for Quoin's coarse MIXED_USE enum. Exact mixed-use standards may vary by Portfolio Manager use mix and should be refined with richer property taxonomy.",
          OTHER:
            "Best-fit mapping for Quoin's coarse OTHER enum using the hotel-like published threshold. Exact OTHER handling should be refined with richer property taxonomy.",
        },
      },
      factorsJson: {
        beps: BEPS_CYCLE_1_FACTORS,
      },
    },
    create: {
      key: BEPS_CYCLE_1_FACTOR_SET_KEY,
      sourceArtifactId: bepsStandardsSource.id,
      version: "dc-cycle-1-factors-v1",
      status: "ACTIVE",
      effectiveFrom: new Date("2021-01-01T00:00:00.000Z"),
      sourceMetadata: {
        seeded: true,
        note:
          "Governed Cycle 1 factor payload. Numeric thresholds, exact formula inputs, and agreement hooks live here instead of in BEPS engine modules.",
        bindingAuthoritySourceArtifactId: bepsSource.id,
        officialStandardsSourceArtifactIds: [
          bepsStandardsSource.id,
          bepsStandardsUpdateSource.id,
        ],
        formulaSources: {
          maxPenalty: {
            citation: "20 DCMR Â§ 3521.1",
            sourceArtifactId: bepsSource.id,
          },
          performanceAdjustment: {
            citation: "20 DCMR Â§ 3521.2",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          standardTargetAdjustment: {
            citation: "20 DCMR Â§ 3521.2",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          prescriptiveAdjustment: {
            citation: "20 DCMR Â§ 3521.2",
            sourceArtifactId: bepsStandardsUpdateSource.id,
          },
          delayedCycle1Option: {
            citation: "20 DCMR Â§ 3518.1(e)",
            sourceArtifactId: bepsSource.id,
          },
        },
        targetScoreNotes: {
          OFFICE: "Direct Office ENERGY STAR score threshold from DOEE Cycle 1 materials.",
          MULTIFAMILY:
            "Direct Multifamily Housing ENERGY STAR score threshold from DOEE Cycle 1 materials.",
          MIXED_USE:
            "Best-fit mapping for Quoin's coarse MIXED_USE enum. Exact mixed-use standards may vary by Portfolio Manager use mix and should be refined with richer property taxonomy.",
          OTHER:
            "Best-fit mapping for Quoin's coarse OTHER enum using the hotel-like published threshold. Exact OTHER handling should be refined with richer property taxonomy.",
        },
      },
      factorsJson: {
        beps: BEPS_CYCLE_1_FACTORS,
      },
    },
  });

  const bepsCycle2FactorSetVersion = await prisma.factorSetVersion.upsert({
    where: {
      key_version: {
        key: BEPS_CYCLE_2_FACTOR_SET_KEY,
        version: "dc-cycle-2-factors-v1",
      },
    },
    update: {
      sourceArtifactId: bepsStandardsUpdateSource.id,
      status: "ACTIVE",
      effectiveFrom: new Date("2028-01-01T00:00:00.000Z"),
      sourceMetadata: {
        seeded: true,
        bootstrap: true,
        note:
          "Initial Cycle 2 factor payload for Quoin's multi-cycle engine. Trajectory targets and cycle-specific standards are governed here.",
        sourceArtifactId: bepsStandardsUpdateSource.id,
      },
      factorsJson: {
        beps: BEPS_CYCLE_2_FACTORS,
      },
    },
    create: {
      key: BEPS_CYCLE_2_FACTOR_SET_KEY,
      sourceArtifactId: bepsStandardsUpdateSource.id,
      version: "dc-cycle-2-factors-v1",
      status: "ACTIVE",
      effectiveFrom: new Date("2028-01-01T00:00:00.000Z"),
      sourceMetadata: {
        seeded: true,
        bootstrap: true,
        note:
          "Initial Cycle 2 factor payload for Quoin's multi-cycle engine. Trajectory targets and cycle-specific standards are governed here.",
        sourceArtifactId: bepsStandardsUpdateSource.id,
      },
      factorsJson: {
        beps: BEPS_CYCLE_2_FACTORS,
      },
    },
  });

  await prisma.bepsCycleRegistry.upsert({
    where: {
      cycleId: "BEPS_CYCLE_1",
    },
    update: {
      complianceCycle: "CYCLE_1",
      cycleStartYear: 2021,
      cycleEndYear: 2026,
      baselineYearStart: 2018,
      baselineYearEnd: 2019,
      evaluationYear: 2026,
      rulePackageId: bepsCycle1RulePackage.id,
      factorSetVersionId: bepsCycle1FactorSetVersion.id,
    },
    create: {
      cycleId: "BEPS_CYCLE_1",
      complianceCycle: "CYCLE_1",
      cycleStartYear: 2021,
      cycleEndYear: 2026,
      baselineYearStart: 2018,
      baselineYearEnd: 2019,
      evaluationYear: 2026,
      rulePackageId: bepsCycle1RulePackage.id,
      factorSetVersionId: bepsCycle1FactorSetVersion.id,
    },
  });

  await prisma.bepsCycleRegistry.upsert({
    where: {
      cycleId: "BEPS_CYCLE_2",
    },
    update: {
      complianceCycle: "CYCLE_2",
      cycleStartYear: 2028,
      cycleEndYear: 2032,
      baselineYearStart: 2024,
      baselineYearEnd: 2025,
      evaluationYear: 2028,
      rulePackageId: bepsCycle2RulePackage.id,
      factorSetVersionId: bepsCycle2FactorSetVersion.id,
    },
    create: {
      cycleId: "BEPS_CYCLE_2",
      complianceCycle: "CYCLE_2",
      cycleStartYear: 2028,
      cycleEndYear: 2032,
      baselineYearStart: 2024,
      baselineYearEnd: 2025,
      evaluationYear: 2028,
      rulePackageId: bepsCycle2RulePackage.id,
      factorSetVersionId: bepsCycle2FactorSetVersion.id,
    },
  });

  // ─── Organization 1: Meridian Capital Partners (PRO) ────────────────────

  const org1 = await upsertOrganization({
    name: "Meridian Capital Partners",
    slug: "meridian-capital",
    tier: "PRO",
    settings: {},
  });

  const org1User = await upsertUser({
    authUserId: "supabase_user_meridian_admin_001",
    email: "admin@meridiancapital.com",
    name: "Sarah Chen",
  });

  await upsertOrganizationMembership({
    organizationId: org1.id,
    userId: org1User.id,
    role: "ADMIN",
  });

  const org1Buildings = await Promise.all([
    upsertBuildingByName({
      organizationId: org1.id,
      name: "K Street Tower",
      address: "1200 K Street NW, Washington, DC 20005",
      latitude: 38.9025,
      longitude: -77.0283,
      grossSquareFeet: 185000,
      propertyType: "OFFICE",
      ownershipType: "PRIVATE",
      isEnergyStarScoreEligible: true,
      yearBuilt: 1988,
      bepsTargetScore: 71,
      maxPenaltyExposure: Math.min(185000 * 10, 7_500_000),
    }),
    upsertBuildingByName({
      organizationId: org1.id,
      name: "L Street Office Center",
      address: "1350 L Street NW, Washington, DC 20005",
      latitude: 38.9042,
      longitude: -77.0312,
      grossSquareFeet: 220000,
      propertyType: "OFFICE",
      ownershipType: "PRIVATE",
      isEnergyStarScoreEligible: true,
      yearBuilt: 1995,
      bepsTargetScore: 71,
      maxPenaltyExposure: Math.min(220000 * 10, 7_500_000),
    }),
    upsertBuildingByName({
      organizationId: org1.id,
      name: "Connecticut Avenue Plaza",
      address: "1625 Connecticut Avenue NW, Washington, DC 20009",
      latitude: 38.9132,
      longitude: -77.0451,
      grossSquareFeet: 145000,
      propertyType: "OFFICE",
      ownershipType: "PRIVATE",
      isEnergyStarScoreEligible: true,
      yearBuilt: 2001,
      bepsTargetScore: 71,
      maxPenaltyExposure: Math.min(145000 * 10, 7_500_000),
    }),
    upsertBuildingByName({
      organizationId: org1.id,
      name: "Columbia Heights Residences",
      address: "3100 14th Street NW, Washington, DC 20010",
      latitude: 38.9282,
      longitude: -77.0323,
      grossSquareFeet: 95000,
      propertyType: "MULTIFAMILY",
      ownershipType: "PRIVATE",
      yearBuilt: 1972,
      bepsTargetScore: 66,
      maxPenaltyExposure: Math.min(95000 * 10, 7_500_000),
    }),
    upsertBuildingByName({
      organizationId: org1.id,
      name: "U Street Mixed-Use",
      address: "1401 U Street NW, Washington, DC 20009",
      latitude: 38.9170,
      longitude: -77.0326,
      grossSquareFeet: 68000,
      propertyType: "MIXED_USE",
      ownershipType: "PRIVATE",
      isEnergyStarScoreEligible: false,
      yearBuilt: 2010,
      bepsTargetScore: 61,
      targetEui: 155,
      maxPenaltyExposure: Math.min(68000 * 10, 7_500_000),
    }),
  ]);

  // Create compliance snapshots for Org 1 buildings
  // K Street Tower: COMPLIANT (score 78, target 71)
  const kStreetSnapshot = await upsertComplianceSnapshotByDate({
    buildingId: org1Buildings[0].id,
    organizationId: org1.id,
    snapshotDate: new Date("2026-03-01T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: 78,
    siteEui: 62.3,
    sourceEui: 145.8,
    weatherNormalizedSiteEui: 60.1,
    weatherNormalizedSourceEui: 142.4,
    complianceStatus: "COMPLIANT",
    complianceGap: 7,
    estimatedPenalty: 0,
    dataQualityScore: 92,
  });

  // L Street Office Center: AT_RISK (score 68, target 71)
  await upsertComplianceSnapshotByDate({
    buildingId: org1Buildings[1].id,
    organizationId: org1.id,
    snapshotDate: new Date("2026-03-02T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: 68,
    siteEui: 78.5,
    sourceEui: 172.4,
    complianceStatus: "AT_RISK",
    complianceGap: -3,
    estimatedPenalty: 450000,
    dataQualityScore: 88,
  });

  // Connecticut Avenue Plaza: COMPLIANT (score 82, target 71)
  await upsertComplianceSnapshotByDate({
    buildingId: org1Buildings[2].id,
    organizationId: org1.id,
    snapshotDate: new Date("2026-03-03T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: 82,
    siteEui: 54.1,
    sourceEui: 128.3,
    complianceStatus: "COMPLIANT",
    complianceGap: 11,
    estimatedPenalty: 0,
    dataQualityScore: 95,
  });

  // Columbia Heights Residences: NON_COMPLIANT (score 52, target 66)
  await upsertComplianceSnapshotByDate({
    buildingId: org1Buildings[3].id,
    organizationId: org1.id,
    snapshotDate: new Date("2026-03-04T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: 52,
    siteEui: 98.7,
    sourceEui: 112.4,
    complianceStatus: "NON_COMPLIANT",
    complianceGap: -14,
    estimatedPenalty: 680000,
    dataQualityScore: 75,
  });

  // U Street Mixed-Use: AT_RISK (score 59, target 61)
  const uStreetSnapshot = await upsertComplianceSnapshotByDate({
    buildingId: org1Buildings[4].id,
    organizationId: org1.id,
    snapshotDate: new Date("2026-03-05T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: 59,
    siteEui: 85.2,
    sourceEui: 165.7,
    weatherNormalizedSiteEui: 82.4,
    weatherNormalizedSourceEui: 158.6,
    complianceStatus: "AT_RISK",
    complianceGap: -2,
    estimatedPenalty: 220000,
    dataQualityScore: 82,
  });

  // ─── Organization 2: District Housing Alliance (ENTERPRISE) ─────────────

  const org2 = await upsertOrganization({
    name: "District Housing Alliance",
    slug: "district-housing",
    tier: "ENTERPRISE",
    settings: {},
  });

  const org2User = await upsertUser({
    authUserId: "supabase_user_dha_admin_001",
    email: "admin@districthousing.org",
    name: "Marcus Williams",
  });

  await upsertOrganizationMembership({
    organizationId: org2.id,
    userId: org2User.id,
    role: "ADMIN",
  });

  const org2Buildings = await Promise.all([
    upsertBuildingByName({
      organizationId: org2.id,
      name: "Anacostia Gardens",
      address: "2100 Martin Luther King Jr Avenue SE, Washington, DC 20020",
      latitude: 38.8583,
      longitude: -76.9853,
      grossSquareFeet: 120000,
      propertyType: "MULTIFAMILY",
      ownershipType: "PRIVATE",
      yearBuilt: 1965,
      bepsTargetScore: 66,
      maxPenaltyExposure: Math.min(120000 * 10, 7_500_000),
    }),
    upsertBuildingByName({
      organizationId: org2.id,
      name: "Congress Heights Commons",
      address: "3500 Wheeler Road SE, Washington, DC 20032",
      latitude: 38.8358,
      longitude: -76.9989,
      grossSquareFeet: 85000,
      propertyType: "MULTIFAMILY",
      ownershipType: "PRIVATE",
      yearBuilt: 1958,
      bepsTargetScore: 66,
      maxPenaltyExposure: Math.min(85000 * 10, 7_500_000),
    }),
    upsertBuildingByName({
      organizationId: org2.id,
      name: "Petworth Place",
      address: "4200 Georgia Avenue NW, Washington, DC 20011",
      latitude: 38.9412,
      longitude: -77.0233,
      grossSquareFeet: 72000,
      propertyType: "MULTIFAMILY",
      ownershipType: "PRIVATE",
      yearBuilt: 1971,
      bepsTargetScore: 66,
      maxPenaltyExposure: Math.min(72000 * 10, 7_500_000),
    }),
  ]);

  // All org2 buildings are NON_COMPLIANT (affordable housing, tests AHRA eligibility)
  // Anacostia Gardens: NON_COMPLIANT (score 41, target 66)
  await upsertComplianceSnapshotByDate({
    buildingId: org2Buildings[0].id,
    organizationId: org2.id,
    snapshotDate: new Date("2026-03-06T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: 41,
    siteEui: 118.5,
    sourceEui: 134.2,
    complianceStatus: "NON_COMPLIANT",
    complianceGap: -25,
    estimatedPenalty: 950000,
    dataQualityScore: 68,
  });

  // Congress Heights Commons: NON_COMPLIANT (score 35, target 66)
  await upsertComplianceSnapshotByDate({
    buildingId: org2Buildings[1].id,
    organizationId: org2.id,
    snapshotDate: new Date("2026-03-07T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: 35,
    siteEui: 132.4,
    sourceEui: 150.8,
    complianceStatus: "NON_COMPLIANT",
    complianceGap: -31,
    estimatedPenalty: 850000,
    dataQualityScore: 62,
  });

  // Petworth Place: NON_COMPLIANT (score 48, target 66)
  await upsertComplianceSnapshotByDate({
    buildingId: org2Buildings[2].id,
    organizationId: org2.id,
    snapshotDate: new Date("2026-03-08T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: 48,
    siteEui: 105.3,
    sourceEui: 119.8,
    complianceStatus: "NON_COMPLIANT",
    complianceGap: -18,
    estimatedPenalty: 720000,
    dataQualityScore: 71,
  });

  // ─── Organization 3: Foggy Bottom Hotels LLC (FREE) ─────────────────────

  const org3 = await upsertOrganization({
    name: "Foggy Bottom Hotels LLC",
    slug: "foggy-bottom-hotels",
    tier: "FREE",
    settings: {},
  });

  const org3User = await upsertUser({
    authUserId: "supabase_user_fbh_admin_001",
    email: "admin@foggybottomhotels.com",
    name: "Patricia Nguyen",
  });

  await upsertOrganizationMembership({
    organizationId: org3.id,
    userId: org3User.id,
    role: "ADMIN",
  });

  const org3Buildings = await Promise.all([
    upsertBuildingByName({
      organizationId: org3.id,
      name: "New Hampshire Suites",
      address: "1143 New Hampshire Avenue NW, Washington, DC 20037",
      latitude: 38.9058,
      longitude: -77.0479,
      grossSquareFeet: 110000,
      propertyType: "OTHER",
      ownershipType: "PRIVATE",
      yearBuilt: 1985,
      bepsTargetScore: 61,
      maxPenaltyExposure: Math.min(110000 * 10, 7_500_000),
    }),
    upsertBuildingByName({
      organizationId: org3.id,
      name: "M Street Boutique Hotel",
      address: "2430 M Street NW, Washington, DC 20037",
      latitude: 38.9050,
      longitude: -77.0530,
      grossSquareFeet: 52000,
      propertyType: "OTHER",
      ownershipType: "PRIVATE",
      isEnergyStarScoreEligible: false,
      yearBuilt: 2005,
      bepsTargetScore: 61,
      targetEui: 205,
      maxPenaltyExposure: Math.min(52000 * 10, 7_500_000),
    }),
  ]);

  // New Hampshire Suites: COMPLIANT (score 67, target 61)
  await upsertComplianceSnapshotByDate({
    buildingId: org3Buildings[0].id,
    organizationId: org3.id,
    snapshotDate: new Date("2026-03-09T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: 67,
    siteEui: 95.4,
    sourceEui: 198.3,
    complianceStatus: "COMPLIANT",
    complianceGap: 6,
    estimatedPenalty: 0,
    dataQualityScore: 85,
  });

  // M Street Boutique Hotel: AT_RISK (score 58, target 61)
  await upsertComplianceSnapshotByDate({
    buildingId: org3Buildings[1].id,
    organizationId: org3.id,
    snapshotDate: new Date("2026-03-10T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: 58,
    siteEui: 108.7,
    sourceEui: 225.6,
    complianceStatus: "AT_RISK",
    complianceGap: -3,
    estimatedPenalty: 180000,
    dataQualityScore: 78,
  });

  const districtAnnex = await upsertBuildingByName({
    organizationId: org2.id,
    name: "Ward 8 Services Annex",
    address: "1100 Alabama Avenue SE, Washington, DC 20032",
    latitude: 38.8429,
    longitude: -76.9821,
    grossSquareFeet: 18000,
    propertyType: "OFFICE",
    ownershipType: "DISTRICT",
    isEnergyStarScoreEligible: false,
    yearBuilt: 1978,
    bepsTargetScore: 71,
    targetEui: 140,
    maxPenaltyExposure: Math.min(18000 * 10, 7_500_000),
  });

  const districtAnnexSnapshot = await upsertComplianceSnapshotByDate({
    buildingId: districtAnnex.id,
    organizationId: org2.id,
    snapshotDate: new Date("2026-03-11T00:00:00.000Z"),
    triggerType: "MANUAL",
    energyStarScore: null,
    siteEui: 76.2,
    sourceEui: 155.4,
    weatherNormalizedSiteEui: 73.8,
    weatherNormalizedSourceEui: 138.0,
    complianceStatus: "PENDING_DATA",
    complianceGap: null,
    estimatedPenalty: 120000,
    dataQualityScore: 84,
    targetEui: 140,
  });

  await prisma.building.updateMany({
    where: {
      id: {
        in: [org1Buildings[0].id, org1Buildings[1].id, org1Buildings[2].id],
      },
    },
    data: {
      ownershipType: "PRIVATE",
      isEnergyStarScoreEligible: true,
    },
  });

  await prisma.building.update({
    where: { id: org1Buildings[4].id },
    data: {
      ownershipType: "PRIVATE",
      isEnergyStarScoreEligible: false,
      targetEui: 155,
    },
  });

  await prisma.building.update({
    where: { id: org3Buildings[1].id },
    data: {
      ownershipType: "PRIVATE",
      isEnergyStarScoreEligible: false,
      targetEui: 205,
    },
  });

  for (const metricInput of [
    {
      organizationId: org1.id,
      buildingId: org1Buildings[0].id,
      complianceCycle: "CYCLE_1" as const,
      filingYear: 2026,
      baselineYearStart: 2018,
      baselineYearEnd: 2019,
      evaluationYearStart: 2026,
      evaluationYearEnd: 2026,
      comparisonYear: 2026,
      delayedCycle1OptionApplied: false,
      baselineAdjustedSiteEui: 100,
      evaluationAdjustedSiteEui: 78,
      baselineWeatherNormalizedSiteEui: 98,
      evaluationWeatherNormalizedSiteEui: 76,
      baselineWeatherNormalizedSourceEui: 170,
      evaluationWeatherNormalizedSourceEui: 142.4,
      baselineEnergyStarScore: 60,
      evaluationEnergyStarScore: 78,
      evaluationSnapshotId: kStreetSnapshot.id,
      sourceArtifactId: bepsStandardsSource.id,
      notesJson: {
        seeded: true,
        purpose: "Score-eligible canonical Cycle 1 metrics",
      },
    },
    {
      organizationId: org1.id,
      buildingId: org1Buildings[4].id,
      complianceCycle: "CYCLE_1" as const,
      filingYear: 2026,
      baselineYearStart: 2018,
      baselineYearEnd: 2019,
      evaluationYearStart: 2026,
      evaluationYearEnd: 2026,
      comparisonYear: 2026,
      delayedCycle1OptionApplied: false,
      baselineAdjustedSiteEui: 92,
      evaluationAdjustedSiteEui: 82,
      baselineWeatherNormalizedSiteEui: 88,
      evaluationWeatherNormalizedSiteEui: 80,
      baselineWeatherNormalizedSourceEui: 170,
      evaluationWeatherNormalizedSourceEui: 158.6,
      evaluationSnapshotId: uStreetSnapshot.id,
      sourceArtifactId: bepsStandardsSource.id,
      notesJson: {
        seeded: true,
        purpose: "Non-score canonical Cycle 1 metrics",
      },
    },
    {
      organizationId: org2.id,
      buildingId: districtAnnex.id,
      complianceCycle: "CYCLE_1" as const,
      filingYear: 2026,
      baselineYearStart: 2018,
      baselineYearEnd: 2019,
      evaluationYearStart: 2026,
      evaluationYearEnd: 2026,
      comparisonYear: 2026,
      delayedCycle1OptionApplied: true,
      baselineAdjustedSiteEui: 86,
      evaluationAdjustedSiteEui: 72,
      baselineWeatherNormalizedSiteEui: 82,
      evaluationWeatherNormalizedSiteEui: 73.8,
      baselineWeatherNormalizedSourceEui: 168,
      evaluationWeatherNormalizedSourceEui: 138,
      evaluationSnapshotId: districtAnnexSnapshot.id,
      sourceArtifactId: bepsStandardsSource.id,
      notesJson: {
        seeded: true,
        purpose: "District-owned applicability threshold and delayed Cycle 1 metrics",
      },
    },
  ]) {
    await prisma.bepsMetricInput.upsert({
      where: {
        buildingId_complianceCycle_filingYear: {
          buildingId: metricInput.buildingId,
          complianceCycle: metricInput.complianceCycle,
          filingYear: metricInput.filingYear,
        },
      },
      update: metricInput,
      create: metricInput,
    });
  }

  for (const prescriptiveItem of [
    {
      organizationId: org1.id,
      buildingId: org1Buildings[1].id,
      complianceCycle: "CYCLE_1" as const,
      filingYear: 2026,
      itemKey: "lighting-upgrade",
      name: "Common area LED lighting retrofit",
      milestoneName: "Owner sign-off complete",
      isRequired: true,
      pointsPossible: 10,
      pointsEarned: 10,
      status: "APPROVED" as const,
      completedAt: new Date("2025-11-01T00:00:00.000Z"),
      approvedAt: new Date("2025-11-15T00:00:00.000Z"),
      sourceArtifactId: bepsStandardsUpdateSource.id,
      metadata: {
        seeded: true,
      },
    },
    {
      organizationId: org1.id,
      buildingId: org1Buildings[1].id,
      complianceCycle: "CYCLE_1" as const,
      filingYear: 2026,
      itemKey: "ahu-controls",
      name: "Air handling unit controls recommissioning",
      milestoneName: "Commissioning verification pending",
      isRequired: true,
      pointsPossible: 15,
      pointsEarned: 8,
      status: "IN_PROGRESS" as const,
      dueAt: new Date("2026-08-01T00:00:00.000Z"),
      sourceArtifactId: bepsStandardsUpdateSource.id,
      metadata: {
        seeded: true,
      },
    },
  ]) {
    await prisma.bepsPrescriptiveItem.upsert({
      where: {
        buildingId_complianceCycle_filingYear_itemKey: {
          buildingId: prescriptiveItem.buildingId,
          complianceCycle: prescriptiveItem.complianceCycle,
          filingYear: prescriptiveItem.filingYear,
          itemKey: prescriptiveItem.itemKey,
        },
      },
      update: prescriptiveItem,
      create: prescriptiveItem,
    });
  }

  await prisma.bepsAlternativeComplianceAgreement.upsert({
    where: {
      buildingId_complianceCycle_filingYear_agreementIdentifier: {
        buildingId: org1Buildings[1].id,
        complianceCycle: "CYCLE_1",
        filingYear: 2026,
        agreementIdentifier: "ACP-L-STREET-2026",
      },
    },
    update: {
      organizationId: org1.id,
      pathway: "PERFORMANCE",
      multiplier: 0.65,
      status: "ACTIVE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      sourceArtifactId: bepsSource.id,
      agreementPayload: {
        seeded: true,
        note: "Structural ACP agreement seed to prove canonical agreement loading.",
      },
    },
    create: {
      organizationId: org1.id,
      buildingId: org1Buildings[1].id,
      complianceCycle: "CYCLE_1",
      filingYear: 2026,
      agreementIdentifier: "ACP-L-STREET-2026",
      pathway: "PERFORMANCE",
      multiplier: 0.65,
      status: "ACTIVE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      sourceArtifactId: bepsSource.id,
      agreementPayload: {
        seeded: true,
        note: "Structural ACP agreement seed to prove canonical agreement loading.",
      },
    },
  });

  await prisma.portfolioManagerSyncState.upsert({
    where: {
      buildingId: org1Buildings[0].id,
    },
    update: {
      organizationId: org1.id,
      status: "SUCCEEDED",
      lastAttemptedSyncAt: new Date("2026-02-15T00:00:00.000Z"),
      lastSuccessfulSyncAt: new Date("2026-02-15T00:00:00.000Z"),
      lastErrorMetadata: {},
      sourceMetadata: {
        system: "ENERGY_STAR_PORTFOLIO_MANAGER",
        seeded: true,
      },
      syncMetadata: {
        reportingYear: 2025,
        stepStatuses: {
          property: "SUCCEEDED",
          meters: "SUCCEEDED",
          consumption: "SUCCEEDED",
          metrics: "SUCCEEDED",
          benchmarking: "SUCCEEDED",
        },
      },
      qaPayload: {
        evaluatedAt: "2026-02-15T00:00:00.000Z",
        reportingYear: 2025,
        status: "READY",
        findings: [],
      },
    },
    create: {
      organizationId: org1.id,
      buildingId: org1Buildings[0].id,
      status: "SUCCEEDED",
      lastAttemptedSyncAt: new Date("2026-02-15T00:00:00.000Z"),
      lastSuccessfulSyncAt: new Date("2026-02-15T00:00:00.000Z"),
      lastErrorMetadata: {},
      sourceMetadata: {
        system: "ENERGY_STAR_PORTFOLIO_MANAGER",
        seeded: true,
      },
      syncMetadata: {
        reportingYear: 2025,
        stepStatuses: {
          property: "SUCCEEDED",
          meters: "SUCCEEDED",
          consumption: "SUCCEEDED",
          metrics: "SUCCEEDED",
          benchmarking: "SUCCEEDED",
        },
      },
      qaPayload: {
        evaluatedAt: "2026-02-15T00:00:00.000Z",
        reportingYear: 2025,
        status: "READY",
        findings: [],
      },
    },
  });

  const existingSeededRetrofitCandidate = await prisma.retrofitCandidate.findFirst({
    where: {
      organizationId: org1.id,
      buildingId: org1Buildings[1].id,
      name: "Lobby and common-area LED retrofit",
    },
    select: { id: true },
  });

  await (existingSeededRetrofitCandidate
    ? prisma.retrofitCandidate.update({
        where: {
          id: existingSeededRetrofitCandidate.id,
        },
        data: {
          organizationId: org1.id,
          buildingId: org1Buildings[1].id,
          projectType: "LED_LIGHTING_RETROFIT",
          candidateSource: "ECM_LIBRARY",
          status: "ACTIVE",
          name: "Lobby and common-area LED retrofit",
          description:
            "Seeded retrofit candidate to prove deterministic ranking and avoided-penalty scoring.",
          complianceCycle: "CYCLE_1",
          targetFilingYear: 2026,
          estimatedCapex: 225000,
          estimatedIncentiveAmount: 25000,
          estimatedAnnualSavingsKbtu: 640000,
          estimatedAnnualSavingsUsd: 19200,
          estimatedSiteEuiReduction: 6.4,
          estimatedSourceEuiReduction: 10.8,
          estimatedBepsImprovementPct: 8,
          estimatedImplementationMonths: 4,
          confidenceBand: "MEDIUM",
          sourceArtifactId: bepsStandardsUpdateSource.id,
          sourceMetadata: {
            seeded: true,
            sourceAnomalyIds: [],
            note: "Structural retrofit candidate seed for Sprint 13 validation.",
          },
        },
      })
    : prisma.retrofitCandidate.create({
        data: {
          organizationId: org1.id,
          buildingId: org1Buildings[1].id,
          projectType: "LED_LIGHTING_RETROFIT",
          candidateSource: "ECM_LIBRARY",
          status: "ACTIVE",
          name: "Lobby and common-area LED retrofit",
          description:
            "Seeded retrofit candidate to prove deterministic ranking and avoided-penalty scoring.",
          complianceCycle: "CYCLE_1",
          targetFilingYear: 2026,
          estimatedCapex: 225000,
          estimatedIncentiveAmount: 25000,
          estimatedAnnualSavingsKbtu: 640000,
          estimatedAnnualSavingsUsd: 19200,
          estimatedSiteEuiReduction: 6.4,
          estimatedSourceEuiReduction: 10.8,
          estimatedBepsImprovementPct: 8,
          estimatedImplementationMonths: 4,
          confidenceBand: "MEDIUM",
          sourceArtifactId: bepsStandardsUpdateSource.id,
          sourceMetadata: {
            seeded: true,
            sourceAnomalyIds: [],
            note: "Structural retrofit candidate seed for Sprint 13 validation.",
          },
        },
      }));

  console.log("Seed complete:");
  console.log("  Rule Packages: 3");
  console.log("  Rule Versions: 3");
  console.log("  Factor Set Versions: 3");
  console.log("  BEPS Cycles: 2");
  console.log("  Organizations: 3");
  console.log("  Users: 3");
  console.log("  Memberships: 3");
  console.log("  Buildings: 11");
  console.log("  Compliance Snapshots: 11");
  console.log("  BEPS Metric Inputs: 3");
  console.log("  BEPS Prescriptive Items: 2");
  console.log("  BEPS ACP Agreements: 1");
  console.log("  PM Sync States: 1");
  console.log("  Retrofit Candidates: 1");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e: unknown) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

