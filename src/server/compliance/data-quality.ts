import {
  DATA_QUALITY_ISSUE_TYPES,
  DataQualityError,
} from "@/server/lib/errors";

export interface BenchmarkCoverageRecord {
  periodStart: Date;
  periodEnd: Date;
  meterId?: string | null;
  meterType?: string | null;
}

export interface CoverageIssue {
  streamKey: string;
  start: string;
  end: string;
  days: number;
}

export const DATA_QUALITY_VERDICT = {
  PASS: "PASS",
  WARN: "WARN",
  FAIL: "FAIL",
} as const;

export type DataQualityVerdict =
  (typeof DATA_QUALITY_VERDICT)[keyof typeof DATA_QUALITY_VERDICT];

export interface BenchmarkYearDataValidationResult {
  verdict: DataQualityVerdict;
  coverageComplete: boolean;
  missingCoverageStreams: string[];
  overlapStreams: string[];
  gapDetails: CoverageIssue[];
  overlapDetails: CoverageIssue[];
  streamCoverage: Array<{
    streamKey: string;
    firstStart: string | null;
    lastEnd: string | null;
    readingCount: number;
  }>;
  coveredMonths: number[];
  missingMonths: number[];
  issues: DataQualityError[];
}

function toUtcDateOnly(value: Date) {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    ),
  );
}

function addUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function daysBetweenInclusive(start: Date, end: Date) {
  return (
    Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
  );
}

function buildStreamKey(record: BenchmarkCoverageRecord) {
  if (record.meterId) {
    return `meter:${record.meterId}`;
  }

  return `meterType:${record.meterType ?? "UNKNOWN"}`;
}

function monthRange(reportingYear: number, monthIndex: number) {
  return {
    month: monthIndex + 1,
    start: new Date(Date.UTC(reportingYear, monthIndex, 1)),
    end: new Date(Date.UTC(reportingYear, monthIndex + 1, 0)),
  };
}

function overlapsRange(
  recordStart: Date,
  recordEnd: Date,
  rangeStart: Date,
  rangeEnd: Date,
) {
  return recordStart <= rangeEnd && recordEnd >= rangeStart;
}

export function validateBenchmarkYearData(
  records: BenchmarkCoverageRecord[],
  reportingYear: number,
): BenchmarkYearDataValidationResult {
  const yearStart = new Date(Date.UTC(reportingYear, 0, 1));
  const yearEnd = new Date(Date.UTC(reportingYear, 11, 31));

  if (records.length === 0) {
    const allMonths = Array.from({ length: 12 }, (_, index) => index + 1);
    return {
      verdict: DATA_QUALITY_VERDICT.FAIL,
      coverageComplete: false,
      missingCoverageStreams: ["all"],
      overlapStreams: [],
      gapDetails: [
        {
          streamKey: "all",
          start: yearStart.toISOString(),
          end: yearEnd.toISOString(),
          days: daysBetweenInclusive(yearStart, yearEnd),
        },
      ],
      overlapDetails: [],
      streamCoverage: [],
      coveredMonths: [],
      missingMonths: allMonths,
      issues: [
        new DataQualityError(
          DATA_QUALITY_ISSUE_TYPES.MISSING_MONTHS,
          "Benchmark year data is missing all reporting months.",
          {
            details: {
              reportingYear,
              missingMonths: allMonths,
            },
          },
        ),
        new DataQualityError(
          DATA_QUALITY_ISSUE_TYPES.INCOMPLETE_TWELVE_MONTH_COVERAGE,
          "Benchmark year data does not provide complete Jan 1-Dec 31 coverage.",
          {
            details: {
              reportingYear,
              missingCoverageStreams: ["all"],
            },
          },
        ),
      ],
    };
  }

  const grouped = new Map<string, BenchmarkCoverageRecord[]>();
  for (const record of records) {
    const streamKey = buildStreamKey(record);
    const existing = grouped.get(streamKey) ?? [];
    existing.push(record);
    grouped.set(streamKey, existing);
  }

  const missingCoverageStreams = new Set<string>();
  const overlapStreams = new Set<string>();
  const gapDetails: CoverageIssue[] = [];
  const overlapDetails: CoverageIssue[] = [];
  const streamCoverage: BenchmarkYearDataValidationResult["streamCoverage"] = [];

  for (const [streamKey, streamRecords] of Array.from(grouped.entries())) {
    const sorted = [...streamRecords].sort(
      (left, right) => left.periodStart.getTime() - right.periodStart.getTime(),
    );

    let cursor = yearStart;
    for (const record of sorted) {
      const rawStart = toUtcDateOnly(record.periodStart);
      const rawEnd = toUtcDateOnly(record.periodEnd);
      const start = rawStart < yearStart ? yearStart : rawStart;
      const end = rawEnd > yearEnd ? yearEnd : rawEnd;

      if (start > cursor) {
        missingCoverageStreams.add(streamKey);
        gapDetails.push({
          streamKey,
          start: cursor.toISOString(),
          end: addUtcDays(start, -1).toISOString(),
          days: daysBetweenInclusive(cursor, addUtcDays(start, -1)),
        });
      }

      // Treat an exact boundary match as continuous coverage.
      // Utility periods can legitimately be represented as:
      // previous.end === next.start
      if (start < addUtcDays(cursor, -1)) {
        overlapStreams.add(streamKey);
        overlapDetails.push({
          streamKey,
          start: start.toISOString(),
          end: end.toISOString(),
          days: daysBetweenInclusive(start, end),
        });
      }

      const nextCursor = addUtcDays(end, 1);
      if (nextCursor > cursor) {
        cursor = nextCursor;
      }
    }

    if (cursor <= yearEnd) {
      missingCoverageStreams.add(streamKey);
      gapDetails.push({
        streamKey,
        start: cursor.toISOString(),
        end: yearEnd.toISOString(),
        days: daysBetweenInclusive(cursor, yearEnd),
      });
    }

    streamCoverage.push({
      streamKey,
      firstStart: sorted[0]
        ? toUtcDateOnly(sorted[0].periodStart).toISOString()
        : null,
      lastEnd: sorted.at(-1)
        ? toUtcDateOnly(sorted.at(-1)!.periodEnd).toISOString()
        : null,
      readingCount: sorted.length,
    });
  }

  const coveredMonths = Array.from(
    new Set(
      records.flatMap((record) =>
        Array.from({ length: 12 }, (_, monthIndex) => monthRange(reportingYear, monthIndex))
          .filter(({ start, end }) =>
            overlapsRange(
              toUtcDateOnly(record.periodStart),
              toUtcDateOnly(record.periodEnd),
              start,
              end,
            ),
          )
          .map(({ month }) => month),
      ),
    ),
  ).sort((left, right) => left - right);

  const missingMonths = Array.from({ length: 12 }, (_, index) => index + 1).filter(
    (month) => !coveredMonths.includes(month),
  );

  const issues: DataQualityError[] = [];
  if (missingMonths.length > 0) {
    issues.push(
      new DataQualityError(
        DATA_QUALITY_ISSUE_TYPES.MISSING_MONTHS,
        "Benchmark year data is missing one or more reporting months.",
        {
          details: {
            reportingYear,
            missingMonths,
            coveredMonths,
          },
        },
      ),
    );
  }

  if (overlapStreams.size > 0) {
    issues.push(
      new DataQualityError(
        DATA_QUALITY_ISSUE_TYPES.OVERLAPPING_PERIODS,
        "Benchmark year data contains overlapping billing periods.",
        {
          details: {
            reportingYear,
            overlapStreams: Array.from(overlapStreams),
            overlapDetails,
          },
        },
      ),
    );
  }

  if (missingCoverageStreams.size > 0 || overlapStreams.size > 0) {
    issues.push(
      new DataQualityError(
        DATA_QUALITY_ISSUE_TYPES.INCOMPLETE_TWELVE_MONTH_COVERAGE,
        "Benchmark year data does not provide complete Jan 1-Dec 31 coverage.",
        {
          details: {
            reportingYear,
            missingCoverageStreams: Array.from(missingCoverageStreams),
            overlapStreams: Array.from(overlapStreams),
            gapDetails,
            overlapDetails,
          },
        },
      ),
    );
  }

  return {
    verdict:
      issues.length === 0
        ? DATA_QUALITY_VERDICT.PASS
        : DATA_QUALITY_VERDICT.FAIL,
    coverageComplete:
      missingCoverageStreams.size === 0 && overlapStreams.size === 0,
    missingCoverageStreams: Array.from(missingCoverageStreams),
    overlapStreams: Array.from(overlapStreams),
    gapDetails,
    overlapDetails,
    streamCoverage,
    coveredMonths,
    missingMonths,
    issues,
  };
}
