import "dotenv/config";
import { execSync } from "node:child_process";
import process from "node:process";
import { Client } from "pg";

function getBaseDatabaseUrl() {
  const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL is required");
  }

  return databaseUrl;
}

function buildDatabaseUrl(baseUrl, databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function runPrisma(args, env) {
  const command =
    process.platform === "win32"
      ? `npx prisma ${args.join(" ")}`
      : `npx prisma ${args.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(" ")}`;

  execSync(command, {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      ...env,
    },
  });
}

function isProvisioningPrivilegeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("permission denied to create database") ||
    message.includes("permission denied to drop database") ||
    message.includes("must be owner of database") ||
    message.includes("CREATE DATABASE cannot run inside a transaction block")
  );
}

function printProvisioningPrivilegeHelp(scriptName) {
  console.error(
    `${scriptName} requires a Postgres role that can create and drop temporary validation and shadow databases. ` +
      "Use a local admin-capable Postgres instance for this path; a hosted Supabase connection string " +
      "is not sufficient for it.",
  );
}

async function querySingleRow(connectionString, query) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(query);
    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

async function querySeededCounts(connectionString) {
  return querySingleRow(
    connectionString,
    `
      SELECT
        (SELECT COUNT(*) FROM rule_packages) AS rule_packages,
        (SELECT COUNT(*) FROM rule_versions) AS rule_versions,
        (SELECT COUNT(*) FROM factor_set_versions) AS factor_set_versions,
        (SELECT COUNT(*) FROM beps_cycle_registries) AS beps_cycles,
        (SELECT COUNT(*) FROM rule_packages WHERE key = 'DC_BEPS_CYCLE_1') AS beps_rule_packages,
        (SELECT COUNT(*) FROM rule_packages WHERE key = 'DC_BEPS_CYCLE_2') AS beps_cycle_2_rule_packages,
        (SELECT COUNT(*) FROM rule_packages WHERE key = 'DC_BEPS_CYCLE_3') AS beps_cycle_3_rule_packages,
        (SELECT COUNT(*) FROM rule_versions rv
          INNER JOIN rule_packages rp ON rp.id = rv.rule_package_id
          WHERE rp.key = 'DC_BEPS_CYCLE_1' AND rv.status = 'ACTIVE') AS beps_active_rule_versions,
        (SELECT COUNT(*) FROM rule_versions rv
          INNER JOIN rule_packages rp ON rp.id = rv.rule_package_id
          WHERE rp.key = 'DC_BEPS_CYCLE_2' AND rv.status = 'ACTIVE') AS beps_cycle_2_active_rule_versions,
        (SELECT COUNT(*) FROM factor_set_versions
          WHERE key = 'DC_BEPS_CYCLE_1_FACTORS_V1' AND status = 'ACTIVE') AS beps_active_factor_versions,
        (SELECT COUNT(*) FROM factor_set_versions
          WHERE key = 'DC_BEPS_CYCLE_2_FACTORS_V1' AND status = 'ACTIVE') AS beps_cycle_2_active_factor_versions,
        (SELECT COUNT(*) FROM factor_set_versions
          WHERE key = 'DC_BEPS_CYCLE_3_FACTORS_V1' AND status = 'ACTIVE') AS beps_cycle_3_active_factor_versions,
        (SELECT COUNT(*) FROM beps_cycle_registries
          WHERE compliance_cycle = 'CYCLE_3') AS beps_cycle_3_registry_rows,
        (SELECT factors_json->'beps'->'applicability'->>'minGrossSquareFeetPrivate'
          FROM factor_set_versions
          WHERE key = 'DC_BEPS_CYCLE_2_FACTORS_V1' AND status = 'ACTIVE'
          ORDER BY effective_from DESC, created_at DESC
          LIMIT 1) AS beps_cycle_2_private_threshold,
        (SELECT factors_json->'beps'->'cycle'->>'cycleStartYear'
          FROM factor_set_versions
          WHERE key = 'DC_BEPS_CYCLE_2_FACTORS_V1' AND status = 'ACTIVE'
          ORDER BY effective_from DESC, created_at DESC
          LIMIT 1) AS beps_cycle_2_start_year,
        (SELECT COUNT(*)
          FROM jsonb_array_elements(
            COALESCE(
              (
                SELECT factors_json->'beps'->'standardsTable'
                FROM factor_set_versions
                WHERE key = 'DC_BEPS_CYCLE_2_FACTORS_V1' AND status = 'ACTIVE'
                ORDER BY effective_from DESC, created_at DESC
                LIMIT 1
              ),
              '[]'::jsonb
            )
          ) entry
          WHERE entry->>'pathway' = 'TRAJECTORY'
            AND entry->>'year' = '2027') AS beps_cycle_2_trajectory_2027_rows,
        (SELECT COUNT(*)
          FROM jsonb_array_elements(
            COALESCE(
              (
                SELECT factors_json->'beps'->'standardsTable'
                FROM factor_set_versions
                WHERE key = 'DC_BEPS_CYCLE_2_FACTORS_V1' AND status = 'ACTIVE'
                ORDER BY effective_from DESC, created_at DESC
                LIMIT 1
              ),
              '[]'::jsonb
            )
          ) entry
          WHERE entry->>'pathway' = 'TRAJECTORY'
            AND entry->>'year' = '2028') AS beps_cycle_2_trajectory_2028_rows,
        (SELECT COALESCE(jsonb_array_length(factors_json->'benchmarking'->'applicabilityBands'), 0)
          FROM factor_set_versions
          WHERE key = 'DC_CURRENT_STANDARDS' AND status = 'ACTIVE'
          ORDER BY effective_from DESC, created_at DESC
          LIMIT 1) AS benchmarking_applicability_bands,
        (SELECT COUNT(*)
          FROM jsonb_array_elements(
            COALESCE(
              (
                SELECT factors_json->'benchmarking'->'applicabilityBands'
                FROM factor_set_versions
                WHERE key = 'DC_CURRENT_STANDARDS' AND status = 'ACTIVE'
                ORDER BY effective_from DESC, created_at DESC
                LIMIT 1
              ),
              '[]'::jsonb
            )
          ) band
          WHERE band->>'label' = 'PRIVATE_10K_TO_24_999'
            AND band->>'deadlineType' = 'MAY_1_FOLLOWING_YEAR'
            AND band->'verificationYears' = '[2027]'::jsonb
            AND band->>'verificationCadenceYears' = '6') AS benchmarking_private_10k_band,
        (SELECT COUNT(*)
          FROM jsonb_array_elements(
            COALESCE(
              (
                SELECT factors_json->'benchmarking'->'applicabilityBands'
                FROM factor_set_versions
                WHERE key = 'DC_CURRENT_STANDARDS' AND status = 'ACTIVE'
                ORDER BY effective_from DESC, created_at DESC
                LIMIT 1
              ),
              '[]'::jsonb
            )
          ) band
          WHERE band->>'label' = 'PRIVATE_25K_TO_49_999'
            AND band->>'deadlineType' = 'MAY_1_FOLLOWING_YEAR'
            AND band->'verificationYears' = '[2024, 2027]'::jsonb
            AND band->>'verificationCadenceYears' = '6') AS benchmarking_private_25k_band,
        (SELECT COUNT(*)
          FROM jsonb_array_elements(
            COALESCE(
              (
                SELECT factors_json->'benchmarking'->'applicabilityBands'
                FROM factor_set_versions
                WHERE key = 'DC_CURRENT_STANDARDS' AND status = 'ACTIVE'
                ORDER BY effective_from DESC, created_at DESC
                LIMIT 1
              ),
              '[]'::jsonb
            )
          ) band
          WHERE band->>'label' = 'PRIVATE_50K_PLUS'
            AND band->>'deadlineType' = 'MAY_1_FOLLOWING_YEAR'
            AND band->'verificationYears' = '[2024, 2027]'::jsonb
            AND band->>'verificationCadenceYears' = '6') AS benchmarking_private_50k_band,
        (SELECT COUNT(*)
          FROM jsonb_array_elements(
            COALESCE(
              (
                SELECT factors_json->'benchmarking'->'applicabilityBands'
                FROM factor_set_versions
                WHERE key = 'DC_CURRENT_STANDARDS' AND status = 'ACTIVE'
                ORDER BY effective_from DESC, created_at DESC
                LIMIT 1
              ),
              '[]'::jsonb
            )
          ) band
          WHERE band->>'label' = 'DISTRICT_10K_PLUS'
            AND band->>'deadlineType' = 'WITHIN_DAYS_OF_BENCHMARK_GENERATION'
            AND band->>'deadlineDaysFromGeneration' = '60'
            AND band->>'manualSubmissionAllowedWhenNotBenchmarkable' = 'true') AS benchmarking_district_band,
        (SELECT COUNT(*) FROM organizations) AS organizations,
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM organization_memberships) AS memberships,
        (SELECT COUNT(*) FROM buildings) AS buildings,
        (SELECT COUNT(*) FROM compliance_snapshots) AS compliance_snapshots,
        (SELECT COUNT(*) FROM beps_metric_inputs) AS beps_metric_inputs,
        (SELECT COUNT(*) FROM beps_prescriptive_items) AS beps_prescriptive_items,
        (SELECT COUNT(*) FROM beps_alternative_compliance_agreements) AS beps_acp_agreements,
        (SELECT COUNT(*) FROM portfolio_manager_sync_states) AS pm_sync_states,
        (SELECT COUNT(*) FROM retrofit_candidates) AS retrofit_candidates
    `,
  );
}

async function createDatabase(client, databaseName) {
  await client.query(`CREATE DATABASE "${databaseName}"`);
}

async function dropDatabase(client, databaseName) {
  await client.query(
    `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()
    `,
    [databaseName],
  );
  await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
}

async function main() {
  const baseUrl = getBaseDatabaseUrl();
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.replace(
    /[^a-z0-9_]/gi,
    "_",
  );
  const validationDb = `quoin_validate_${nonce}`;
  const shadowDb = `quoin_shadow_${nonce}`;

  const adminUrl = buildDatabaseUrl(baseUrl, "postgres");
  const adminClient = new Client({ connectionString: adminUrl });
  await adminClient.connect();

  try {
    await createDatabase(adminClient, validationDb);
    await createDatabase(adminClient, shadowDb);

    const validationUrl = buildDatabaseUrl(baseUrl, validationDb);
    const shadowUrl = buildDatabaseUrl(baseUrl, shadowDb);

    runPrisma(["migrate", "deploy"], {
      DATABASE_URL: validationUrl,
      DIRECT_URL: validationUrl,
    });
    runPrisma(["generate"], {
      DATABASE_URL: validationUrl,
      DIRECT_URL: validationUrl,
    });
    runPrisma(["validate"], {
      DATABASE_URL: validationUrl,
      DIRECT_URL: validationUrl,
    });
    runPrisma(["db", "seed"], {
      DATABASE_URL: validationUrl,
      DIRECT_URL: validationUrl,
    });

    const seededCounts = await querySeededCounts(validationUrl);

    if (!seededCounts) {
      throw new Error("Seed verification query returned no rows");
    }

    if (
      Number(seededCounts.beps_rule_packages) !== 1 ||
      Number(seededCounts.beps_cycle_2_rule_packages) !== 1 ||
      Number(seededCounts.beps_cycle_3_rule_packages) !== 0 ||
      Number(seededCounts.beps_active_rule_versions) < 1 ||
      Number(seededCounts.beps_cycle_2_active_rule_versions) < 1 ||
      Number(seededCounts.beps_active_factor_versions) < 1 ||
      Number(seededCounts.beps_cycle_2_active_factor_versions) < 1 ||
      Number(seededCounts.beps_cycle_3_active_factor_versions) !== 0 ||
      Number(seededCounts.beps_cycle_3_registry_rows) !== 0 ||
      Number(seededCounts.beps_cycle_2_private_threshold) !== 25000 ||
      Number(seededCounts.beps_cycle_2_start_year) !== 2028 ||
      Number(seededCounts.beps_cycle_2_trajectory_2027_rows) !== 0 ||
      Number(seededCounts.beps_cycle_2_trajectory_2028_rows) < 1 ||
      Number(seededCounts.benchmarking_applicability_bands) < 4 ||
      Number(seededCounts.benchmarking_private_10k_band) !== 1 ||
      Number(seededCounts.benchmarking_private_25k_band) !== 1 ||
      Number(seededCounts.benchmarking_private_50k_band) !== 1 ||
      Number(seededCounts.benchmarking_district_band) !== 1 ||
      Number(seededCounts.beps_cycles) < 2 ||
      Number(seededCounts.beps_metric_inputs) < 1 ||
      Number(seededCounts.beps_prescriptive_items) < 1 ||
      Number(seededCounts.beps_acp_agreements) < 1 ||
      Number(seededCounts.pm_sync_states) < 1 ||
      Number(seededCounts.retrofit_candidates) < 1
    ) {
      throw new Error(
        "Seed verification failed to produce active governed BEPS multi-cycle records",
      );
    }

    console.log("Seed verification:", seededCounts);

    runPrisma(["db", "seed"], {
      DATABASE_URL: validationUrl,
      DIRECT_URL: validationUrl,
    });

    const reseededCounts = await querySeededCounts(validationUrl);
    if (JSON.stringify(reseededCounts) !== JSON.stringify(seededCounts)) {
      throw new Error("Seed re-run changed the validation database counts");
    }

    console.log("Seed re-run verification:", reseededCounts);

    execSync("node scripts/audit-tenant-integrity.mjs", {
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        DATABASE_URL: validationUrl,
        DIRECT_URL: validationUrl,
      },
    });
    runPrisma(
      ["db", "execute", "--file", "prisma/validate-tenant-constraints.sql"],
      {
        DATABASE_URL: validationUrl,
        DIRECT_URL: validationUrl,
      },
    );

    runPrisma(
      [
        "migrate",
        "diff",
        "--from-migrations",
        "prisma/migrations",
        "--to-config-datasource",
        "--exit-code",
      ],
      {
        DATABASE_URL: validationUrl,
        DIRECT_URL: validationUrl,
        SHADOW_DATABASE_URL: shadowUrl,
      },
    );
  } finally {
    await dropDatabase(adminClient, shadowDb).catch(() => undefined);
    await dropDatabase(adminClient, validationDb).catch(() => undefined);
    await adminClient.end();
  }
}

main().catch((error) => {
  if (isProvisioningPrivilegeError(error)) {
    printProvisioningPrivilegeHelp("npm run db:validate:fresh");
  }
  console.error(error);
  process.exit(1);
});
