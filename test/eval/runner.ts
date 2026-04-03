#!/usr/bin/env npx tsx

/**
 * Eval Runner — Tests deterministic pipeline functions against golden datasets.
 *
 * Usage:
 *   npx tsx test/eval/runner.ts                    # Run all evals
 *   npx tsx test/eval/runner.ts --suite penalty    # Run specific suite
 *   npx tsx test/eval/runner.ts --verbose          # Show detailed output
 *
 * Exit code 0 = all pass, 1 = failures exist
 */

export interface EvalCase {
  id: string;
  name: string;
  suite: string;
  run: () => Promise<EvalResult>;
}

export interface EvalResult {
  passed: boolean;
  expected: unknown;
  actual: unknown;
  details?: string;
}

export interface EvalSuite {
  name: string;
  cases: EvalCase[];
}

const suites: EvalSuite[] = [];

export function registerSuite(suite: EvalSuite): void {
  suites.push(suite);
}

/** Tolerance-aware comparison for floating point */
export function approxEqual(
  a: number,
  b: number,
  tolerance = 0.01,
): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  const maxVal = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff / maxVal <= tolerance;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const suiteIdx = args.indexOf("--suite");
  const suiteFilter = suiteIdx !== -1 ? args[suiteIdx + 1] : null;
  const verbose = args.includes("--verbose");

  console.log("═══════════════════════════════════════");
  console.log("  Quoin Eval Framework");
  console.log("═══════════════════════════════════════\n");

  const filtered = suiteFilter
    ? suites.filter((s) => s.name === suiteFilter)
    : suites;

  if (filtered.length === 0) {
    console.log(
      `No suites found${suiteFilter ? ` matching "${suiteFilter}"` : ""}`,
    );
    process.exit(1);
  }

  let totalPassed = 0;
  let totalFailed = 0;
  const failures: { suite: string; case_: string; details: string }[] = [];

  for (const suite of filtered) {
    console.log(`\n── Suite: ${suite.name} (${suite.cases.length} cases) ──\n`);

    for (const evalCase of suite.cases) {
      try {
        const result = await evalCase.run();

        if (result.passed) {
          totalPassed++;
          console.log(`  ✓ ${evalCase.name}`);
          if (verbose) {
            console.log(`    Expected: ${JSON.stringify(result.expected)}`);
            console.log(`    Actual:   ${JSON.stringify(result.actual)}`);
          }
        } else {
          totalFailed++;
          console.log(`  ✗ ${evalCase.name}`);
          console.log(`    Expected: ${JSON.stringify(result.expected)}`);
          console.log(`    Actual:   ${JSON.stringify(result.actual)}`);
          if (result.details) console.log(`    Details:  ${result.details}`);
          failures.push({
            suite: suite.name,
            case_: evalCase.name,
            details:
              result.details ??
              `Expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`,
          });
        }
      } catch (err) {
        totalFailed++;
        const message = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ ${evalCase.name} (THREW: ${message})`);
        failures.push({
          suite: suite.name,
          case_: evalCase.name,
          details: `Exception: ${message}`,
        });
      }
    }
  }

  console.log("\n═══════════════════════════════════════");
  console.log(
    `  Results: ${totalPassed} passed, ${totalFailed} failed, ${totalPassed + totalFailed} total`,
  );

  if (failures.length > 0) {
    console.log("\n  Failures:");
    for (const f of failures) {
      console.log(`    [${f.suite}] ${f.case_}: ${f.details}`);
    }
  }

  console.log("═══════════════════════════════════════\n");
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Eval runner crashed:", err);
  process.exit(1);
});
