/**
 * Live session cost profile (plan §13 H.1).
 *
 * The static multipliers said what Asian-session spread USUALLY does; this
 * was designed to measure what this operator's broker actually charges,
 * session by session, from samples accumulated into `cost_samples` and
 * aggregated on read. Live rungs fill from the platform OANDA quote
 * (one sample per symbol per minute into `cost_samples`); until a session
 * clears MIN_SAMPLES this resolves through the labelled fallbacks below.
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
import { query } from "@/lib/db";
import { metrics } from "@/lib/metrics";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { pipSizeForSymbol } from "@/lib/spread";
import {
  SESSION_SPREAD_MULTIPLIER,
  sessionAt,
  type ForexSession,
} from "./sessionSpread";

/**
 * Absolute typical London-session spreads per instrument class, in the
 * platform's pip convention (`pipSizeForSymbol`: JPY pairs and XAU 0.01,
 * XAG 0.001, everything else 0.0001). These are deliberately conservative
 * retail-broker figures — a MODEL, always labelled `static_model`, used only
 * when there is neither a live profile nor an observed quote to anchor to:
 *
 *  - majors        1.2 pips (EURUSD-class, ≈0.00012 price units)
 *  - JPY crosses   1.8 pips (≈0.018 price units at pip 0.01)
 *  - minor crosses 1.8 pips
 *  - exotics       3.5 pips
 *  - gold  (XAU)  30 pips  = 0.30 USD at pip 0.01
 *  - silver (XAG) 25 pips  = 0.025 USD at pip 0.001
 *
 * Session shaping still applies on read: the table is a London baseline and
 * SESSION_SPREAD_MULTIPLIER stretches it for Asia etc., same as an observed
 * anchor would be.
 */
const STATIC_CLASS_SPREAD_PIPS = {
  major: 1.2,
  jpyCross: 1.8,
  minorCross: 1.8,
  exotic: 3.5,
  gold: 30,
  silver: 25,
} as const;

const MAJOR_PAIRS = new Set([
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
]);

/** Liquid G10 currencies — a pair outside this set is priced as an exotic. */
const G10 = new Set(["EUR", "GBP", "USD", "CHF", "JPY", "AUD", "NZD", "CAD", "NOK", "SEK"]);

/**
 * Index CFDs quote in native index points, and the platform pip convention
 * (0.0001 for "everything else") makes a bare pips number meaningless for
 * them. So the typical spread is stored here in POINTS and converted through
 * `pipSizeForSymbol` on read — the price-unit consumers (net R, the spread
 * gate) then see the correct absolute number.
 */
const INDEX_TYPICAL_POINTS: Record<string, number> = {
  US30: 2.5,
  DJ30: 2.5,
  NAS100: 1.8,
  USTEC: 1.8,
  US100: 1.8,
  SPX500: 0.7,
  US500: 0.7,
  GER40: 1.6,
  DE40: 1.6,
  UK100: 1.5,
  FRA40: 1.2,
  JPN225: 8,
  JP225: 8,
  AUS200: 2,
  HK50: 6,
};

/** Instruments whose costs we refuse to model statically (crypto: spreads vary 100×). */
const UNMODELLED_PREFIXES = ["BTC", "ETH", "XRP", "LTC", "ADA", "SOL", "DOG", "BNB"];

/**
 * The modelled typical spread for an instrument, in platform pips — or null
 * when the instrument class cannot honestly be modelled. Null is the answer,
 * never a guess.
 */
export function staticTypicalSpreadPips(symbol: string): number | null {
  const key = forexCanonicalKey(symbol);
  const indexPoints = INDEX_TYPICAL_POINTS[key];
  if (indexPoints != null) return round(indexPoints / pipSizeForSymbol(key));
  if (UNMODELLED_PREFIXES.some((prefix) => key.startsWith(prefix))) return null;
  if (key.startsWith("XAU")) return STATIC_CLASS_SPREAD_PIPS.gold;
  if (key.startsWith("XAG")) return STATIC_CLASS_SPREAD_PIPS.silver;
  if (!/^[A-Z]{6}$/.test(key)) return null;
  if (MAJOR_PAIRS.has(key)) return STATIC_CLASS_SPREAD_PIPS.major;
  const base = key.slice(0, 3);
  const quote = key.slice(3);
  if (!G10.has(base) || !G10.has(quote)) return STATIC_CLASS_SPREAD_PIPS.exotic;
  if (base === "JPY" || quote === "JPY") return STATIC_CLASS_SPREAD_PIPS.jpyCross;
  return STATIC_CLASS_SPREAD_PIPS.minorCross;
}

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
    source: anyLive ? "live_ea_quotes" : "unavailable",
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

  // No live profile AND no observed anchor: the absolute per-class table,
  // session-shaped, still labelled as the model it is. Before this rung
  // existed, `expectedSpreadFor(symbol, null)` could only answer
  // "unavailable" — which is how a platform showing a live spread in its own
  // ticker simultaneously told the decision engine the spread did not exist.
  const staticPips = staticTypicalSpreadPips(symbol);
  if (staticPips != null) {
    return {
      session,
      expectedSpreadPips: round(staticPips * SESSION_SPREAD_MULTIPLIER[session]),
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
