import type { AgentRunContext } from "../types";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import {
  detectLiquiditySweeps,
  latestLiquiditySweep,
  type LiquiditySweep,
} from "../marketContext/liquiditySweeps";

export interface LiquidityResult {
  equalHighs: AgentMarketContext["liquidity"]["equalHighs"];
  equalLows: AgentMarketContext["liquidity"]["equalLows"];
  nearestBuySide: AgentMarketContext["liquidity"]["nearestBuySide"];
  nearestSellSide: AgentMarketContext["liquidity"]["nearestSellSide"];
  /** Detected wick-through-and-close-back sweeps (oldest → newest). Note:
   *  `followedByStructureShift` is enriched later once structure is known. */
  sweeps: LiquiditySweep[];
  latestSweep?: LiquiditySweep | null;
}

/** Liquidity map: equal highs/lows, nearest pools, and explicit sweeps. */
export async function runLiquidityAgent(
  ctx: AgentRunContext,
  market: AgentMarketContext,
): Promise<LiquidityResult> {
  ctx.emitActivity({
    type: "analysis",
    status: "started",
    message: "أبحث عن مناطق السيولة والقمم/القيعان المتساوية وعمليات السحب.",
    // Narration-only: trace log, not UI. The completed event has the result.
    visible: false,
  });

  const liquidity = market.liquidity;
  const sweeps = detectLiquiditySweeps({
    candles: market.currentTfCandles,
    equalHighs: liquidity.equalHighs,
    equalLows: liquidity.equalLows,
    atr: market.atr,
  });

  ctx.emitActivity({
    type: "analysis",
    status: "completed",
    message: sweeps.length
      ? `جهّزت خريطة السيولة مع ${sweeps.length} عملية سحب سيولة مكتشفة.`
      : "جهّزت خريطة السيولة القريبة.",
    metadata: {
      equalHighs: liquidity.equalHighs.length,
      equalLows: liquidity.equalLows.length,
      sweeps: sweeps.length,
    },
  });

  return {
    ...liquidity,
    sweeps,
    latestSweep: latestLiquiditySweep(sweeps),
  };
}
