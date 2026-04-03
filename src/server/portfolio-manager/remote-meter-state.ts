import type { PrismaClient } from "@/generated/prisma";
import { prisma } from "@/server/lib/db";
import type { ESPM } from "@/server/integrations/espm";
import { ESPMAccessError, ESPMError } from "@/server/integrations/espm/errors";
import {
  parsePortfolioManagerMeterDetail,
  parsePortfolioManagerMeterIds,
} from "@/server/compliance/portfolio-manager-support";
import { resolvePortfolioManagerClientForOrganization } from "@/server/portfolio-manager/existing-account";
import { mapWithConcurrency } from "@/server/lib/async";

export type RemoteMeterRecord = {
  meterId: number;
  name: string;
  meterType:
    | "ELECTRIC"
    | "GAS"
    | "STEAM"
    | "WATER_INDOOR"
    | "WATER_OUTDOOR"
    | "WATER_RECYCLED"
    | "OTHER";
  unit: "KWH" | "THERMS" | "KBTU" | "MMBTU" | "GAL" | "KGAL" | "CCF";
  inUse: boolean;
  rawType: string | null;
  rawUnitOfMeasure: string | null;
};

export type InaccessibleRemoteMeterRecord = {
  meterId: string;
  statusCode: number | null;
  errorCode: string | null;
  isAccessRelated: boolean;
  category:
    | "MISSING_SHARE_ACCESS"
    | "PROVIDER_UNSUPPORTED_METER_TYPE"
    | "QUOIN_UNSUPPORTED_METER_NORMALIZATION"
    | "TEMPORARY_REMOTE_ERROR";
  message: string;
};

export type RemoteMeterAccessSummary = {
  status: "FULL_ACCESS" | "PARTIAL_ACCESS" | "UNAVAILABLE";
  inaccessibleCount: number;
  inaccessibleMeterIds: string[];
  inaccessibleMeters: InaccessibleRemoteMeterRecord[];
  warning: string | null;
  canProceed: boolean;
  partialReasonSummary: string | null;
};

export type RemoteAssociationAccessSummary = {
  status: "FULL_ACCESS" | "UNAVAILABLE";
  warning: string | null;
  canProceed: boolean;
};

type RemoteMeterLoadResult = {
  espmClient: ESPM;
  meters: RemoteMeterRecord[];
  remoteMeterAccess: RemoteMeterAccessSummary;
};

function parseAssociationMeterIds(raw: unknown) {
  return new Set(parsePortfolioManagerMeterIds(raw));
}

export async function loadRemoteMetersForProperty(input: {
  organizationId: string;
  propertyId: number;
  espmClient?: ESPM;
  db?: PrismaClient;
}): Promise<RemoteMeterLoadResult> {
  const db = input.db ?? prisma;
  const espmClient =
    input.espmClient ??
    (await resolvePortfolioManagerClientForOrganization({
      organizationId: input.organizationId,
      db,
    }));

  let meterIds: number[] = [];
  try {
    meterIds = parsePortfolioManagerMeterIds(await espmClient.meter.listMeters(input.propertyId));
  } catch (error) {
    const appError =
      error instanceof ESPMError
        ? error
        : new ESPMError(
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Portfolio Manager meter access is unavailable.",
            0,
          );

    return {
      espmClient,
      meters: [],
      remoteMeterAccess: {
        status: "UNAVAILABLE",
        inaccessibleCount: 0,
        inaccessibleMeterIds: [],
        inaccessibleMeters: [],
        warning:
          appError instanceof ESPMAccessError
            ? "Quoin cannot read this property's Portfolio Manager meters. Share the property meters with this ESPM account before continuing."
            : "Quoin could not read this property's Portfolio Manager meters right now.",
        canProceed: false,
        partialReasonSummary: null,
      },
    };
  }

  const settledMeters = await mapWithConcurrency(meterIds, 4, async (meterId) => {
      try {
        return {
          ok: true as const,
          meter: parsePortfolioManagerMeterDetail(
            await espmClient.meter.getMeter(meterId),
            meterId,
          ),
        };
      } catch (error) {
        const appError =
          error instanceof ESPMError
            ? error
            : new ESPMError(
                error instanceof Error && error.message.trim().length > 0
                  ? error.message
                  : `Portfolio Manager meter ${meterId} could not be loaded.`,
                0,
              );

        return {
          ok: false as const,
          inaccessibleMeter: {
            meterId: String(meterId),
            statusCode: appError.statusCode || null,
            errorCode: appError.espmErrorCode ?? null,
            isAccessRelated: appError instanceof ESPMAccessError || appError.statusCode === 403,
            category:
              appError instanceof ESPMAccessError || appError.statusCode === 403
                ? "PROVIDER_UNSUPPORTED_METER_TYPE"
                : "TEMPORARY_REMOTE_ERROR",
            message: appError.message,
          } satisfies InaccessibleRemoteMeterRecord,
        };
      }
    });

  const accessibleMeters = settledMeters
    .filter((result): result is Extract<(typeof settledMeters)[number], { ok: true }> => result.ok)
    .map((result) => result.meter);
  const inaccessibleMeters = settledMeters
    .filter((result): result is Extract<(typeof settledMeters)[number], { ok: false }> => !result.ok)
    .map((result) => result.inaccessibleMeter);

  const inaccessibleMeterIds = inaccessibleMeters.map((meter) => meter.meterId);
  const remoteMeterAccess: RemoteMeterAccessSummary =
    inaccessibleMeters.length === 0
      ? {
          status: "FULL_ACCESS",
          inaccessibleCount: 0,
          inaccessibleMeterIds: [],
          inaccessibleMeters: [],
          warning: null,
          canProceed: true,
          partialReasonSummary: null,
        }
      : {
          status: accessibleMeters.length > 0 ? "PARTIAL_ACCESS" : "UNAVAILABLE",
          inaccessibleCount: inaccessibleMeters.length,
          inaccessibleMeterIds,
          inaccessibleMeters,
          warning: inaccessibleMeters.some((meter) => meter.isAccessRelated)
            ? accessibleMeters.length > 0
              ? `Quoin imported the Portfolio Manager meters it can access and skipped ${inaccessibleMeters.length} meter${inaccessibleMeters.length === 1 ? "" : "s"} that ESPM does not expose to this provider account. Skipped meter IDs: ${inaccessibleMeterIds.join(", ")}.`
              : `Quoin cannot read any of this property's Portfolio Manager meters. Share at least one supported property meter with this ESPM account before continuing. Inaccessible meter IDs: ${inaccessibleMeterIds.join(", ")}.`
            : `Quoin could not read ${inaccessibleMeters.length} Portfolio Manager meter(s) for this property right now.`,
          canProceed: accessibleMeters.length > 0,
          partialReasonSummary:
            accessibleMeters.length > 0
              ? `Imported ${accessibleMeters.length} accessible meter${accessibleMeters.length === 1 ? "" : "s"} and skipped ${inaccessibleMeters.length} inaccessible or provider-limited meter${inaccessibleMeters.length === 1 ? "" : "s"}.`
              : null,
        };

  return {
    espmClient,
    meters: accessibleMeters,
    remoteMeterAccess,
  };
}

export async function loadRemotePropertyMeterSnapshot(input: {
  organizationId: string;
  propertyId: number;
  espmClient?: ESPM;
  db?: PrismaClient;
}) {
  const remote = await loadRemoteMetersForProperty(input);
  let associatedMeterIds = new Set<number>();
  let associationAccess: RemoteAssociationAccessSummary = {
    status: "FULL_ACCESS",
    warning: null,
    canProceed: true,
  };

  if (remote.remoteMeterAccess.canProceed) {
    if (typeof remote.espmClient.meter.listPropertyMeterAssociations === "function") {
      try {
        associatedMeterIds = parseAssociationMeterIds(
          await remote.espmClient.meter.listPropertyMeterAssociations(input.propertyId),
        );
      } catch (error) {
        const appError =
          error instanceof ESPMError
            ? error
            : new ESPMError(
                error instanceof Error && error.message.trim().length > 0
                  ? error.message
                  : "Portfolio Manager property-to-meter associations are unavailable.",
                0,
              );
        associationAccess = {
          status: "UNAVAILABLE",
          warning:
            appError instanceof ESPMAccessError
              ? "Quoin could not validate this property's Portfolio Manager meter associations. Share the property's meter associations with this ESPM account before usage can continue."
              : "Quoin could not validate this property's Portfolio Manager meter associations right now. Retry usage after association access is restored.",
          canProceed: false,
        };
      }
    } else {
      associationAccess = {
        status: "UNAVAILABLE",
        warning:
          "Quoin could not validate this property's Portfolio Manager meter associations right now. Retry usage after association access is restored.",
        canProceed: false,
      };
    }
  }

  return {
    ...remote,
    associatedMeterIds,
    associationAccess,
  };
}
