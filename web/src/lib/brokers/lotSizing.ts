import type { EaSymbolSpec } from "../types";

export interface LotSizingResult {
  ok: boolean;
  lots: number;
  reason?: string;
}

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const rounded = Math.floor(value / step) * step;
  // Avoid binary float noise (e.g. 0.30000000004).
  const decimals = (step.toString().split(".")[1] || "").length;
  return Number(rounded.toFixed(decimals));
}

/**
 * Converts a desired notional risk (quote currency) into MetaTrader lots using
 * the EA-reported symbol spec. Falls back to a safe denial when the spec is
 * missing so the agent never sends an unsized order to the broker.
 */
export function computeForexLots(
  notional: number,
  price: number,
  spec: EaSymbolSpec | null,
): LotSizingResult {
  if (notional <= 0) {
    return { ok: false, lots: 0, reason: "قيمة الصفقة غير صالحة." };
  }
  if (!spec) {
    return {
      ok: false,
      lots: 0,
      reason: "مواصفات الرمز غير متاحة بعد من MetaTrader. انتظر تحديث الاتصال.",
    };
  }

  const contractSize = Number(spec.contract_size) || 0;
  const minLot = Number(spec.min_lot) || 0.01;
  const maxLot = Number(spec.max_lot) || 100;
  const lotStep = Number(spec.lot_step) || 0.01;
  const effPrice = price > 0 ? price : Number(spec.ask) || Number(spec.bid) || 0;

  if (contractSize <= 0 || effPrice <= 0) {
    return {
      ok: false,
      lots: 0,
      reason: "تعذّر حساب حجم اللوت (مواصفات ناقصة).",
    };
  }

  // Notional value of 1.0 lot in quote currency ≈ contractSize * price.
  const valuePerLot = contractSize * effPrice;
  let lots = roundToStep(notional / valuePerLot, lotStep);

  if (lots < minLot) {
    // Allow the broker minimum if the user's per-trade budget is small but
    // positive; this keeps a tradeable order while respecting min lot.
    lots = minLot;
  }
  if (lots > maxLot) lots = maxLot;

  if (lots <= 0) {
    return { ok: false, lots: 0, reason: "حجم اللوت المحسوب صفر." };
  }
  return { ok: true, lots };
}

/** Inverse of computeForexLots — notional exposure for a target lot size. */
export function lotsToNotional(
  lot: number,
  price: number,
  contractSize: number,
): number {
  if (lot <= 0 || price <= 0 || contractSize <= 0) return 0;
  return lot * price * contractSize;
}
