export type GovernanceFamilyVisibility = "main" | "internal";
export type GovernanceFamilyKind = "rules" | "factors";

export interface GovernanceSourceArtifactInput {
  artifactType?: string | null;
  externalUrl?: string | null;
  name: string | null;
}

export interface GovernanceVersionInput {
  createdAt?: Date | string;
  effectiveFrom: Date | string;
  id: string;
  sourceArtifact?: GovernanceSourceArtifactInput | null;
  status: string;
  version: string;
}

export interface GovernanceRulePackageInput {
  id: string;
  key: string;
  name: string;
  versions: GovernanceVersionInput[];
}

export interface GovernanceFactorSetVersionInput extends GovernanceVersionInput {
  key: string;
}

export interface GovernanceDisplayVersion {
  createdAt: string | null;
  displayVersionLabel: string;
  effectiveFrom: string;
  effectiveFromAt: string | null;
  id: string;
  isMachineVersion: boolean;
  rawKey: string;
  rawSourceName: string | null;
  rawVersion: string;
  sourceArtifactType: string | null;
  sourceExternalUrl: string | null;
  sourceLabel: string;
  status: string;
  title: string;
}

export interface GovernanceDisplayFamily {
  badgeLabel: string | null;
  description: string;
  familyId: string;
  kind: GovernanceFamilyKind;
  otherVersions: GovernanceDisplayVersion[];
  primaryVersion: GovernanceDisplayVersion;
  rawKeys: string[];
  summary: string;
  title: string;
  versions: GovernanceDisplayVersion[];
  visibility: GovernanceFamilyVisibility;
}

interface GovernanceFamilyDefinition {
  description: string;
  familyId: string;
  sortOrder: number;
  title: string;
  visibility: GovernanceFamilyVisibility;
}

interface GovernanceFamilyAccumulator extends GovernanceFamilyDefinition {
  kind: GovernanceFamilyKind;
  versions: GovernanceDisplayVersion[];
  rawKeys: Set<string>;
}

/**
 * Builds grouped operator-facing governance families for rule packages.
 */
export function buildRuleGovernanceFamilies(
  rulePackages: GovernanceRulePackageInput[],
): GovernanceDisplayFamily[] {
  const families = new Map<string, GovernanceFamilyAccumulator>();

  for (const rulePackage of rulePackages) {
    const definition = resolveRuleFamilyDefinition(rulePackage.key, rulePackage.name);
    if (!definition) {
      continue;
    }
    const family = getOrCreateFamily(families, "rules", definition);
    family.rawKeys.add(rulePackage.key);

    for (const version of rulePackage.versions) {
      family.versions.push(
        createDisplayVersion({
          rawKey: rulePackage.key,
          sourceArtifact: version.sourceArtifact ?? null,
          status: version.status,
          version,
          visibility: definition.visibility,
        }),
      );
    }
  }

  return finalizeFamilies(families);
}

/**
 * Builds grouped operator-facing governance families for factor set versions.
 */
export function buildFactorGovernanceFamilies(
  factorSets: GovernanceFactorSetVersionInput[],
): GovernanceDisplayFamily[] {
  const families = new Map<string, GovernanceFamilyAccumulator>();

  for (const factorSet of factorSets) {
    const definition = resolveFactorFamilyDefinition(factorSet.key);
    if (!definition) {
      continue;
    }
    const family = getOrCreateFamily(families, "factors", definition);
    family.rawKeys.add(factorSet.key);
    family.versions.push(
      createDisplayVersion({
        rawKey: factorSet.key,
        sourceArtifact: factorSet.sourceArtifact ?? null,
        status: factorSet.status,
        version: factorSet,
        visibility: definition.visibility,
      }),
    );
  }

  return finalizeFamilies(families);
}

/**
 * Splits governance families into operator and internal buckets.
 */
export function partitionGovernanceFamilies(families: GovernanceDisplayFamily[]) {
  return {
    internal: families.filter((family) => family.visibility === "internal"),
    main: families.filter((family) => family.visibility === "main"),
  };
}

function getOrCreateFamily(
  families: Map<string, GovernanceFamilyAccumulator>,
  kind: GovernanceFamilyKind,
  definition: GovernanceFamilyDefinition,
) {
  const existing = families.get(definition.familyId);
  if (existing) {
    return existing;
  }

  const created: GovernanceFamilyAccumulator = {
    ...definition,
    kind,
    rawKeys: new Set<string>(),
    versions: [],
  };
  families.set(definition.familyId, created);
  return created;
}

function finalizeFamilies(families: Map<string, GovernanceFamilyAccumulator>) {
  return Array.from(families.values())
    .map((family) => finalizeFamily(family))
    .sort(compareFamilies);
}

function finalizeFamily(family: GovernanceFamilyAccumulator): GovernanceDisplayFamily {
  const sortedVersions = [...family.versions].sort(compareVersions);
  const titledVersions = sortedVersions.map((version, index) => ({
    ...version,
    title: formatVersionTitle(version.status, index),
  }));
  const primaryVersion = titledVersions[0];

  if (!primaryVersion) {
    throw new Error(`Governance family ${family.familyId} has no versions to display.`);
  }

  return {
    badgeLabel: getBadgeLabel(family.visibility),
    description: family.description,
    familyId: family.familyId,
    kind: family.kind,
    otherVersions: titledVersions.slice(1),
    primaryVersion,
    rawKeys: Array.from(family.rawKeys).sort(),
    summary: formatFamilySummary(titledVersions),
    title: family.title,
    versions: titledVersions,
    visibility: family.visibility,
  };
}

function resolveRuleFamilyDefinition(
  key: string,
  name: string,
): GovernanceFamilyDefinition | null {
  if (key === "DC_BENCHMARKING_2025") {
    return {
      description: "Rules currently used for annual DC benchmarking readiness and submission workflow.",
      familyId: "rules:dc-benchmarking-2025",
      sortOrder: 10,
      title: "DC Annual Benchmarking Rules (2025)",
      visibility: "main" as const,
    };
  }

  if (key.startsWith("BENCHMARK_PACKET_RULES_")) {
    return internalDefinition(
      "rules:internal-benchmark-packet",
      "Benchmark Packet Rules",
      210,
      "Internal packet-generation rule records retained for traceability.",
    );
  }

  if (key.startsWith("DELETE_RULE_PACKAGE_")) {
    return internalDefinition(
      "rules:internal-delete-rule-packages",
      "Internal Delete-Test Rule Packages",
      220,
      "Delete-test rule records retained in active data and hidden from the default operator view.",
    );
  }

  if (key.includes("BEPS")) {
    return null;
  }

  return fallbackDefinition("rules", key, name);
}

function resolveFactorFamilyDefinition(key: string): GovernanceFamilyDefinition | null {
  if (key === "DC_CURRENT_STANDARDS") {
    return {
      description: "Reference standards and factor values currently used by benchmark readiness flows.",
      familyId: "factors:dc-current-standards",
      sortOrder: 10,
      title: "Current DC Benchmarking Standards",
      visibility: "main" as const,
    };
  }

  if (key.startsWith("BENCHMARK_PACKET_FACTORS_")) {
    return internalDefinition(
      "factors:internal-benchmark-packet",
      "Benchmark Packet Factors",
      210,
      "Internal packet-generation factor records retained for traceability.",
    );
  }

  if (key.startsWith("DELETE_FACTOR_SET_")) {
    return internalDefinition(
      "factors:internal-delete-factor-sets",
      "Internal Delete-Test Factor Sets",
      220,
      "Delete-test factor records retained in active data and hidden from the default operator view.",
    );
  }

  if (key.includes("BEPS")) {
    return null;
  }

  return fallbackDefinition("factors", key, null);
}

function internalDefinition(
  familyId: string,
  title: string,
  sortOrder: number,
  description: string,
): GovernanceFamilyDefinition {
  return {
    description,
    familyId,
    sortOrder,
    title,
    visibility: "internal" as const,
  };
}

function fallbackDefinition(
  kind: GovernanceFamilyKind,
  key: string,
  name: string | null,
): GovernanceFamilyDefinition {
  const candidateTitle = selectFallbackTitle(name, key);
  const visibility: GovernanceFamilyVisibility = looksInternalKey(key)
    ? "internal"
    : "main";

  return {
    description:
      visibility === "internal"
        ? "Internal governance record retained for traceability."
        : "Additional governance family currently active in the platform.",
    familyId: `${kind}:${visibility}:${key}`,
    sortOrder: visibility === "internal" ? 900 : 500,
    title: candidateTitle,
    visibility,
  };
}

function createDisplayVersion(input: {
  rawKey: string;
  sourceArtifact: GovernanceSourceArtifactInput | null;
  status: string;
  version: GovernanceVersionInput;
  visibility: GovernanceFamilyVisibility;
}): GovernanceDisplayVersion {
  return {
    createdAt: toIsoString(input.version.createdAt),
    displayVersionLabel: formatFriendlyVersionLabel(input.version.version, input.visibility),
    effectiveFrom: formatShortDate(input.version.effectiveFrom),
    effectiveFromAt: toIsoString(input.version.effectiveFrom),
    id: input.version.id,
    isMachineVersion: isMachineLikeVersion(input.version.version),
    rawKey: input.rawKey,
    rawSourceName: normalizeText(input.sourceArtifact?.name),
    rawVersion: input.version.version,
    sourceArtifactType: normalizeText(input.sourceArtifact?.artifactType),
    sourceExternalUrl: normalizeText(input.sourceArtifact?.externalUrl),
    sourceLabel: formatSourceLabel(input.sourceArtifact?.name),
    status: input.status,
    title: "",
  };
}

function compareFamilies(left: GovernanceDisplayFamily, right: GovernanceDisplayFamily) {
  const sortOrderDelta =
    extractSortOrder(left.familyId) - extractSortOrder(right.familyId);
  if (sortOrderDelta !== 0) {
    return sortOrderDelta;
  }

  return left.title.localeCompare(right.title);
}

function compareVersions(left: GovernanceDisplayVersion, right: GovernanceDisplayVersion) {
  const statusDelta = getStatusRank(left.status) - getStatusRank(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const effectiveDelta =
    toTimestamp(right.effectiveFromAt) - toTimestamp(left.effectiveFromAt);
  if (effectiveDelta !== 0) {
    return effectiveDelta;
  }

  return toTimestamp(right.createdAt) - toTimestamp(left.createdAt);
}

function formatVersionTitle(status: string, index: number) {
  const label = normalizeStatusLabel(status);
  if (index === 0) {
    return `${label} version`;
  }

  return `Additional ${label.toLowerCase()} version`;
}

function formatFamilySummary(versions: GovernanceDisplayVersion[]) {
  const countLabel = `${versions.length} active ${versions.length === 1 ? "record" : "records"}`;
  return `${countLabel}; current effective ${versions[0]?.effectiveFrom ?? "Not scheduled"}`;
}

function formatFriendlyVersionLabel(
  rawVersion: string,
  visibility: GovernanceFamilyVisibility,
) {
  const bootstrapMatch = rawVersion.match(/^bootstrap-\d{4}-\d{2}-\d{2}$/i);
  if (bootstrapMatch) {
    return "Bootstrap release";
  }

  const cycleMatch = rawVersion.match(/^dc-cycle-(\d+)-\d{4}-v(\d+)$/i);
  if (cycleMatch) {
    return `Cycle ${cycleMatch[1]} release v${cycleMatch[2]}`;
  }

  const plainVersionMatch = rawVersion.match(/^v(\d+)$/i);
  if (plainVersionMatch) {
    return `Version ${plainVersionMatch[1]}`;
  }

  if (/^active-rule-viewer-\d+$/i.test(rawVersion)) {
    return visibility === "internal" ? "Internal viewer release" : "Current configured release";
  }

  if (/^data-issues-test-v\d+$/i.test(rawVersion)) {
    return visibility === "internal" ? "Internal test release" : "Current configured release";
  }

  if (/^test-v\d+$/i.test(rawVersion)) {
    return visibility === "internal" ? "Internal test release" : "Current configured release";
  }

  if (isMachineLikeVersion(rawVersion)) {
    return visibility === "internal" ? "Internal generated release" : "Configured release";
  }

  return humanizeLooseToken(rawVersion);
}

function formatSourceLabel(sourceName: string | null | undefined) {
  const normalized = normalizeText(sourceName);
  if (!normalized) {
    return "No source file attached";
  }

  if (isInternalSourceName(normalized)) {
    return "Internal generated source";
  }

  return normalized;
}

function isMachineLikeVersion(rawVersion: string) {
  return (
    /^test-v\d+$/i.test(rawVersion) ||
    /^data-issues-test-v\d+$/i.test(rawVersion) ||
    /^active-rule-viewer-\d+$/i.test(rawVersion) ||
    /-\d{10,}$/i.test(rawVersion)
  );
}

function isInternalSourceName(sourceName: string) {
  return (
    /^benchmark packet source \d+$/i.test(sourceName) ||
    /generated/i.test(sourceName) ||
    /delete-test/i.test(sourceName)
  );
}

function looksInternalKey(key: string) {
  return (
    key.startsWith("DELETE_") ||
    key.startsWith("BENCHMARK_PACKET_") ||
    /^INTERNAL_/i.test(key)
  );
}

function selectFallbackTitle(name: string | null, key: string) {
  const normalizedName = normalizeText(name);
  if (normalizedName && !looksInternalKey(normalizedName.toUpperCase())) {
    return normalizedName;
  }

  return humanizeLooseToken(key);
}

function humanizeLooseToken(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => formatWord(part))
    .join(" ");
}

function formatWord(part: string) {
  const upper = part.toUpperCase();
  if (["DC", "BEPS", "PM", "ESPM", "QA"].includes(upper)) {
    return upper;
  }

  if (/^\d+$/.test(part)) {
    return part;
  }

  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

function normalizeStatusLabel(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getBadgeLabel(visibility: GovernanceFamilyVisibility) {
  if (visibility === "internal") {
    return "Internal record";
  }

  return null;
}

function extractSortOrder(familyId: string) {
  const knownOrders: Record<string, number> = {
    "factors:dc-current-standards": 10,
    "factors:internal-benchmark-packet": 210,
    "factors:internal-delete-factor-sets": 220,
    "rules:dc-benchmarking-2025": 10,
    "rules:internal-benchmark-packet": 210,
    "rules:internal-delete-rule-packages": 220,
  };

  return knownOrders[familyId] ?? 999;
}

function getStatusRank(status: string) {
  switch (status) {
    case "ACTIVE":
      return 0;
    case "CANDIDATE":
      return 1;
    case "DRAFT":
      return 2;
    default:
      return 3;
  }
}

function formatShortDate(value: Date | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not scheduled";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toIsoString(value: Date | string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function toTimestamp(value: string | null) {
  if (!value) {
    return 0;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }

  return date.getTime();
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
