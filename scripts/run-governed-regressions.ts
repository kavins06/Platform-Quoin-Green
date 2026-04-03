#!/usr/bin/env npx tsx

import "dotenv/config";
import process from "node:process";
import { getGovernedPublicationOverview, runGovernedPublicationValidationPreview } from "@/server/compliance/rule-publication";

async function main() {
  const overview = await getGovernedPublicationOverview();
  const targets = overview.targets.filter((target) => target.activeVersion);

  if (targets.length === 0) {
    console.log("No active governed publication targets are configured.");
    process.exit(1);
  }

  let totalCases = 0;
  let totalFailed = 0;
  let failedTargets = 0;

  for (const target of targets) {
    const activeVersion = target.activeVersion;
    if (!activeVersion) {
      continue;
    }
    try {
      const preview =
        target.publicationKind === "RULE_VERSION"
          ? await runGovernedPublicationValidationPreview({
              publicationKind: target.publicationKind,
              ruleVersionId: activeVersion.id,
            })
          : await runGovernedPublicationValidationPreview({
              publicationKind: target.publicationKind,
              factorSetVersionId: activeVersion.id,
            });

      const summary = preview.summary;
      totalCases += summary.totalCases;
      totalFailed += summary.failedCases;

      console.log(`\n${target.label}`);
      console.log(`  target: ${target.targetKey}`);
      console.log(
        `  result: ${summary.passedCases} passed / ${summary.failedCases} failed / ${summary.totalCases} total`,
      );
    } catch (error) {
      failedTargets += 1;
      console.log(`\n${target.label}`);
      console.log(`  target: ${target.targetKey}`);
      console.log(
        `  result: validation could not run (${error instanceof Error ? error.message : "unknown error"})`,
      );
    }
  }

  console.log(`\nGoverned regressions: ${totalCases - totalFailed} passed / ${totalFailed} failed / ${totalCases} total`);
  process.exit(totalFailed > 0 || failedTargets > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
