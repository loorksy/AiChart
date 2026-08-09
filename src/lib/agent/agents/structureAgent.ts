import type { AgentRunContext } from "../types";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import {
  detectSwings,
  detectTrend,
  type PriceLevel,
  type Swing,
  type TrendLabel,
} from "../marketContext/detectors";
import {
  detectStructureEvents,
  latestStructureEvent,
  type StructureEvent,
} from "../marketContext/structureEvents";

export interface StructureResult {
  trend: TrendLabel;
  swings: Swing[];
  support: PriceLevel[];
  resistance: PriceLevel[];
  /** BOS/CHoCH/MSS events, oldest → newest. Empty when uncertain. */
  structureEvents: StructureEvent[];
  latestStructureEvent?: StructureEvent | null;
}

/** Market structure: swings, trend, nearest S/R, and BOS/CHoCH/MSS events. */
export async function runStructureAgent(
  ctx: AgentRunContext,
  market: AgentMarketContext,
): Promise<StructureResult> {
  ctx.emitActivity({
    type: "analysis",
    status: "started",
    message: "أحلّل بنية السوق والقمم والقيعان وكسور الهيكل.",
  });

  const swings = detectSwings(market.currentTfCandles);
  const trend = detectTrend(swings);
  const structureEvents = detectStructureEvents(
    market.currentTfCandles,
    swings,
    market.atr,
  );
  const latest = latestStructureEvent(structureEvents);
  const trendAr =
    trend === "uptrend" ? "صاعد" : trend === "downtrend" ? "هابط" : trend === "range" ? "عرضي" : "غير محدد";

  ctx.emitActivity({
    type: "analysis",
    status: "completed",
    message: latest
      ? `حدّدت بنية السوق: اتجاه ${trendAr} مع ${latest.type} ${latest.direction === "bullish" ? "صاعد" : "هابط"} حديث.`
      : `حدّدت بنية السوق: اتجاه ${trendAr}.`,
    metadata: { trend, structureEvents: structureEvents.length },
  });

  return {
    trend,
    swings,
    support: market.majorLevels.support,
    resistance: market.majorLevels.resistance,
    structureEvents,
    latestStructureEvent: latest,
  };
}
