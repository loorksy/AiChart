import { NextRequest, NextResponse } from "next/server";
import { maintainCandleSeries } from "@/lib/candles/candleBackfillService";
import {
  listWarehouseSeries,
  pruneExpiredCandles,
} from "@/lib/candles/candleRepository";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import {
  isCanonicalInterval,
  normalizeCanonicalInterval,
} from "@/lib/markets/intervals";
import { getFlag, logAudit, setFlag } from "@/lib/store";

export const maxDuration = 300;

const DEFAULT_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const LEADER_LOCK_MS = 290_000;
const SERIES_CURSOR_FLAG = "candle_warehouse_series_cursor";

function configuredSeries(): Array<{ symbol: string; interval: string }> {
  const symbols = (process.env.CANDLE_SYNC_SYMBOLS ?? "")
    .split(",")
    .map((value) => forexCanonicalKey(value))
    .filter((value) => /^[A-Z]{6}$/.test(value));
  const configuredIntervals = (process.env.CANDLE_SYNC_INTERVALS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const intervals = configuredIntervals.length
    ? configuredIntervals
        .filter(isCanonicalInterval)
        .map((value) => normalizeCanonicalInterval(value))
    : [...DEFAULT_INTERVALS];
  return symbols.flatMap((symbol) =>
    intervals.map((interval) => ({ symbol, interval })),
  );
}

function dedupeSeries(
  series: Array<{ symbol: string; interval: string }>,
): Array<{ symbol: string; interval: string }> {
  const unique = new Map<string, { symbol: string; interval: string }>();
  for (const item of series) {
    const symbol = forexCanonicalKey(item.symbol);
    const interval = normalizeCanonicalInterval(item.interval);
    unique.set(`${symbol}:${interval}`, { symbol, interval });
  }
  return [...unique.values()];
}

/**
 * Incrementally fills years of OANDA history, repairs recent open-market gaps,
 * and applies retention. It is bounded per invocation and resumes from the
 * oldest stored candle on the next cron run.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await withLock("cron:candle-warehouse", LEADER_LOCK_MS, async () => {
    const allSeries = dedupeSeries([
      ...configuredSeries(),
      ...(await listWarehouseSeries()),
    ]);
    const requestedLimit = Number(process.env.CANDLE_SYNC_MAX_SERIES ?? "6");
    const maxSeries = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50)
      : 6;
    const storedCursor = Number(await getFlag(SERIES_CURSOR_FLAG));
    const start = allSeries.length
      ? (Number.isSafeInteger(storedCursor) ? storedCursor : 0) % allSeries.length
      : 0;
    const selected = Array.from(
      { length: Math.min(maxSeries, allSeries.length) },
      (_, index) => allSeries[(start + index) % allSeries.length]!,
    );
    const results = [];
    for (const series of selected) {
      results.push(await maintainCandleSeries(series));
    }
    if (allSeries.length) {
      await setFlag(
        SERIES_CURSOR_FLAG,
        String((start + selected.length) % allSeries.length),
      );
    }
    const pruned = await pruneExpiredCandles();
    return {
      configured: allSeries.length,
      processed: selected.length,
      pruned,
      results,
    };
  });

  if (!run.ran) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  await logAudit(
    null,
    "cron_candle_warehouse",
    `processed=${run.result.processed} pruned=${run.result.pruned}`,
  );
  return NextResponse.json({ ok: true, ...run.result });
}
