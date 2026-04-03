import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma";

const IS_VERCEL_RUNTIME = Boolean(process.env["VERCEL"] || process.env["VERCEL_ENV"]);

function resolveRuntimeConnectionString() {
  const pooledUrl = process.env["DATABASE_URL"];
  const directUrl = process.env["DIRECT_URL"];

  if (IS_VERCEL_RUNTIME) {
    return pooledUrl ?? directUrl;
  }

  return directUrl ?? pooledUrl;
}

function createPrismaClient(): PrismaClient {
  const connectionString = resolveRuntimeConnectionString();
  if (!connectionString) {
    throw new Error("DIRECT_URL or DATABASE_URL is required");
  }

  const adapter = new PrismaPg({
    connectionString,
    ...(IS_VERCEL_RUNTIME
      ? {
          // Keep Vercel function instances from exhausting the Supabase pooler.
          max: 1,
          idleTimeoutMillis: 5_000,
          connectionTimeoutMillis: 15_000,
        }
      : {}),
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Base privileged client. It is expected to bypass tenant RLS and is used only
// by webhook handlers, seed scripts, migrations, and tests.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

const CUID_REGEX = /^c[a-z0-9]{7,}$/;

/**
 * Returns a Prisma client scoped to a single tenant via RLS.
 * Every query runs inside a transaction that:
 *   1. Sets app.organization_id for RLS policy evaluation
 *   2. Downgrades from the privileged login role to quoin_app so RLS is enforced
 */
export function getTenantClient(organizationId: string) {
  if (!organizationId || !CUID_REGEX.test(organizationId)) {
    throw new Error(`Invalid organizationId format: ${organizationId}`);
  }

  return prisma.$extends({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ args, query }: { args: any; query: (args: any) => any }) {
          const [, , result] = await prisma.$transaction([
            prisma.$executeRawUnsafe(
              `SELECT set_config('app.organization_id', $1, true)`,
              organizationId,
            ),
            prisma.$executeRawUnsafe(`SET LOCAL ROLE quoin_app`),
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}
