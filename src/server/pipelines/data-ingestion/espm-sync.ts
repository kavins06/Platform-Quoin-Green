import type { ESPM } from "@/server/integrations/espm";
import type { PropertyMetrics } from "@/server/integrations/espm/types";
import { createLogger } from "@/server/lib/logger";

export interface ESPMSyncInput {
  espmPropertyId: number;
  espmMeterId?: number | null;
  readings: Array<{
    periodStart: Date;
    periodEnd: Date;
    consumptionNative: number;
    nativeUnit: string;
  }>;
}

export interface ESPMSyncResult {
  pushed: boolean;
  pushError?: string;
  metrics: PropertyMetrics | null;
  metricsError?: string;
}

const ESPM_METER_CONFIG = {
  ELECTRIC: {
    type: "Electric",
    unitOfMeasure: "kWh (thousand Watt-hours)",
    defaultName: "Primary Electric Meter",
  },
  GAS: {
    type: "Natural Gas",
    unitOfMeasure: "therms",
    defaultName: "Primary Natural Gas Meter",
  },
} as const;

/**
 * Sync energy data with ESPM:
 * 1. Ensure a real meter exists on the property
 * 2. Push consumption data to that meter
 * 3. Pull updated metrics from the property
 *
 * Each step is independent. A push failure should not prevent metrics retrieval.
 */
export async function syncWithESPM(
  espmClient: ESPM,
  input: ESPMSyncInput,
): Promise<ESPMSyncResult> {
  const result: ESPMSyncResult = { pushed: false, metrics: null };
  const log = createLogger({
    syncPhase: "legacy-espm-sync",
    espmPropertyId: input.espmPropertyId,
  });

  let meterId = input.espmMeterId ?? null;

  if (input.readings.length > 0) {
    try {
      const links = toArray(
        toRecord(toRecord(toRecord(await espmClient.meter.listMeters(input.espmPropertyId)).response).links)
          .link,
      );

      if (meterId == null) {
        for (const link of links) {
          const parsedMeterId = extractMeterId(link);
          if (parsedMeterId != null) {
            meterId = parsedMeterId;
            log.info("Resolved existing ESPM meter for legacy sync.", {
              meterId,
            });
            break;
          }
        }
      }

      if (meterId == null) {
        const firstReading = input.readings[0];
        const meterConfig = inferMeterConfig(firstReading?.nativeUnit ?? null);
        log.info("Creating ESPM meter for legacy sync.", {
          meterType: meterConfig.type,
          unitOfMeasure: meterConfig.unitOfMeasure,
        });

        const createResponse = toRecord(
          await espmClient.meter.createMeter(input.espmPropertyId, {
            type: meterConfig.type,
            name: meterConfig.defaultName,
            unitOfMeasure: meterConfig.unitOfMeasure,
            metered: true,
            firstBillDate: formatDate(firstReading.periodStart),
            inUse: true,
          }),
        );

        meterId =
          getNumber(createResponse.meterId) ??
          getNumber(createResponse.id) ??
          extractMeterId(toRecord(toRecord(toRecord(createResponse.response).links).link));

        if (meterId != null) {
          log.info("Created ESPM meter for legacy sync.", { meterId });
        } else {
          log.warn(
            "Meter creation succeeded but no meter ID could be parsed for legacy sync.",
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("Legacy ESPM meter setup failed.", {
        errorMessage: msg,
        error: err instanceof Error ? err : undefined,
      });
    }

    if (meterId == null) {
      result.pushError =
        "ESPM meter setup did not produce a valid meter ID. Consumption push was skipped.";
    } else {
      try {
        const entries = input.readings.map((reading) => ({
          startDate: formatDate(reading.periodStart),
          endDate: formatDate(reading.periodEnd),
          usage: reading.consumptionNative,
        }));

        const chunks = chunkArray(entries, 120);
        for (const chunk of chunks) {
          await espmClient.consumption.pushConsumptionData(meterId, chunk);
        }
        result.pushed = true;
        log.info("Pushed legacy ESPM consumption data.", {
          meterId,
          readingCount: entries.length,
          chunkCount: chunks.length,
        });
      } catch (err) {
        result.pushError = err instanceof Error ? err.message : String(err);
        log.error("Legacy ESPM consumption push failed.", {
          meterId,
          errorMessage: result.pushError,
          error: err instanceof Error ? err : undefined,
        });
      }
    }
  }

  try {
    const now = new Date();
    result.metrics = await espmClient.metrics.getLatestAvailablePropertyMetrics(
      input.espmPropertyId,
      now.getFullYear(),
      now.getMonth() + 1,
    );
  } catch (err) {
    result.metricsError = err instanceof Error ? err.message : String(err);
    log.error("Legacy ESPM metrics pull failed.", {
      errorMessage: result.metricsError,
      error: err instanceof Error ? err : undefined,
    });
  }

  return result;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
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

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function extractMeterId(raw: unknown): number | null {
  const record = toRecord(raw);
  const directId = getNumber(record["@_id"] ?? record.id);
  if (directId != null) {
    return directId;
  }

  const href =
    typeof record["@_href"] === "string"
      ? record["@_href"]
      : typeof record.href === "string"
        ? record.href
        : null;
  if (!href) {
    return null;
  }

  const match = href.match(/\/meter\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function inferMeterConfig(nativeUnit: string | null) {
  const normalized = nativeUnit?.trim().toLowerCase() ?? "";
  if (normalized.includes("therm") || normalized.includes("ccf")) {
    return ESPM_METER_CONFIG.GAS;
  }

  return ESPM_METER_CONFIG.ELECTRIC;
}

function chunkArray<T>(entries: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(entries.slice(index, index + size));
  }
  return chunks;
}
