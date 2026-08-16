/**
 * The case indexer, unfrozen.
 *
 * `caseIndexer.ts` still says there is no indexer here, and explains why: a
 * case needs tens of thousands of candles walked in sliding windows, and the
 * bulk source that served it was deleted. So `market_cases` stopped growing and
 * `find_similar_cases` has been answering out of whatever it already held.
 *
 * The gold candle store is that source. This is the walker it was missing.
 *
 * ## The one invariant
 *
 * A case is a claim about what the market looked like at a moment AND what
 * happened next. Those two halves come from disjoint candle ranges, and mixing
 * them by even one bar makes the memory a record of the future:
 *
 *   - features    ← candles at or BEFORE `caseTime`
 *   - the outcome ← candles strictly AFTER it
 *
 * Every slice below is written to make that split structural rather than
 * remembered. The fingerprint window ends AT the case index; the forward window
 * starts at `index + 1`.
 *
 * ## Why both directions, always
 *
 * A case is indexed long AND short at the same moment. "This is what the market
 * looked like" is only half the question; the useful half is "and did going
 * long from here pay". Indexing one side would build a memory that can only
 * ever confirm.
 */
import { createLogger } from "@/lib/logger";
import { DATA_SYMBOL, TIMEFRAMES } from "@/lib/gold";
import { readGoldCandles, type StoredGoldCandle } from "@/lib/gold/candleStore";
import { query } from "@/lib/db";
import { fingerprintAt } from "./caseFingerprint";
import { resolveForwardOutcome } from "./forwardOutcome";
import {
  INDEXER_VERSION,
  sessionCostFor,
  storeCases,
  warehouseKey,
  type IndexedCase,
} from "./caseIndexer";

const log = createLogger("marketMemory.gold-indexer");

/** Candles the fingerprint needs behind a case before it means anything. */
const LOOKBACK = 60;

/** Candles the outcome resolver may walk forward. */
export const FORWARD_HORIZON = 40;

/**
 * Bars between consecutive cases.
 *
 * Every bar would index near-duplicates: consecutive 15m moments share 59 of
 * their 60 lookback candles, so the memory would fill with copies of one
 * situation and a similarity search would return the same moment eight times.
 * Four bars is far enough apart for the window to have actually moved.
 */
const STRIDE = 4;

export interface IndexReport {
  timeframe: string;
  scanned: number;
  indexed: number;
  /** Set when the pass stopped early with a reason worth reporting. */
  stoppedBecause?: "insufficient_history" | "already_indexed" | "cap_reached";
}

/** Newest case time already stored for this series, or null. */
async function newestIndexedCase(
  symbol: string,
  interval: string,
): Promise<number | null> {
  const rows = await query<{ newest: number | null }>(
    `SELECT MAX(case_time) AS newest FROM market_cases
      WHERE symbol = ? AND interval = ? AND indexer_version = ?`,
    [symbol, interval, INDEXER_VERSION],
  ).catch(() => []);
  const newest = rows[0]?.newest;
  return newest == null ? null : Number(newest);
}

/**
 * Index one timeframe's stored history.
 *
 * Resumable and capped. It starts after the newest case already stored, so a
 * nightly run indexes only what the store gained; `maxCases` bounds a first run
 * over years of history into something that finishes.
 */
export async function indexGoldCases(input: {
  timeframe: string;
  maxCases?: number;
  /** Re-index from the beginning instead of resuming. */
  full?: boolean;
}): Promise<IndexReport> {
  const key = warehouseKey(DATA_SYMBOL, input.timeframe);
  const cap = Math.max(1, Math.min(20_000, input.maxCases ?? 2_000));
  const candles = await readGoldCandles({
    timeframe: input.timeframe,
    limit: 200_000,
  });

  const report: IndexReport = {
    timeframe: input.timeframe,
    scanned: 0,
    indexed: 0,
  };
  // A case needs its lookback behind it and its whole horizon ahead of it.
  // Without both, it is not a case — it is half a claim.
  if (candles.length < LOOKBACK + FORWARD_HORIZON + 1) {
    report.stoppedBecause = "insufficient_history";
    return report;
  }

  const resumeAfter = input.full ? null : await newestIndexedCase(key.symbol, key.interval);
  const cases: IndexedCase[] = [];

  // The loop stops FORWARD_HORIZON bars from the end on purpose: a case whose
  // outcome window runs past the data would be resolved on a truncated future
  // and recorded as "unresolved" when the market simply has not printed yet.
  const lastIndexable = candles.length - FORWARD_HORIZON - 1;
  for (let index = LOOKBACK; index <= lastIndexable; index += STRIDE) {
    const bar = candles[index]!;
    if (resumeAfter != null && bar.time <= resumeAfter) continue;
    report.scanned += 1;
    if (cases.length >= cap * 2) {
      report.stoppedBecause = "cap_reached";
      break;
    }

    // Features: this candle and everything before it. Never `index + 1`.
    const history = candles.slice(index - LOOKBACK + 1, index + 1);
    const fingerprint = fingerprintAt(history);
    if (!fingerprint) continue;

    const atr = atrOf(history);
    if (!(atr > 0)) continue;

    // The outcome: strictly after. This is the slice that makes the memory
    // honest or useless.
    const future = candles.slice(index + 1, index + 1 + FORWARD_HORIZON);
    const cost = sessionCostFor(DATA_SYMBOL, bar.time);

    for (const direction of ["buy", "sell"] as const) {
      const outcome = resolveForwardOutcome({
        direction,
        entry: bar.close,
        atr,
        future,
        horizon: FORWARD_HORIZON,
        cost,
      });
      cases.push({
        ...fingerprint,
        symbol: key.symbol,
        interval: key.interval,
        caseTime: bar.time,
        direction,
        // Pattern detection is not run here: a pattern name that disagreed
        // with the one the live path derives would make two memories of one
        // moment. Cases carry the fingerprint, which both paths share.
        patternName: null,
        patternStage: null,
        breakLevel: null,
        breakDirection: null,
        entryPrice: bar.close,
        atr,
        outcome: outcome.resolution,
        outcomeBars: outcome.bars,
        // `IndexedCase` names these without a unit and the column is
        // `max_favourable`, but the value stored is the ATR-NORMALISED
        // excursion — `caseQuery` reads the same column back into
        // `maxFavourableAtr`. Writing a price-unit number here would make new
        // rows incomparable with every row already indexed.
        maxFavourable: outcome.maxFavourableAtr,
        maxAdverse: outcome.maxAdverseAtr,
        netR: outcome.netR,
        formingOutcome: null,
        formingBars: null,
        falseBreak: null,
        earlyNetR: null,
        confirmedNetR: null,
        sessionCost: cost,
      });
    }
  }

  if (!cases.length) {
    report.stoppedBecause ??= "already_indexed";
    return report;
  }
  report.indexed = await storeCases(cases);
  log.info("gold.cases.indexed", {
    timeframe: input.timeframe,
    scanned: report.scanned,
    indexed: report.indexed,
  });
  return report;
}

/** ATR over a window, matching the fingerprint's own definition. */
function atrOf(candles: readonly StoredGoldCandle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const window = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < window.length; i += 1) {
    const current = window[i]!;
    const previous = window[i - 1]!;
    sum += Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
  }
  return sum / period;
}

/** One pass across the analysed timeframes. */
export async function indexAllGoldCases(options?: {
  maxCasesPerTimeframe?: number;
}): Promise<IndexReport[]> {
  const reports: IndexReport[] = [];
  for (const timeframe of TIMEFRAMES) {
    reports.push(
      await indexGoldCases({
        timeframe,
        maxCases: options?.maxCasesPerTimeframe,
      }).catch((error) => {
        log.warn("gold.cases.failed", {
          timeframe,
          error: error instanceof Error ? error.message : String(error),
        });
        return { timeframe, scanned: 0, indexed: 0 } satisfies IndexReport;
      }),
    );
  }
  return reports;
}
