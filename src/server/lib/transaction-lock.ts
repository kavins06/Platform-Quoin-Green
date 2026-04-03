import { Prisma } from "@/generated/prisma";
import type { PrismaClient } from "@/generated/prisma";

const LOCK_NAMESPACE = "quoin";

export async function withAdvisoryTransactionLock<T>(
  db: PrismaClient,
  lockKey: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${LOCK_NAMESPACE}),
        hashtext(${lockKey})
      )
    `;

    return fn(tx);
  });
}
