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
import { detectChartGeometry, MIN_GEOMETRY_CANDLES } from "@/lib/chart/geometry";
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

/**
 * Partial-stage outcomes (plan §12): what became of a pattern that was still
 * FORMING when the case was indexed.
 *
 * A completed pattern already answered its own question; a forming one poses
 * two more that the plain outcome cannot see: did the structure go on to
 * complete or fail, and what did entering early — before confirmation — cost
 * or earn against waiting for the confirmed break? Both entries are measured
 * to the SAME horizon and both pay the session cost, so the comparison is a
 * fair one rather than an argument for whichever leg was measured longer.
 */
export type FormingResolution = "completed" | "failed" | "unresolved";

/** Stages during which a pattern still counts as forming (see patternStage). */
const FORMING_STAGES = new Set(["starting", "forming", "near_completion"]);

export function isFormingStage(stage: string | null | undefined): boolean {
  return stage != null && FORMING_STAGES.has(stage);
}

export interface FormingOutcome {
  /** Did the forming structure complete or fail once the future arrived? */
  formingOutcome: FormingResolution;
  /** Bars until the completing close; null when it never closed beyond. */
  formingBars: number | null;
  /** The boundary broke and price came back through it. */
  falseBreak: boolean;
  /** Net R entering at the case's own moment, before confirmation. */
  earlyNetR: number;
  /** Net R entering on the confirmed completing close; null without one. */
  confirmedNetR: number | null;
  /** Round-trip session cost charged to both entries, in price terms. */
  sessionCost: number;
}

/**
 * Resolve the partial-stage outcome of one forming-pattern case.
 *
 * `future` MUST contain only candles strictly after the case's timestamp —
 * the same rule as `resolveForwardOutcome`. `history` (candles at or before
 * the case) exists ONLY so the same deterministic geometry detectors can be
 * re-run over the extended window to ask whether the structure failed; it
 * never touches a feature, and the frozen `breakLevel` is the boundary AS IT
 * WAS at the case time.
 */
export function resolveFormingOutcome(input: {
  history: readonly FingerprintCandle[];
  future: readonly FingerprintCandle[];
  patternType: string;
  breakDirection: "up" | "down";
  /** The level whose close-beyond would complete the pattern, frozen at t. */
  breakLevel: number;
  /** The case's entry price (its own close) — the anticipatory entry. */
  entry: number;
  atr: number;
  horizon?: number;
  /** Round-trip cost in price terms, from the session spread model. */
  cost?: number;
}): FormingOutcome | null {
  if (!(input.atr > 0) || !Number.isFinite(input.breakLevel)) return null;
  const requested = input.horizon ?? 40;
  const window = input.future.slice(0, requested);
  if (!window.length) return null;
  const up = input.breakDirection === "up";
  const cost = Math.max(0, input.cost ?? 0);

  // First intrabar touch and first close beyond the frozen boundary.
  let completeIndex: number | null = null;
  let touchedIndex: number | null = null;
  for (let i = 0; i < window.length; i++) {
    const bar = window[i]!;
    const pierced = up ? bar.high >= input.breakLevel : bar.low <= input.breakLevel;
    if (pierced && touchedIndex == null) touchedIndex = i;
    const closedBeyond = up ? bar.close > input.breakLevel : bar.close < input.breakLevel;
    if (closedBeyond) {
      completeIndex = i;
      break;
    }
  }

  let resolution: FormingResolution;
  if (completeIndex != null) {
    resolution = "completed";
  } else if (window.length < requested) {
    // The forward window has not fully arrived; the answer has not either.
    resolution = "unresolved";
  } else {
    // No completing close. The SAME detectors, over the extended window,
    // say whether the structure survived, died, or dissolved entirely.
    const extended = [...input.history, ...window];
    let redetected: "forming" | "completed" | "invalidated" | null = null;
    if (extended.length >= MIN_GEOMETRY_CANDLES) {
      const snapshot = detectChartGeometry({ candles: extended, atr: input.atr });
      redetected =
        snapshot.patterns.find((p) => p.patternType === input.patternType)?.status ?? null;
    }
    resolution =
      redetected === "completed"
        ? "completed" // a sloped boundary completed away from the frozen level
        : redetected === "forming"
          ? "unresolved"
          : "failed"; // invalidated, or the structure dissolved
  }

  // A false break is a boundary that broke and was then closed back through:
  // a pierce that never closed beyond, or a completion the market took back.
  const backInside = (bar: FingerprintCandle) =>
    up ? bar.close < input.breakLevel : bar.close > input.breakLevel;
  const falseBreak =
    completeIndex != null
      ? window.slice(completeIndex + 1).some(backInside)
      : touchedIndex != null;

  const direction = up ? ("buy" as const) : ("sell" as const);
  const early = resolveForwardOutcome({
    direction,
    entry: input.entry,
    atr: input.atr,
    future: window,
    horizon: window.length,
    cost,
  });

  // The confirmed entry starts at the completing close and runs to the SAME
  // horizon end, so waiting is charged exactly the bars it spent waiting.
  let confirmedNetR: number | null = null;
  if (completeIndex != null) {
    const rest = window.slice(completeIndex + 1);
    confirmedNetR = rest.length
      ? resolveForwardOutcome({
          direction,
          entry: window[completeIndex]!.close,
          atr: input.atr,
          future: rest,
          horizon: rest.length,
          cost,
        }).netR
      : 0;
  }

  return {
    formingOutcome: resolution,
    formingBars: completeIndex != null ? completeIndex + 1 : null,
    falseBreak,
    earlyNetR: early.netR,
    confirmedNetR,
    sessionCost: Number(cost.toFixed(6)),
  };
}

export interface FormingStageStats {
  /** Matched cases that carry a partial-stage outcome. */
  sampleSize: number;
  completed: number;
  failed: number;
  unresolved: number;
  falseBreaks: number;
  /** Completions over resolved forming cases; null below a usable sample. */
  completionRate: number | null;
  falseBreakRate: number | null;
  averageEarlyNetR: number | null;
  averageConfirmedNetR: number | null;
}

/**
 * Aggregate partial-stage outcomes under the same discipline as
 * `summarizeOutcomes`: below the minimum sample, counts only — never a rate.
 */
export function summarizeFormingOutcomes(
  outcomes: readonly Pick<
    FormingOutcome,
    "formingOutcome" | "falseBreak" | "earlyNetR" | "confirmedNetR"
  >[],
): FormingStageStats {
  const sampleSize = outcomes.length;
  const completed = outcomes.filter((o) => o.formingOutcome === "completed").length;
  const failed = outcomes.filter((o) => o.formingOutcome === "failed").length;
  const unresolved = outcomes.filter((o) => o.formingOutcome === "unresolved").length;
  const falseBreaks = outcomes.filter((o) => o.falseBreak).length;

  if (sampleSize < MIN_STATS_SAMPLE) {
    return {
      sampleSize,
      completed,
      failed,
      unresolved,
      falseBreaks,
      completionRate: null,
      falseBreakRate: null,
      averageEarlyNetR: null,
      averageConfirmedNetR: null,
    };
  }

  const resolved = completed + failed;
  const confirmed = outcomes.filter((o) => o.confirmedNetR != null);
  return {
    sampleSize,
    completed,
    failed,
    unresolved,
    falseBreaks,
    completionRate: resolved > 0 ? completed / resolved : null,
    falseBreakRate: falseBreaks / sampleSize,
    averageEarlyNetR: round(
      outcomes.reduce((sum, o) => sum + o.earlyNetR, 0) / sampleSize,
    ),
    averageConfirmedNetR: confirmed.length
      ? round(
          confirmed.reduce((sum, o) => sum + (o.confirmedNetR ?? 0), 0) /
            confirmed.length,
        )
      : null,
  };
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
