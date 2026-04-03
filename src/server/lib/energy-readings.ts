type EnergyReadingLike = {
  id?: string;
  meterId?: string | null;
  meterType: string;
  source: string;
  periodStart: Date;
  periodEnd: Date;
  ingestedAt?: Date;
  rawPayload?: unknown;
  archivedAt?: Date | null;
};

function getOverrideOfReadingId(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const value = (rawPayload as Record<string, unknown>)["overrideOfReadingId"];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readingKey(reading: EnergyReadingLike) {
  return [
    reading.meterId ?? "no-meter",
    reading.meterType,
    reading.source,
    reading.periodStart.toISOString(),
    reading.periodEnd.toISOString(),
  ].join("|");
}

function displayReadingKey(reading: EnergyReadingLike) {
  return [
    reading.meterId ?? "no-meter",
    reading.meterType,
    reading.periodStart.toISOString(),
    reading.periodEnd.toISOString(),
  ].join("|");
}

function sourcePriority(source: string) {
  switch (source) {
    case "MANUAL":
      return 4;
    case "CSV_UPLOAD":
    case "BILL_UPLOAD":
      return 3;
    case "GREEN_BUTTON":
      return 2;
    case "ESPM_SYNC":
      return 1;
    default:
      return 0;
  }
}

export function dedupeEnergyReadings<T extends EnergyReadingLike>(readings: T[]) {
  const latestByKey = new Map<string, T>();

  for (const reading of readings) {
    if (reading.archivedAt != null) {
      continue;
    }
    const key = readingKey(reading);
    const current = latestByKey.get(key);

    if (!current) {
      latestByKey.set(key, reading);
      continue;
    }

    const readingTime = reading.ingestedAt?.getTime() ?? 0;
    const currentTime = current.ingestedAt?.getTime() ?? 0;

    if (readingTime > currentTime) {
      latestByKey.set(key, reading);
      continue;
    }

    if (
      readingTime === currentTime &&
      (reading.id ?? "").localeCompare(current.id ?? "") > 0
    ) {
      latestByKey.set(key, reading);
    }
  }

  return Array.from(latestByKey.values()).sort((left, right) => {
    const byPeriod = left.periodStart.getTime() - right.periodStart.getTime();
    if (byPeriod !== 0) {
      return byPeriod;
    }

    const byEnd = left.periodEnd.getTime() - right.periodEnd.getTime();
    if (byEnd !== 0) {
      return byEnd;
    }

    return left.meterType.localeCompare(right.meterType);
  });
}

export function collapseDisplayEnergyReadings<T extends EnergyReadingLike>(readings: T[]) {
  const selectedByKey = new Map<string, T>();

  for (const reading of readings) {
    if (reading.archivedAt != null) {
      continue;
    }
    const key = displayReadingKey(reading);
    const current = selectedByKey.get(key);

    if (!current) {
      selectedByKey.set(key, reading);
      continue;
    }

    const readingPriority = sourcePriority(reading.source);
    const currentPriority = sourcePriority(current.source);

    if (readingPriority > currentPriority) {
      selectedByKey.set(key, reading);
      continue;
    }

    if (readingPriority < currentPriority) {
      continue;
    }

    const readingTime = reading.ingestedAt?.getTime() ?? 0;
    const currentTime = current.ingestedAt?.getTime() ?? 0;

    if (readingTime > currentTime) {
      selectedByKey.set(key, reading);
      continue;
    }

    if (
      readingTime === currentTime &&
      (reading.id ?? "").localeCompare(current.id ?? "") > 0
    ) {
      selectedByKey.set(key, reading);
    }
  }

  const overriddenReadingIds = new Set(
    Array.from(selectedByKey.values())
      .map((reading) => getOverrideOfReadingId(reading.rawPayload))
      .filter((value): value is string => value != null),
  );

  return Array.from(selectedByKey.values())
    .filter((reading) => !overriddenReadingIds.has(reading.id ?? ""))
    .sort((left, right) => {
    const byPeriod = left.periodStart.getTime() - right.periodStart.getTime();
    if (byPeriod !== 0) {
      return byPeriod;
    }

    const byEnd = left.periodEnd.getTime() - right.periodEnd.getTime();
    if (byEnd !== 0) {
      return byEnd;
    }

      return left.meterType.localeCompare(right.meterType);
    });
}
