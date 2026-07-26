/**
 * What happened AFTER a historical moment (docs/UNIFIED_AGENT_PLAN.md §10).
 *
 * A fingerprint says what the market looked like; this says how it resolved.
 * Together they answer the question the agent could never ask: "when it looked
 * like this before, did the move pay?"
 *
 * The separation is deliberate and load-bearing. Features come from candles at
 * or before the moment; outcomes come from candles strictly after it. Mixing
 * them produces a memory that predicts the past perfectly and the future not at
 * all — so they live in different functions with different inputs, and the
 * indexer can only wire them one way.
 *
 * Outcomes are evaluated the way a real plan would be: a stop at one ATR, a
 * first target at two, walked bar by bar, with the stop taking precedence when
 * a single bar touches both — the same risk-honest convention the live tracker
 * uses.
 */
import type { FingerprintCandle } from "./caseFingerprint";

export type CaseResolution =
  | "target_first"
  | "stop_first"
  | "unresolved"
  | "false_break";

export interface ForwardOutcome {
  resolution: CaseResolution;
  /** Bars until resolution, or the horizon when unresolved. */
  bars: number;
  /** Best excursion in the tested direction, in ATR. */
  maxFavourableAtr: number;
  /** Worst excursion against it, in ATR. */
  maxAdverseAtr: number;
  /** Net R at resolution, costs applied. */
  netR: number;
}

const STOP_ATR = 1;
const TARGET_ATR = 2;

/**
 * Resolve one historical case.
 *
 * `future` MUST contain only candles after the case's own timestamp. This is
 * the single rule that keeps the memory honest, so it is stated here rather
 * than assumed at the call site.
 */
export function resolveForwardOutcome(input: {
  direction: "buy" | "sell";
  entry: number;
  atr: number;
  future: readonly FingerprintCandle[];
  horizon?: number;
  /** Round-trip cost in price terms, so the R is what a trade would keep. */
  cost?: number;
}): ForwardOutcome {
  const horizon = Math.min(input.horizon ?? 40, input.future.length);
  const long = input.direction === "buy";
  const stop = long ? input.entry - input.atr * STOP_ATR : input.entry + input.atr * STOP_ATR;
  const target = long
    ? input.entry + input.atr * TARGET_ATR
    : input.entry - input.atr * TARGET_ATR;
  const cost = Math.max(0, input.cost ?? 0);

  let maxFavourable = 0;
  let maxAdverse = 0;

  for (let i = 0; i < horizon; i++) {
    const bar = input.future[i]!;
    const favourable = long ? bar.high - input.entry : input.entry - bar.low;
    const adverse = long ? input.entry - bar.low : bar.high - input.entry;
    maxFavourable = Math.max(maxFavourable, favourable);
    maxAdverse = Math.max(maxAdverse, adverse);

    const hitStop = long ? bar.low <= stop : bar.high >= stop;
    const hitTarget = long ? bar.high >= target : bar.low <= target;

    // Same-bar ambiguity resolves to the stop. From OHLC alone the order is
    // unknowable, and assuming the good outcome is how a backtest lies.
    if (hitStop) {
      return {
        resolution: "stop_first",
        bars: i + 1,
        maxFavourableAtr: round(maxFavourable / input.atr),
        maxAdverseAtr: round(maxAdverse / input.atr),
        netR: round(-(input.atr * STOP_ATR + cost) / (input.atr * STOP_ATR + cost)),
      };
    }
    if (hitTarget) {
      const reward = Math.max(0, input.atr * TARGET_ATR - cost);
      const risk = input.atr * STOP_ATR + cost;
      return {
        resolution: "target_first",
        bars: i + 1,
        maxFavourableAtr: round(maxFavourable / input.atr),
        maxAdverseAtr: round(maxAdverse / input.atr),
        netR: round(reward / risk),
      };
    }
  }

  return {
    resolution: "unresolved",
    bars: horizon,
    maxFavourableAtr: round(maxFavourable / input.atr),
    maxAdverseAtr: round(maxAdverse / input.atr),
    netR: 0,
  };
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

export interface OutcomeStats {
  sampleSize: number;
  targetFirst: number;
  stopFirst: number;
  unresolved: number;
  /** Share reaching target before stop; null below a usable sample. */
  hitRate: number | null;
  averageNetR: number | null;
  averageBars: number | null;
}

/** Minimum cases before a rate is reported rather than a bare count. */
export const MIN_STATS_SAMPLE = 8;

/**
 * Aggregate outcomes.
 *
 * Below the minimum sample the counts are reported and the rates are null —
 * "3 of 4 worked" invites a conclusion the data cannot support, and this memory
 * exists to inform a decision, not to decorate it.
 */
export function summarizeOutcomes(outcomes: readonly ForwardOutcome[]): OutcomeStats {
  const sampleSize = outcomes.length;
  const targetFirst = outcomes.filter((o) => o.resolution === "target_first").length;
  const stopFirst = outcomes.filter((o) => o.resolution === "stop_first").length;
  const unresolved = outcomes.filter((o) => o.resolution === "unresolved").length;
  const resolved = targetFirst + stopFirst;

  if (sampleSize < MIN_STATS_SAMPLE) {
    return {
      sampleSize,
      targetFirst,
      stopFirst,
      unresolved,
      hitRate: null,
      averageNetR: null,
      averageBars: null,
    };
  }

  return {
    sampleSize,
    targetFirst,
    stopFirst,
    unresolved,
    hitRate: resolved > 0 ? targetFirst / resolved : null,
    averageNetR: round(
      outcomes.reduce((sum, o) => sum + o.netR, 0) / Math.max(1, sampleSize),
    ),
    averageBars: round(
      outcomes.reduce((sum, o) => sum + o.bars, 0) / Math.max(1, sampleSize),
    ),
  };
}
