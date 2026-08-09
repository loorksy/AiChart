/**
 * Path-to-entry analysis for conditional (pending) setups.
 *
 * A distant pending entry is never itself a transitional trade. Any move
 * toward the pending zone requires independent market evidence and its own
 * geometry — this module only classifies the path quality.
 */
export type PathToEntryClass =
  | "continuation_edge"
  | "neutral_path"
  | "unlikely_reach"
  | "invalidated_before_activation";

export interface PathToEntryAnalysis {
  class: PathToEntryClass;
  distance: number;
  distanceAtr: number | null;
  /** Natural language for the model — not for machine labels in the UI. */
  summary: string;
  /**
   * True only when independent same-side evidence supports a transition trade
   * toward the pending zone. Never true merely because the pending entry is
   * on the other side of price.
   */
  transitionalTradeJustified: boolean;
}

export function analyzePathToEntry(input: {
  action: "buy" | "sell";
  currentPrice: number;
  entry: number;
  atr: number | null;
  /**
   * Independent evidence for a transition trade in the direction FROM current
   * price TOWARD the pending entry (opposite of the pending action when the
   * pending entry is a retest above/below).
   */
  independentTransitionEvidence: boolean;
  /** Structure already broke through / beyond the pending zone. */
  zoneAlreadyBroken: boolean;
  /** Momentum currently moving away from the pending zone. */
  driftingAway: boolean;
}): PathToEntryAnalysis {
  const distance = Math.abs(input.entry - input.currentPrice);
  const distanceAtr =
    input.atr && input.atr > 0 ? distance / input.atr : null;

  if (input.zoneAlreadyBroken) {
    return {
      class: "invalidated_before_activation",
      distance,
      distanceAtr,
      summary:
        "السعر اخترق منطقة الدخول قبل التفعيل؛ السيناريو المعلق غير صالح الآن.",
      transitionalTradeJustified: false,
    };
  }

  if (input.driftingAway && (distanceAtr == null || distanceAtr > 1.5)) {
    return {
      class: "unlikely_reach",
      distance,
      distanceAtr,
      summary:
        "الزخم يبتعد عن منطقة الدخول المعلقة؛ احتمال الوصول قريبًا منخفض.",
      transitionalTradeJustified: false,
    };
  }

  if (input.independentTransitionEvidence) {
    return {
      class: "continuation_edge",
      distance,
      distanceAtr,
      summary:
        "يوجد دليل مستقل لحركة انتقالية نحو المنطقة — تُعامل كفرصة منفصلة بهندسة خاصة بها.",
      transitionalTradeJustified: true,
    };
  }

  return {
    class: "neutral_path",
    distance,
    distanceAtr,
    summary:
      input.action === "sell"
        ? "فكرة البيع تصبح ذات صلة فقط إذا عاد السعر إلى منطقة العرض وأظهر تأكيدًا. المسار الحالي لا يشكّل صفقة شراء تلقائية."
        : "فكرة الشراء تصبح ذات صلة فقط إذا عاد السعر إلى منطقة الطلب وأظهر تأكيدًا. المسار الحالي لا يشكّل صفقة بيع تلقائية.",
    transitionalTradeJustified: false,
  };
}
