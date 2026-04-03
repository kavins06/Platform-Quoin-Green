import type { GreenButtonConfig, GreenButtonTokens } from "./types";
import { refreshAccessToken } from "./oauth";
import { createLogger } from "@/server/lib/logger";
import {
  createRetryableIntegrationError,
  NotFoundError,
  WorkflowStateError,
} from "@/server/lib/errors";
import {
  getGreenButtonTokensForBuilding,
  greenButtonCredentialSelect,
  rotateGreenButtonCredentials,
} from "./credentials";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Get a valid access token for a building's Green Button connection.
 * Refreshes the token when it is close to expiry and persists the new values.
 */
export async function getValidToken(
  input: {
    buildingId: string;
    organizationId: string;
    config: GreenButtonConfig;
    encryptionKey: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): Promise<GreenButtonTokens> {
  const logger = createLogger({
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    integration: "GREEN_BUTTON",
  });

  const connection = await db.greenButtonConnection.findFirst({
    where: {
      organizationId: input.organizationId,
      buildingId: input.buildingId,
    },
    select: greenButtonCredentialSelect,
  });

  if (!connection) {
    throw new NotFoundError("Green Button connection not found.");
  }

  if (connection.status !== "ACTIVE") {
    throw new WorkflowStateError(
      "Green Button connection is not active for ingestion.",
      {
        details: {
          status: connection.status,
          connectionId: connection.id,
        },
      },
    );
  }
  const { tokens } = await getGreenButtonTokensForBuilding({
    db,
    organizationId: input.organizationId,
    buildingId: input.buildingId,
    masterKey: input.encryptionKey,
  });
  const expiresAt = connection.tokenExpiresAt;

  if (
    expiresAt &&
    new Date(expiresAt).getTime() > Date.now() + REFRESH_BUFFER_MS
  ) {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(expiresAt),
      scope: "",
      resourceUri: connection.resourceUri ?? "",
      authorizationUri: "",
      subscriptionId: connection.subscriptionId ?? "",
    };
  }

  try {
    const refreshed = await refreshAccessToken(input.config, tokens.refreshToken);

    await rotateGreenButtonCredentials({
      db,
      connectionId: connection.id,
      tokens: refreshed,
      masterKey: input.encryptionKey,
    });

    logger.info("Green Button access token refreshed", {
      connectionId: connection.id,
      subscriptionId: refreshed.subscriptionId,
    });

    return refreshed;
  } catch (error) {
    logger.error("Green Button token refresh failed", {
      error,
      connectionId: connection.id,
    });
    throw createRetryableIntegrationError(
      "GREEN_BUTTON",
      "Green Button token refresh failed.",
      {
        details: {
          connectionId: connection.id,
        },
        cause: error,
      },
    );
  }
}
