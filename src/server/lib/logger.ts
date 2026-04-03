export interface LogContext {
  requestId?: string | null;
  jobId?: string | null;
  organizationId?: string | null;
  buildingId?: string | null;
  userId?: string | null;
  router?: string | null;
  procedure?: string | null;
  packetId?: string | null;
  syncPhase?: string | null;
  [key: string]: unknown;
}

type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogger {
  child(context: LogContext): StructuredLogger;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const SHOULD_LOG_DEBUG =
  process.env["LOG_LEVEL"] === "debug" || process.env["NODE_ENV"] !== "production";

function compactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

function serializeError(error: Error) {
  const record = compactRecord({
    name: error.name,
    message: error.message,
    stack: error.stack,
  });

  for (const key of [
    "code",
    "httpStatus",
    "retryable",
    "details",
    "statusCode",
    "espmErrorCode",
    "status",
    "reasonCode",
  ] as const) {
    const value = (error as unknown as Record<string, unknown>)[key];
    if (value !== undefined) {
      record[key] = serializeValue(value);
    }
  }

  return record;
}

function serializeValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    if (depth >= 5) {
      return "[array]";
    }

    return value.map((entry) => serializeValue(entry, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }

    if (depth >= 5) {
      return "[object]";
    }

    seen.add(value);
    const serialized = compactRecord(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          serializeValue(entry, depth + 1, seen),
        ]),
      ),
    );
    seen.delete(value);
    return serialized;
  }

  return String(value);
}

function writeLog(
  level: LogLevel,
  context: LogContext,
  message: string,
  fields?: Record<string, unknown>,
) {
  if (level === "debug" && !SHOULD_LOG_DEBUG) {
    return;
  }

  const entry = compactRecord({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(serializeValue(context) as Record<string, unknown>),
    ...(fields ? (serializeValue(fields) as Record<string, unknown>) : {}),
  });

  const line = JSON.stringify(entry);
  switch (level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

class JsonStructuredLogger implements StructuredLogger {
  constructor(private readonly context: LogContext = {}) {}

  child(context: LogContext): StructuredLogger {
    return new JsonStructuredLogger({
      ...this.context,
      ...compactRecord(context),
    });
  }

  debug(message: string, fields?: Record<string, unknown>) {
    writeLog("debug", this.context, message, fields);
  }

  info(message: string, fields?: Record<string, unknown>) {
    writeLog("info", this.context, message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>) {
    writeLog("warn", this.context, message, fields);
  }

  error(message: string, fields?: Record<string, unknown>) {
    writeLog("error", this.context, message, fields);
  }
}

export const logger: StructuredLogger = new JsonStructuredLogger();

export function createLogger(context?: LogContext) {
  return context ? logger.child(context) : logger;
}
