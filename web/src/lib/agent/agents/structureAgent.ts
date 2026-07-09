import type { AgentRunContext } from "../types";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import {
  detectSwings,
  detectTrend,
  type PriceLevel,
  type Swing,
  type TrendLabel,
} from "../marketContext/detectors";

export interface StructureResult {
  trend: TrendLabel;
  swings: Swing[];
  support: PriceLevel[];
  resistance: PriceLevel[];
}

/** Market structure: swing highs/lows, trend, nearest S/R. */
export async function runStructureAgent(
  ctx: AgentRunContext,
  market: AgentMarketContext,
): Promise<StructureResult> {
  ctx.emitActivity({
    type: "analysis",
    status: "started",
    message: "أحلّل بنية السوق والقمم والقيعان.",
  });

  const swings = detectSwings(market.currentTfCandles);
  const trend = detectTrend(swings);
  const trendAr =
    trend === "uptrend" ? "صاعد" : trend === "downtrend" ? "هابط" : trend === "range" ? "عرضي" : "غير محدد";

  ctx.emitActivity({
    type: "analysis",
    status: "completed",
    message: `حدّدت بنية السوق: اتجاه ${trendAr}.`,
    metadata: { trend },
  });

  return {
    trend,
    swings,
    support: market.majorLevels.support,
    resistance: market.majorLevels.resistance,
  };
}
