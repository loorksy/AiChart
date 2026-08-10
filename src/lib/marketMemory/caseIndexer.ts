/**
 * The historical case memory (docs/UNIFIED_AGENT_PLAN.md §10, implementation
 * plan Phase G): types and storage shared by the case indexer's output and
 * the live similarity query (caseQuery.ts).
 *
 * There is no more indexer here. Building a case required walking tens of
 * thousands of candles per symbol/timeframe in sliding windows — a bulk
 * historical scan only the deleted candle warehouse could serve cheaply; live
 * per-request MetaApi calls cannot replace it without hammering the broker on
 * every cron tick. The memory this module supports is therefore frozen at
 * whatever `market_cases` already holds: still valid evidence, just no
 * longer growing. Both directions were indexed at every moment when the
 * indexer ran — "this is what the market looked like" was only half the
 * question, the useful half was "and did going long from here pay."
 */
import { execute, getDbBackend } from "@/lib/db";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import { SESSION_SPREAD_MULTIPLIER, sessionAt } from "@/lib/strategies/sessionSpread";
import { pipSizeForSymbol } from "@/lib/spread";
import { type CaseFingerprint } from "./caseFingerprint";
import { type CaseResolution, type FormingResolution } from "./forwardOutcome";
import { caseEmbeddingLiteral, caseVectorSearchReady } from "./caseVector";

/** Canonical (symbol, interval) key stored cases are keyed by. */
export function warehouseKey(symbol: string, interval: string): {
  symbol: string;
  interval: string;
} {
  return {
    symbol: forexCanonicalKey(symbol),
    interval: normalizeCanonicalInterval(interval),
  };
}

/** Bump when the feature set changes: old rows stay, new rows are comparable. */
export const INDEXER_VERSION = 1;

export interface IndexedCase extends CaseFingerprint {
  symbol: string;
  interval: string;
  caseTime: number;
  direction: "buy" | "sell";
  patternName: string | null;
  patternStage: string | null;
  /**
   * The boundary that would complete a forming pattern, frozen at case time.
   * Features like everything above them: computed from candles ≤ caseTime,
   * never revised. Null when no pattern (or no single boundary) was present.
   */
  breakLevel: number | null;
  breakDirection: "up" | "down" | null;
  entryPrice: number;
  atr: number;
  outcome: CaseResolution | null;
  outcomeBars: number | null;
  maxFavourable: number | null;
  maxAdverse: number | null;
  netR: number | null;
  /** Partial-stage outcome (plan §12); only forming-pattern cases carry one. */
  formingOutcome: FormingResolution | null;
  formingBars: number | null;
  falseBreak: boolean | null;
  earlyNetR: number | null;
  confirmedNetR: number | null;
  sessionCost: number | null;
}

/**
 * Anchor for the session cost model, in pips at the London session.
 *
 * Historical indexing has no live quote to anchor to, so the SHAPE of the
 * session curve carries the meaning (sessionSpread.ts makes the same call:
 * the ordering matters more than the exact multipliers). The number is a
 * modest London-session spread; Asia costs 1.4× it, the overlap 0.9×.
 */
const BASELINE_SPREAD_PIPS = 1;

/** Round-trip session cost in price terms for one case's moment. */
export function sessionCostFor(symbol: string, timeMs: number): number {
  return (
    BASELINE_SPREAD_PIPS *
    SESSION_SPREAD_MULTIPLIER[sessionAt(new Date(timeMs))] *
    pipSizeForSymbol(symbol)
  );
}

const INSERT_CHUNK = 60;

/** Idempotent write: re-indexing a window overwrites nothing that matters. */
export async function storeCases(cases: readonly IndexedCase[]): Promise<number> {
  if (!cases.length) return 0;
  // On Postgres with pgvector the fingerprint vector is stored alongside the
  // feature columns it derives from; elsewhere the column does not exist and
  // the insert must not mention it.
  const withEmbedding =
    getDbBackend() === "postgres" && (await caseVectorSearchReady());
  const columns = `symbol, interval, case_time, direction, regime, trend, range_zone,
          pullback_depth, impulse_atr, volatility, session, structure_run,
          pattern_name, pattern_stage, break_level, break_direction,
          entry_price, atr,
          outcome, outcome_bars, max_favourable, max_adverse, net_r,
          forming_outcome, forming_bars, false_break,
          early_net_r, confirmed_net_r, session_cost,
          indexer_version${withEmbedding ? ", embedding" : ""}`;
  const rowPlaceholders = `(${new Array(30).fill("?").join(", ")}${
    withEmbedding ? ", ?::vector" : ""
  })`;
  let written = 0;
  for (let i = 0; i < cases.length; i += INSERT_CHUNK) {
    const chunk = cases.slice(i, i + INSERT_CHUNK);
    const placeholders = chunk.map(() => rowPlaceholders).join(", ");
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
        row.breakLevel,
        row.breakDirection,
        row.entryPrice,
        row.atr,
        row.outcome,
        row.outcomeBars,
        row.maxFavourable,
        row.maxAdverse,
        row.netR,
        row.formingOutcome,
        row.formingBars,
        row.falseBreak == null ? null : row.falseBreak ? 1 : 0,
        row.earlyNetR,
        row.confirmedNetR,
        row.sessionCost,
        INDEXER_VERSION,
      );
      if (withEmbedding) args.push(caseEmbeddingLiteral(row));
    }
    const res = await execute(
      `INSERT INTO market_cases
         (${columns})
       VALUES ${placeholders}
       ON CONFLICT (symbol, interval, case_time, direction, indexer_version)
       DO NOTHING`,
      args,
    );
    written += res.changes;
  }
  return written;
}
