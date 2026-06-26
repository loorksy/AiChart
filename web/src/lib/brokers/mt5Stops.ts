import type { EaSymbolSpec } from "../types";

export interface NormalizedMt5Stops {
  stop_loss: number | null;
  take_profit: number | null;
  /** Set when SL/TP were dropped because invalid for the broker. */
  droppedInvalid?: boolean;
  note?: string;
}

function roundPrice(price: number, digits: number): number {
  if (digits <= 0) return price;
  const f = 10 ** digits;
  return Math.round(price * f) / f;
}

function minStopDistance(spec: EaSymbolSpec): number {
  const point = Number(spec.point) || 0;
  const stopsLevel = Number(spec.stops_level) || 0;
  if (point <= 0 || stopsLevel <= 0) return 0;
  return stopsLevel * point;
}

function isValidStop(
  side: "buy" | "sell",
  refPrice: number,
  level: number,
  isSl: boolean,
  minDist: number,
): boolean {
  if (!Number.isFinite(level) || level <= 0 || refPrice <= 0) return false;
  const dist = Math.abs(refPrice - level);
  if (minDist > 0 && dist < minDist - 1e-12) return false;
  if (side === "buy") {
    return isSl ? level < refPrice : level > refPrice;
  }
  return isSl ? level > refPrice : level < refPrice;
}

/**
 * Normalizes SL/TP for MT5 orders. Invalid levels are dropped (null) so
 * the EA opens without stops rather than failing with retcode 10016.
 *
 * For pending/limit orders pass the limit price as refPrice (not live bid/ask).
 */
export function normalizeMt5Stops(
  side: "buy" | "sell",
  refPrice: number,
  stopLoss: number | null | undefined,
  takeProfit: number | null | undefined,
  spec: EaSymbolSpec | null,
  _opts?: { referencePrice?: "entry" | "market" },
): NormalizedMt5Stops {
  const digits = Number(spec?.digits) || 5;
  const price = roundPrice(refPrice, digits);
  const minDist = spec ? minStopDistance(spec) : 0;

  let sl =
    stopLoss != null && stopLoss > 0
      ? roundPrice(stopLoss, digits)
      : null;
  let tp =
    takeProfit != null && takeProfit > 0
      ? roundPrice(takeProfit, digits)
      : null;

  let droppedInvalid = false;
  const notes: string[] = [];

  if (sl != null && !isValidStop(side, price, sl, true, minDist)) {
    notes.push("أُزيل وقف الخسارة لأنه غير مقبول عند الوسيط");
    sl = null;
    droppedInvalid = true;
  }
  if (tp != null && !isValidStop(side, price, tp, false, minDist)) {
    notes.push("أُزيل جني الربح لأنه غير مقبول عند الوسيط");
    tp = null;
    droppedInvalid = true;
  }

  return {
    stop_loss: sl,
    take_profit: tp,
    droppedInvalid: droppedInvalid || undefined,
    note: notes.length ? notes.join("؛ ") : undefined,
  };
}
