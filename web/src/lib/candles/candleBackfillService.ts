/**
 * Candle backfill — the ONLY writer into the warehouse from OANDA.
 *
 * A user request never performs a huge historical backfill inline: it reads
 * what the warehouse has and fires `triggerBackfill` (fire-and-forget) to top
 * up in the background. Concurrency is guarded twice: an in-process Set dedupes
 * within one instance, and a DB lease lock (locks table) dedupes across web
 * replicas / the worker so two processes never hammer OANDA for the same range.
 */
import { fetchOandaCandles } from "@/lib/markets/oanda";
import { acquireLock, releaseLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import { upsertCandles } from "./candleRepository";

const log = createLogger("candles:backfill");

/** Same-instance in-flight guard (cheap, avoids the DB round-trip on dupes). */
const activeBackfills = new Set<string>();
/** DB lease TTL — long enough for a 5000-candle OANDA page + write. */
const LOCK_TTL_MS = 30_000;
const MAX_BACKFILL = 5000;

export interface BackfillParams {
  symbol: string;
  interval: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

export interface BackfillResult {
  inserted: number;
  skipped: boolean;
  reason?: "in_flight" | "locked" | "oanda_error";
}

function backfillKey(p: BackfillParams): string {
  const symbol = forexCanonicalKey(p.symbol);
  const interval = normalizeCanonicalInterval(p.interval);
  return `candle-backfill:${symbol}:${interval}:${p.fromMs ?? "none"}:${p.toMs ?? "none"}`;
}

/**
 * Synchronous-awaitable backfill. Pulls the requested window from OANDA and
 * upserts it. Double-guarded (in-process Set + DB lease). Safe to await when a
 * request genuinely needs the data now (small windows only).
 */
export async function backfillCandles(
  params: BackfillParams,
): Promise<BackfillResult> {
  const key = backfillKey(params);
  if (activeBackfills.has(key)) {
    return { inserted: 0, skipped: true, reason: "in_flight" };
  }
  activeBackfills.add(key);

  // Cross-instance lease: if another replica/worker holds it, skip quietly.
  const lock = await acquireLock(key, LOCK_TTL_MS).catch(() => null);
  if (!lock) {
    activeBackfills.delete(key);
    return { inserted: 0, skipped: true, reason: "locked" };
  }

  try {
    const symbol = forexCanonicalKey(params.symbol);
    const interval = normalizeCanonicalInterval(params.interval);
    const count = Math.min(params.limit ?? MAX_BACKFILL, MAX_BACKFILL);

    const { candles } = await fetchOandaCandles(symbol, interval, count, {
      fromMs: params.fromMs,
      toMs: params.toMs,
    });

    if (!candles.length) {
      return { inserted: 0, skipped: false };
    }

    const inserted = await upsertCandles(symbol, interval, candles);
    log.debug("backfilled", { symbol, interval, inserted });
    return { inserted, skipped: false };
  } catch (error) {
    log.error("backfill failed", {
      symbol: params.symbol,
      interval: params.interval,
      error: error instanceof Error ? error.message : String(error),
    });
    return { inserted: 0, skipped: true, reason: "oanda_error" };
  } finally {
    await releaseLock(lock).catch(() => {});
    activeBackfills.delete(key);
  }
}

/** Fire-and-forget backfill — never blocks the caller, swallows failures. */
export function triggerBackfill(params: BackfillParams): void {
  void backfillCandles(params).catch((error) => {
    log.error("triggerBackfill rejected", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
