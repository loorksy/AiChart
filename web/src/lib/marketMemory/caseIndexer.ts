/**
 * The indexer that builds the historical case memory
 * (docs/UNIFIED_AGENT_PLAN.md §10, implementation plan Phase G).
 *
 * It walks the candle warehouse in sliding windows. At each step it describes
 * the moment from the window ENDING there, then reads what the following bars
 * did. Two passes, two inputs, no overlap:
 *
 *     features  ← candles[..i]      (the window, inclusive)
 *     outcome   ← candles[i+1..]    (strictly after)
 *
 * A case whose forward window has not fully arrived yet is stored with a null
 * outcome and resolved on a later run, so the memory grows with the warehouse
 * instead of being rebuilt. That also means the edge of history never
 * contributes a truncated, optimistic outcome to the statistics.
 *
 * Both directions are indexed at every moment. "This is what the market looked
 * like" is only half a question — the useful half is "and did going long from
 * here pay", which needs the long and the short evaluated separately.
 */
import { execute, query } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { barDurationMs } from "@/lib/intervals";
import { getCandles, warehouseKey } from "@/lib/candles/candleRepository";
import { detectChartGeometry, MIN_GEOMETRY_CANDLES } from "@/lib/chart/geometry";
import { fingerprintAt, type CaseFingerprint, type FingerprintCandle } from "./caseFingerprint";
import { resolveForwardOutcome, type CaseResolution } from "./forwardOutcome";

const log = createLogger("marketMemory:indexer");

/** Bump when the feature set changes: old rows stay, new rows are comparable. */
export const INDEXER_VERSION = 1;

/** Bars of history each fingerprint is computed from. */
const FEATURE_WINDOW = 90;
/** Bars ahead an outcome is allowed to take before it counts as unresolved. */
export const FORWARD_HORIZON = 40;
/**
 * Bars between consecutive cases. Adjacent moments are near-duplicates that
 * would inflate a sample without adding information, so the walk skips ahead.
 */
const DEFAULT_STRIDE = 8;

/**
 * Whether a candle sits on the case lattice.
 *
 * Anchored to the candle's own timestamp, NOT to its position in whatever slice
 * was read. Stepping by array index makes the lattice depend on where the read
 * began, so a resumed run and a full re-walk pick different moments and the
 * memory ends up holding overlapping near-duplicates whose composition reflects
 * the cron's history rather than the market's. Bucketing on time makes the case
 * set a pure function of the warehouse.
 */
function onLattice(time: number, barMs: number, stride: number): boolean {
  if (!(barMs > 0)) return true;
  return Math.floor(time / barMs) % stride === 0;
}

export interface IndexedCase extends CaseFingerprint {
  symbol: string;
  interval: string;
  caseTime: number;
  direction: "buy" | "sell";
  patternName: string | null;
  patternStage: string | null;
  entryPrice: number;
  atr: number;
  outcome: CaseResolution | null;
  outcomeBars: number | null;
  maxFavourable: number | null;
  maxAdverse: number | null;
  netR: number | null;
}

interface IndexResult {
  symbol: string;
  interval: string;
  scanned: number;
  written: number;
  resolved: number;
  pending: number;
}

function atrOf(candles: readonly FingerprintCandle[], period = 14): number {
  const window = candles.slice(-period - 1);
  if (window.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]!;
    const current = window[i]!;
    sum += Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close),
    );
  }
  return sum / (window.length - 1);
}

/**
 * Index one symbol/timeframe.
 *
 * `maxCases` bounds the work per invocation so a cron tick stays inside its
 * duration; the walk resumes from the newest indexed case on the next run.
 */
export async function indexSymbolCases(input: {
  symbol: string;
  interval: string;
  /** Cap on cases written per invocation (both directions count as two). */
  maxCases?: number;
  stride?: number;
  /** Detect patterns per case. Off makes the walk much cheaper. */
  detectPatterns?: boolean;
  /** Overrides the resume point; used by tests. */
  fromMs?: number;
}): Promise<IndexResult> {
  const key = warehouseKey(input.symbol, input.interval);
  const stride = Math.max(1, input.stride ?? DEFAULT_STRIDE);
  const maxCases = Math.max(2, input.maxCases ?? 2_000);
  const detectPatterns = input.detectPatterns !== false;

  const resumeFrom = input.fromMs ?? (await newestCaseTime(key.symbol, key.interval));
  // Read back well before the resume point so the first new candidate still has
  // a full feature window. The pad is generous because weekends and holidays
  // make "N bars back" longer in wall-clock than N × bar duration.
  const readFrom =
    resumeFrom == null
      ? undefined
      : resumeFrom - barDurationMs(key.interval) * FEATURE_WINDOW * 3;
  const candles = await getCandles({
    symbol: key.symbol,
    interval: key.interval,
    fromMs: readFrom,
    order: "asc",
    limit: 20_000,
  });

  const result: IndexResult = {
    symbol: key.symbol,
    interval: key.interval,
    scanned: 0,
    written: 0,
    resolved: 0,
    pending: 0,
  };
  if (candles.length < FEATURE_WINDOW) return result;

  const rows: IndexedCase[] = [];
  const start = Math.max(FEATURE_WINDOW - 1, MIN_GEOMETRY_CANDLES - 1);
  const barMs = barDurationMs(key.interval);

  for (let i = start; i < candles.length; i++) {
    if (rows.length >= maxCases) break;
    const caseTime = candles[i]!.time;
    if (resumeFrom != null && caseTime <= resumeFrom) continue;
    if (!onLattice(caseTime, barMs, stride)) continue;
    result.scanned += 1;

    const window = candles.slice(Math.max(0, i - FEATURE_WINDOW + 1), i + 1);
    const fingerprint = fingerprintAt(window);
    if (!fingerprint) continue;
    const atr = atrOf(window);
    if (!(atr > 0)) continue;

    let patternName: string | null = null;
    let patternStage: string | null = null;
    if (detectPatterns && window.length >= MIN_GEOMETRY_CANDLES) {
      const geometry = detectChartGeometry({ candles: window, atr });
      const primary = geometry.patterns[0];
      if (primary) {
        patternName = primary.patternType;
        patternStage = primary.stage ?? primary.status;
      }
    }

    // Strictly after the case. Slicing from i+1 is the only place this rule is
    // enforced, so it stays a single obvious line.
    const future = candles.slice(i + 1, i + 1 + FORWARD_HORIZON);
    const complete = future.length >= FORWARD_HORIZON;
    const entryPrice = candles[i]!.close;

    for (const direction of ["buy", "sell"] as const) {
      const outcome = complete
        ? resolveForwardOutcome({
            direction,
            entry: entryPrice,
            atr,
            future,
            horizon: FORWARD_HORIZON,
          })
        : null;
      if (outcome) result.resolved += 1;
      else result.pending += 1;

      rows.push({
        ...fingerprint,
        symbol: key.symbol,
        interval: key.interval,
        caseTime,
        direction,
        patternName,
        patternStage,
        entryPrice,
        atr: Number(atr.toFixed(6)),
        outcome: outcome?.resolution ?? null,
        outcomeBars: outcome?.bars ?? null,
        maxFavourable: outcome?.maxFavourableAtr ?? null,
        maxAdverse: outcome?.maxAdverseAtr ?? null,
        netR: outcome?.netR ?? null,
      });
    }
  }

  result.written = await storeCases(rows);
  if (result.written > 0) {
    log.info("indexed market cases", {
      symbol: key.symbol,
      interval: key.interval,
      written: result.written,
      pending: result.pending,
    });
  }
  return result;
}

async function newestCaseTime(symbol: string, interval: string): Promise<number | null> {
  const rows = await query<{ case_time: number | string | null }>(
    `SELECT MAX(case_time) AS case_time
       FROM market_cases
      WHERE symbol = ? AND interval = ? AND indexer_version = ?`,
    [symbol, interval, INDEXER_VERSION],
  ).catch(() => []);
  const value = rows[0]?.case_time;
  return value == null ? null : Number(value);
}

const INSERT_CHUNK = 60;

/** Idempotent write: re-indexing a window overwrites nothing that matters. */
export async function storeCases(cases: readonly IndexedCase[]): Promise<number> {
  if (!cases.length) return 0;
  let written = 0;
  for (let i = 0; i < cases.length; i += INSERT_CHUNK) {
    const chunk = cases.slice(i, i + INSERT_CHUNK);
    const placeholders = chunk
      .map(() => `(${new Array(22).fill("?").join(", ")})`)
      .join(", ");
    const args: unknown[] = [];
    for (const row of chunk) {
      args.push(
        row.symbol,
        row.interval,
        row.caseTime,
        row.direction,
        row.regime,
        row.trend,
        row.rangeZone,
        row.pullbackDepth,
        row.impulseAtr,
        row.volatility,
        row.session,
        row.structureRun,
        row.patternName,
        row.patternStage,
        row.entryPrice,
        row.atr,
        row.outcome,
        row.outcomeBars,
        row.maxFavourable,
        row.maxAdverse,
        row.netR,
        INDEXER_VERSION,
      );
    }
    const res = await execute(
      `INSERT INTO market_cases
         (symbol, interval, case_time, direction, regime, trend, range_zone,
          pullback_depth, impulse_atr, volatility, session, structure_run,
          pattern_name, pattern_stage, entry_price, atr,
          outcome, outcome_bars, max_favourable, max_adverse, net_r,
          indexer_version)
       VALUES ${placeholders}
       ON CONFLICT (symbol, interval, case_time, direction, indexer_version)
       DO NOTHING`,
      args,
    );
    written += res.changes;
  }
  return written;
}

/**
 * Fill in outcomes for cases whose forward window has since arrived.
 *
 * Separate from indexing on purpose: a pending case already has its features
 * frozen, and this pass may only read candles after its timestamp. It cannot
 * touch a feature column, and the SQL says so.
 */
export async function resolvePendingCases(input: {
  symbol: string;
  interval: string;
  limit?: number;
}): Promise<number> {
  const key = warehouseKey(input.symbol, input.interval);
  const limit = Math.max(1, Math.min(input.limit ?? 500, 5_000));
  const pending = await query<{
    id: number | string;
    case_time: number | string;
    direction: string;
    entry_price: number | string;
    atr: number | string;
  }>(
    `SELECT id, case_time, direction, entry_price, atr
       FROM market_cases
      WHERE symbol = ? AND interval = ? AND indexer_version = ? AND outcome IS NULL
      ORDER BY case_time ASC
      LIMIT ?`,
    [key.symbol, key.interval, INDEXER_VERSION, limit],
  ).catch(() => []);
  if (!pending.length) return 0;

  /**
   * Candles are read ONCE for the whole batch rather than once per case.
   *
   * The per-case read was a query per row — 500 sequential round-trips per series
   * per cron tick, for windows that overlap almost completely. One read from the
   * oldest pending case forward covers every case in the batch.
   */
  const oldest = Math.min(...pending.map((row) => Number(row.case_time)));
  const window = await getCandles({
    symbol: key.symbol,
    interval: key.interval,
    fromMs: oldest + 1,
    order: "asc",
    limit: 20_000,
  });
  /** Index of the first candle strictly after `time`, via binary search. */
  const firstAfter = (time: number): number => {
    let low = 0;
    let high = window.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (window[mid]!.time <= time) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  let resolved = 0;
  for (const row of pending) {
    const caseTime = Number(row.case_time);
    const start = firstAfter(caseTime);
    const future = window.slice(start, start + FORWARD_HORIZON);
    if (future.length < FORWARD_HORIZON) continue;

    const outcome = resolveForwardOutcome({
      direction: row.direction === "sell" ? "sell" : "buy",
      entry: Number(row.entry_price),
      atr: Number(row.atr),
      future,
      horizon: FORWARD_HORIZON,
    });
    await execute(
      `UPDATE market_cases
          SET outcome = ?, outcome_bars = ?, max_favourable = ?, max_adverse = ?, net_r = ?
        WHERE id = ? AND outcome IS NULL`,
      [
        outcome.resolution,
        outcome.bars,
        outcome.maxFavourableAtr,
        outcome.maxAdverseAtr,
        outcome.netR,
        row.id,
      ],
    );
    resolved += 1;
  }
  return resolved;
}
