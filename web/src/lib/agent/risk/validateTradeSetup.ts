/**
 * Pure trade-setup validation. No I/O — deterministic and unit-testable. The
 * Risk Agent runs this on the proposed candidate; a rejected setup forces the
 * final decision to WAIT.
 */
export interface ProposedTrade {
  action: "buy" | "sell" | "wait";
  entry?: number;
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
  /** Minimum acceptable reward:risk (defaults to 1.5). */
  minRr?: number;
  /** Educational-only requests skip the RR gate. */
  educationalOnly?: boolean;
}

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
    reasons.push("Candle coverage is insufficient.");
  }
  if (!input.hasValidPoi) {
    reasons.push("Entry is not near a valid POI.");
  }
  if (input.htfConflict) {
    warnings.push("Setup conflicts with higher timeframe context.");
  }
  if (input.newsRisk === "high") {
    reasons.push("High news risk blocks the trade.");
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
