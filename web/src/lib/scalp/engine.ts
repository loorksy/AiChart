import type { Momentum } from "./momentum";

/**
 * Pure scalp decision engine. Given current momentum + the open position (if
 * any) + thresholds, it returns the next action. No I/O, no side effects — the
 * worker (worker.ts) is what actually executes via the risk-gated path.
 */

export type ScalpAction = "buy" | "sell" | "close" | "reverse" | "hold";

export interface ScalpPosition {
  side: "buy" | "sell";
  entryPrice: number;
  /** How many candles the position has been held. */
  barsHeld: number;
}

export interface ScalpThresholds {
  /** Take profit (% move in favor) → close. */
  takeProfitPct: number;
  /** Stop loss (% move against) → close. */
  stopLossPct: number;
  /** Consecutive opposite candles that count as a reversal. */
  reversalBars: number;
  /** Allow short entries (false for crypto spot). */
  allowShort: boolean;
  /** Min |slopePct| to consider momentum strong enough to enter. */
  entrySlopePct: number;
}

export const DEFAULT_SCALP_THRESHOLDS: ScalpThresholds = {
  takeProfitPct: 0.3,
  stopLossPct: 0.2,
  reversalBars: 2,
  allowShort: false,
  entrySlopePct: 0.05,
};

export interface ScalpDecision {
  action: ScalpAction;
  /** Target side for buy/sell/reverse. */
  side?: "buy" | "sell";
  reason: string;
  /** 0–100 heuristic confidence (not the LLM's). */
  confidence: number;
}

function pnlPct(position: ScalpPosition, price: number): number {
  if (position.entryPrice <= 0) return 0;
  const raw = ((price - position.entryPrice) / position.entryPrice) * 100;
  return position.side === "buy" ? raw : -raw;
}

/**
 * Decide the next scalp action.
 *
 * No position:
 *   - strong up momentum → BUY
 *   - strong down momentum → SELL (only if allowShort)
 *   - else HOLD
 * In a position:
 *   - TP/SL hit → CLOSE
 *   - reversal against the position (>= reversalBars opposite candles or EMA
 *     flip) → REVERSE (flip) if allowed, else CLOSE
 *   - else HOLD (let the winner run)
 */
export function decideScalpAction(
  momentum: Momentum,
  position: ScalpPosition | null,
  price: number,
  thresholds: ScalpThresholds = DEFAULT_SCALP_THRESHOLDS,
): ScalpDecision {
  const t = thresholds;

  if (!position) {
    const upBurst =
      momentum.lastCandleBullish &&
      momentum.emaFast >= momentum.emaSlow &&
      momentum.slopePct >= t.entrySlopePct;
    if (upBurst) {
      return {
        action: "buy",
        side: "buy",
        reason: `زخم صاعد فوري (slope ${momentum.slopePct.toFixed(2)}%، شمعة خضراء، EMA سريع فوق البطيء)`,
        confidence: Math.min(90, 55 + Math.round(momentum.slopePct * 50)),
      };
    }
    const downBurst =
      !momentum.lastCandleBullish &&
      momentum.emaFast <= momentum.emaSlow &&
      momentum.slopePct <= -t.entrySlopePct;
    if (downBurst && t.allowShort) {
      return {
        action: "sell",
        side: "sell",
        reason: `زخم هابط فوري (slope ${momentum.slopePct.toFixed(2)}%، شمعة حمراء، EMA سريع تحت البطيء)`,
        confidence: Math.min(90, 55 + Math.round(-momentum.slopePct * 50)),
      };
    }
    return { action: "hold", reason: "لا زخم واضح للدخول", confidence: 40 };
  }

  // In a position — manage it.
  const gain = pnlPct(position, price);
  if (gain >= t.takeProfitPct) {
    return {
      action: "close",
      reason: `جني ربح: +${gain.toFixed(2)}% ≥ هدف ${t.takeProfitPct}%`,
      confidence: 80,
    };
  }
  if (gain <= -t.stopLossPct) {
    return {
      action: "close",
      reason: `وقف خسارة: ${gain.toFixed(2)}% ≤ -${t.stopLossPct}%`,
      confidence: 80,
    };
  }

  const reversedAgainstLong =
    position.side === "buy" &&
    (momentum.consecutiveDown >= t.reversalBars ||
      momentum.emaFast < momentum.emaSlow);
  const reversedAgainstShort =
    position.side === "sell" &&
    (momentum.consecutiveUp >= t.reversalBars ||
      momentum.emaFast > momentum.emaSlow);

  if (reversedAgainstLong || reversedAgainstShort) {
    const flipSide: "buy" | "sell" =
      position.side === "buy" ? "sell" : "buy";
    if ((flipSide === "sell" && t.allowShort) || flipSide === "buy") {
      return {
        action: "reverse",
        side: flipSide,
        reason: `انعكاس ضد ${position.side} (${position.side === "buy" ? momentum.consecutiveDown : momentum.consecutiveUp} شموع معاكسة / EMA flip) — قلب الاتجاه`,
        confidence: 70,
      };
    }
    return {
      action: "close",
      reason: `انعكاس ضد ${position.side} — إغلاق (الشورت غير مسموح)`,
      confidence: 70,
    };
  }

  return {
    action: "hold",
    reason: `استمرار في ${position.side} (PnL ${gain.toFixed(2)}%) — دع الرابح يجري`,
    confidence: 55,
  };
}
