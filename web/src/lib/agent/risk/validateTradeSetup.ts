/**
 * Pure trade-setup validation. No I/O — deterministic and unit-testable. The
 * Risk Agent runs this on the proposed candidate; a rejected setup forces the
 * final decision to WAIT.
 */
export interface ProposedTrade {
  action: "buy" | "sell" | "wait";
  entry?: number;
  entryType?: "market" | "buy_limit" | "buy_stop" | "sell_limit" | "sell_stop";
  stop_loss?: number;
  targets?: number[];
}

export interface TradeValidationInput {
  trade: ProposedTrade;
  currentPrice: number;
  atr?: number | null;
  spread?: number | null;
  hasValidPoi: boolean;
  htfConflict: boolean;
  newsRisk: "low" | "medium" | "high" | "unknown";
  dataSufficient: boolean;
  /** Exact coverage explanation when data is insufficient (never invents counts). */
  coverageDetail?: string;
  /** Minimum acceptable reward:risk (defaults to 1.5). */
  minRr?: number;
  /** Educational-only requests skip the RR gate. */
  educationalOnly?: boolean;
  // --- Phase-2 context (all optional for backward compatibility) ---
  /** Session-based risk (Asia/London/NY open volatility etc.). */
  sessionRisk?: "low" | "medium" | "high" | "unknown";
  spreadState?: "normal" | "wide" | "unknown";
  volatilityState?: "normal" | "spike" | "dead" | "unknown";
  /** How far price is from the intended entry. "missed" = already ran away. */
  entryDistanceState?: "near" | "far" | "missed" | "unknown";
  /** Reversal evidence (sweep + CHoCH/MSS) that can justify counter-HTF. */
  hasReversalEvidence?: boolean;
  /** POI quality score 0–100; below threshold blocks the trade. */
  poiScore?: number;
  rangePosition?:
    | "premium"
    | "discount"
    | "mid_range"
    | "near_high"
    | "near_low"
    | "unknown";
  setupType?:
    | "trend_continuation"
    | "reversal_after_sweep"
    | "range_boundary"
    | "breakout_retest";
  /** Market closed blocks execution; educational analysis may continue. */
  marketOpen?: boolean;
}

/** POI score below this cannot produce a Buy/Sell. */
export const MIN_TRADABLE_POI_SCORE = 75;

export interface TradeValidationResult {
  accepted: boolean;
  reasons: string[];
  warnings: string[];
  rr?: number;
}

export function validateTradeSetup(
  input: TradeValidationInput,
): TradeValidationResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const { trade } = input;
  const minRr = input.minRr ?? 1.5;

  if (trade.action === "wait") {
    return { accepted: true, reasons: ["No trade requested."], warnings };
  }

  if (!input.dataSufficient) {
    reasons.push(
      input.coverageDetail?.trim() ||
        "Candle coverage is insufficient — available/required counts were not supplied.",
    );
  }
  if (!input.hasValidPoi) {
    reasons.push("Entry is not near a valid POI.");
  }
  // HTF conflict is a hard BLOCK unless reversal evidence exists.
  if (input.htfConflict) {
    if (input.hasReversalEvidence) {
      warnings.push(
        "Setup conflicts with higher timeframe but reversal evidence exists.",
      );
    } else {
      reasons.push(
        "Higher-timeframe conflict without reversal evidence blocks the trade.",
      );
    }
  }
  if (input.newsRisk === "high") {
    reasons.push("High news risk blocks the trade.");
  }

  // --- Phase-2 gates ---------------------------------------------------
  if (input.poiScore != null && input.poiScore < MIN_TRADABLE_POI_SCORE) {
    reasons.push(
      `POI score ${input.poiScore} is below the tradable minimum (${MIN_TRADABLE_POI_SCORE}).`,
    );
  }
  if (
    input.rangePosition === "mid_range" &&
    input.setupType !== "breakout_retest"
  ) {
    reasons.push("Price is mid-range without a breakout-retest setup.");
  }
  if (input.entryDistanceState === "missed") {
    reasons.push("Price already ran away from the entry — setup missed.");
  } else if (input.entryDistanceState === "far") {
    warnings.push("Entry is far from current price — setup may take time.");
  }
  if (input.spreadState === "wide") {
    reasons.push("Spread is too wide for a safe stop.");
  }
  if (input.volatilityState === "spike" && !input.educationalOnly) {
    reasons.push("Volatility spike — execution blocked until it settles.");
  } else if (input.volatilityState === "dead") {
    warnings.push("Very low volatility — targets may take long to reach.");
  }
  if (input.sessionRisk === "high") {
    warnings.push("High session risk (open/rollover volatility).");
  }
  if (input.marketOpen === false && !input.educationalOnly) {
    reasons.push("Market is closed — execution is blocked (analysis only).");
  }

  const entry = trade.entry;
  const sl = trade.stop_loss;
  const tp = trade.targets?.find((t) => Number.isFinite(t) && t > 0);

  if (entry == null || sl == null || tp == null) {
    reasons.push("Entry, stop loss, or target is missing.");
    return { accepted: false, reasons, warnings };
  }

  if (trade.action === "buy" && !(sl < entry && tp > entry)) {
    reasons.push("Invalid buy levels: must satisfy SL < entry < TP.");
  }
  if (trade.action === "sell" && !(tp < entry && entry < sl)) {
    reasons.push("Invalid sell levels: must satisfy TP < entry < SL.");
  }

  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const rr = risk > 0 ? reward / risk : 0;

  if (!input.educationalOnly && rr < minRr) {
    reasons.push(`Risk/reward is too weak: ${rr.toFixed(2)} (min ${minRr}).`);
  }
  if (input.atr && risk < input.atr * 0.25) {
    reasons.push("Stop loss is too close relative to ATR.");
  }
  if (input.spread && risk < input.spread * 5) {
    reasons.push("Stop loss is too close relative to spread.");
  }

  const entryEqualsCurrent =
    Math.abs(entry - input.currentPrice) <= (input.spread ?? 0.00001) * 2;
  if (entryEqualsCurrent && !input.hasValidPoi) {
    reasons.push("Entry equals current price without valid POI.");
  }

  return { accepted: reasons.length === 0, reasons, warnings, rr };
}
