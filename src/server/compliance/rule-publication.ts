import type {
  ActorType,
  ComplianceCycle,
  FactorSetVersion,
  GovernedPublicationKind,
  GovernedPublicationRun,
  GovernedPublicationRunStatus,
  RuleVersion,
  VersionStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import { createAuditLog } from "@/server/lib/audit-log";
import { createLogger } from "@/server/lib/logger";
import { NotFoundError, WorkflowStateError } from "@/server/lib/errors";
import {
  BOOTSTRAP_FACTOR_SET_KEY,
  BOOTSTRAP_RULE_PACKAGE_KEYS,
  getActiveFactorSetVersion,
  getActiveRuleVersion,
  getActiveRuleVersionByPackageId,
} from "@/server/compliance/provenance";
import { getBepsCycleRegistry } from "@/server/compliance/beps/cycle-registry";
import { getBepsFactorSetKeyForCycle } from "@/server/compliance/beps/config";
import {
  type GovernedRegressionFixtureSetKey,
  runGovernedRegressionFixtureSet,
} from "@/server/compliance/rule-regression-harness";

type PublicationScopeKey =
  | "BENCHMARKING"
  | "BEPS_CYCLE_1"
  | "BEPS_CYCLE_2";

interface PublicationVersionSummary {
  id: string;
  version: string;
  status: VersionStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  implementationKey: string | null;
}

interface PublicationRunSummary {
  id: string;
  status: GovernedPublicationRunStatus;
  fixtureSetKey: string;
  validatedAt: string | null;
  publishedAt: string | null;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  impactedScopes: Array<{
    scopeKey: PublicationScopeKey;
    label: string;
    fixtureSetKey: string;
    totalCases: number;
    passedCases: number;
    failedCases: number;
  }>;
  matchesCurrentCandidate: boolean;
  canPublish: boolean;
}

export interface GovernedPublicationTargetSummary {
  publicationKind: GovernedPublicationKind;
  targetKey: string;
  scopeKey: PublicationScopeKey;
  label: string;
  activeVersion: PublicationVersionSummary | null;
  candidateVersion: PublicationVersionSummary | null;
  latestDraftVersion: PublicationVersionSummary | null;
  latestValidation: PublicationRunSummary | null;
}

export interface GovernedPublicationOverview {
  targets: GovernedPublicationTargetSummary[];
}

interface PersistedPublicationResult {
  run: GovernedPublicationRun;
  summary: PublicationRunSummary;
}

const RULE_TARGETS = [
  {
    scopeKey: "BENCHMARKING" as const,
    label: "DC benchmarking rules",
    targetKey: BOOTSTRAP_RULE_PACKAGE_KEYS.benchmarking2025,
    fixtureSetKey: "benchmarking-core-v1" as const,
  },
  {
    scopeKey: "BEPS_CYCLE_1" as const,
    label: "DC BEPS cycle 1 rules",
    targetKey: BOOTSTRAP_RULE_PACKAGE_KEYS.bepsCycle1,
    fixtureSetKey: "beps-cycle-1-core-v1" as const,
    cycle: "CYCLE_1" as const,
  },
  {
    scopeKey: "BEPS_CYCLE_2" as const,
    label: "DC BEPS cycle 2 rules",
    targetKey: BOOTSTRAP_RULE_PACKAGE_KEYS.bepsCycle2,
    fixtureSetKey: "beps-cycle-2-core-v1" as const,
    cycle: "CYCLE_2" as const,
  },
] as const;

const FACTOR_TARGETS = [
  {
    publicationKind: "FACTOR_SET_VERSION" as const,
    scopeKey: "BENCHMARKING" as const,
    label: "DC benchmarking factors",
    targetKey: BOOTSTRAP_FACTOR_SET_KEY,
    fixtureSetKey: "benchmarking-core-v1" as const,
  },
  {
    publicationKind: "FACTOR_SET_VERSION" as const,
    scopeKey: "BEPS_CYCLE_1" as const,
    label: "DC BEPS cycle 1 factors",
    targetKey: getBepsFactorSetKeyForCycle("CYCLE_1"),
    fixtureSetKey: "beps-cycle-1-core-v1" as const,
    cycle: "CYCLE_1" as const,
  },
  {
    publicationKind: "FACTOR_SET_VERSION" as const,
    scopeKey: "BEPS_CYCLE_2" as const,
    label: "DC BEPS cycle 2 factors",
    targetKey: getBepsFactorSetKeyForCycle("CYCLE_2"),
    fixtureSetKey: "beps-cycle-2-core-v1" as const,
    cycle: "CYCLE_2" as const,
  },
] as const;

function toVersionSummary(
  version:
    | Pick<
        RuleVersion,
        "id" | "version" | "status" | "effectiveFrom" | "effectiveTo" | "createdAt" | "implementationKey"
      >
    | Pick<FactorSetVersion, "id" | "version" | "status" | "effectiveFrom" | "effectiveTo" | "createdAt">
    | null,
): PublicationVersionSummary | null {
  if (!version) {
    return null;
  }

  return {
    id: version.id,
    version: version.version,
    status: version.status,
    effectiveFrom: version.effectiveFrom.toISOString(),
    effectiveTo: version.effectiveTo?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
    implementationKey:
      "implementationKey" in version ? version.implementationKey : null,
  };
}

function normalizePublicationRunSummary(
  run: Pick<
    GovernedPublicationRun,
    "id" | "status" | "fixtureSetKey" | "validatedAt" | "publishedAt" | "summaryPayload" | "ruleVersionId" | "factorSetVersionId"
  >,
  candidateVersionId: string | null,
): PublicationRunSummary {
  const summaryPayload =
    run.summaryPayload && typeof run.summaryPayload === "object" && !Array.isArray(run.summaryPayload)
      ? (run.summaryPayload as Record<string, unknown>)
      : {};
  const impactedScopes = Array.isArray(summaryPayload["impactedScopes"])
    ? (summaryPayload["impactedScopes"] as Array<Record<string, unknown>>).map((scope) => ({
        scopeKey:
          scope["scopeKey"] === "BENCHMARKING" ||
          scope["scopeKey"] === "BEPS_CYCLE_1" ||
          scope["scopeKey"] === "BEPS_CYCLE_2"
            ? (scope["scopeKey"] as PublicationScopeKey)
            : "BENCHMARKING",
        label: typeof scope["label"] === "string" ? scope["label"] : "Governed scope",
        fixtureSetKey:
          typeof scope["fixtureSetKey"] === "string" ? scope["fixtureSetKey"] : run.fixtureSetKey,
        totalCases: typeof scope["totalCases"] === "number" ? scope["totalCases"] : 0,
        passedCases: typeof scope["passedCases"] === "number" ? scope["passedCases"] : 0,
        failedCases: typeof scope["failedCases"] === "number" ? scope["failedCases"] : 0,
      }))
    : [];
  const totalCases =
    typeof summaryPayload["totalCases"] === "number" ? summaryPayload["totalCases"] : 0;
  const passedCases =
    typeof summaryPayload["passedCases"] === "number" ? summaryPayload["passedCases"] : 0;
  const failedCases =
    typeof summaryPayload["failedCases"] === "number" ? summaryPayload["failedCases"] : 0;
  const runVersionId = run.ruleVersionId ?? run.factorSetVersionId ?? null;
  const matchesCurrentCandidate = candidateVersionId != null && runVersionId === candidateVersionId;

  return {
    id: run.id,
    status: run.status,
    fixtureSetKey: run.fixtureSetKey,
    validatedAt: run.validatedAt?.toISOString() ?? null,
    publishedAt: run.publishedAt?.toISOString() ?? null,
    totalCases,
    passedCases,
    failedCases,
    impactedScopes,
    matchesCurrentCandidate,
    canPublish: matchesCurrentCandidate && run.status === "PASSED",
  };
}

function buildPublicationSummaryPayload(results: Array<{
  scopeKey: PublicationScopeKey;
  label: string;
  fixtureSetKey: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
}>) {
  return {
    totalCases: results.reduce((sum, item) => sum + item.totalCases, 0),
    passedCases: results.reduce((sum, item) => sum + item.passedCases, 0),
    failedCases: results.reduce((sum, item) => sum + item.failedCases, 0),
    impactedScopes: results,
  };
}

function toJson(value: unknown) {
  return value as never;
}

async function getLatestRuleVersionByStatus(rulePackageId: string, status: VersionStatus) {
  return prisma.ruleVersion.findFirst({
    where: {
      rulePackageId,
      status,
    },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      version: true,
      status: true,
      effectiveFrom: true,
      effectiveTo: true,
      createdAt: true,
      implementationKey: true,
    },
  });
}

async function getLatestFactorSetVersionByStatus(key: string, status: VersionStatus) {
  return prisma.factorSetVersion.findFirst({
    where: {
      key,
      status,
    },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      version: true,
      status: true,
      effectiveFrom: true,
      effectiveTo: true,
      createdAt: true,
    },
  });
}

async function getLatestPublicationRun(params: {
  publicationKind: GovernedPublicationKind;
  targetKey: string;
}) {
  return prisma.governedPublicationRun.findFirst({
    where: {
      publicationKind: params.publicationKind,
      targetKey: params.targetKey,
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      fixtureSetKey: true,
      validatedAt: true,
      publishedAt: true,
      summaryPayload: true,
      ruleVersionId: true,
      factorSetVersionId: true,
    },
  });
}

async function resolveRuleTargetSummary(target: (typeof RULE_TARGETS)[number]) {
  const rulePackage = await prisma.rulePackage.findUnique({
    where: { key: target.targetKey },
    select: { id: true },
  });

  if (!rulePackage) {
    return {
      publicationKind: "RULE_VERSION" as const,
      targetKey: target.targetKey,
      scopeKey: target.scopeKey,
      label: target.label,
      activeVersion: null,
      candidateVersion: null,
      latestDraftVersion: null,
      latestValidation: null,
    } satisfies GovernedPublicationTargetSummary;
  }

  const [activeVersion, candidateVersion, latestDraftVersion, latestRun] = await Promise.all([
    getActiveRuleVersion(target.targetKey).catch(() => null),
    getLatestRuleVersionByStatus(rulePackage.id, "CANDIDATE"),
    getLatestRuleVersionByStatus(rulePackage.id, "DRAFT"),
    getLatestPublicationRun({
      publicationKind: "RULE_VERSION",
      targetKey: target.targetKey,
    }),
  ]);

  return {
    publicationKind: "RULE_VERSION" as const,
    targetKey: target.targetKey,
    scopeKey: target.scopeKey,
    label: target.label,
    activeVersion: toVersionSummary(activeVersion),
    candidateVersion: toVersionSummary(candidateVersion),
    latestDraftVersion: toVersionSummary(latestDraftVersion),
    latestValidation: latestRun
      ? normalizePublicationRunSummary(latestRun, candidateVersion?.id ?? null)
      : null,
  } satisfies GovernedPublicationTargetSummary;
}

async function resolveFactorTargetSummary(target: (typeof FACTOR_TARGETS)[number]) {
  const [activeVersion, candidateVersion, latestDraftVersion, latestRun] = await Promise.all([
    getActiveFactorSetVersion(target.targetKey).catch(() => null),
    getLatestFactorSetVersionByStatus(target.targetKey, "CANDIDATE"),
    getLatestFactorSetVersionByStatus(target.targetKey, "DRAFT"),
    getLatestPublicationRun({
      publicationKind: "FACTOR_SET_VERSION",
      targetKey: target.targetKey,
    }),
  ]);

  return {
    publicationKind: "FACTOR_SET_VERSION" as const,
    targetKey: target.targetKey,
    scopeKey: target.scopeKey,
    label: target.label,
    activeVersion: toVersionSummary(activeVersion),
    candidateVersion: toVersionSummary(candidateVersion),
    latestDraftVersion: toVersionSummary(latestDraftVersion),
    latestValidation: latestRun
      ? normalizePublicationRunSummary(latestRun, candidateVersion?.id ?? null)
      : null,
  } satisfies GovernedPublicationTargetSummary;
}

export async function getGovernedPublicationOverview(): Promise<GovernedPublicationOverview> {
  const ruleTargets = await Promise.all(RULE_TARGETS.map(resolveRuleTargetSummary));
  const factorTargets = await Promise.all(FACTOR_TARGETS.map(resolveFactorTargetSummary));

  return {
    targets: [...ruleTargets, ...factorTargets],
  };
}

interface ValidationScopeConfig {
  scopeKey: PublicationScopeKey;
  label: string;
  fixtureSetKey: GovernedRegressionFixtureSetKey;
  ruleConfig: Record<string, unknown>;
  factorConfig: Record<string, unknown>;
}

async function resolveRulePublicationScope(ruleVersionId: string): Promise<{
  publicationKind: "RULE_VERSION";
  targetKey: string;
  version: Pick<
    RuleVersion,
    "id" | "status" | "version" | "rulePackageId" | "implementationKey" | "configJson"
  > & {
    rulePackage: { key: string };
  };
  validationScopes: ValidationScopeConfig[];
}> {
  const version = await prisma.ruleVersion.findUnique({
    where: { id: ruleVersionId },
    include: {
      rulePackage: {
        select: {
          key: true,
        },
      },
    },
  });

  if (!version) {
    throw new NotFoundError("Rule version not found");
  }

  const target = RULE_TARGETS.find((item) => item.targetKey === version.rulePackage.key);
  if (!target) {
    throw new WorkflowStateError("Rule version is not part of a governed publication target");
  }

  let factorConfig: Record<string, unknown>;
  if (target.scopeKey === "BENCHMARKING") {
    const activeFactor = await getActiveFactorSetVersion(BOOTSTRAP_FACTOR_SET_KEY);
    factorConfig = (activeFactor.factorsJson ?? {}) as Record<string, unknown>;
  } else {
    const cycle = "cycle" in target ? target.cycle : null;
    if (!cycle) {
      throw new WorkflowStateError("Governed rule target is missing its BEPS cycle mapping");
    }
    const registry = await getBepsCycleRegistry(cycle);
    factorConfig = (registry.factorSetVersion.factorsJson ?? {}) as Record<string, unknown>;
  }

  return {
    publicationKind: "RULE_VERSION",
    targetKey: version.rulePackage.key,
    version,
    validationScopes: [
      {
        scopeKey: target.scopeKey,
        label: target.label,
        fixtureSetKey: target.fixtureSetKey,
        ruleConfig: (version.configJson ?? {}) as Record<string, unknown>,
        factorConfig,
      },
    ],
  };
}

async function resolveFactorPublicationScopes(factorSetVersionId: string): Promise<{
  publicationKind: "FACTOR_SET_VERSION";
  targetKey: string;
  version: Pick<FactorSetVersion, "id" | "status" | "version" | "key" | "factorsJson">;
  validationScopes: ValidationScopeConfig[];
  impactedCycles: ComplianceCycle[];
}> {
  const version = await prisma.factorSetVersion.findUnique({
    where: { id: factorSetVersionId },
    select: {
      id: true,
      status: true,
      version: true,
      key: true,
      factorsJson: true,
    },
  });

  if (!version) {
    throw new NotFoundError("Factor set version not found");
  }

  const validationScopes: ValidationScopeConfig[] = [];
  const impactedCycles: ComplianceCycle[] = [];
  const target = FACTOR_TARGETS.find((item) => item.targetKey === version.key);

  if (!target) {
    throw new WorkflowStateError("Factor set version is not part of a governed publication target");
  }

  if (target.scopeKey === "BENCHMARKING") {
    const activeBenchmarkRule = await getActiveRuleVersion(
      BOOTSTRAP_RULE_PACKAGE_KEYS.benchmarking2025,
    );
    validationScopes.push({
      scopeKey: target.scopeKey,
      label: target.label,
      fixtureSetKey: target.fixtureSetKey,
      ruleConfig: (activeBenchmarkRule.configJson ?? {}) as Record<string, unknown>,
      factorConfig: (version.factorsJson ?? {}) as Record<string, unknown>,
    });
  } else {
    const registry = await getBepsCycleRegistry(target.cycle);
    const activeRuleVersion = await getActiveRuleVersionByPackageId(registry.rulePackageId);
    validationScopes.push({
      scopeKey: target.scopeKey,
      label: target.label,
      fixtureSetKey: target.fixtureSetKey,
      ruleConfig: (activeRuleVersion.configJson ?? {}) as Record<string, unknown>,
      factorConfig: (version.factorsJson ?? {}) as Record<string, unknown>,
    });
    impactedCycles.push(target.cycle);
  }

  if (validationScopes.length === 0) {
    throw new WorkflowStateError("Factor set version does not map to any governed regression scope");
  }

  return {
    publicationKind: "FACTOR_SET_VERSION",
    targetKey: version.key,
    version,
    validationScopes,
    impactedCycles: Array.from(new Set(impactedCycles)),
  };
}

export async function markRuleVersionCandidate(params: {
  ruleVersionId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}) {
  const version = await prisma.ruleVersion.findUnique({
    where: { id: params.ruleVersionId },
    include: {
      rulePackage: {
        select: {
          key: true,
        },
      },
    },
  });

  if (!version) {
    throw new NotFoundError("Rule version not found");
  }

  if (version.status === "ACTIVE" || version.status === "SUPERSEDED") {
    throw new WorkflowStateError("Only draft rule versions can be promoted to candidate");
  }

  const updated =
    version.status === "CANDIDATE"
      ? version
      : await prisma.$transaction(async (tx) => {
          await tx.ruleVersion.updateMany({
            where: {
              rulePackageId: version.rulePackageId,
              status: "CANDIDATE",
              NOT: {
                id: version.id,
              },
            },
            data: {
              status: "SUPERSEDED",
            },
          });

          return tx.ruleVersion.update({
            where: { id: version.id },
            data: { status: "CANDIDATE" },
            include: {
              rulePackage: {
                select: {
                  key: true,
                },
              },
            },
          });
        });

  await createAuditLog({
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    action: "RULE_VERSION_PROMOTED_TO_CANDIDATE",
    inputSnapshot: {
      ruleVersionId: updated.id,
      rulePackageKey: updated.rulePackage.key,
      previousStatus: version.status,
    },
    outputSnapshot: {
      status: updated.status,
      version: updated.version,
    },
    requestId: params.requestId ?? null,
  });

  return updated;
}

export async function markFactorSetVersionCandidate(params: {
  factorSetVersionId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}) {
  const version = await prisma.factorSetVersion.findUnique({
    where: { id: params.factorSetVersionId },
  });

  if (!version) {
    throw new NotFoundError("Factor set version not found");
  }

  if (version.status === "ACTIVE" || version.status === "SUPERSEDED") {
    throw new WorkflowStateError("Only draft factor set versions can be promoted to candidate");
  }

  const updated =
    version.status === "CANDIDATE"
      ? version
      : await prisma.$transaction(async (tx) => {
          await tx.factorSetVersion.updateMany({
            where: {
              key: version.key,
              status: "CANDIDATE",
              NOT: {
                id: version.id,
              },
            },
            data: {
              status: "SUPERSEDED",
            },
          });

          return tx.factorSetVersion.update({
            where: { id: version.id },
            data: { status: "CANDIDATE" },
          });
        });

  await createAuditLog({
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    action: "FACTOR_SET_VERSION_PROMOTED_TO_CANDIDATE",
    inputSnapshot: {
      factorSetVersionId: updated.id,
      factorSetKey: updated.key,
      previousStatus: version.status,
    },
    outputSnapshot: {
      status: updated.status,
      version: updated.version,
    },
    requestId: params.requestId ?? null,
  });

  return updated;
}

async function persistPublicationRun(params: {
  publicationKind: GovernedPublicationKind;
  targetKey: string;
  scopeKey: PublicationScopeKey;
  ruleVersionId?: string | null;
  factorSetVersionId?: string | null;
  fixtureSetKey: string;
  results: Awaited<ReturnType<typeof runGovernedRegressionFixtureSet>>[];
  actorType: ActorType;
  actorId?: string | null;
}) {
  const summaryPayload = buildPublicationSummaryPayload(
    params.results.map((result) => ({
      scopeKey:
        result.fixtureSetKey === "benchmarking-core-v1"
          ? "BENCHMARKING"
          : result.fixtureSetKey === "beps-cycle-1-core-v1"
            ? "BEPS_CYCLE_1"
            : "BEPS_CYCLE_2",
      label:
        result.fixtureSetKey === "benchmarking-core-v1"
          ? "DC benchmarking rules"
          : result.fixtureSetKey === "beps-cycle-1-core-v1"
            ? "DC BEPS cycle 1 rules"
            : "DC BEPS cycle 2 rules",
      fixtureSetKey: result.fixtureSetKey,
      totalCases: result.totalCases,
      passedCases: result.passedCases,
      failedCases: result.failedCases,
    })),
  );
  const status: GovernedPublicationRunStatus =
    summaryPayload.failedCases > 0 ? "FAILED" : "PASSED";

  return prisma.governedPublicationRun.create({
    data: {
      publicationKind: params.publicationKind,
      targetKey: params.targetKey,
      scopeKey: params.scopeKey,
      ruleVersionId: params.ruleVersionId ?? null,
      factorSetVersionId: params.factorSetVersionId ?? null,
      fixtureSetKey: params.fixtureSetKey,
      status,
      summaryPayload: toJson(summaryPayload),
      resultsPayload: toJson(
        params.results.map((result) => ({
          fixtureSetKey: result.fixtureSetKey,
          totalCases: result.totalCases,
          passedCases: result.passedCases,
          failedCases: result.failedCases,
          passed: result.passed,
          cases: result.cases,
        })),
      ),
      validatedAt: new Date(),
      createdByType: params.actorType,
      createdById: params.actorId ?? null,
    },
  });
}

export async function validateRuleVersionCandidate(params: {
  ruleVersionId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}): Promise<PersistedPublicationResult> {
  const logger = createLogger({
    procedure: "rule-publication.validateRuleVersionCandidate",
    requestId: params.requestId ?? null,
  });
  const resolved = await resolveRulePublicationScope(params.ruleVersionId);
  const results = await Promise.all(
    resolved.validationScopes.map((scope) =>
      runGovernedRegressionFixtureSet({
        fixtureSetKey: scope.fixtureSetKey,
        ruleConfig: scope.ruleConfig,
        factorConfig: scope.factorConfig,
      }),
    ),
  );
  const run = await persistPublicationRun({
    publicationKind: resolved.publicationKind,
    targetKey: resolved.targetKey,
    scopeKey: resolved.validationScopes[0]?.scopeKey ?? "BENCHMARKING",
    ruleVersionId: resolved.version.id,
    fixtureSetKey: resolved.validationScopes.map((scope) => scope.fixtureSetKey).join("+"),
    results,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
  });
  const summary = normalizePublicationRunSummary(run, resolved.version.id);

  await createAuditLog({
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    action:
      run.status === "PASSED"
        ? "GOVERNED_PUBLICATION_VALIDATION_PASSED"
        : "GOVERNED_PUBLICATION_VALIDATION_FAILED",
    inputSnapshot: {
      publicationKind: resolved.publicationKind,
      targetKey: resolved.targetKey,
      ruleVersionId: resolved.version.id,
    },
    outputSnapshot: summary,
    errorCode: run.status === "FAILED" ? "REGRESSION_FAILED" : null,
    requestId: params.requestId ?? null,
  });

  logger.info("Rule version regression validation completed", {
    ruleVersionId: resolved.version.id,
    targetKey: resolved.targetKey,
    status: run.status,
    failedCases: summary.failedCases,
  });

  return { run, summary };
}

export async function validateFactorSetVersionCandidate(params: {
  factorSetVersionId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}): Promise<PersistedPublicationResult> {
  const logger = createLogger({
    procedure: "rule-publication.validateFactorSetVersionCandidate",
    requestId: params.requestId ?? null,
  });
  const resolved = await resolveFactorPublicationScopes(params.factorSetVersionId);
  const results = await Promise.all(
    resolved.validationScopes.map((scope) =>
      runGovernedRegressionFixtureSet({
        fixtureSetKey: scope.fixtureSetKey,
        ruleConfig: scope.ruleConfig,
        factorConfig: scope.factorConfig,
      }),
    ),
  );
  const run = await persistPublicationRun({
    publicationKind: resolved.publicationKind,
    targetKey: resolved.targetKey,
    scopeKey: resolved.validationScopes[0]?.scopeKey ?? "BENCHMARKING",
    factorSetVersionId: resolved.version.id,
    fixtureSetKey: resolved.validationScopes.map((scope) => scope.fixtureSetKey).join("+"),
    results,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
  });
  const summary = normalizePublicationRunSummary(run, resolved.version.id);

  await createAuditLog({
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    action:
      run.status === "PASSED"
        ? "GOVERNED_PUBLICATION_VALIDATION_PASSED"
        : "GOVERNED_PUBLICATION_VALIDATION_FAILED",
    inputSnapshot: {
      publicationKind: resolved.publicationKind,
      targetKey: resolved.targetKey,
      factorSetVersionId: resolved.version.id,
      impactedCycles: resolved.impactedCycles,
    },
    outputSnapshot: summary,
    errorCode: run.status === "FAILED" ? "REGRESSION_FAILED" : null,
    requestId: params.requestId ?? null,
  });

  logger.info("Factor set regression validation completed", {
    factorSetVersionId: resolved.version.id,
    targetKey: resolved.targetKey,
    status: run.status,
    failedCases: summary.failedCases,
  });

  return { run, summary };
}

export async function publishGovernedPublicationRun(params: {
  runId: string;
  actorType: ActorType;
  actorId?: string | null;
  requestId?: string | null;
}) {
  const run = await prisma.governedPublicationRun.findUnique({
    where: { id: params.runId },
    include: {
      ruleVersion: {
        include: {
          rulePackage: {
            select: {
              key: true,
            },
          },
        },
      },
      factorSetVersion: true,
    },
  });

  if (!run) {
    throw new NotFoundError("Governed publication run not found");
  }

  if (run.status !== "PASSED") {
    throw new WorkflowStateError("Only a passing publication run can be published");
  }

  const published = await prisma.$transaction(async (tx) => {
    const previousPublishedRun = await tx.governedPublicationRun.findFirst({
      where: {
        publicationKind: run.publicationKind,
        targetKey: run.targetKey,
        status: "PUBLISHED",
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });

    if (run.publicationKind === "RULE_VERSION") {
      if (!run.ruleVersion) {
        throw new WorkflowStateError("Rule publication run is missing its rule version");
      }
      if (run.ruleVersion.status !== "CANDIDATE") {
        throw new WorkflowStateError("Only candidate rule versions can be published");
      }

      await tx.ruleVersion.updateMany({
        where: {
          rulePackageId: run.ruleVersion.rulePackageId,
          status: "ACTIVE",
        },
        data: {
          status: "SUPERSEDED",
        },
      });

      await tx.ruleVersion.update({
        where: { id: run.ruleVersion.id },
        data: { status: "ACTIVE" },
      });
    } else {
      if (!run.factorSetVersion) {
        throw new WorkflowStateError("Factor publication run is missing its factor set version");
      }
      if (run.factorSetVersion.status !== "CANDIDATE") {
        throw new WorkflowStateError("Only candidate factor set versions can be published");
      }

      const registries = await tx.bepsCycleRegistry.findMany({
        where: {
          factorSetVersion: {
            key: run.factorSetVersion.key,
          },
        },
        select: { id: true },
      });

      await tx.factorSetVersion.updateMany({
        where: {
          key: run.factorSetVersion.key,
          status: "ACTIVE",
        },
        data: {
          status: "SUPERSEDED",
        },
      });

      await tx.factorSetVersion.update({
        where: { id: run.factorSetVersion.id },
        data: { status: "ACTIVE" },
      });

      if (registries.length > 0) {
        await tx.bepsCycleRegistry.updateMany({
          where: {
            id: {
              in: registries.map((registry) => registry.id),
            },
          },
          data: {
            factorSetVersionId: run.factorSetVersion.id,
          },
        });
      }
    }

    const updatedRun = await tx.governedPublicationRun.update({
      where: { id: run.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    if (previousPublishedRun?.id) {
      await tx.governedPublicationRun.update({
        where: { id: previousPublishedRun.id },
        data: {
          supersededByRunId: updatedRun.id,
        },
      });
    }

    return updatedRun;
  });

  await createAuditLog({
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    action: "GOVERNED_PUBLICATION_PUBLISHED",
    inputSnapshot: {
      publicationRunId: published.id,
      publicationKind: published.publicationKind,
      targetKey: published.targetKey,
      ruleVersionId: published.ruleVersionId,
      factorSetVersionId: published.factorSetVersionId,
    },
    outputSnapshot: {
      publishedAt: published.publishedAt?.toISOString() ?? null,
      status: published.status,
    },
    requestId: params.requestId ?? null,
  });

  return published;
}

export async function runGovernedPublicationValidationPreview(params: {
  publicationKind: GovernedPublicationKind;
  ruleVersionId?: string;
  factorSetVersionId?: string;
}) {
  if (params.publicationKind === "RULE_VERSION") {
    if (!params.ruleVersionId) {
      throw new WorkflowStateError("ruleVersionId is required for rule validation preview");
    }
    const resolved = await resolveRulePublicationScope(params.ruleVersionId);
    const results = await Promise.all(
      resolved.validationScopes.map((scope) =>
        runGovernedRegressionFixtureSet({
          fixtureSetKey: scope.fixtureSetKey,
          ruleConfig: scope.ruleConfig,
          factorConfig: scope.factorConfig,
        }),
      ),
    );

    return {
      publicationKind: resolved.publicationKind,
      targetKey: resolved.targetKey,
      results,
      summary: buildPublicationSummaryPayload(
        results.map((result) => ({
          scopeKey:
            result.fixtureSetKey === "benchmarking-core-v1"
              ? "BENCHMARKING"
              : result.fixtureSetKey === "beps-cycle-1-core-v1"
                ? "BEPS_CYCLE_1"
                : "BEPS_CYCLE_2",
          label:
            result.fixtureSetKey === "benchmarking-core-v1"
              ? "DC benchmarking rules"
              : result.fixtureSetKey === "beps-cycle-1-core-v1"
                ? "DC BEPS cycle 1 rules"
                : "DC BEPS cycle 2 rules",
          fixtureSetKey: result.fixtureSetKey,
          totalCases: result.totalCases,
          passedCases: result.passedCases,
          failedCases: result.failedCases,
        })),
      ),
    };
  }

  if (!params.factorSetVersionId) {
    throw new WorkflowStateError("factorSetVersionId is required for factor validation preview");
  }

  const resolved = await resolveFactorPublicationScopes(params.factorSetVersionId);
  const results = await Promise.all(
    resolved.validationScopes.map((scope) =>
      runGovernedRegressionFixtureSet({
        fixtureSetKey: scope.fixtureSetKey,
        ruleConfig: scope.ruleConfig,
        factorConfig: scope.factorConfig,
      }),
    ),
  );

  return {
    publicationKind: resolved.publicationKind,
    targetKey: resolved.targetKey,
    results,
    summary: buildPublicationSummaryPayload(
      results.map((result) => ({
        scopeKey:
          result.fixtureSetKey === "benchmarking-core-v1"
            ? "BENCHMARKING"
            : result.fixtureSetKey === "beps-cycle-1-core-v1"
              ? "BEPS_CYCLE_1"
              : "BEPS_CYCLE_2",
        label:
          result.fixtureSetKey === "benchmarking-core-v1"
            ? "DC benchmarking rules"
            : result.fixtureSetKey === "beps-cycle-1-core-v1"
              ? "DC BEPS cycle 1 rules"
              : "DC BEPS cycle 2 rules",
        fixtureSetKey: result.fixtureSetKey,
        totalCases: result.totalCases,
        passedCases: result.passedCases,
        failedCases: result.failedCases,
      })),
    ),
  };
}
