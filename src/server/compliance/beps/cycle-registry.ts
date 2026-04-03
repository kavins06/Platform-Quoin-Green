import type { ComplianceCycle } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/db";
import {
  getActiveRuleVersionByPackageId,
} from "../provenance";
import {
  assertSupportedBepsCycle,
  BepsConfigurationError,
  normalizeBepsFactorConfig,
  normalizeBepsRuleConfig,
} from "./config";

export async function getBepsCycleRegistry(cycle: ComplianceCycle) {
  assertSupportedBepsCycle(cycle);

  const registry = await prisma.bepsCycleRegistry.findUnique({
    where: {
      complianceCycle: cycle,
    },
    include: {
      rulePackage: true,
      factorSetVersion: true,
    },
  });

  if (!registry) {
    throw new BepsConfigurationError(
      `No governed BEPS cycle registry entry found for ${cycle}`,
      cycle === "CYCLE_3" ? "UNSUPPORTED_CYCLE" : undefined,
    );
  }

  return registry;
}

export async function getActiveBepsCycleContext(
  cycle: ComplianceCycle,
  effectiveAt?: Date,
) {
  const registry = await getBepsCycleRegistry(cycle);
  const cycleStartEffectiveAt = new Date(Date.UTC(registry.cycleStartYear, 0, 1));
  const resolvedEffectiveAt =
    effectiveAt ??
    (cycleStartEffectiveAt > new Date() ? cycleStartEffectiveAt : new Date());

  if (registry.factorSetVersion.status !== "ACTIVE") {
    throw new BepsConfigurationError(
      `Factor set version ${registry.factorSetVersionId} is not active for ${cycle}`,
    );
  }

  if (registry.factorSetVersion.effectiveFrom > resolvedEffectiveAt) {
    throw new BepsConfigurationError(
      `Factor set version ${registry.factorSetVersionId} is not effective for ${cycle}`,
    );
  }

  if (
    registry.factorSetVersion.effectiveTo &&
    registry.factorSetVersion.effectiveTo < resolvedEffectiveAt
  ) {
    throw new BepsConfigurationError(
      `Factor set version ${registry.factorSetVersionId} expired before ${cycle}`,
    );
  }

  const ruleVersion = await getActiveRuleVersionByPackageId(
    registry.rulePackageId,
    resolvedEffectiveAt,
  );

  return {
    registry,
    rulePackage: registry.rulePackage,
    ruleVersion,
    factorSetVersion: registry.factorSetVersion,
    effectiveAt: resolvedEffectiveAt,
    ruleConfig: normalizeBepsRuleConfig(ruleVersion.configJson),
    factorConfig: normalizeBepsFactorConfig(registry.factorSetVersion.factorsJson),
  };
}
