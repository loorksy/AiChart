/**
 * The Cost Evidence contract — one shape, one resolution order, both units.
 *
 * Three independent breaks sat between the observed spread and the decision
 * engine, and any one of them alone made the cost invisible:
 *
 *   1. No entry point supplied a spread at all. `market.spread` was the only
 *      inlet and every production caller left it null, so expected execution
 *      cost was 0 and net R equalled gross R on every plan.
 *   2. The synthesizer emitted three incompatible objects depending on a flag,
 *      with disjoint key sets. The only downstream reader looked for keys that
 *      the enabled branch never produced, so the spread-drift trigger read NaN
 *      and never fired.
 *   3. Units were mixed. `market.spread` is PRICE units, but it was fed to a
 *      helper whose argument is PIPS and compared against a pips baseline —
 *      wrong by ~10^4 the moment anyone wired a real number through.
 *
 * So this module carries BOTH units explicitly, named, in every rung. A field
 * called `spread` with an unstated unit is what caused (3); there is no such
 * field here.
 *
 * Resolution ladder, highest confidence first. A rung is used only if it is
 * genuinely available and fresh; nothing is ever fabricated, and a stale
 * sample is never presented as live:
 *
 *   1. fresh observed bid/ask from the broker feed
 *   2. fresh live cost profile (measured samples for this symbol/session)
 *   3. session profile (the same profile, past its freshness window)
 *   4. static fallback (the instrument's modelled typical spread)
 *   5. unavailable — stated as such, never as zero
 */
import { getEaLiveQuote } from "@/lib/eaLiveState";
import { pipSizeForSymbol } from "@/lib/spread";
import { expectedSpreadFor } from "@/lib/strategies/liveCostProfile";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent.cost-evidence");

export const COST_EVIDENCE_SOURCES = [
  "observed_quote",
  "live_cost_profile",
  "session_profile",
  "static_fallback",
  "unavailable",
] as const;

export type CostEvidenceSource = (typeof COST_EVIDENCE_SOURCES)[number];

/**
 * How old an observed quote may be and still count as LIVE for analysis.
 *
 * Deliberately its own constant rather than the execution staleness gate: a
 * quote too old to fill against can still be honest evidence for a decision,
 * and conflating them would either block analysis or admit stale prices to
 * execution. Both are wrong in different directions.
 */
export const ANALYSIS_QUOTE_STALE_MS = (() => {
  const raw = Number(process.env.ANALYSIS_QUOTE_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
})();

export interface CostEvidence {
  source: CostEvidenceSource;
  /** Spread in PRICE units (ask - bid). Null when unavailable. */
  spreadPrice: number | null;
  /** The same spread in PIPS for this instrument. Null when unavailable. */
  spreadPips: number | null;
  bid: number | null;
  ask: number | null;
  /** Epoch ms the quote was observed, when it came from a real observation. */
  observedAt: number | null;
  /** Age of that observation at build time; null when not an observation. */
  freshnessMs: number | null;
  /** Trading session the profile rungs are shaped by. */
  session: string | null;
  /** How many measured samples stand behind a profile rung. */
  sampleCount: number | null;
  /** True whenever the value did not come from a fresh observation. */
  fallbackUsed: boolean;
  /** Why the higher rungs were skipped — plain language, for the trace. */
  fallbackReason: string | null;
}

export const UNAVAILABLE_COST: CostEvidence = {
  source: "unavailable",
  spreadPrice: null,
  spreadPips: null,
  bid: null,
  ask: null,
  observedAt: null,
  freshnessMs: null,
  session: null,
  sampleCount: null,
  fallbackUsed: true,
  fallbackReason: "no observed quote and no measured cost profile",
};

function pipsToPrice(pips: number, symbol: string, reference: number): number {
  return pips * pipSizeForSymbol(symbol, reference);
}

function priceToPips(price: number, symbol: string, reference: number): number {
  const pip = pipSizeForSymbol(symbol, reference);
  return pip > 0 ? price / pip : 0;
}

/**
 * Build the cost evidence for one analysis.
 *
 * `observedOverride` lets a caller that already holds a quote (a worker, a
 * re-evaluation replaying a moment) supply it rather than re-reading the feed.
 * It is in PRICE units, like every other `*Price` field here.
 */
export async function resolveCostEvidence(input: {
  userId?: number;
  symbol: string;
  /** Mid price used to convert between pips and price units. */
  referencePrice?: number | null;
  observedOverride?: { bid: number; ask: number; observedAt?: number } | null;
  now?: number;
}): Promise<CostEvidence> {
  const now = input.now ?? Date.now();
  const symbol = input.symbol;

  // Rung 1 — a fresh observed bid/ask.
  let quote = input.observedOverride
    ? {
        bid: input.observedOverride.bid,
        ask: input.observedOverride.ask,
        updatedAt: input.observedOverride.observedAt ?? now,
      }
    : null;
  if (!quote && input.userId != null) {
    try {
      const live = await getEaLiveQuote(input.userId, symbol);
      if (live) quote = { bid: live.bid, ask: live.ask, updatedAt: live.updatedAt };
    } catch (error) {
      log.warn("live quote lookup failed", {
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let staleReason: string | null = null;
  if (quote && quote.ask > 0 && quote.bid > 0 && quote.ask >= quote.bid) {
    const age = Math.max(0, now - quote.updatedAt);
    const mid = (quote.bid + quote.ask) / 2;
    if (age <= ANALYSIS_QUOTE_STALE_MS) {
      const spreadPrice = quote.ask - quote.bid;
      return {
        source: "observed_quote",
        spreadPrice,
        spreadPips: priceToPips(spreadPrice, symbol, mid),
        bid: quote.bid,
        ask: quote.ask,
        observedAt: quote.updatedAt,
        freshnessMs: age,
        session: null,
        sampleCount: null,
        fallbackUsed: false,
        fallbackReason: null,
      };
    }
    // A stale sample is NEVER presented as live — it falls through, and says why.
    staleReason = `observed quote was ${Math.round(age / 1000)}s old (limit ${Math.round(
      ANALYSIS_QUOTE_STALE_MS / 1000,
    )}s)`;
  }

  const reference =
    input.referencePrice && input.referencePrice > 0
      ? input.referencePrice
      : quote
        ? (quote.bid + quote.ask) / 2
        : 0;

  // Rungs 2-4 — the measured profile, then its session shape, then the static
  // model. expectedSpreadFor owns that ordering and reports which it used.
  try {
    // Second argument is PIPS; we have no fresh observation at this rung, so
    // null — passing a price-unit number here is the latent 10^4 bug.
    const profile = await expectedSpreadFor(symbol, null);
    const pips = Number(profile?.expectedSpreadPips);
    if (Number.isFinite(pips) && pips > 0) {
      const stale = Boolean(profile?.stale);
      const measured = profile?.source === "live_ea_quotes";
      const source: CostEvidenceSource = measured
        ? stale
          ? "session_profile"
          : "live_cost_profile"
        : "static_fallback";
      return {
        source,
        spreadPrice: reference > 0 ? pipsToPrice(pips, symbol, reference) : null,
        spreadPips: pips,
        bid: null,
        ask: null,
        observedAt: null,
        freshnessMs: null,
        session: profile?.session ?? null,
        sampleCount: Number.isFinite(Number(profile?.sampleCount))
          ? Number(profile?.sampleCount)
          : null,
        fallbackUsed: true,
        fallbackReason:
          staleReason ??
          (source === "static_fallback"
            ? "no measured samples for this instrument yet"
            : "no fresh observed quote"),
      };
    }
  } catch (error) {
    log.warn("cost profile lookup failed", {
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    ...UNAVAILABLE_COST,
    fallbackReason: staleReason ?? UNAVAILABLE_COST.fallbackReason,
  };
}

/**
 * The wire shape stored in the evidence snapshot and read by the tracker.
 *
 * snake_case with the unit in every key name, because the ambiguity of a bare
 * `spread` is what allowed the price/pips mismatch to sit latent.
 */
export function serializeCostEvidence(
  input: CostEvidence | null | undefined,
): Record<string, unknown> {
  // An absent evidence object is genuinely "unavailable" — the one thing it
  // must never become is a zero, which would read as a free fill.
  const evidence = input ?? UNAVAILABLE_COST;
  return {
    source: evidence.source,
    observed_spread_price: evidence.spreadPrice,
    observed_spread_pips: evidence.spreadPips,
    expected_spread_pips: evidence.spreadPips,
    bid: evidence.bid,
    ask: evidence.ask,
    observed_at: evidence.observedAt,
    freshness_ms: evidence.freshnessMs,
    session: evidence.session,
    sample_count: evidence.sampleCount,
    fallback_used: evidence.fallbackUsed,
    fallback_reason: evidence.fallbackReason,
    note: "Session-adjusted expected spread. A move that does not clear it is a worse entry, not an absent one — say the better price instead.",
  };
}

/** Read the pips figure back out of a stored snapshot, in one place. */
export function costEvidencePips(cost: Record<string, unknown> | null | undefined): number {
  if (!cost) return Number.NaN;
  const value = Number(
    cost.observed_spread_pips ??
      cost.expected_spread_pips ??
      // Pre-contract snapshots stored a bare price-unit spread under these
      // names. Read them so old rows still compare, but never write them.
      cost.observed_spread ??
      cost.expected_spread ??
      Number.NaN,
  );
  return Number.isFinite(value) ? value : Number.NaN;
}
