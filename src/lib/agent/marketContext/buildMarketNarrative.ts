/**
 * Market narrative builder — turns candles + detector output into an
 * evidence-based STORY the synthesizer can reason over, instead of raw dumps.
 * Everything here is derived from actual data; anything uncertain is marked
 * "unknown" — structure is never invented.
 */
import type { AgentMarketContext } from "./buildAgentMarketContext";
import type { StructureResult } from "../agents/structureAgent";
import type { LiquidityResult } from "../agents/liquidityAgent";
import type { MultiTimeframeResult } from "../agents/multiTimeframeAgent";
import { computeRangePosition, type RangePosition, type RangePositionLabel } from "./rangePosition";
import type { AgentCandle } from "./detectors";

export type MarketNarrative = {
  symbol: string;
  interval: string;
  higherInterval: string;
  regime: "trend" | "range" | "transition" | "unknown";
  currentPosition: RangePositionLabel;
  recentImpulse?: {
    direction: "up" | "down";
    from: number;
    to: number;
    strengthAtr: number;
    startTime: number;
    endTime: number;
  };
  recentPullback?: {
    depthPct: number;
    healthy: boolean;
    reason: string;
  };
  latestStructureEvent?: {
    type: "BOS" | "CHoCH" | "MSS" | "none";
    direction?: "bullish" | "bearish";
    price?: number;
    time?: number;
    strength: number;
  };
  liquidityStory: {
    sweep?: {
      side: "buy_side" | "sell_side";
      price: number;
      time: number;
      confirmed: boolean;
    };
    nearestTarget?: {
      side: "buy_side" | "sell_side";
      price: number;
      reason: string;
    };
  };
  rangePosition: RangePosition | null;
  summary: string;
  warnings: string[];
};

export function buildMarketNarrative(input: {
  market: AgentMarketContext;
  structure: StructureResult | null;
  liquidity: LiquidityResult | null;
  mtf: MultiTimeframeResult | null;
}): MarketNarrative {
  const { market, structure, liquidity, mtf } = input;
  const warnings: string[] = [];
  const candles = market.currentTfCandles;

  const rangePosition = computeRangePosition(candles, market.currentPrice);
  const currentPosition: RangePositionLabel = rangePosition?.label ?? "unknown";

  // Regime: structure events refine the raw regime into "transition".
  const latestEvent = structure?.latestStructureEvent ?? null;
  const regime: MarketNarrative["regime"] =
    latestEvent && (latestEvent.type === "CHoCH" || latestEvent.type === "MSS")
      ? "transition"
      : market.marketRegime === "uptrend" || market.marketRegime === "downtrend"
        ? "trend"
        : market.marketRegime === "range"
          ? "range"
          : "unknown";

  const recentImpulse = findRecentImpulse(candles, market.atr);
  const recentPullback = recentImpulse
    ? measurePullback(candles, recentImpulse)
    : undefined;

  const latestSweep = liquidity?.latestSweep ?? null;
  const liquidityStory: MarketNarrative["liquidityStory"] = {};
  if (latestSweep) {
    liquidityStory.sweep = {
      side: latestSweep.side,
      price: latestSweep.sweptLevel,
      time: latestSweep.candleTime,
      confirmed: latestSweep.followedByStructureShift,
    };
  }
  const price = market.currentPrice;
  if (price != null && liquidity) {
    const above = liquidity.nearestBuySide;
    const below = liquidity.nearestSellSide;
    if (above && above.price > price) {
      liquidityStory.nearestTarget = {
        side: "buy_side",
        price: above.price,
        reason: "قمم متساوية فوق السعر تمثل سيولة مستهدفة.",
      };
    } else if (below && below.price < price) {
      liquidityStory.nearestTarget = {
        side: "sell_side",
        price: below.price,
        reason: "قيعان متساوية تحت السعر تمثل سيولة مستهدفة.",
      };
    }
  }

  if (!market.dataQuality.sufficient) {
    warnings.push("تغطية الشموع غير مكتملة — الثقة بالسرد أقل.");
  }
  if (!market.freshness.isFresh && market.marketOpen) {
    warnings.push("الشموع متأخرة والسوق مفتوح.");
  }
  if (mtf?.conflict) {
    warnings.push("تعارض بين الفريم الحالي والفريم الأعلى.");
  }

  return {
    symbol: market.symbol,
    interval: market.interval,
    higherInterval: market.higherInterval,
    regime,
    currentPosition,
    recentImpulse,
    recentPullback,
    latestStructureEvent: latestEvent
      ? {
          type: latestEvent.type,
          direction: latestEvent.direction,
          price: latestEvent.brokenLevel,
          time: latestEvent.breakCandleTime,
          strength: latestEvent.strength,
        }
      : { type: "none", strength: 0 },
    liquidityStory,
    rangePosition,
    summary: composeSummary({
      symbol: market.symbol,
      regime,
      currentPosition,
      latestEvent,
      latestSweep,
      mtfConflict: Boolean(mtf?.conflict),
    }),
    warnings,
  };
}

/** Strongest directional leg within the last ~60 bars. */
function findRecentImpulse(
  candles: AgentCandle[],
  atr: number | null,
): MarketNarrative["recentImpulse"] {
  const window = candles.slice(-60);
  if (window.length < 10) return undefined;
  const effAtr =
    atr && atr > 0
      ? atr
      : window.map((c) => c.high - c.low).reduce((a, b) => a + b, 0) /
        window.length;
  if (!(effAtr > 0)) return undefined;

  let best: MarketNarrative["recentImpulse"];
  let start = 0;
  for (let i = 1; i <= window.length; i++) {
    const prev = window[i - 1]!;
    const cur = window[i];
    const dirChanged =
      cur == null ||
      Math.sign(cur.close - cur.open) !== Math.sign(prev.close - prev.open);
    if (dirChanged) {
      const leg = window.slice(start, i);
      if (leg.length >= 2) {
        const from = leg[0]!.open;
        const to = leg.at(-1)!.close;
        const strengthAtr = Math.abs(to - from) / effAtr;
        if (strengthAtr >= 1.5 && (!best || strengthAtr > best.strengthAtr)) {
          best = {
            direction: to > from ? "up" : "down",
            from,
            to,
            strengthAtr: Math.round(strengthAtr * 10) / 10,
            startTime: leg[0]!.time,
            endTime: leg.at(-1)!.time,
          };
        }
      }
      start = i;
    }
  }
  return best;
}

/** Pullback depth vs. the impulse (38–79% is a healthy retracement). */
function measurePullback(
  candles: AgentCandle[],
  impulse: NonNullable<MarketNarrative["recentImpulse"]>,
): MarketNarrative["recentPullback"] {
  const after = candles.filter((c) => c.time > impulse.endTime);
  if (!after.length) return undefined;
  const span = Math.abs(impulse.to - impulse.from);
  if (!(span > 0)) return undefined;

  const extreme =
    impulse.direction === "up"
      ? Math.min(...after.map((c) => c.low))
      : Math.max(...after.map((c) => c.high));
  const retraced = Math.abs(impulse.to - extreme);
  const depthPct = Math.round((retraced / span) * 100);
  const healthy = depthPct >= 20 && depthPct <= 79;
  return {
    depthPct,
    healthy,
    reason: healthy
      ? "تصحيح ضمن النطاق الصحي من الاندفاع."
      : depthPct < 20
        ? "التصحيح ضحل جداً — السعر لم يرجع لمنطقة قيمة."
        : "التصحيح عميق — الاندفاع مهدد بالإلغاء.",
  };
}

function composeSummary(input: {
  symbol: string;
  regime: MarketNarrative["regime"];
  currentPosition: RangePositionLabel;
  latestEvent: { type: string; direction: string; strength: number } | null;
  latestSweep: { side: string; followedByStructureShift: boolean } | null;
  mtfConflict: boolean;
}): string {
  const parts: string[] = [];
  const regimeAr =
    input.regime === "trend"
      ? "اتجاهي"
      : input.regime === "range"
        ? "عرضي"
        : input.regime === "transition"
          ? "في مرحلة تحول"
          : "غير محدد";
  parts.push(`${input.symbol} في وضع ${regimeAr}`);

  const posAr: Record<RangePositionLabel, string> = {
    premium: "بمنطقة سعرية مرتفعة (Premium)",
    discount: "بمنطقة سعرية مخفَّضة (Discount)",
    mid_range: "في منتصف النطاق",
    near_high: "قرب قمة النطاق",
    near_low: "قرب قاع النطاق",
    unknown: "بموضع غير محدد",
  };
  parts.push(posAr[input.currentPosition]);

  if (input.latestEvent) {
    parts.push(
      `آخر حدث هيكلي ${input.latestEvent.type} ${input.latestEvent.direction === "bullish" ? "صاعد" : "هابط"}`,
    );
  }
  if (input.latestSweep) {
    parts.push(
      input.latestSweep.followedByStructureShift
        ? "مع سحب سيولة مؤكد بتحول هيكلي"
        : "مع سحب سيولة غير مؤكد",
    );
  }
  if (input.mtfConflict) parts.push("والفريم الأعلى متعارض");
  return parts.join("، ") + ".";
}
