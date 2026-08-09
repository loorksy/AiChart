/**
 * The Tradability Budget — is this plan's entry realistically reachable?
 *
 * Why this exists: the doctrine guarantees every successful analysis a
 * direction, and its only escape hatch for a badly positioned price was a
 * "conditional" plan hung on a distant level. Nothing on the write path ever
 * compared the entry to the live price, so "sell from a great level 5 ATR
 * above the market" stored and rendered exactly like an actionable trade
 * (docs/PLATFORM_AGENT_UPGRADE_PLAN.md §0). This module is the missing
 * measurement.
 *
 * It grades REACHABILITY only. It never questions the direction, the levels'
 * quality, or the evidence — those already have owners. One verdict, four
 * values:
 *
 * - `now`        — price is at (or within cost-noise of) the entry.
 * - `soon`       — a short, plausible approach; publishable as an actionable
 *                  plan with its distance stated.
 * - `watch_only` — the view is real but the entry is not realistically
 *                  reachable inside the plan's own validity; publish as a
 *                  market view to watch, never as a ready trade.
 * - `rejected`   — so far that publishing it as any kind of plan would be
 *                  noise; the caller should re-plan near the market.
 *
 * Leaf module on purpose (no DB, no network, mirrors planContract.ts):
 * consumed identically by the API write path and any future engine writer, so
 * the two surfaces cannot diverge.
 */

export const TRADABILITY_LIMITS = {
  /** Entry within this many ATR of price is effectively "at market". */
  nowMaxAtr: 0.4,
  /** Up to here a pending plan is a plausible near approach → `soon`. */
  soonMaxAtr: 1.5,
  /** Beyond this the plan is not publishable as a trade at all → `rejected`. */
  maxPublishableAtr: 3,
  /**
   * Optimistic traversal assumption used to sanity-check validity: price
   * rarely covers a full ATR of directed distance per bar, so expect at least
   * this many bars per ATR of distance. Deliberately a LOWER bound — if even
   * the optimistic estimate exceeds the plan's validity, the plan cannot
   * honestly activate in time.
   */
  traversalBarsPerAtr: 2,
  /** No-ATR fallback thresholds as a fraction of current price. */
  fallbackNowFrac: 0.0005,
  fallbackSoonFrac: 0.0035,
  fallbackRejectFrac: 0.01,
} as const;

export const TRADABILITY_VALUES = [
  "now",
  "soon",
  "watch_only",
  "rejected",
] as const;
export type Tradability = (typeof TRADABILITY_VALUES)[number];

export interface TradabilityInput {
  direction: "buy" | "sell" | "wait" | string;
  planType?: string | null;
  entry?: number | null;
  currentPrice?: number | null;
  /** ATR of the plan's own timeframe. Null when unavailable — never guessed. */
  atr?: number | null;
  /** Current quoted spread in price units, when a live book is visible. */
  spread?: number | null;
  validityCandles?: number | null;
}

export interface TradabilityAssessment {
  tradability: Tradability;
  /** |entry − price| in price units; null when either side is unknown. */
  entryDistance: number | null;
  /** Distance in ATR multiples; null when ATR is unavailable. */
  entryDistanceAtr: number | null;
  /** Distance in spread multiples; null when no spread was provided. */
  entryDistanceSpread: number | null;
  /**
   * Optimistic bars-to-reach-entry estimate (lower bound). Null without ATR.
   * Zero for plans already at market.
   */
  expectedBarsToActivation: number | null;
  /** Machine-readable codes explaining the verdict, most severe first. */
  reasons: string[];
  /** False when the live price could not be read — verdict fails safe. */
  priceKnown: boolean;
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * Grade reachability. Pure and total: every input shape returns a verdict.
 *
 * Fail-safe direction: when the price or the entry cannot be read, the plan is
 * `watch_only` — an unverifiable entry must never present as actionable, and a
 * data outage must never hard-reject an otherwise honest plan (operational
 * absence is not an analytical fault — same principle as the result envelope).
 */
export function assessTradability(input: TradabilityInput): TradabilityAssessment {
  const reasons: string[] = [];

  // Only directional plans are graded — a WAIT is refused upstream, and
  // grading it would imply it could pass (same stance as planContract.ts).
  if (input.direction !== "buy" && input.direction !== "sell") {
    return {
      tradability: "watch_only",
      entryDistance: null,
      entryDistanceAtr: null,
      entryDistanceSpread: null,
      expectedBarsToActivation: null,
      reasons: ["direction_not_gradable"],
      priceKnown: false,
    };
  }

  if (!finitePositive(input.entry) || !finitePositive(input.currentPrice)) {
    return {
      tradability: "watch_only",
      entryDistance: null,
      entryDistanceAtr: null,
      entryDistanceSpread: null,
      expectedBarsToActivation: null,
      reasons: [
        finitePositive(input.entry) ? "price_unavailable" : "entry_unavailable",
      ],
      priceKnown: false,
    };
  }

  const entry = input.entry;
  const price = input.currentPrice;
  const distance = Math.abs(entry - price);
  const atr = finitePositive(input.atr) ? input.atr : null;
  const spread = finitePositive(input.spread) ? input.spread : null;

  const entryDistanceAtr = atr != null ? round(distance / atr, 3) : null;
  const entryDistanceSpread =
    spread != null ? round(distance / spread, 2) : null;
  const expectedBarsToActivation =
    atr != null
      ? Math.ceil((distance / atr) * TRADABILITY_LIMITS.traversalBarsPerAtr)
      : null;

  // Within one spread of the entry, "waiting for a better price" is smaller
  // than the cost of the trade itself — that is an at-market plan.
  if (spread != null && distance <= spread) {
    return {
      tradability: "now",
      entryDistance: distance,
      entryDistanceAtr,
      entryDistanceSpread,
      expectedBarsToActivation: 0,
      reasons: ["within_spread_noise"],
      priceKnown: true,
    };
  }

  // The same epsilon convention as scalpGeometry's net-R checks: a boundary
  // value must land on the permissive side of its own boundary.
  const EPS = 1e-9;
  let verdict: Tradability;
  if (atr != null) {
    const mult = distance / atr;
    if (mult <= TRADABILITY_LIMITS.nowMaxAtr + EPS) {
      verdict = "now";
    } else if (mult <= TRADABILITY_LIMITS.soonMaxAtr + EPS) {
      verdict = "soon";
    } else if (mult <= TRADABILITY_LIMITS.maxPublishableAtr + EPS) {
      verdict = "watch_only";
      reasons.push("entry_far_from_market");
    } else {
      verdict = "rejected";
      reasons.push("entry_too_far_to_publish");
    }
  } else {
    // No volatility context: grade against price fractions, and never let a
    // far level publish as actionable on a blind read.
    const frac = distance / price;
    if (frac <= TRADABILITY_LIMITS.fallbackNowFrac + EPS) {
      verdict = "now";
    } else if (frac <= TRADABILITY_LIMITS.fallbackSoonFrac + EPS) {
      verdict = "soon";
    } else if (frac <= TRADABILITY_LIMITS.fallbackRejectFrac + EPS) {
      verdict = "watch_only";
      reasons.push("entry_far_no_volatility_context");
    } else {
      verdict = "rejected";
      reasons.push("entry_too_far_to_publish");
    }
    if (verdict !== "now") reasons.push("atr_unavailable");
  }

  // A plan that cannot plausibly activate inside its own validity window is a
  // watch item even when the raw distance graded `soon`: the OPTIMISTIC
  // traversal estimate already outlives the plan.
  if (
    verdict === "soon" &&
    expectedBarsToActivation != null &&
    input.validityCandles != null &&
    Number.isInteger(input.validityCandles) &&
    input.validityCandles >= 1 &&
    expectedBarsToActivation > input.validityCandles
  ) {
    verdict = "watch_only";
    reasons.push("activation_unlikely_within_validity");
  }

  // An "immediate" plan whose entry is not at market contradicts itself; the
  // execution-state derivation already refuses valid_now, and the verdict
  // carries the named contradiction back to the model.
  if (input.planType === "immediate" && verdict !== "now") {
    reasons.push("immediate_plan_but_entry_not_at_market");
  }

  return {
    tradability: verdict,
    entryDistance: distance,
    entryDistanceAtr,
    entryDistanceSpread,
    expectedBarsToActivation:
      verdict === "now" ? 0 : expectedBarsToActivation,
    reasons,
    priceKnown: true,
  };
}
