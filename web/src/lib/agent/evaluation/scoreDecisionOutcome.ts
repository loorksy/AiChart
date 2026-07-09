/**
 * Outcome scorer for replayed decisions: walks the candles AFTER the decision
 * point and reports whether the entry triggered and whether TP or SL was hit
 * first (win / loss / timeout / no-entry), plus the RR actually achieved.
 * Conservative tie-break: a candle touching BOTH SL and TP counts as a loss.
 */
import type { AgentCandle } from "../marketContext/detectors";

export interface DecisionOutcomeInput {
  action: "buy" | "sell" | "wait";
  entry?: number;
  stop_loss?: number;
  targets?: number[];
  futureCandles: AgentCandle[];
  /** Evaluation horizon in candles (default 100). */
  horizon?: number;
}

export interface DecisionOutcome {
  decision: "buy" | "sell" | "wait";
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  entryTriggered: boolean;
  result: "win" | "loss" | "timeout" | "no_entry" | "not_applicable";
  rrAchieved: number;
  candlesToOutcome: number;
  falseSignalReason?: string;
}

export function scoreDecisionOutcome(
  input: DecisionOutcomeInput,
): DecisionOutcome {
  if (input.action === "wait") {
    return {
      decision: "wait",
      entryTriggered: false,
      result: "not_applicable",
      rrAchieved: 0,
      candlesToOutcome: 0,
    };
  }

  const entry = input.entry;
  const sl = input.stop_loss;
  const tp = input.targets?.[0];
  if (entry == null || sl == null || tp == null) {
    return {
      decision: input.action,
      entryTriggered: false,
      result: "not_applicable",
      rrAchieved: 0,
      candlesToOutcome: 0,
      falseSignalReason: "Trade levels are incomplete.",
    };
  }

  const horizon = input.horizon ?? 100;
  const window = input.futureCandles.slice(0, horizon);
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const rrPlanned = risk > 0 ? reward / risk : 0;

  let triggered = false;
  for (let i = 0; i < window.length; i++) {
    const c = window[i]!;

    if (!triggered) {
      // Limit-style trigger: price must reach the entry level.
      const touchesEntry = c.low <= entry && entry <= c.high;
      if (touchesEntry) triggered = true;
      else continue;
    }

    const hitsSl = input.action === "buy" ? c.low <= sl : c.high >= sl;
    const hitsTp = input.action === "buy" ? c.high >= tp : c.low <= tp;

    // Both in one candle → conservative: count the loss.
    if (hitsSl) {
      return {
        decision: input.action,
        entry,
        stopLoss: sl,
        takeProfit: tp,
        entryTriggered: true,
        result: "loss",
        rrAchieved: -1,
        candlesToOutcome: i + 1,
        falseSignalReason: hitsTp
          ? "SL and TP in the same candle — counted as loss."
          : undefined,
      };
    }
    if (hitsTp) {
      return {
        decision: input.action,
        entry,
        stopLoss: sl,
        takeProfit: tp,
        entryTriggered: true,
        result: "win",
        rrAchieved: Math.round(rrPlanned * 100) / 100,
        candlesToOutcome: i + 1,
      };
    }
  }

  if (!triggered) {
    return {
      decision: input.action,
      entry,
      stopLoss: sl,
      takeProfit: tp,
      entryTriggered: false,
      result: "no_entry",
      rrAchieved: 0,
      candlesToOutcome: window.length,
      falseSignalReason: "Price never returned to the entry zone.",
    };
  }

  return {
    decision: input.action,
    entry,
    stopLoss: sl,
    takeProfit: tp,
    entryTriggered: true,
    result: "timeout",
    rrAchieved: 0,
    candlesToOutcome: window.length,
    falseSignalReason: "Neither TP nor SL hit within the horizon.",
  };
}
