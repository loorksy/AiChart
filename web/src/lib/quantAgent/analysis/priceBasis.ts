/**
 * Price-basis anchoring: expressing an analysis in the reader's own book.
 *
 * The analysis engine computes market SHAPE from a shared reference series —
 * one read that serves every user, which is what makes a cron tick, a memory
 * corpus and a cross-user comparison possible at all. But every price it emits
 * (entry, stop, target, support, resistance, pivot) is then read by someone
 * with their own broker's chart open, and two books never agree to the tick.
 * A stop 30 cents away from where the reader's chart puts it is not a cosmetic
 * difference: on a $1.50 XAUUSD scalp risk that is a fifth of the risk budget.
 *
 * So the shape is computed once, and a single scalar translates it into the
 * reader's price space before anything downstream — the prompt, the scorer,
 * the model, the row — sees a number.
 *
 * WHY A CONSTANT OFFSET IS THE RIGHT TRANSFORM
 *
 * Every price-anchored quantity in this engine is a positively-weighted affine
 * combination of bar prices whose weights sum to one: pivot is (H+L+C)/3, r1 is
 * 2·pivot − low, support averages three levels, the Bollinger middle is an
 * SMA. Add δ to every input price and each of those outputs moves by exactly δ.
 * Meanwhile every DISTANCE is untouched — stop distance, target distance, the
 * risk/reward ratio, ATR — because δ cancels in a subtraction. And the
 * oscillators never see it at all: RSI and MACD are functions of differences.
 *
 * That is the whole reason to shift the BARS rather than the outputs. Shifting
 * outputs means enumerating every price field and shipping a bug the day
 * someone adds an eleventh; shifting the input series makes the property
 * structural, and the arithmetic above guarantees the two are identical.
 *
 * WHEN SHIFTING WOULD BE A LIE
 *
 * A small offset is two books pricing the same instrument. A large one is not:
 * it means either the symbols are not the same instrument, or the reference
 * series is old enough that the market has genuinely moved. In BOTH cases the
 * levels are untrustworthy — stale support is not made current by sliding it —
 * so the engine refuses to anchor and the caller must publish a direction
 * without price levels rather than levels in the wrong place. One rule
 * covers both failures because both have the same correct response.
 */
import { createLogger } from "@/lib/logger";
import { getForexLiveQuote, type LiveForexQuote } from "@/lib/markets/forexPrice";

/** The shape anchoring needs from a quote: two sides of one book. */
export type LiveQuote = Pick<LiveForexQuote, "bid" | "ask">;
import type { QuantOhlcBar } from "../types";

const log = createLogger("quant_agent:analysis:price_basis");

/**
 * Beyond this relative gap the offset stops being a book difference.
 *
 * Retail markup on major FX is under a basis point, and on gold a few cents on
 * a four-figure price — comfortably inside 0.5%. A gap wider than that is a
 * different instrument or a stale series, and the honest response to either is
 * to withhold the levels, so the threshold does not need to distinguish them.
 */
export const MAX_BASIS_DIVERGENCE_RATIO = 0.005;

/** How long to wait for the reader's own quote before giving up on anchoring. */
const QUOTE_TIMEOUT_MS = 2_500;

export type PriceBasisStatus =
  /** Anchored to the reader's book; every price below is in their space. */
  | "anchored"
  /** Already in their space — the offset was too small to be worth applying. */
  | "aligned"
  /** No linked account, so there is no second book to reconcile against. */
  | "unlinked"
  /** An account exists but did not answer in time; levels stay unanchored. */
  | "unavailable"
  /** The books disagree too much to reconcile. Levels must be withheld. */
  | "divergent";

export interface PriceBasis {
  status: PriceBasisStatus;
  /** Add this to a reference price to land in the reader's book. */
  delta: number;
  /** The reader's mid at the moment of the run, when we got one. */
  brokerMid: number | null;
  /** The reference close the offset was measured against. */
  referencePrice: number | null;
  /** |delta| / referencePrice, for the audit trail and the divergence notice. */
  divergenceRatio: number | null;
  /**
   * True when price levels must NOT be published. Set only by `divergent`:
   * the other non-anchored states leave the reference numbers intact and
   * merely unreconciled, which is a caveat, not a falsehood.
   */
  suppressLevels: boolean;
}

/** Below this fraction of price the offset is noise; shifting adds nothing. */
const NEGLIGIBLE_RATIO = 1e-6;

function basis(partial: Partial<PriceBasis> & { status: PriceBasisStatus }): PriceBasis {
  return {
    delta: 0,
    brokerMid: null,
    referencePrice: null,
    divergenceRatio: null,
    suppressLevels: false,
    ...partial,
  };
}

/**
 * Measure the offset between the reference series and the reader's own book.
 *
 * Never throws and never blocks for long: a missing quote degrades to
 * `unlinked`/`unavailable`, which leaves the analysis usable but unreconciled.
 * The only outcome that withholds anything is `divergent`.
 */
export async function resolvePriceBasis(input: {
  userId: number | null | undefined;
  symbol: string;
  referencePrice: number | null;
  /** Injection seam — the default reads the reader's own cloud account. */
  getQuote?: (userId: number, symbol: string) => Promise<LiveQuote | null>;
}): Promise<PriceBasis> {
  const { userId, symbol, referencePrice } = input;

  if (referencePrice == null || !Number.isFinite(referencePrice) || referencePrice <= 0) {
    return basis({ status: "unavailable" });
  }
  if (!userId || userId <= 0) {
    return basis({ status: "unlinked", referencePrice });
  }

  const read =
    input.getQuote ??
    ((id: number, sym: string) => getForexLiveQuote(id, sym, { timeoutMs: QUOTE_TIMEOUT_MS }));

  // A broken quote must never take the analysis down with it. The reader loses
  // the translation, not the report.
  const quote = await read(userId, symbol).catch(() => null);
  if (!quote) {
    // No account, mt5local, a closed market, or a slow broker. All of them mean
    // the same thing here: nothing to reconcile against right now.
    return basis({ status: "unlinked", referencePrice });
  }

  // The mid, not the bid: the reference series is built from mid-ish closes,
  // and anchoring to one side of the reader's spread would bake half their
  // spread into every level.
  const brokerMid = (quote.bid + quote.ask) / 2;
  if (!Number.isFinite(brokerMid) || brokerMid <= 0) {
    return basis({ status: "unavailable", referencePrice });
  }

  const delta = brokerMid - referencePrice;
  const divergenceRatio = Math.abs(delta) / referencePrice;

  if (divergenceRatio > MAX_BASIS_DIVERGENCE_RATIO) {
    log.warn("quant_agent.analysis.basis_divergent", {
      symbol,
      divergenceRatio: Number(divergenceRatio.toFixed(6)),
    });
    return basis({
      status: "divergent",
      brokerMid,
      referencePrice,
      divergenceRatio,
      suppressLevels: true,
    });
  }

  if (divergenceRatio < NEGLIGIBLE_RATIO) {
    return basis({ status: "aligned", brokerMid, referencePrice, divergenceRatio });
  }

  return basis({ status: "anchored", delta, brokerMid, referencePrice, divergenceRatio });
}

/**
 * Translate a bar series into the reader's price space.
 *
 * Volume is untouched — it is not a price — and the series is copied rather
 * than mutated so the caller keeps the unshifted reference bars for anything
 * that has to stay comparable across users.
 */
export function shiftBars(bars: QuantOhlcBar[], delta: number): QuantOhlcBar[] {
  if (!Number.isFinite(delta) || delta === 0) return bars;
  return bars.map((bar) => ({
    ...bar,
    open: bar.open + delta,
    high: bar.high + delta,
    low: bar.low + delta,
    close: bar.close + delta,
  }));
}

/** Whether this basis actually moved the numbers. */
export function isAnchored(b: PriceBasis): boolean {
  return b.status === "anchored" && b.delta !== 0;
}
