/**
 * Live session cost profile (plan §13 H.1).
 *
 * The static multipliers said what Asian-session spread USUALLY does; this
 * measures what this operator's broker actually charges, session by session.
 * Samples come from the EA's live quotes — the only source that knows the real
 * spread on the account that will pay it — accumulated by a cron into
 * `cost_samples` and aggregated on read.
 *
 * The honesty rules are the point of the module:
 *
 *  - Below MIN_SAMPLES for a session, no numbers are reported for it. "The
 *    Asian spread is 2.1 pips" off three observations is a guess wearing a
 *    decimal point.
 *  - When the live profile cannot answer, the fallback is RETURNED AS a
 *    fallback — `source: "static_model"` — never as a number that implies it
 *    was measured.
 *  - Staleness is part of the answer: a profile built from last week's samples
 *    says so, and the freshness gauge tracks it.
 */
import { execute, query } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/metrics";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { spreadFromBidAsk } from "@/lib/spread";
import { getEaLiveQuotes } from "@/lib/eaLiveState";
import {
  SESSION_SPREAD_MULTIPLIER,
  sessionAt,
  type ForexSession,
} from "./sessionSpread";

const log = createLogger("strategies:live-cost");

/** Fewest samples before a session's numbers are reported. */
export const MIN_SAMPLES = 20;
/** Rolling window the aggregation reads. */
export const SAMPLE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Beyond this the freshest sample is stale and the profile says so. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface SessionCostStats {
  session: ForexSession;
  sampleCount: number;
  /** Median spread in pips — the "typical" number a plan should be costed at. */
  typicalSpreadPips: number | null;
  /** 90th percentile — what "the spread widened" means for this session. */
  expandedSpreadPips: number | null;
  /**
   * Estimated slippage in pips. Modelled from spread dispersion (p90 − median):
   * a session whose spread jumps around fills orders away from the quote.
   */
  estimatedSlippagePips: number | null;
}

export interface LiveCostProfile {
  symbol: string;
  sessions: SessionCostStats[];
  /** Milliseconds since the freshest sample; null when there are none. */
  freshnessMs: number | null;
  stale: boolean;
  /**
   * Where the numbers came from. `live_ea_quotes` only when the answering
   * session cleared MIN_SAMPLES; anything else is the labelled fallback.
   */
  source: "live_ea_quotes" | "static_model" | "unavailable";
  /** Commission per lot when the broker profile configures one. */
  commissionPerLot: number | null;
}

/**
 * Record one spread observation per symbol from the EA's live quotes.
 *
 * Called from the monitoring cron, so sampling costs nothing extra: the quotes
 * are already in memory for freshness checks. Sampling rather than streaming is
 * deliberate — a per-tick record would grow the table by millions of rows for a
 * distribution that ten-minute samples describe just as well.
 */
export async function sampleLiveCosts(userId: number): Promise<number> {
  const quotes = await getEaLiveQuotes(userId).catch(() => ({}));
  const now = Date.now();
  let written = 0;
  for (const quote of Object.values(quotes)) {
    if (quote.quoteAgeMs > 60_000) continue; // a dead quote is not an observation
    const canonical = forexCanonicalKey(quote.symbol);
    const spread = spreadFromBidAsk(Number(quote.bid), Number(quote.ask), canonical);
    if (!spread || !(spread.spreadPips >= 0)) continue;
    await execute(
      `INSERT INTO cost_samples (symbol, session, spread_pips, observed_at)
       VALUES (?,?,?,?)`,
      [canonical, sessionAt(new Date(now)), spread.spreadPips, now],
    ).catch((error: unknown) => {
      log.warn("cost sample write failed", {
        symbol: canonical,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    written += 1;
  }
  // Prune outside the window opportunistically; cheap and keeps the table flat.
  if (written > 0) {
    await execute("DELETE FROM cost_samples WHERE observed_at < ?", [
      now - SAMPLE_WINDOW_MS,
    ]).catch(() => undefined);
  }
  return written;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

const ALL_SESSIONS: ForexSession[] = [
  "asia",
  "london",
  "new_york",
  "london_new_york_overlap",
];

/**
 * Aggregate the profile for one symbol.
 *
 * A session below MIN_SAMPLES contributes a row with counts and null numbers —
 * visible as "not enough data", never silently absent and never guessed.
 */
export async function getLiveCostProfile(symbol: string): Promise<LiveCostProfile> {
  const canonical = forexCanonicalKey(symbol);
  const since = Date.now() - SAMPLE_WINDOW_MS;
  const rows = await query<{ session: string; spread_pips: number | string; observed_at: number | string }>(
    `SELECT session, spread_pips, observed_at
       FROM cost_samples
      WHERE symbol = ? AND observed_at >= ?`,
    [canonical, since],
  ).catch(() => []);

  const bySession = new Map<string, number[]>();
  let freshest = 0;
  for (const row of rows) {
    const list = bySession.get(row.session) ?? [];
    list.push(Number(row.spread_pips));
    bySession.set(row.session, list);
    freshest = Math.max(freshest, Number(row.observed_at));
  }

  const sessions: SessionCostStats[] = ALL_SESSIONS.map((session) => {
    const samples = (bySession.get(session) ?? []).sort((a, b) => a - b);
    if (samples.length < MIN_SAMPLES) {
      return {
        session,
        sampleCount: samples.length,
        typicalSpreadPips: null,
        expandedSpreadPips: null,
        estimatedSlippagePips: null,
      };
    }
    const typical = percentile(samples, 50)!;
    const expanded = percentile(samples, 90)!;
    return {
      session,
      sampleCount: samples.length,
      typicalSpreadPips: round(typical),
      expandedSpreadPips: round(expanded),
      // Dispersion as a slippage proxy: a jumpy spread fills away from the quote.
      estimatedSlippagePips: round(Math.max(0, (expanded - typical) / 2)),
    };
  });

  const anyLive = sessions.some((s) => s.typicalSpreadPips != null);
  const freshnessMs = freshest > 0 ? Date.now() - freshest : null;
  if (freshnessMs != null) {
    metrics.costProfileFreshness.set({ symbol: canonical }, freshnessMs / 1000);
  }

  const commission = Number(process.env.BACKTEST_COMMISSION_PER_LOT);

  return {
    symbol: canonical,
    sessions,
    freshnessMs,
    stale: freshnessMs == null || freshnessMs > STALE_AFTER_MS,
    source: anyLive ? "live_ea_quotes" : rows.length ? "unavailable" : "unavailable",
    commissionPerLot: Number.isFinite(commission) && commission >= 0 ? commission : null,
  };
}

/**
 * The spread a plan should be costed at RIGHT NOW for this symbol.
 *
 * Live profile first; the static session model only as a labelled fallback —
 * the label is what stops a modelled number from masquerading as a measured
 * one in the evidence card.
 */
export async function expectedSpreadFor(
  symbol: string,
  observedPips: number | null,
  now = new Date(),
): Promise<{
  session: ForexSession;
  expectedSpreadPips: number | null;
  source: "live_ea_quotes" | "static_model" | "unavailable";
  sampleCount: number;
  stale: boolean;
}> {
  const session = sessionAt(now);
  const profile = await getLiveCostProfile(symbol);
  const stats = profile.sessions.find((s) => s.session === session);

  if (stats?.typicalSpreadPips != null && !profile.stale) {
    return {
      session,
      expectedSpreadPips: stats.typicalSpreadPips,
      source: "live_ea_quotes",
      sampleCount: stats.sampleCount,
      stale: false,
    };
  }

  // Labelled fallback: shape the observed quote by the static session model.
  if (observedPips != null && observedPips >= 0) {
    return {
      session,
      expectedSpreadPips: round(observedPips * SESSION_SPREAD_MULTIPLIER[session]),
      source: "static_model",
      sampleCount: stats?.sampleCount ?? 0,
      stale: profile.stale,
    };
  }

  return {
    session,
    expectedSpreadPips: null,
    source: "unavailable",
    sampleCount: stats?.sampleCount ?? 0,
    stale: profile.stale,
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
