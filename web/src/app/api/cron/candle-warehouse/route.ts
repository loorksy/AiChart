import { NextRequest, NextResponse } from "next/server";
import {
  maintainCandleSeries,
  pickWarehouseFeederUserId,
} from "@/lib/candles/candleBackfillService";
import { buildWarehouseCompletenessReport } from "@/lib/candles/candleCompleteness";
import {
  listWarehouseSeries,
  pruneExpiredCandles,
} from "@/lib/candles/candleRepository";
import { pruneExpiredAnalysisCandles } from "@/lib/candles/analysisCandleRepository";
import { maintainAnalysisCandleSeries } from "@/lib/candles/oandaBackfillService";
import { listWarmDemand } from "@/lib/candles/warmDemand";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { isKnownForexSymbol } from "@/lib/markets/forexInstruments";
import {
  isCanonicalInterval,
  normalizeCanonicalInterval,
} from "@/lib/markets/intervals";
import { oandaConfigured } from "@/lib/markets/oanda";
import { getFlag, logAudit, setFlag } from "@/lib/store";

export const maxDuration = 300;

const log = createLogger("cron:candle-warehouse");
// 30m included: it is a research backtest timeframe — without warehouse
// maintenance no 30m strategy deployment can ever accumulate history.
const DEFAULT_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
const LEADER_LOCK_MS = 290_000;
const SERIES_CURSOR_FLAG = "candle_warehouse_series_cursor";
const OANDA_SERIES_CURSOR_FLAG = "candle_warehouse_oanda_series_cursor";

function configuredSeries(): Array<{ symbol: string; interval: string }> {
  const symbols = (process.env.CANDLE_SYNC_SYMBOLS ?? "")
    .split(",")
    .map((value) => forexCanonicalKey(value))
    // Permissive shape (indices/crypto later); the registry is the real gate.
    .filter((value) => /^[A-Z0-9]{3,10}$/.test(value) && isKnownForexSymbol(value));
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

/** Read-only coverage report: first/last candle + gap counts per series. */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const symbol = req.nextUrl.searchParams.get("symbol") || undefined;
  const interval = req.nextUrl.searchParams.get("interval") || undefined;
  const report = await buildWarehouseCompletenessReport({
    symbols: symbol ? [symbol] : undefined,
    intervals: interval ? [interval] : undefined,
    repair: false,
  });
  return NextResponse.json({ ok: true, ...report });
}

type MtPhaseResult =
  | { skipped: "no_feeder_account" }
  | {
      configured: number;
      processed: number;
      pruned: number;
      results: Awaited<ReturnType<typeof maintainCandleSeries>>[];
      completeness: Awaited<ReturnType<typeof buildWarehouseCompletenessReport>>;
    };

/**
 * MetaTrader-fed warehouse maintenance. History pulls ride a linked
 * MetaTrader "feeder" account — there is no platform feed for it. Without a
 * feeder account there is nothing to fetch with, so this phase alone skips;
 * it must never gate the independent OANDA phase below.
 */
async function runMtPhase(): Promise<MtPhaseResult> {
  if ((await pickWarehouseFeederUserId()) == null) {
    log.info("no linked MetaTrader feeder account — MT warehouse phase skipped");
    return { skipped: "no_feeder_account" };
  }

  // Three sources, in priority order. The operator's pinned list first, then
  // series the platform was actually asked for but could not serve from the
  // warehouse, then everything already stored.
  //
  // Demand matters because the pinned list is gated on a 17-entry registry
  // while analysis is open to every symbol the linked broker offers. Without
  // it, a pair outside the registry whose first cold pull failed outright
  // would never store a row, never appear in listWarehouseSeries, and so
  // stay cold on every future analysis.
  const allSeries = dedupeSeries([
    ...configuredSeries(),
    ...(await listWarmDemand()).map(({ symbol, interval }) => ({
      symbol,
      interval,
    })),
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

  // Completeness for the series touched this run — repair gaps + clear log.
  const completeness = await buildWarehouseCompletenessReport({
    symbols: [...new Set(selected.map((item) => item.symbol))],
    intervals: [...new Set(selected.map((item) => item.interval))],
    repair: true,
    maxSeries: selected.length || 1,
  });
  for (const row of completeness.series) {
    log.info("warehouse coverage", {
      symbol: row.symbol,
      interval: row.interval,
      firstCandleAt: row.firstCandleAt,
      lastCandleAt: row.lastCandleAt,
      barCount: row.barCount,
      depthComplete: row.depthComplete,
      gapCount: row.gapCount,
      missingBars: row.missingBars,
      repairedGaps: row.repairedGaps,
    });
  }

  return {
    configured: allSeries.length,
    processed: selected.length,
    pruned,
    results,
    completeness,
  };
}

type OandaPhaseResult =
  | { skipped: "oanda_not_configured" }
  | {
      configured: number;
      processed: number;
      pruned: number;
      results: Awaited<ReturnType<typeof maintainAnalysisCandleSeries>>[];
    };

/**
 * OANDA-fed analysis-only warehouse maintenance (`source='oanda'` rows,
 * written exclusively through `oandaBackfillService.ts`). Gated ONLY on
 * `oandaConfigured()` — deliberately independent of the MT phase's feeder
 * guard above, since OANDA answers to one platform-level credential and has
 * nothing to do with any linked MetaTrader account. Reuses the exact same
 * pinned symbol/interval list the MT phase reads from (`CANDLE_SYNC_SYMBOLS`
 * / `CANDLE_SYNC_INTERVALS`) rather than a second parallel list.
 */
async function runOandaPhase(): Promise<OandaPhaseResult> {
  if (!oandaConfigured()) {
    return { skipped: "oanda_not_configured" };
  }

  const allSeries = configuredSeries();
  const requestedLimit = Number(process.env.CANDLE_SYNC_MAX_SERIES ?? "6");
  const maxSeries = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50)
    : 6;
  const storedCursor = Number(await getFlag(OANDA_SERIES_CURSOR_FLAG));
  const start = allSeries.length
    ? (Number.isSafeInteger(storedCursor) ? storedCursor : 0) % allSeries.length
    : 0;
  const selected = Array.from(
    { length: Math.min(maxSeries, allSeries.length) },
    (_, index) => allSeries[(start + index) % allSeries.length]!,
  );
  const results = [];
  for (const series of selected) {
    results.push(await maintainAnalysisCandleSeries(series));
  }
  if (allSeries.length) {
    await setFlag(
      OANDA_SERIES_CURSOR_FLAG,
      String((start + selected.length) % allSeries.length),
    );
  }
  const pruned = await pruneExpiredAnalysisCandles();
  for (const row of results) {
    log.info("oanda analysis coverage", {
      symbol: row.symbol,
      interval: row.interval,
      latestInserted: row.latestInserted,
      historicalInserted: row.historicalInserted,
      repairedGaps: row.repairedGaps,
      coverage: row.coverage,
    });
  }

  return {
    configured: allSeries.length,
    processed: selected.length,
    pruned,
    results,
  };
}

/**
 * Incrementally fills years of broker history (pulled through a linked
 * MetaTrader "feeder" account), repairs recent open-market gaps, applies
 * 5-year retention, and emits a completeness report (first/last/gaps) for
 * the chart-facing MT warehouse — then does the same, independently, for the
 * OANDA-fed analysis-only warehouse (never blocked by the MT feeder guard).
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await withLock("cron:candle-warehouse", LEADER_LOCK_MS, async () => {
    const mt = await runMtPhase();
    const oanda = await runOandaPhase();
    return { mt, oanda };
  });

  if (!run.ran) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  const { mt, oanda } = run.result;
  const mtGaps =
    "completeness" in mt
      ? mt.completeness.series.reduce((n, s) => n + s.gapCount, 0)
      : 0;
  await logAudit(
    null,
    "cron_candle_warehouse",
    `mt_processed=${"processed" in mt ? mt.processed : 0} mt_pruned=${"pruned" in mt ? mt.pruned : 0} mt_gaps=${mtGaps} ` +
      `oanda_processed=${"processed" in oanda ? oanda.processed : 0} oanda_pruned=${"pruned" in oanda ? oanda.pruned : 0}`,
  );
  return NextResponse.json({ ok: true, mt, oanda });
}
