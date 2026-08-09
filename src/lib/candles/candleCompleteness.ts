/**
 * Historical warehouse completeness: depth vs configured years, open-market
 * gap detection across the full stored span, and optional gap auto-repair.
 */
import { barDurationMs } from "@/lib/intervals";
import { createLogger } from "@/lib/logger";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { isKnownForexSymbol } from "@/lib/markets/forexInstruments";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import { backfillCandles, MAX_BACKFILL } from "./candleBackfillService";
import {
  candleHistoryYears,
  targetHistoryStartMs,
} from "./candleHistoryPolicy";
import {
  detectCandleGaps,
  getCandles,
  getCoverage,
  listWarehouseSeries,
  MAX_READ_LIMIT,
  type CandleGap,
  type WarehouseCoverage,
} from "./candleRepository";

const log = createLogger("candles:completeness");

export interface SeriesCompletenessReport {
  symbol: string;
  interval: string;
  firstCandleAt: string | null;
  lastCandleAt: string | null;
  barCount: number;
  targetStartAt: string;
  targetYears: number;
  depthComplete: boolean;
  gapCount: number;
  missingBars: number;
  largestGaps: Array<{
    from: string;
    to: string;
    missingBars: number;
  }>;
  repairedGaps: number;
  errors: string[];
}

export interface WarehouseCompletenessReport {
  generatedAt: string;
  targetYears: number;
  series: SeriesCompletenessReport[];
}

export { targetHistoryStartMs } from "./candleHistoryPolicy";

function iso(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Merge overlapping / adjacent gap ranges produced by windowed scans. */
export function mergeCandleGaps(gaps: readonly CandleGap[]): CandleGap[] {
  if (!gaps.length) return [];
  const sorted = [...gaps].sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs);
  const merged: CandleGap[] = [{ ...sorted[0]! }];
  for (const gap of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (gap.fromMs <= last.toMs + 1) {
      last.toMs = Math.max(last.toMs, gap.toMs);
      last.missingBars = Math.max(last.missingBars, gap.missingBars);
      // Recompute missingBars approximately from span when overlapping.
      // Prefer the larger estimate; exact recount happens on next scan.
    } else {
      merged.push({ ...gap });
    }
  }
  return merged;
}

/**
 * Page ascending through [fromMs, toMs] and detect open-market gaps.
 * Bounded by maxPages to keep cron invocations finite.
 */
export async function scanSeriesGaps(input: {
  symbol: string;
  interval: string;
  fromMs: number;
  toMs: number;
  maxPages?: number;
}): Promise<{ gaps: CandleGap[]; pages: number; truncated: boolean }> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const step = barDurationMs(interval);
  const maxPages = Math.min(Math.max(input.maxPages ?? 40, 1), 200);
  let cursor = Math.floor(input.fromMs);
  const end = Math.floor(input.toMs);
  const gaps: CandleGap[] = [];
  let pages = 0;
  let previous: { time: number } | null = null;

  while (cursor <= end && pages < maxPages) {
    const candles = await getCandles({
      symbol,
      interval,
      fromMs: cursor,
      toMs: end,
      limit: MAX_READ_LIMIT,
      order: "asc",
    });
    pages += 1;
    if (!candles.length) break;
    const window = previous ? [previous, ...candles] : candles;
    gaps.push(...detectCandleGaps(symbol, interval, window));
    const last = candles[candles.length - 1]!;
    previous = { time: last.time };
    if (candles.length < MAX_READ_LIMIT || last.time >= end) break;
    cursor = last.time + step;
  }

  return {
    gaps: mergeCandleGaps(gaps),
    pages,
    truncated: pages >= maxPages && (previous?.time ?? 0) < end,
  };
}

async function repairGaps(input: {
  symbol: string;
  interval: string;
  gaps: CandleGap[];
  maxGaps: number;
}): Promise<{ repaired: number; errors: string[] }> {
  const step = barDurationMs(input.interval);
  let repaired = 0;
  const errors: string[] = [];
  for (const gap of input.gaps.slice(0, input.maxGaps)) {
    const result = await backfillCandles({
      symbol: input.symbol,
      interval: input.interval,
      fromMs: Math.max(1, gap.fromMs - step),
      toMs: gap.toMs + step,
      limit: Math.min(Math.max(gap.missingBars + 4, 10), MAX_BACKFILL),
    });
    if (result.reason === "provider_error" || result.reason === "no_account") {
      errors.push(`gap repair failed at ${new Date(gap.fromMs).toISOString()}`);
    } else if (!result.skipped && result.inserted > 0) {
      repaired += 1;
    }
  }
  return { repaired, errors };
}

export async function assessSeriesCompleteness(input: {
  symbol: string;
  interval: string;
  nowMs?: number;
  repair?: boolean;
  maxRepairGaps?: number;
  maxScanPages?: number;
}): Promise<SeriesCompletenessReport> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const nowMs = input.nowMs ?? Date.now();
  const years = candleHistoryYears();
  const targetStart = targetHistoryStartMs(interval, nowMs);
  const coverage = await getCoverage({ symbol, interval });
  const errors: string[] = [];
  let repairedGaps = 0;

  const scanFrom = Math.max(targetStart, coverage.firstTime ?? targetStart);
  const scanTo = coverage.lastTime ?? nowMs;
  let gaps: CandleGap[] = [];
  if (coverage.count >= 2 && coverage.firstTime != null && coverage.lastTime != null) {
    const scanned = await scanSeriesGaps({
      symbol,
      interval,
      fromMs: scanFrom,
      toMs: scanTo,
      maxPages: input.maxScanPages,
    });
    gaps = scanned.gaps;
    if (scanned.truncated) {
      errors.push("gap scan truncated by page budget; more gaps may exist");
    }
  }

  if (input.repair && gaps.length) {
    const repair = await repairGaps({
      symbol,
      interval,
      gaps,
      maxGaps: Math.min(Math.max(input.maxRepairGaps ?? 8, 0), 40),
    });
    repairedGaps = repair.repaired;
    errors.push(...repair.errors);
    if (repairedGaps > 0) {
      const rescanned = await scanSeriesGaps({
        symbol,
        interval,
        fromMs: scanFrom,
        toMs: (await getCoverage({ symbol, interval })).lastTime ?? scanTo,
        maxPages: input.maxScanPages,
      });
      gaps = rescanned.gaps;
    }
  }

  const fresh: WarehouseCoverage = await getCoverage({ symbol, interval });
  const depthComplete =
    fresh.firstTime != null &&
    fresh.lastTime != null &&
    fresh.firstTime <= targetStart + barDurationMs(interval) * 2 &&
    fresh.count > 0;

  const missingBars = gaps.reduce((sum, gap) => sum + gap.missingBars, 0);
  const report: SeriesCompletenessReport = {
    symbol,
    interval,
    firstCandleAt: iso(fresh.firstTime),
    lastCandleAt: iso(fresh.lastTime),
    barCount: fresh.count,
    targetStartAt: new Date(targetStart).toISOString(),
    targetYears: years,
    depthComplete,
    gapCount: gaps.length,
    missingBars,
    largestGaps: [...gaps]
      .sort((a, b) => b.missingBars - a.missingBars)
      .slice(0, 10)
      .map((gap) => ({
        from: new Date(gap.fromMs).toISOString(),
        to: new Date(gap.toMs).toISOString(),
        missingBars: gap.missingBars,
      })),
    repairedGaps,
    errors,
  };
  log.info("series completeness", {
    symbol,
    interval,
    barCount: report.barCount,
    depthComplete: report.depthComplete,
    gapCount: report.gapCount,
    missingBars: report.missingBars,
    firstCandleAt: report.firstCandleAt,
    lastCandleAt: report.lastCandleAt,
  });
  return report;
}

export async function buildWarehouseCompletenessReport(input?: {
  symbols?: string[];
  intervals?: string[];
  nowMs?: number;
  repair?: boolean;
  maxSeries?: number;
}): Promise<WarehouseCompletenessReport> {
  const configuredSymbols = (process.env.CANDLE_SYNC_SYMBOLS ?? "")
    .split(",")
    .map((value) => forexCanonicalKey(value))
    // Shape check is permissive (indices/crypto later); the instrument
    // registry is the real gate.
    .filter((value) => /^[A-Z0-9]{3,10}$/.test(value) && isKnownForexSymbol(value));
  const configuredIntervals = (process.env.CANDLE_SYNC_INTERVALS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => normalizeCanonicalInterval(value));
  const defaults = configuredIntervals.length
    ? configuredIntervals
    : (["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const).map((value) => value);

  const stored = await listWarehouseSeries();
  const wanted = new Map<string, { symbol: string; interval: string }>();
  for (const symbol of input?.symbols?.length ? input.symbols : configuredSymbols) {
    for (const interval of input?.intervals?.length ? input.intervals : defaults) {
      const key = `${forexCanonicalKey(symbol)}:${normalizeCanonicalInterval(interval)}`;
      wanted.set(key, {
        symbol: forexCanonicalKey(symbol),
        interval: normalizeCanonicalInterval(interval),
      });
    }
  }
  for (const series of stored) {
    wanted.set(`${series.symbol}:${series.interval}`, series);
  }

  const maxSeries = Math.min(
    Math.max(input?.maxSeries ?? wanted.size, 1),
    200,
  );
  const selected = [...wanted.values()].slice(0, maxSeries);
  const series: SeriesCompletenessReport[] = [];
  for (const item of selected) {
    series.push(
      await assessSeriesCompleteness({
        symbol: item.symbol,
        interval: item.interval,
        nowMs: input?.nowMs,
        repair: input?.repair === true,
      }),
    );
  }
  return {
    generatedAt: new Date(input?.nowMs ?? Date.now()).toISOString(),
    targetYears: candleHistoryYears(),
    series,
  };
}
