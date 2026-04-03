import type {
  EnergyUnit,
  MeterType,
  PortfolioManagerSyncStatus,
} from "@/generated/prisma/client";
import {
  ESPMAccessError,
  ESPMAuthError,
  ESPMError,
  ESPMNotFoundError,
  ESPMRateLimitError,
  ESPMValidationError,
} from "@/server/integrations/espm";
import {
  defaultLocalUnitForMeterType,
  getPortfolioManagerRemoteMeterDefinition,
  mapRawEspmMeterType,
} from "@/server/portfolio-manager/unit-catalog";
import { parsePeriodDate } from "@/lib/period-date";

export type PortfolioManagerSyncStep =
  | "property"
  | "meters"
  | "consumption"
  | "metrics"
  | "benchmarking"
  | "sync";

export type PortfolioManagerSyncStepStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED";

export interface PortfolioManagerPropertySnapshot {
  propertyId: number;
  name: string | null;
  primaryFunction: string | null;
  grossFloorArea: number | null;
  yearBuilt: number | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export interface PortfolioManagerMeterSnapshot {
  meterId: number;
  meterType: MeterType;
  name: string;
  unit: EnergyUnit;
  inUse: boolean;
  rawType: string | null;
  rawUnitOfMeasure: string | null;
}

export interface PortfolioManagerConsumptionReading {
  id: number | null;
  periodStart: Date;
  periodEnd: Date;
  usage: number;
  cost: number | null;
  estimatedValue: boolean | null;
}

export interface PortfolioManagerConsumptionParseResult {
  readings: PortfolioManagerConsumptionReading[];
  malformedRowCount: number;
  rawRowCount: number;
}

export interface PortfolioManagerSyncErrorDetail {
  step: PortfolioManagerSyncStep;
  message: string;
  retryable: boolean;
  errorCode: string;
  statusCode: number | null;
}

export interface PortfolioManagerSyncDiagnostics {
  failedStep: PortfolioManagerSyncStep | null;
  message: string | null;
  retryable: boolean;
  warnings: string[];
  errors: PortfolioManagerSyncErrorDetail[];
  stepStatuses: Record<Exclude<PortfolioManagerSyncStep, "sync">, PortfolioManagerSyncStepStatus>;
  readingsCreated: number;
  readingsUpdated: number;
  readingsSkipped: number;
  activeLinkedMeters: number;
  snapshotId: string | null;
  benchmarkSubmissionId: string | null;
}

export class PortfolioManagerPayloadError extends Error {
  constructor(message: string, public readonly step: PortfolioManagerSyncStep) {
    super(message);
    this.name = "PortfolioManagerPayloadError";
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value == null ? [] : [value];
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }

  return null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const direct = toRecord(value);
  if (Object.keys(direct).length > 0) {
    return direct;
  }

  const first = toArray(value)[0];
  const record = toRecord(first);
  return Object.keys(record).length > 0 ? record : null;
}

function getNestedObject(value: unknown, key: string): Record<string, unknown> | null {
  const record = toRecord(value);
  const nested = record[key];
  return firstRecord(nested);
}

export function mapEspmMeterType(type: string | null): MeterType {
  return mapRawEspmMeterType(type);
}

export function mapEspmUnit(
  unit: string | null,
  rawType?: string | null,
): EnergyUnit {
  const remote = getPortfolioManagerRemoteMeterDefinition({
    rawType: rawType ?? null,
    rawUnitOfMeasure: unit,
  });

  if (remote) {
    return remote.preferredLocalUnit;
  }

  return defaultLocalUnitForMeterType(mapEspmMeterType(rawType ?? null));
}

export function parsePortfolioManagerProperty(
  raw: unknown,
  expectedPropertyId?: number | null,
): PortfolioManagerPropertySnapshot {
  const property = getNestedObject(raw, "property") ?? firstRecord(raw);
  if (!property) {
    throw new PortfolioManagerPayloadError(
      "Portfolio Manager property payload is missing a property node.",
      "property",
    );
  }

  const propertyId =
    getNumber(property["@_id"] ?? property["id"]) ?? expectedPropertyId ?? null;
  if (propertyId == null) {
    throw new PortfolioManagerPayloadError(
      "Portfolio Manager property payload did not include a property ID.",
      "property",
    );
  }

  if (expectedPropertyId != null && propertyId !== expectedPropertyId) {
    throw new PortfolioManagerPayloadError(
      `Portfolio Manager returned property ${propertyId}, but Quoin is linked to property ${expectedPropertyId}.`,
      "property",
    );
  }

  const address = getNestedObject(property, "address");
  const grossFloorArea = getNestedObject(property, "grossFloorArea");

  return {
    propertyId,
    name: getString(property["name"]),
    primaryFunction: getString(property["primaryFunction"]),
    grossFloorArea: getNumber(grossFloorArea?.["value"]),
    yearBuilt: getNumber(property["yearBuilt"]),
    addressLine1: getString(address?.["@_address1"] ?? address?.["address1"]),
    city: getString(address?.["@_city"] ?? address?.["city"]),
    state: getString(address?.["@_state"] ?? address?.["state"]),
    postalCode: getString(address?.["@_postalCode"] ?? address?.["postalCode"]),
  };
}

export function parsePortfolioManagerMeterIds(raw: unknown): number[] {
  const record = toRecord(raw);
  const hasRecognizedRoot =
    "response" in record ||
    "links" in record ||
    "link" in record ||
    "meterList" in record ||
    "meterPropertyAssociationList" in record;

  if (!hasRecognizedRoot) {
    throw new PortfolioManagerPayloadError(
      "Portfolio Manager meter list payload is malformed.",
      "meters",
    );
  }

  const associationList = getNestedObject(record, "meterPropertyAssociationList");
  if (associationList) {
    const associationMeterIds = Object.values(associationList).flatMap((association) => {
      const meters = getNestedObject(association, "meters");
      if (!meters) {
        return [];
      }

      return toArray(meters["meterId"])
        .map((entry) => {
          const primitiveId = getNumber(entry);
          if (primitiveId != null) {
            return primitiveId;
          }

          const meterRecord = toRecord(entry);
          return getNumber(meterRecord["@_id"] ?? meterRecord["id"]);
        })
        .filter((value): value is number => value != null);
    });

    if (associationMeterIds.length > 0) {
      return associationMeterIds;
    }
  }

  const links =
    getNestedObject(record, "response")?.["links"] ??
    record["links"] ??
    getNestedObject(record, "meterList")?.["link"] ??
    record["link"];

  const linkEntries =
    toRecord(links)["meterId"] ??
    getNestedObject(links, "meterId")?.["meterId"] ??
    getNestedObject(links, "link")?.["link"] ??
    toRecord(links)["link"] ??
    links;

  return toArray(linkEntries)
    .map((entry) => {
      const primitiveId = getNumber(entry);
      if (primitiveId != null) {
        return primitiveId;
      }

      const link = toRecord(entry);
      const numericId = getNumber(link["@_id"] ?? link["id"]);
      if (numericId != null) {
        return numericId;
      }

      const href = getString(
        link["@_href"] ?? link["href"] ?? link["@_link"] ?? link["link"],
      );
      if (!href) {
        return null;
      }

      const match = href.match(/(\d+)/);
      return match ? Number(match[1]) : null;
    })
    .filter((value): value is number => value != null && Number.isFinite(value));
}

export function parsePortfolioManagerMeterDetail(
  raw: unknown,
  fallbackMeterId: number,
): PortfolioManagerMeterSnapshot {
  const meter = getNestedObject(raw, "meter") ?? firstRecord(raw);
  if (!meter) {
    throw new PortfolioManagerPayloadError(
      `Portfolio Manager meter payload is malformed for meter ${fallbackMeterId}.`,
      "meters",
    );
  }

  const meterId = getNumber(meter["@_id"] ?? meter["id"]) ?? fallbackMeterId;
  const rawType = getString(meter["type"]);
  if (!rawType) {
    throw new PortfolioManagerPayloadError(
      `Portfolio Manager meter ${meterId} payload is missing meter type information.`,
      "meters",
    );
  }

  const rawUnitOfMeasure = getString(meter["unitOfMeasure"]);

  return {
    meterId,
    meterType: mapEspmMeterType(rawType),
    name: getString(meter["name"]) ?? `Portfolio Manager meter ${meterId}`,
    unit: mapEspmUnit(rawUnitOfMeasure, rawType),
    inUse: getBoolean(meter["inUse"]) ?? true,
    rawType,
    rawUnitOfMeasure,
  };
}

export function parsePortfolioManagerConsumptionReadings(
  raw: unknown,
): PortfolioManagerConsumptionParseResult {
  const record = toRecord(raw);
  const hasRecognizedRoot =
    "meterData" in record ||
    "consumptionData" in record ||
    "meterConsumption" in record ||
    "consumption" in record;

  if (!hasRecognizedRoot) {
    throw new PortfolioManagerPayloadError(
      "Portfolio Manager consumption payload is malformed.",
      "consumption",
    );
  }

  const nested =
    getNestedObject(record, "meterData")?.["meterConsumption"] ??
    getNestedObject(record, "consumptionData")?.["meterConsumption"] ??
    getNestedObject(record, "consumptionData")?.["consumption"] ??
    record["meterConsumption"] ??
    record["consumption"];

  const rows = toArray(nested);
  let malformedRowCount = 0;

  const readings = rows
    .map((entry) => {
      const row = toRecord(entry);
      const periodStart = parsePeriodDate(row["startDate"]);
      const periodEnd = parsePeriodDate(row["endDate"]);
      const usage = getNumber(row["usage"]);

      if (!periodStart || !periodEnd || usage == null) {
        malformedRowCount += 1;
        return null;
      }

      return {
        id: getNumber(row["id"]),
        periodStart,
        periodEnd,
        usage,
        cost: getNumber(row["cost"]),
        estimatedValue: getBoolean(row["estimatedValue"]),
      };
    })
    .filter((entry): entry is PortfolioManagerConsumptionReading => entry != null);

  return {
    readings,
    malformedRowCount,
    rawRowCount: rows.length,
  };
}

export function classifyPortfolioManagerError(
  error: unknown,
  step: PortfolioManagerSyncStep,
): PortfolioManagerSyncErrorDetail {
  if (error instanceof PortfolioManagerPayloadError) {
    return {
      step,
      message: error.message,
      retryable: false,
      errorCode: "MALFORMED_PAYLOAD",
      statusCode: null,
    };
  }

  if (error instanceof ESPMRateLimitError) {
    return {
      step,
      message: error.message,
      retryable: true,
      errorCode: error.espmErrorCode ?? "RATE_LIMIT",
      statusCode: error.statusCode,
    };
  }

  if (error instanceof ESPMAccessError) {
    return {
      step,
      message: error.message,
      retryable: false,
      errorCode: error.espmErrorCode ?? "ACCESS_DENIED",
      statusCode: error.statusCode,
    };
  }

  if (
    error instanceof ESPMAuthError ||
    error instanceof ESPMNotFoundError ||
    error instanceof ESPMValidationError
  ) {
    return {
      step,
      message: error.message,
      retryable: false,
      errorCode: error.espmErrorCode ?? "ESPM_ERROR",
      statusCode: error.statusCode,
    };
  }

  if (error instanceof ESPMError) {
    const retryable =
      error.statusCode >= 500 ||
      error.statusCode === 0 ||
      error.espmErrorCode === "NETWORK_ERROR";
    return {
      step,
      message: error.message,
      retryable,
      errorCode: error.espmErrorCode ?? "ESPM_ERROR",
      statusCode: error.statusCode,
    };
  }

  return {
    step,
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    errorCode: "UNKNOWN",
    statusCode: null,
  };
}

function toSyncErrorDetails(value: unknown): PortfolioManagerSyncErrorDetail[] {
  return toArray(value)
    .map((entry) => {
      const record = toRecord(entry);
      const step = getString(record["step"]);
      const message = getString(record["message"]);
      const retryable = typeof record["retryable"] === "boolean" ? record["retryable"] : false;
      const errorCode = getString(record["errorCode"]);
      const statusCode = getNumber(record["statusCode"]);

      if (!step || !message || !errorCode) {
        return null;
      }

      return {
        step: step as PortfolioManagerSyncStep,
        message,
        retryable,
        errorCode,
        statusCode,
      };
    })
    .filter((entry): entry is PortfolioManagerSyncErrorDetail => entry != null);
}

function toStepStatuses(
  value: unknown,
): Record<Exclude<PortfolioManagerSyncStep, "sync">, PortfolioManagerSyncStepStatus> {
  const defaults: Record<
    Exclude<PortfolioManagerSyncStep, "sync">,
    PortfolioManagerSyncStepStatus
  > = {
    property: "PENDING",
    meters: "PENDING",
    consumption: "PENDING",
    metrics: "PENDING",
    benchmarking: "PENDING",
  };

  const record = toRecord(value);
  for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) {
    const status = getString(record[key]);
    if (
      status === "PENDING" ||
      status === "RUNNING" ||
      status === "SUCCEEDED" ||
      status === "PARTIAL" ||
      status === "FAILED" ||
      status === "SKIPPED"
    ) {
      defaults[key] = status;
    }
  }

  return defaults;
}

export function summarizePortfolioManagerSyncState(
  syncState: {
    status: PortfolioManagerSyncStatus;
    lastErrorMetadata: unknown;
    syncMetadata: unknown;
  } | null,
): PortfolioManagerSyncDiagnostics | null {
  if (!syncState) {
    return null;
  }

  const lastErrorMetadata = toRecord(syncState.lastErrorMetadata);
  const syncMetadata = toRecord(syncState.syncMetadata);
  const errors = toSyncErrorDetails(lastErrorMetadata["errors"]);
  const warnings = toArray(lastErrorMetadata["warnings"])
    .map((warning) => getString(warning))
    .filter((warning): warning is string => warning != null);
  const primaryMessage =
    getString(lastErrorMetadata["message"]) ??
    errors[0]?.message ??
    (warnings.length > 0 ? warnings[0] : null);
  const failedStep = getString(lastErrorMetadata["failedStep"]) ?? errors[0]?.step ?? null;
  const retryable =
    typeof lastErrorMetadata["retryable"] === "boolean"
      ? (lastErrorMetadata["retryable"] as boolean)
      : errors[0]?.retryable ?? false;

  return {
    failedStep: failedStep as PortfolioManagerSyncStep | null,
    message: primaryMessage,
    retryable,
    warnings,
    errors,
    stepStatuses: toStepStatuses(syncMetadata["stepStatuses"]),
    readingsCreated: getNumber(syncMetadata["readingsCreated"]) ?? 0,
    readingsUpdated: getNumber(syncMetadata["readingsUpdated"]) ?? 0,
    readingsSkipped: getNumber(syncMetadata["readingsSkipped"]) ?? 0,
    activeLinkedMeters: getNumber(syncMetadata["activeLinkedMeters"]) ?? 0,
    snapshotId: getString(syncMetadata["snapshotId"]),
    benchmarkSubmissionId: getString(syncMetadata["benchmarkSubmissionId"]),
  };
}
