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

function runCommand(command, env) {
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
    `${scriptName} requires a Postgres role that can create and drop temporary databases. ` +
      "Use a local admin-capable Postgres instance for this validation path; standard hosted " +
      "Supabase connection strings are not suitable for it.",
  );
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
  const testDb = `quoin_integration_${nonce}`;
  const adminUrl = buildDatabaseUrl(baseUrl, "postgres");
  const adminClient = new Client({ connectionString: adminUrl });
  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE "${testDb}"`);
    const testUrl = buildDatabaseUrl(baseUrl, testDb);

    runCommand("npx prisma migrate deploy", {
      DATABASE_URL: testUrl,
      DIRECT_URL: testUrl,
    });
    runCommand("npx prisma generate", {
      DATABASE_URL: testUrl,
      DIRECT_URL: testUrl,
    });
    runCommand("npx vitest run test/integration --maxWorkers 1 --no-file-parallelism", {
      DATABASE_URL: testUrl,
      DIRECT_URL: testUrl,
    });
  } finally {
    await dropDatabase(adminClient, testDb).catch(() => undefined);
    await adminClient.end();
  }
}

main().catch((error) => {
  if (isProvisioningPrivilegeError(error)) {
    printProvisioningPrivilegeHelp("npm run test:integration:db");
  }
  console.error(error);
  process.exit(1);
});
