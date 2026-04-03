import type { ActorType, EnergySource, EnergyUnit, MeterType } from "@/generated/prisma/client";
import type { ESPM, PropertyMetrics } from "@/server/integrations/espm";
import { prisma } from "@/server/lib/db";
import { syncPortfolioManagerForBuilding } from "./portfolio-manager-sync";

// Legacy benchmarking compatibility layer only. The current Portfolio Manager
// connection, setup, import, and push workflow lives in src/server/portfolio-manager/*.

type PortfolioManagerPushClient = Pick<ESPM, "meter" | "consumption" | "metrics" | "property">;

interface LocalEnergyReading {
  id: string;
  meterId: string | null;
  meterType: MeterType;
  periodStart: Date;
  periodEnd: Date;
  consumption: number;
  unit: EnergyUnit;
  cost: number | null;
  source: EnergySource;
  ingestedAt: Date;
}

interface LocalMeterRecord {
  id: string;
  meterType: MeterType;
  name: string;
  unit: EnergyUnit;
  espmMeterId: bigint | null;
  isActive: boolean;
}

interface MeterLinkSnapshot {
  meterId: number;
  meterType: MeterType;
  rawType: string | null;
  rawUnitOfMeasure: string | null;
  name: string;
  inUse: boolean;
}

interface PushableSeries {
  key: string;
  meterType: "ELECTRIC" | "GAS";
  localMeterId: string | null;
  localMeter: LocalMeterRecord | null;
  name: string;
  unit: EnergyUnit;
  readings: LocalEnergyReading[];
}

export interface PortfolioManagerPushResult {
  propertyId: number;
  reportingYear: number;
  metersCreated: number;
  meterMappings: Array<{
    seriesKey: string;
    meterType: "ELECTRIC" | "GAS";
    espmMeterId: number;
    created: boolean;
    readingsPrepared: number;
    readingsPushed: number;
    readingsUpdated: number;
    readingsSkippedExisting: number;
  }>;
  totals: {
    seriesPrepared: number;
    readingsPrepared: number;
    readingsPushed: number;
    readingsUpdated: number;
    readingsSkippedExisting: number;
  };
  warnings: string[];
  metrics: PropertyMetrics | null;
  syncState: Awaited<ReturnType<typeof syncPortfolioManagerForBuilding>>["syncState"];
}

const PUSHABLE_METER_TYPES = new Set<MeterType>(["ELECTRIC", "GAS"]);
const EXCLUDED_PUSH_SOURCES = new Set<EnergySource>(["ESPM_SYNC"]);

const ESPM_METER_CREATE_CONFIG: Record<
  "ELECTRIC" | "GAS",
  { type: string; unitOfMeasure: string; defaultName: string }
> = {
  ELECTRIC: {
    type: "Electric",
    unitOfMeasure: "kWh (thousand Watt-hours)",
    defaultName: "Quoin Electric Meter",
  },
  GAS: {
    type: "Natural Gas",
    unitOfMeasure: "therms",
    defaultName: "Quoin Natural Gas Meter",
  },
};

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

function normalizeEspmMeterType(type: string | null): MeterType {
  const normalized = type?.toLowerCase() ?? "";

  if (normalized.includes("electric")) return "ELECTRIC";
  if (normalized.includes("gas")) return "GAS";
  if (normalized.includes("steam")) return "STEAM";

  return "OTHER";
}

function parseMeterLinkIds(raw: unknown): number[] {
  const record = toRecord(raw);
  const linksRecord =
    toRecord(toRecord(record.response).links).link ??
    toRecord(record.links).link ??
    record.link;

  return toArray(linksRecord)
    .map((entry) => {
      const link = toRecord(entry);
      const numericId = getNumber(link["@_id"] ?? link.id);
      if (numericId != null) {
        return numericId;
      }

      const href = getString(link["@_href"] ?? link.href ?? link["@_link"] ?? link.link);
      if (!href) {
        return null;
      }

      const match = href.match(/(\d+)/);
      return match ? Number(match[1]) : null;
    })
    .filter((value): value is number => value != null);
}

function parseMeterDetail(raw: unknown, meterId: number): MeterLinkSnapshot {
  const root = toRecord(raw);
  const meterNode = toArray(root.meter)[0] ?? root;
  const meter = toRecord(meterNode);
  const responseLink = toArray(toRecord(toRecord(root.response).links).link)[0];
  const responseLinkRecord = toRecord(responseLink);
  const href = getString(
    responseLinkRecord["@_href"] ??
      responseLinkRecord.href ??
      responseLinkRecord["@_link"] ??
      responseLinkRecord.link,
  );
  const hrefMatch = href?.match(/(\d+)/);
  const fallbackIdFromLink = hrefMatch ? Number(hrefMatch[1]) : null;

  const rawType = getString(meter.type);
  const rawUnitOfMeasure = getString(meter.unitOfMeasure);

  return {
    meterId: getNumber(meter["@_id"] ?? meter.id) ?? fallbackIdFromLink ?? meterId,
    meterType: normalizeEspmMeterType(rawType),
    rawType,
    rawUnitOfMeasure,
    name: getString(meter.name) ?? `Portfolio Manager meter ${meterId}`,
    inUse: getBoolean(meter.inUse) ?? true,
  };
}

function normalizePeriodKey(start: Date, end: Date) {
  return `${start.toISOString()}|${end.toISOString()}`;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

interface RemoteConsumptionRecord {
  id: number;
  usage: number | null;
  cost: number | null;
}

function uniqueLatestReadings(readings: LocalEnergyReading[]) {
  const latestByPeriod = new Map<string, LocalEnergyReading>();

  for (const reading of readings) {
    const key = normalizePeriodKey(reading.periodStart, reading.periodEnd);
    const current = latestByPeriod.get(key);

    if (!current) {
      latestByPeriod.set(key, reading);
      continue;
    }

    const readingTime = reading.ingestedAt.getTime();
    const currentTime = current.ingestedAt.getTime();

    if (readingTime > currentTime) {
      latestByPeriod.set(key, reading);
      continue;
    }

    if (readingTime === currentTime && reading.id.localeCompare(current.id) > 0) {
      latestByPeriod.set(key, reading);
    }
  }

  return Array.from(latestByPeriod.values()).sort((left, right) => {
    const startDelta = left.periodStart.getTime() - right.periodStart.getTime();
    if (startDelta !== 0) {
      return startDelta;
    }

    return left.periodEnd.getTime() - right.periodEnd.getTime();
  });
}

function buildSeriesKey(reading: LocalEnergyReading) {
  return reading.meterId ? `meter:${reading.meterId}` : `fuel:${reading.meterType}`;
}

function buildPushSeries(input: {
  readings: LocalEnergyReading[];
  localMeters: LocalMeterRecord[];
}): PushableSeries[] {
  const meterById = new Map(input.localMeters.map((meter) => [meter.id, meter]));
  const grouped = new Map<string, LocalEnergyReading[]>();

  for (const reading of input.readings) {
    if (!PUSHABLE_METER_TYPES.has(reading.meterType) || EXCLUDED_PUSH_SOURCES.has(reading.source)) {
      continue;
    }

    const key = buildSeriesKey(reading);
    const current = grouped.get(key) ?? [];
    current.push(reading);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .map(([key, readings]) => {
      const deduped = uniqueLatestReadings(readings);
      const first = deduped[0];
      if (!first) {
        return null;
      }

      const localMeter = first.meterId ? meterById.get(first.meterId) ?? null : null;
      const meterType = first.meterType;
      if (meterType !== "ELECTRIC" && meterType !== "GAS") {
        return null;
      }

      return {
        key,
        meterType,
        localMeterId: first.meterId,
        localMeter,
        name:
          localMeter?.name ??
          (meterType === "ELECTRIC" ? "Primary Electric Meter" : "Primary Natural Gas Meter"),
        unit: localMeter?.unit ?? first.unit,
        readings: deduped,
      } satisfies PushableSeries;
    })
    .filter((series): series is PushableSeries => series != null);
}

async function loadRemoteMeters(espmClient: PortfolioManagerPushClient, propertyId: number) {
  const meterIds = parseMeterLinkIds(await espmClient.meter.listMeters(propertyId));
  return Promise.all(
    meterIds.map(async (meterId) =>
      parseMeterDetail(await espmClient.meter.getMeter(meterId), meterId),
    ),
  );
}

async function ensureRemoteMeter(input: {
  espmClient: PortfolioManagerPushClient;
  propertyId: number;
  series: PushableSeries;
  remoteMeters: MeterLinkSnapshot[];
  organizationId: string;
  buildingId: string;
}) {
  const existingLinked = input.series.localMeter?.espmMeterId
    ? Number(input.series.localMeter.espmMeterId)
    : null;

  const linkedRemote =
    existingLinked != null
      ? input.remoteMeters.find((meter) => meter.meterId === existingLinked) ?? null
      : null;

  if (linkedRemote) {
    return { meterId: linkedRemote.meterId, created: false };
  }

  const matchingRemote =
    input.remoteMeters.find(
      (meter) => meter.inUse && meter.meterType === input.series.meterType,
    ) ?? null;

  if (matchingRemote) {
    if (input.series.localMeter) {
      await prisma.meter.update({
        where: { id: input.series.localMeter.id },
        data: {
          espmMeterId: BigInt(matchingRemote.meterId),
        },
      });
    }

    return { meterId: matchingRemote.meterId, created: false };
  }

  const config = ESPM_METER_CREATE_CONFIG[input.series.meterType];
  const firstBillDate = formatDate(input.series.readings[0]!.periodStart);
  const createdRaw = await input.espmClient.meter.createMeter(input.propertyId, {
    type: config.type,
    name: input.series.name || config.defaultName,
    unitOfMeasure: config.unitOfMeasure,
    metered: true,
    firstBillDate,
    inUse: true,
  });

  const createdMeter = parseMeterDetail(createdRaw, input.propertyId);

  if (input.series.localMeter) {
    await prisma.meter.update({
      where: { id: input.series.localMeter.id },
      data: {
        espmMeterId: BigInt(createdMeter.meterId),
      },
    });
  } else {
    await prisma.meter.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        meterType: input.series.meterType,
        name: input.series.name || config.defaultName,
        unit: input.series.unit,
        isActive: true,
        espmMeterId: BigInt(createdMeter.meterId),
      },
    });
  }

  input.remoteMeters.push(createdMeter);
  return { meterId: createdMeter.meterId, created: true };
}

async function getExistingRemotePeriods(input: {
  espmClient: PortfolioManagerPushClient;
  meterId: number;
  readings: LocalEnergyReading[];
}) {
  const periodStart = input.readings[0]?.periodStart;
  const periodEnd = input.readings[input.readings.length - 1]?.periodEnd;
  if (!periodStart || !periodEnd) {
    return new Map<string, RemoteConsumptionRecord>();
  }

  const raw = await input.espmClient.consumption.getConsumptionData(input.meterId, {
    startDate: formatDate(periodStart),
    endDate: formatDate(periodEnd),
  });

  const record = toRecord(raw);
  const nodes =
    toRecord(record.meterData).meterConsumption ??
    toRecord(record.consumptionData).meterConsumption ??
    record.meterConsumption;

  const byPeriod = new Map<string, RemoteConsumptionRecord>();
  for (const node of toArray(nodes)) {
    const row = toRecord(node);
    const startDate = getString(row.startDate);
    const endDate = getString(row.endDate);
    if (startDate && endDate) {
      byPeriod.set(`${startDate}|${endDate}`, {
        id: getNumber(row.id) ?? 0,
        usage: getNumber(row.usage),
        cost: getNumber(row.cost),
      });
    }
  }

  return byPeriod;
}

export async function pushLocalEnergyToPortfolioManager(params: {
  organizationId: string;
  buildingId: string;
  reportingYear?: number;
  espmClient: PortfolioManagerPushClient;
  producedByType: ActorType;
  producedById?: string | null;
}) : Promise<PortfolioManagerPushResult> {
  const reportingYear = params.reportingYear ?? new Date().getUTCFullYear() - 1;

  const building = await prisma.building.findFirst({
    where: {
      id: params.buildingId,
      organizationId: params.organizationId,
    },
    select: {
      id: true,
      organizationId: true,
      espmPropertyId: true,
    },
  });

  if (!building) {
    throw new Error("Building not found for Portfolio Manager push");
  }

  const propertyId = building.espmPropertyId ? Number(building.espmPropertyId) : null;
  if (!propertyId) {
    throw new Error("Building is not linked to a Portfolio Manager property");
  }

  const [readings, localMeters] = await Promise.all([
    prisma.energyReading.findMany({
      where: {
        buildingId: params.buildingId,
        organizationId: params.organizationId,
        source: {
          not: "ESPM_SYNC",
        },
      },
      orderBy: [{ periodStart: "asc" }, { ingestedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        meterId: true,
        meterType: true,
        periodStart: true,
        periodEnd: true,
        consumption: true,
        unit: true,
        cost: true,
        source: true,
        ingestedAt: true,
      },
    }),
    prisma.meter.findMany({
      where: {
        buildingId: params.buildingId,
        organizationId: params.organizationId,
      },
      select: {
        id: true,
        meterType: true,
        name: true,
        unit: true,
        espmMeterId: true,
        isActive: true,
      },
    }),
  ]);

  const series = buildPushSeries({
    readings,
    localMeters,
  });

  if (series.length === 0) {
    throw new Error("No local electric or gas readings are available to push");
  }

  const remoteMeters = await loadRemoteMeters(params.espmClient, propertyId);
  const warnings: string[] = [];
  const meterMappings: PortfolioManagerPushResult["meterMappings"] = [];
  let metersCreated = 0;
  let readingsPrepared = 0;
  let readingsPushed = 0;
  let readingsUpdated = 0;
  let readingsSkippedExisting = 0;

  for (const item of series) {
    const meter = await ensureRemoteMeter({
      espmClient: params.espmClient,
      propertyId,
      series: item,
      remoteMeters,
      organizationId: params.organizationId,
      buildingId: params.buildingId,
    });
    if (meter.created) {
      metersCreated += 1;
    }

    const existingPeriods = await getExistingRemotePeriods({
      espmClient: params.espmClient,
      meterId: meter.meterId,
      readings: item.readings,
    });

    const entriesToCreate: Array<{
      startDate: string;
      endDate: string;
      usage: number;
      cost?: number;
    }> = [];
    const entriesToUpdate: Array<{
      id: number;
      startDate: string;
      endDate: string;
      usage: number;
      cost?: number;
    }> = [];

    for (const reading of item.readings) {
      const startDate = formatDate(reading.periodStart);
      const endDate = formatDate(reading.periodEnd);
      const key = `${startDate}|${endDate}`;
      const existing = existingPeriods.get(key);
      const desiredCost = reading.cost ?? existing?.cost ?? undefined;

      if (!existing || existing.id === 0) {
        entriesToCreate.push({
          startDate,
          endDate,
          usage: reading.consumption,
          ...(desiredCost !== undefined ? { cost: desiredCost } : {}),
        });
        continue;
      }

      const usageMatches =
        existing.usage != null && existing.usage === reading.consumption;
      const costMatches =
        desiredCost === undefined
          ? existing.cost == null
          : existing.cost === desiredCost;

      if (usageMatches && costMatches) {
        readingsSkippedExisting += 1;
        continue;
      }

      entriesToUpdate.push({
        id: existing.id,
        startDate,
        endDate,
        usage: reading.consumption,
        ...(desiredCost !== undefined ? { cost: desiredCost } : {}),
      });
    }

    readingsPrepared += item.readings.length;

    if (entriesToCreate.length > 0) {
      for (let index = 0; index < entriesToCreate.length; index += 120) {
        await params.espmClient.consumption.pushConsumptionData(
          meter.meterId,
          entriesToCreate.slice(index, index + 120),
        );
      }
      readingsPushed += entriesToCreate.length;
    }

    for (const entry of entriesToUpdate) {
      await params.espmClient.consumption.updateConsumptionData(entry.id, {
        startDate: entry.startDate,
        endDate: entry.endDate,
        usage: entry.usage,
        ...(entry.cost !== undefined ? { cost: entry.cost } : {}),
      });
    }
    readingsUpdated += entriesToUpdate.length;

    if (entriesToCreate.length === 0 && entriesToUpdate.length === 0) {
      warnings.push(
        `${item.name}: all ${item.readings.length} local readings already exist in Portfolio Manager`,
      );
    }

    meterMappings.push({
      seriesKey: item.key,
      meterType: item.meterType,
      espmMeterId: meter.meterId,
      created: meter.created,
      readingsPrepared: item.readings.length,
      readingsPushed: entriesToCreate.length,
      readingsUpdated: entriesToUpdate.length,
      readingsSkippedExisting:
        item.readings.length - entriesToCreate.length - entriesToUpdate.length,
    });
  }

  const syncResult = await syncPortfolioManagerForBuilding({
    organizationId: params.organizationId,
    buildingId: params.buildingId,
    reportingYear,
    espmClient: params.espmClient,
    producedByType: params.producedByType,
    producedById: params.producedById ?? null,
  });

  return {
    propertyId,
    reportingYear,
    metersCreated,
    meterMappings,
    totals: {
      seriesPrepared: series.length,
      readingsPrepared,
      readingsPushed,
      readingsUpdated,
      readingsSkippedExisting,
    },
    warnings,
    metrics: syncResult.metrics,
    syncState: syncResult.syncState,
  };
}
