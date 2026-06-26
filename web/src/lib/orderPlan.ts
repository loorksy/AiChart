import type { Recommendation } from "./types";

export interface OrderPlan {
  order_type: "market" | "limit";
  limit_price: number | null;
  entry: number | null;
  /** Arabic warning when falling back to market (no entry on recommendation). */
  warnNoEntryAr?: string;
}

type RecLike = Pick<Recommendation, "entry"> & {
  action?: string;
  side?: "buy" | "sell";
};

/**
 * When a recommendation carries an entry price, always plan a limit/pending order
 * at that price — never a blind market fill.
 */
export function planOrderFromRecommendation(
  rec: RecLike,
  livePrice?: number | null,
): OrderPlan {
  const entry = rec.entry ?? null;
  if (entry != null && entry > 0) {
    return {
      order_type: "limit",
      limit_price: entry,
      entry,
    };
  }
  return {
    order_type: "market",
    limit_price: null,
    entry: livePrice ?? null,
    warnNoEntryAr:
      "لا سعر دخول في التوصية — تنفيذ فوري (يُفضّل رفض في وضع الموافقة)",
  };
}
