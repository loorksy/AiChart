import type { EaSymbolSpec } from "../types";

export interface LotSizingResult {
  ok: boolean;
  lots: number;
  riskAmount: number;
  lossPerLot?: number;
  reason?: string;
}

/**
 * Selects the price used for stop-distance sizing.
 *
 * Market orders must use the latest executable side quote (ask for buys, bid
 * for sells).  The analysed chart entry is only a last-resort fallback because
 * sizing from it can silently exceed the configured risk after broker spread
 * or price movement.  Pending orders are sized from their explicit limit.
 */
export function resolveSizingReferencePrice(input: {
  orderType: "market" | "limit" | "stop";
  limitPrice?: number | null;
  analysedEntry?: number | null;
  sideQuote?: number | null;
  ask?: number | null;
  bid?: number | null;
}): number {
  const positive = (...values: Array<number | null | undefined>): number => {
    for (const value of values) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
    return 0;
  };

  // A pending order (limit or stop) is sized off its own trigger price, not
  // the current quote — that quote is not what the order will fill at.
  if (input.orderType === "limit" || input.orderType === "stop") {
    return positive(input.limitPrice);
  }
  return positive(
    input.sideQuote,
    input.ask,
    input.bid,
    input.analysedEntry,
  );
}

function floorToStep(value: number, step: number): number {
  const floored = Math.floor((value + Number.EPSILON) / step) * step;
  const decimals = (step.toString().split(".")[1] || "").length;
  return Number(floored.toFixed(decimals));
}

/**
 * True stop-distance sizing using broker-provided tick economics:
 *   lossPerLot = |entry-stop| / tickSize * tickValue
 *   lots       = riskAmount / lossPerLot
 *
 * The result is always rounded down. If the broker minimum would exceed the
 * risk budget, execution fails instead of silently increasing risk.
 */
export function computeForexLots(
  riskAmount: number,
  entryPrice: number,
  stopLoss: number | null | undefined,
  spec: EaSymbolSpec | null,
): LotSizingResult {
  const fail = (reason: string): LotSizingResult => ({
    ok: false,
    lots: 0,
    riskAmount,
    reason,
  });
  if (!Number.isFinite(riskAmount) || riskAmount <= 0) {
    return fail("قيمة المخاطرة المحسوبة غير صالحة.");
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return fail("سعر الدخول غير متاح لحساب المخاطرة.");
  }
  if (stopLoss == null || !Number.isFinite(stopLoss) || stopLoss <= 0) {
    return fail("وقف الخسارة مطلوب لحساب حجم المركز.");
  }
  if (!spec) {
    return fail("مواصفات الرمز غير متاحة من MetaTrader.");
  }

  const tickSize = Number(spec.tick_size);
  const tickValue = Number(spec.tick_value);
  const minLot = Number(spec.min_lot);
  const maxLot = Number(spec.max_lot);
  const lotStep = Number(spec.lot_step);
  const stopDistance = Math.abs(entryPrice - stopLoss);

  if (
    !Number.isFinite(tickSize) || tickSize <= 0 ||
    !Number.isFinite(tickValue) || tickValue <= 0 ||
    !Number.isFinite(minLot) || minLot <= 0 ||
    !Number.isFinite(maxLot) || maxLot < minLot ||
    !Number.isFinite(lotStep) || lotStep <= 0 ||
    !Number.isFinite(stopDistance) || stopDistance <= 0
  ) {
    return fail("بيانات tick أو حدود اللوت غير مكتملة؛ أُلغي التنفيذ بأمان.");
  }

  const lossPerLot = (stopDistance / tickSize) * tickValue;
  if (!Number.isFinite(lossPerLot) || lossPerLot <= 0) {
    return fail("تعذّر حساب الخسارة المتوقعة لكل لوت.");
  }

  const lots = floorToStep(Math.min(riskAmount / lossPerLot, maxLot), lotStep);
  if (lots < minLot) {
    return fail("الحد الأدنى للوت يتجاوز Risk per Trade؛ لم يُرسل أي أمر.");
  }
  return { ok: true, lots, riskAmount, lossPerLot };
}

export function lotsToNotional(lot: number, price: number, contractSize: number): number {
  if (lot <= 0 || price <= 0 || contractSize <= 0) return 0;
  return lot * price * contractSize;
}
