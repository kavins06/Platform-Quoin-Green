import { prisma } from "@/server/lib/db";
import { requireGreenButtonTokenMasterKey } from "@/server/lib/config";
import {
  GREEN_BUTTON_TOKEN_ENCRYPTION_VERSION,
  greenButtonCredentialSelect,
  resolveGreenButtonTokensFromRecord,
} from "@/server/integrations/green-button/credentials";
import { sealSecret } from "@/server/lib/crypto/secret-envelope";

async function main() {
  const masterKey = requireGreenButtonTokenMasterKey();
  const rows = await prisma.greenButtonConnection.findMany({
    where: {
      OR: [
        { accessTokenEncrypted: null },
        { refreshTokenEncrypted: null },
        { tokenEncryptionVersion: null },
      ],
    },
    select: greenButtonCredentialSelect,
  });

  let migratedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    try {
      const { tokens, usedPlaintextFallback } = resolveGreenButtonTokensFromRecord({
        record: row,
        masterKey,
      });

      if (!usedPlaintextFallback) {
        skippedCount += 1;
        continue;
      }

      await prisma.greenButtonConnection.update({
        where: { id: row.id },
        data: {
          accessToken: null,
          refreshToken: null,
          accessTokenEncrypted: sealSecret({
            plaintext: tokens.accessToken,
            masterKey,
            purpose: "green-button-access-token",
          }),
          refreshTokenEncrypted: sealSecret({
            plaintext: tokens.refreshToken,
            masterKey,
            purpose: "green-button-refresh-token",
          }),
          tokenEncryptionVersion: GREEN_BUTTON_TOKEN_ENCRYPTION_VERSION,
        },
      });
      migratedCount += 1;
    } catch {
      skippedCount += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        migratedCount,
        skippedCount,
        totalScanned: rows.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("Green Button token backfill failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
