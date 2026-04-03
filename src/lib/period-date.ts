export function parsePeriodDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, yearText, monthText, dayText] = dateOnlyMatch;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatPeriodDate(value: string | Date | null | undefined) {
  if (!value) {
    return "—";
  }

  const parsed = parsePeriodDate(value);
  if (!parsed) {
    return "—";
  }

  return parsed.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatPeriodDateInputValue(value: string | Date | null | undefined) {
  if (!value) {
    return "";
  }

  const parsed = parsePeriodDate(value);
  if (!parsed) {
    return "";
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatPeriodDateRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
) {
  const formattedStart = formatPeriodDate(start);
  const formattedEnd = formatPeriodDate(end);
  if (formattedStart === "—" || formattedEnd === "—") {
    return "No approved periods selected";
  }

  return `${formattedStart} to ${formattedEnd}`;
}
