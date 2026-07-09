import type { AgentRunContext } from "../types";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";

export type LiquidityResult = AgentMarketContext["liquidity"];

/** Liquidity map: equal highs/lows and nearest buy/sell-side pools. */
export async function runLiquidityAgent(
  ctx: AgentRunContext,
  market: AgentMarketContext,
): Promise<LiquidityResult> {
  ctx.emitActivity({
    type: "analysis",
    status: "started",
    message: "أبحث عن مناطق السيولة والقمم/القيعان المتساوية.",
  });

  const liquidity = market.liquidity;

  ctx.emitActivity({
    type: "analysis",
    status: "completed",
    message: "جهّزت خريطة السيولة القريبة.",
    metadata: {
      equalHighs: liquidity.equalHighs.length,
      equalLows: liquidity.equalLows.length,
    },
  });

  return liquidity;
}
