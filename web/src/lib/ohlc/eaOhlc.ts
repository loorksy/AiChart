import { queueEaGetOhlc } from "@/lib/eaAgentCommands";
import { barDurationMs, normalizeInterval } from "@/lib/intervals";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";

/** EA get_ohlc hard cap per request (ack payload size). */
export const EA_OHLC_MAX = 500;

/** Timeframes the EA bridge serves natively (MT5 periods). */
const EA_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);

export function eaSupportsInterval(interval: string): boolean {
  return EA_INTERVALS.has(normalizeInterval(interval));
}

/**
 * Candles straight from the user's broker terminal via the EA bridge.
 * History pagination: `start` = bar offset back from the newest bar,
 * derived from the requested window (EA v4.02+; older EAs serve page 0 only).
 */
export async function fetchEaOhlc(
  userId: number,
  symbol: string,
  interval: string,
  opts: { fromMs?: number; toMs?: number; limit?: number } = {},
): Promise<{ candles: OhlcCandle[]; warning?: string }> {
  const iv = normalizeInterval(interval);
  if (!EA_INTERVALS.has(iv)) {
    return { candles: [], warning: `الإطار ${iv} غير مدعوم من جسر الوسيط.` };
  }

  const barMs = barDurationMs(iv) || 60_000;
  const now = Date.now();
  const toMs = Math.min(opts.toMs ?? now, now);
  const hasRange = opts.fromMs != null && opts.fromMs < toMs;
  // Clamp the window to ≤ the EA per-request cap (in bar-time; gaps only
  // shrink the real bar count, never overflow it).
  const fromMs = hasRange
    ? Math.max(opts.fromMs!, toMs - EA_OHLC_MAX * barMs)
    : undefined;

  const count = Math.min(EA_OHLC_MAX, Math.max(10, opts.limit ?? 300));

  // v4.03+: exact epoch-second range — bar-offset math drifts across weekend
  // gaps and left holes in the chart. Older EAs ignore from/to and return the
  // newest page (degraded but safe).
  const ack = await queueEaGetOhlc(
    userId,
    {
      symbol,
      timeframe: iv,
      count,
      ...(hasRange
        ? {
            from: Math.floor(fromMs! / 1000),
            to: Math.ceil(toMs / 1000),
          }
        : {}),
    },
    20_000,
  );
  if (!ack.ok || !ack.result) {
    return {
      candles: [],
      warning: ack.reason ?? "جسر الوسيط لم يستجب — تأكد أن MetaTrader يعمل.",
    };
  }

  const raw = (ack.result.candles ?? []) as Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>;

  const candles: OhlcCandle[] = raw
    .filter((c) => Number.isFinite(c.time) && c.time > 0)
    .map((c) => ({
      // EA emits epoch seconds; fetchOhlc consumers expect ms.
      time: c.time * 1000,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume ?? 0),
    }))
    .sort((a, b) => a.time - b.time);

  return { candles };
}
