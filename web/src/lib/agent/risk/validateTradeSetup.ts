import {
  computeGrossR,
  computeNetR,
  meetsExecutableGeometry,
  SCALP_GEOMETRY,
} from "../trading/scalpGeometry";

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
  spread?: number | null;
  /** Precomputed net TP1 R when available from the candidate engine. */
  netRr?: number | null;
  activationClass?: "immediate" | "conditional" | "non_executable";
}

export interface TradeValidationResult {
  /** Whether the proposed numeric levels are structurally executable. Not a decision gate. */
  accepted: boolean;
  reasons: string[];
  warnings: string[];
  rr?: number;
  netRr?: number;
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
  if (input.activationClass === "conditional") {
    warnings.push("الدخول مشروط بعودة السعر إلى المنطقة — ليس فرصة فورية.");
  }

  const { trade } = input;
  if (trade.action === "wait") return { accepted: true, reasons, warnings };
  const entry = trade.entry;
  const stop = trade.stop_loss;
  const targets = (trade.targets ?? []).filter((value) => Number.isFinite(value) && value > 0);
  if (!entry || !stop || !targets.length) {
    reasons.push("مستويات الدخول والوقف والهدف غير مكتملة.");
    return { accepted: false, reasons, warnings };
  }

  const geometry = meetsExecutableGeometry({
    action: trade.action,
    entry,
    stop,
    targets,
    spread: input.spread,
  });
  const rr = computeGrossR({ entry, stop, target: targets[0]! });
  const netRr =
    input.netRr != null && Number.isFinite(input.netRr)
      ? input.netRr
      : computeNetR({
          action: trade.action,
          entry,
          stop,
          target: targets[0]!,
          spread: input.spread,
        });

  if (!geometry.ok) {
    if (geometry.reason === "level_order_invalid") {
      reasons.push("ترتيب مستويات الدخول والوقف والهدف غير صالح.");
    } else {
      reasons.push(
        `هندسة الهدف غير قابلة للتنفيذ (صافي R≈${netRr.toFixed(2)} أقل من ${SCALP_GEOMETRY.minNetTp1R}).`,
      );
    }
    return { accepted: false, reasons, warnings, rr, netRr };
  }

  if (input.activationClass === "non_executable") {
    reasons.push("منطقة الدخول بعيدة جداً عن السعر الحالي للتنفيذ الآمن.");
    return { accepted: false, reasons, warnings, rr, netRr };
  }

  return { accepted: true, reasons, warnings, rr, netRr };
}
