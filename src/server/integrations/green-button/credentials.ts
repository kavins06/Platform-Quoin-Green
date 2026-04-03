import type { Prisma } from "@/generated/prisma/client";
import {
  ConfigError,
  NotFoundError,
  WorkflowStateError,
} from "@/server/lib/errors";
import {
  getSecretEnvelopeVersion,
  openSecret,
  sealSecret,
} from "@/server/lib/crypto/secret-envelope";
import type { GreenButtonTokens } from "./types";

const ACCESS_TOKEN_PURPOSE = "green-button-access-token";
const REFRESH_TOKEN_PURPOSE = "green-button-refresh-token";

export const GREEN_BUTTON_TOKEN_ENCRYPTION_VERSION = getSecretEnvelopeVersion();

export const greenButtonCredentialSelect = {
  id: true,
  buildingId: true,
  organizationId: true,
  status: true,
  accessToken: true,
  refreshToken: true,
  accessTokenEncrypted: true,
  refreshTokenEncrypted: true,
  tokenEncryptionVersion: true,
  tokenExpiresAt: true,
  resourceUri: true,
  subscriptionId: true,
} satisfies Prisma.GreenButtonConnectionSelect;

export type GreenButtonCredentialRecord = Prisma.GreenButtonConnectionGetPayload<{
  select: typeof greenButtonCredentialSelect;
}>;

function hasEncryptedTokens(record: GreenButtonCredentialRecord) {
  return Boolean(record.accessTokenEncrypted && record.refreshTokenEncrypted);
}

function hasPlaintextTokens(record: GreenButtonCredentialRecord) {
  return Boolean(record.accessToken && record.refreshToken);
}

function buildEncryptedCredentialUpdate(tokens: GreenButtonTokens, masterKey: string) {
  return {
    accessToken: null,
    refreshToken: null,
    accessTokenEncrypted: sealSecret({
      plaintext: tokens.accessToken,
      masterKey,
      purpose: ACCESS_TOKEN_PURPOSE,
    }),
    refreshTokenEncrypted: sealSecret({
      plaintext: tokens.refreshToken,
      masterKey,
      purpose: REFRESH_TOKEN_PURPOSE,
    }),
    tokenEncryptionVersion: GREEN_BUTTON_TOKEN_ENCRYPTION_VERSION,
    tokenExpiresAt: tokens.expiresAt,
    subscriptionId: tokens.subscriptionId,
    resourceUri: tokens.resourceUri,
  };
}

function coerceTokenExpiresAt(expiresAt: Date | null) {
  return expiresAt ?? new Date(0);
}

export function resolveGreenButtonTokensFromRecord(input: {
  record: GreenButtonCredentialRecord;
  masterKey: string;
}) {
  const { record, masterKey } = input;

  if (hasEncryptedTokens(record)) {
    if (record.tokenEncryptionVersion !== GREEN_BUTTON_TOKEN_ENCRYPTION_VERSION) {
      throw new ConfigError("Unsupported Green Button token encryption version.");
    }

    return {
      tokens: {
        accessToken: openSecret({
          envelope: record.accessTokenEncrypted!,
          masterKey,
          purpose: ACCESS_TOKEN_PURPOSE,
        }),
        refreshToken: openSecret({
          envelope: record.refreshTokenEncrypted!,
          masterKey,
          purpose: REFRESH_TOKEN_PURPOSE,
        }),
        expiresAt: coerceTokenExpiresAt(record.tokenExpiresAt),
        scope: "",
        resourceUri: record.resourceUri ?? "",
        authorizationUri: "",
        subscriptionId: record.subscriptionId ?? "",
      } satisfies GreenButtonTokens,
      usedPlaintextFallback: false,
    };
  }

  if (hasPlaintextTokens(record)) {
    return {
      tokens: {
        accessToken: record.accessToken!,
        refreshToken: record.refreshToken!,
        expiresAt: coerceTokenExpiresAt(record.tokenExpiresAt),
        scope: "",
        resourceUri: record.resourceUri ?? "",
        authorizationUri: "",
        subscriptionId: record.subscriptionId ?? "",
      } satisfies GreenButtonTokens,
      usedPlaintextFallback: true,
    };
  }

  throw new WorkflowStateError(
    "Green Button connection is missing stored OAuth tokens.",
    {
      details: {
        connectionId: record.id,
      },
    },
  );
}

export async function findGreenButtonCredentialRecord(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  organizationId: string;
  buildingId: string;
}) {
  return input.db.greenButtonConnection.findFirst({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
    },
    select: greenButtonCredentialSelect,
  });
}

export async function getGreenButtonTokensForConnection(input: {
  record: GreenButtonCredentialRecord;
  masterKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
}) {
  const resolved = resolveGreenButtonTokensFromRecord({
    record: input.record,
    masterKey: input.masterKey,
  });

  if (resolved.usedPlaintextFallback) {
    await input.db.greenButtonConnection.update({
      where: { id: input.record.id },
      data: buildEncryptedCredentialUpdate(resolved.tokens, input.masterKey),
    });
  }

  return resolved.tokens;
}

export async function getGreenButtonTokensForBuilding(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  organizationId: string;
  buildingId: string;
  masterKey: string;
}) {
  const record = await findGreenButtonCredentialRecord(input);

  if (!record) {
    throw new NotFoundError("Green Button connection not found.");
  }

  return {
    record,
    tokens: await getGreenButtonTokensForConnection({
      record,
      masterKey: input.masterKey,
      db: input.db,
    }),
  };
}

export async function upsertGreenButtonCredentials(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  organizationId: string;
  buildingId: string;
  tokens: GreenButtonTokens;
  masterKey: string;
  status?: "ACTIVE" | "FAILED" | "PENDING_AUTH" | "EXPIRED";
  runtimeStatus?: "IDLE" | "RUNNING" | "SUCCEEDED" | "FAILED" | "RETRYING" | "STALE";
}) {
  const encrypted = buildEncryptedCredentialUpdate(input.tokens, input.masterKey);

  return input.db.greenButtonConnection.upsert({
    where: { buildingId: input.buildingId },
    update: {
      status: input.status ?? "ACTIVE",
      runtimeStatus: input.runtimeStatus ?? "IDLE",
      ...encrypted,
      latestErrorCode: null,
      latestErrorMessage: null,
    },
    create: {
      buildingId: input.buildingId,
      organizationId: input.organizationId,
      status: input.status ?? "ACTIVE",
      runtimeStatus: input.runtimeStatus ?? "IDLE",
      ...encrypted,
    },
  });
}

export async function rotateGreenButtonCredentials(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  connectionId: string;
  tokens: GreenButtonTokens;
  masterKey: string;
}) {
  return input.db.greenButtonConnection.update({
    where: { id: input.connectionId },
    data: {
      status: "ACTIVE",
      ...buildEncryptedCredentialUpdate(input.tokens, input.masterKey),
    },
  });
}
