/**
 * POI (Point of Interest) quality scoring for TRADE decisions — not just for
 * drawing. A zone must earn its trade: freshness, impulse away, HTF confluence,
 * a sweep before it, structure created by it, sane width, discount/premium fit.
 * The NEAREST zone is never automatically valid.
 *
 * Grades: A (>85) strong, B (75–85) cautious, C (60–75) not tradable, reject.
 * Buy/Sell is only allowed from grade A or B.
 */
import type { AgentCandle, SupplyDemandZone } from "../marketContext/detectors";
import type { StructureEvent } from "../marketContext/structureEvents";
import type { LiquiditySweep } from "../marketContext/liquiditySweeps";
import type { RangePosition } from "../marketContext/rangePosition";

export type PoiScore = {
  score: number;
  grade: "A" | "B" | "C" | "reject";
  reasons: string[];
  warnings: string[];
  isTradable: boolean;
};

export interface ScorePoiInput {
  zone: SupplyDemandZone;
  candles: AgentCandle[];
  currentPrice: number;
  atr: number | null;
  structureEvents: StructureEvent[];
  sweeps: LiquiditySweep[];
  rangePosition: RangePosition | null;
  /** Daily/major levels for HTF confluence. */
  htfLevels: number[];
  otherZones: SupplyDemandZone[];
}

export function scorePoi(input: ScorePoiInput): PoiScore {
  const { zone, candles, currentPrice } = input;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const atr = input.atr && input.atr > 0 ? input.atr : approxAtr(candles);
  if (!atr || !candles.length || !(currentPrice > 0)) {
    return {
      score: 0,
      grade: "reject",
      reasons: ["بيانات غير كافية لتقييم المنطقة."],
      warnings,
      isTradable: false,
    };
  }

  const mid = (zone.low + zone.high) / 2;
  const width = zone.high - zone.low;
  let score = 20; // impulse-origin zone base weight

  // Freshness + touch count: untouched zone is best; over-touched is spent.
  const touches = countTouchesAfterFormation(zone, candles);
  if (touches === 0) {
    score += 20;
    reasons.push("منطقة غير مختبرة (fresh).");
  } else if (touches === 1) {
    score += 10;
    reasons.push("منطقة اختُبرت مرة واحدة.");
  } else if (touches >= 3) {
    score -= 20;
    warnings.push("المنطقة مُستهلكة بلمسات متكررة.");
  }

  // Impulse away from the zone (displacement that formed it).
  const impulseAtr = impulseAwayAtr(zone, candles, atr);
  if (impulseAtr >= 2) {
    score += 20;
    reasons.push("اندفاع قوي خرج من المنطقة.");
  } else if (impulseAtr >= 1) {
    score += 10;
  } else {
    warnings.push("الاندفاع الخارج من المنطقة ضعيف.");
  }

  // HTF confluence.
  const htfTol = Math.max(atr * 0.75, mid * 0.0008);
  if (input.htfLevels.some((l) => Math.abs(l - mid) <= htfTol)) {
    score += 15;
    reasons.push("المنطقة متوافقة مع مستوى فريم أعلى/يومي.");
  }

  // Liquidity sweep into/near the zone before it (engineered liquidity).
  const sweepTol = Math.max(atr, width);
  if (
    input.sweeps.some(
      (s) =>
        Math.abs(s.sweptLevel - mid) <= sweepTol * 2 &&
        (zone.type === "demand" ? s.side === "sell_side" : s.side === "buy_side"),
    )
  ) {
    score += 10;
    reasons.push("سحب سيولة قبل المنطقة يدعمها.");
  }

  // BOS/CHoCH created by the move from this zone.
  if (
    input.structureEvents.some(
      (ev) =>
        ev.breakCandleTime >= zone.time &&
        (zone.type === "demand"
          ? ev.direction === "bullish"
          : ev.direction === "bearish"),
    )
  ) {
    score += 15;
    reasons.push("الحركة من المنطقة أنتجت كسر هيكل.");
  }

  // Zone width sanity relative to ATR.
  const widthAtr = width / atr;
  if (widthAtr > 3) {
    score -= 15;
    warnings.push("المنطقة عريضة جداً نسبةً إلى التذبذب.");
  } else if (widthAtr < 0.1) {
    score -= 10;
    warnings.push("المنطقة ضيقة جداً.");
  }

  // Distance from current price: too far = not actionable now.
  const distanceAtr = Math.abs(currentPrice - mid) / atr;
  if (distanceAtr > 10) {
    score -= 20;
    warnings.push("المنطقة بعيدة جداً عن السعر الحالي.");
  } else if (distanceAtr <= 4) {
    score += 5;
  }

  // Premium/discount fit: demand belongs in discount, supply in premium.
  if (input.rangePosition) {
    const zonePct = clamp01(
      (mid - input.rangePosition.rangeLow) /
        Math.max(
          input.rangePosition.rangeHigh - input.rangePosition.rangeLow,
          1e-9,
        ),
    );
    if (zone.type === "demand" && zonePct <= 0.45) {
      score += 10;
      reasons.push("منطقة طلب في الجزء المخفَّض من النطاق.");
    } else if (zone.type === "supply" && zonePct >= 0.55) {
      score += 10;
      reasons.push("منطقة عرض في الجزء المرتفع من النطاق.");
    } else if (
      (zone.type === "demand" && zonePct >= 0.62) ||
      (zone.type === "supply" && zonePct <= 0.38)
    ) {
      score -= 15;
      warnings.push("موضع المنطقة داخل النطاق لا يناسب اتجاهها.");
    }
  }

  // Crowding: another zone of the same type overlapping nearby dilutes it.
  const crowdTol = Math.max(atr * 0.5, width);
  if (
    input.otherZones.some(
      (z) =>
        z !== zone &&
        z.type === zone.type &&
        Math.abs((z.low + z.high) / 2 - mid) <= crowdTol,
    )
  ) {
    score -= 10;
    warnings.push("منطقة أخرى مشابهة قريبة جداً.");
  }

  score = Math.max(0, Math.min(100, score));
  const grade: PoiScore["grade"] =
    score > 85 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "reject";

  return {
    score,
    grade,
    reasons,
    warnings,
    isTradable: grade === "A" || grade === "B",
  };
}

/** Touches AFTER the zone formed (a retest), not the formation candles. */
function countTouchesAfterFormation(
  zone: SupplyDemandZone,
  candles: AgentCandle[],
): number {
  let touches = 0;
  let inTouch = false;
  for (const c of candles) {
    if (c.time <= zone.time) continue;
    const touching = c.low <= zone.high && c.high >= zone.low;
    if (touching && !inTouch) touches++;
    inTouch = touching;
  }
  return touches;
}

/** Max displacement away from the zone within the bars after formation. */
function impulseAwayAtr(
  zone: SupplyDemandZone,
  candles: AgentCandle[],
  atr: number,
): number {
  const after = candles.filter(
    (c) => c.time > zone.time && c.time <= zone.time + 1000 * 60 * 60 * 24 * 7,
  );
  const window = after.slice(0, 12);
  if (!window.length) return 0;
  let extreme = 0;
  for (const c of window) {
    if (zone.type === "demand") extreme = Math.max(extreme, c.high - zone.high);
    else extreme = Math.max(extreme, zone.low - c.low);
  }
  return Math.max(0, extreme) / atr;
}

function approxAtr(candles: AgentCandle[]): number | null {
  const window = candles.slice(-14);
  const trs = window.map((c) => c.high - c.low).filter((x) => x > 0);
  if (!trs.length) return null;
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
