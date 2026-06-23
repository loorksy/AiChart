/**
 * Central error capture. Always emits a structured error log; additionally
 * forwards to Sentry when SENTRY_DSN is configured (lazy-initialized, so the
 * dependency is inert in dev / when unset). Use captureError in catch blocks of
 * background paths (cron, worker, agent) that would otherwise swallow failures.
 */
import { createLogger, type LogFields } from "./logger";

const log = createLogger("error");

type Sentry = typeof import("@sentry/node");
let sentry: Sentry | null = null;
let initialized = false;

async function ensureSentry(): Promise<Sentry | null> {
  if (initialized) return sentry;
  initialized = true;
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return null;
  try {
    const S = await import("@sentry/node");
    S.init({
      dsn,
      environment: process.env.NODE_ENV ?? "production",
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
    });
    sentry = S;
    log.info("Sentry error reporting enabled");
  } catch (e) {
    log.error("Sentry init failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return sentry;
}

export async function captureError(
  err: unknown,
  context?: LogFields,
): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  log.error(e.message, { ...context, stack: e.stack });
  const s = await ensureSentry();
  if (s) {
    s.captureException(e, context ? { extra: context } : undefined);
  }
}

/** Fire-and-forget variant for synchronous catch blocks. */
export function reportError(err: unknown, context?: LogFields): void {
  void captureError(err, context);
}

/** Whether error forwarding to Sentry is configured. */
export function errorReportingEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN?.trim());
}
