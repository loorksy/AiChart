import { BridgeErrorCode } from "./bridge/errors";
import type { AdminLimits, TradeIntent } from "./types";

export interface ExecutionSafetyDecision {
  ok: boolean;
  reason: string;
  denyCode?: BridgeErrorCode;
}

/** Technical order validity only; this function never judges the AI decision. */
export function validateExecutionIntent(
  intent: TradeIntent,
  limits: AdminLimits,
): ExecutionSafetyDecision {
  const deny = (reason: string, denyCode = BridgeErrorCode.VALIDATION_ERROR) => ({
    ok: false as const,
    reason,
    denyCode,
  });
  if (!Boolean(limits.can_execute)) {
    return deny("الحساب غير مخوّل تقنياً لإرسال الأوامر.", BridgeErrorCode.EXECUTION_UNAUTHORIZED);
  }
  if (intent.market !== "forex" || intent.market_type === "futures") {
    return deny("التنفيذ متاح لعقود الفوركس الفورية فقط.");
  }
  if (!intent.symbol?.trim() || (intent.side !== "buy" && intent.side !== "sell")) {
    return deny("الرمز أو اتجاه الأمر غير صالح.");
  }
  const stop = Number(intent.stop_loss);
  if (!Number.isFinite(stop) || stop <= 0) {
    return deny("وقف الخسارة صالح وإلزامي لحساب حجم المركز.");
  }
  const entry = Number(intent.limit_price ?? intent.entry);
  if (Number.isFinite(entry) && entry > 0) {
    if (intent.side === "buy" && stop >= entry) {
      return deny("وقف صفقة الشراء يجب أن يكون أسفل سعر الدخول.");
    }
    if (intent.side === "sell" && stop <= entry) {
      return deny("وقف صفقة البيع يجب أن يكون أعلى سعر الدخول.");
    }
  }
  return { ok: true, reason: "صالح تقنياً" };
}
