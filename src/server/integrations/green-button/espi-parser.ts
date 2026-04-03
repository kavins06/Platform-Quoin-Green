import { XMLParser } from "fast-xml-parser";
import type {
  ESPIIntervalReading,
  ESPIReadingType,
  GreenButtonReading,
} from "./types";
import { createNonRetryableIntegrationError } from "@/server/lib/errors";

const espiParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  removeNSPrefix: true,
  isArray: (_name, jPathOrMatcher) => {
    const jpath = typeof jPathOrMatcher === "string" ? jPathOrMatcher : "";
    return (
      jpath === "feed.entry" ||
      jpath.endsWith("IntervalBlock") ||
      jpath.endsWith("IntervalReading")
    );
  },
});

/** kWh to kBtu conversion factor (ENERGY STAR standard). */
const KWH_TO_KBTU = 3.412;

/** Therms to kWh conversion factor. */
const THERMS_TO_KWH = 29.3001;

/**
 * Parse ESPI/Atom XML into normalized Green Button readings.
 *
 * ESPI XML structure:
 * - feed.entry with ReadingType describes units + commodity
 * - feed.entry with IntervalBlock contains actual consumption data
 * - IntervalReading.timePeriod.start is Unix epoch seconds
 * - ReadingType.uom: 72 = Wh, 169 = therms
 * - ReadingType.powerOfTenMultiplier scales raw values
 */
export function parseESPIXml(xml: string): GreenButtonReading[] {
  const parsed = espiParser.parse(xml) as Record<string, unknown>;
  const feed = parsed["feed"] as Record<string, unknown> | undefined;
  if (!feed) {
    throw createNonRetryableIntegrationError(
      "GREEN_BUTTON",
      "Invalid ESPI XML payload: missing feed element.",
    );
  }

  const entries = (feed["entry"] ?? []) as Record<string, unknown>[];

  // Extract ReadingType (tells us units and commodity)
  const readingType = extractReadingType(entries);

  // Extract all IntervalReadings
  const rawReadings = extractIntervalReadings(entries);

  // Convert to normalized readings
  return rawReadings.map((raw) =>
    normalizeReading(raw, readingType),
  );
}

function extractReadingType(
  entries: Record<string, unknown>[],
): ESPIReadingType {
  for (const entry of entries) {
    const content = entry["content"] as Record<string, unknown> | undefined;
    const rt = content?.["ReadingType"] as Record<string, unknown> | undefined;
    if (rt) {
      return {
        commodity: Number(rt["commodity"] ?? 0),
        uom: Number(rt["uom"] ?? 72),
        powerOfTenMultiplier: Number(rt["powerOfTenMultiplier"] ?? 0),
        flowDirection: Number(rt["flowDirection"] ?? 1),
        accumulationBehaviour: Number(rt["accumulationBehaviour"] ?? 4),
      };
    }
  }

  // Default: electricity in Wh
  return {
    commodity: 0,
    uom: 72,
    powerOfTenMultiplier: 0,
    flowDirection: 1,
    accumulationBehaviour: 4,
  };
}

function extractIntervalReadings(
  entries: Record<string, unknown>[],
): ESPIIntervalReading[] {
  const readings: ESPIIntervalReading[] = [];

  for (const entry of entries) {
    const content = entry["content"] as Record<string, unknown> | undefined;
    if (!content) continue;

    const blocks = content["IntervalBlock"];
    if (!blocks) continue;

    const blockArray = Array.isArray(blocks) ? blocks : [blocks];
    for (const block of blockArray as Record<string, unknown>[]) {
      const intervalReadings = block["IntervalReading"];
      if (!intervalReadings) continue;

      const readingArray = Array.isArray(intervalReadings)
        ? intervalReadings
        : [intervalReadings];

      for (const reading of readingArray as Record<string, unknown>[]) {
        const timePeriod = reading["timePeriod"] as
          | Record<string, unknown>
          | undefined;
        if (!timePeriod?.["start"] || !timePeriod?.["duration"]) continue;

        readings.push({
          start: new Date(Number(timePeriod["start"]) * 1000),
          duration: Number(timePeriod["duration"]),
          value: Number(reading["value"] ?? 0),
          qualityOfReading:
            reading["qualityOfReading"] != null
              ? Number(reading["qualityOfReading"])
              : undefined,
        });
      }
    }
  }

  return readings;
}

function normalizeReading(
  raw: ESPIIntervalReading,
  readingType: ESPIReadingType,
): GreenButtonReading {
  const periodEnd = new Date(raw.start.getTime() + raw.duration * 1000);
  const scaledValue =
    raw.value * Math.pow(10, readingType.powerOfTenMultiplier);

  let consumptionKWh: number;
  if (readingType.uom === 72) {
    // Wh → kWh
    consumptionKWh = scaledValue / 1000;
  } else if (readingType.uom === 169) {
    // Therms → kWh
    consumptionKWh = scaledValue * THERMS_TO_KWH;
  } else {
    // Unknown UOM — assume Wh
    consumptionKWh = scaledValue / 1000;
  }

  const fuelType =
    readingType.commodity === 1 ? ("GAS" as const) : ("ELECTRIC" as const);

  return {
    periodStart: raw.start,
    periodEnd,
    consumptionKWh,
    consumptionKBtu: consumptionKWh * KWH_TO_KBTU,
    cost: null,
    fuelType,
    source: "GREEN_BUTTON",
    isEstimated: raw.qualityOfReading === 8,
    intervalSeconds: raw.duration,
  };
}

/**
 * Aggregate 15-minute or hourly interval readings into monthly totals.
 * The ingestion pipeline and ESPM sync expect monthly granularity.
 */
export function aggregateToMonthly(
  readings: GreenButtonReading[],
): GreenButtonReading[] {
  const monthMap = new Map<string, GreenButtonReading>();

  for (const reading of readings) {
    const key = `${reading.periodStart.getUTCFullYear()}-${String(reading.periodStart.getUTCMonth() + 1).padStart(2, "0")}`;

    if (!monthMap.has(key)) {
      const monthStart = new Date(
        Date.UTC(
          reading.periodStart.getUTCFullYear(),
          reading.periodStart.getUTCMonth(),
          1,
        ),
      );
      const monthEnd = new Date(
        Date.UTC(
          reading.periodStart.getUTCFullYear(),
          reading.periodStart.getUTCMonth() + 1,
          0,
        ),
      );

      monthMap.set(key, {
        periodStart: monthStart,
        periodEnd: monthEnd,
        consumptionKWh: 0,
        consumptionKBtu: 0,
        cost: null,
        fuelType: reading.fuelType,
        source: "GREEN_BUTTON",
        isEstimated: false,
        intervalSeconds: 0,
      });
    }

    const monthly = monthMap.get(key)!;
    monthly.consumptionKWh += reading.consumptionKWh;
    monthly.consumptionKBtu += reading.consumptionKBtu;
    if (reading.cost !== null) {
      monthly.cost = (monthly.cost ?? 0) + reading.cost;
    }
    if (reading.isEstimated) {
      monthly.isEstimated = true;
    }
  }

  return Array.from(monthMap.values()).sort(
    (a, b) => a.periodStart.getTime() - b.periodStart.getTime(),
  );
}
