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
  dataSufficient: boolean;
  coverageDetail?: string;
  htfConflict?: boolean;
  newsRisk?: "low" | "medium" | "high" | "unknown";
  poiScore?: number;
  spreadState?: "normal" | "wide" | "unknown";
  entryDistanceState?: "near" | "far" | "missed" | "unknown";
}

export interface TradeValidationResult {
  /** Whether the proposed numeric levels are structurally usable. Not a decision gate. */
  accepted: boolean;
  reasons: string[];
  warnings: string[];
  rr?: number;
}

/** Produces evidence annotations and validates numbers without overriding BUY/SELL/WAIT. */
export function validateTradeSetup(input: TradeValidationInput): TradeValidationResult {
  const warnings: string[] = [];
  const reasons: string[] = [];
  if (!input.dataSufficient) warnings.push(input.coverageDetail?.trim() || "تغطية البيانات محدودة.");
  if (input.htfConflict) warnings.push("يوجد تعارض مع الفريم الأعلى.");
  if (input.newsRisk === "high") warnings.push("خطر إخباري مرتفع قريب.");
  if (input.poiScore != null && input.poiScore < 75) warnings.push(`درجة POI منخفضة (${input.poiScore}).`);
  if (input.spreadState === "wide") warnings.push("السبريد واسع نسبةً إلى الوقف.");
  if (input.entryDistanceState === "missed") warnings.push("السعر ابتعد عن منطقة الدخول.");

  const { trade } = input;
  if (trade.action === "wait") return { accepted: true, reasons, warnings };
  const entry = trade.entry;
  const stop = trade.stop_loss;
  const target = trade.targets?.find((value) => Number.isFinite(value) && value > 0);
  if (!entry || !stop || !target) {
    reasons.push("مستويات الدخول والوقف والهدف غير مكتملة.");
    return { accepted: false, reasons, warnings };
  }
  const valid = trade.action === "buy"
    ? stop < entry && target > entry
    : target < entry && entry < stop;
  if (!valid) reasons.push("ترتيب مستويات الدخول والوقف والهدف غير صالح.");
  const risk = Math.abs(entry - stop);
  const rr = risk > 0 ? Math.abs(target - entry) / risk : 0;
  return { accepted: valid, reasons, warnings, rr };
}
