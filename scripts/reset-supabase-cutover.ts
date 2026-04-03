import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const RESET_CONFIRMATION_VALUE = "YES";
const RESET_CONFIRMATION_ENV = "RESET_QUOIN_SUPABASE_CUTOVER";

/**
 * Builds a Prisma client against the configured Postgres database.
 */
function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_URL or DATABASE_URL is required.");
  }

  const adapter = new PrismaPg({
    connectionString,
  });

  return new PrismaClient({ adapter });
}

/**
 * Ensures the caller has explicitly confirmed the destructive reset.
 */
function assertResetConfirmation(): void {
  if (process.env[RESET_CONFIRMATION_ENV] === RESET_CONFIRMATION_VALUE) {
    return;
  }

  throw new Error(
    `Refusing destructive cutover reset. Set ${RESET_CONFIRMATION_ENV}=${RESET_CONFIRMATION_VALUE} and re-run this command.`,
  );
}

/**
 * Lists all public schema tables except Prisma's migration ledger.
 */
async function listResettableTables(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename ASC
  `;

  return rows.map((row) => row.tablename);
}

/**
 * Truncates the current public application tables to prepare for the hard cutover.
 */
async function resetApplicationData(prisma: PrismaClient): Promise<void> {
  const tables = await listResettableTables(prisma);
  if (tables.length === 0) {
    console.log("No public application tables found to reset.");
    return;
  }

  const quotedTables = tables.map((table) => `"public"."${table}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`,
  );
  console.log(`Reset ${tables.length} public tables for the Supabase-only cutover.`);
}

async function main(): Promise<void> {
  assertResetConfirmation();
  const prisma = createPrismaClient();

  try {
    await resetApplicationData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
