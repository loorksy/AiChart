/**
 * Minimal structured logger. Cloud log aggregators (CloudWatch, Loki, Datadog)
 * need machine-parseable lines with a level, scope and context fields; ad-hoc
 * console.log strings cannot be filtered or correlated. In production it emits
 * one JSON object per line; in dev it stays human-readable.
 *
 * Usage:
 *   const log = createLogger("cron:scalp");
 *   log.info("cycle done", { sessions, events });
 *   const reqLog = log.child({ requestId });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function thresholdWeight(): number {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
  return LEVEL_WEIGHT[raw] ?? LEVEL_WEIGHT.info;
}

function asJson(): boolean {
  const fmt = process.env.LOG_FORMAT?.toLowerCase();
  if (fmt === "json") return true;
  if (fmt === "pretty") return false;
  return process.env.NODE_ENV === "production";
}

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Derive a logger that always includes `fields` (e.g. a request/user id). */
  child(fields: LogFields): Logger;
}

function emit(
  scope: string,
  base: LogFields,
  level: LogLevel,
  msg: string,
  fields?: LogFields,
): void {
  if (LEVEL_WEIGHT[level] < thresholdWeight()) return;
  const merged = { ...base, ...fields };
  const sink =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;

  if (asJson()) {
    sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        scope,
        msg,
        ...merged,
      }),
    );
    return;
  }
  const tail = Object.keys(merged).length
    ? " " +
      Object.entries(merged)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
    : "";
  sink(`[${level}] [${scope}] ${msg}${tail}`);
}

export function createLogger(scope: string, base: LogFields = {}): Logger {
  return {
    debug: (msg, fields) => emit(scope, base, "debug", msg, fields),
    info: (msg, fields) => emit(scope, base, "info", msg, fields),
    warn: (msg, fields) => emit(scope, base, "warn", msg, fields),
    error: (msg, fields) => emit(scope, base, "error", msg, fields),
    child: (fields) => createLogger(scope, { ...base, ...fields }),
  };
}
