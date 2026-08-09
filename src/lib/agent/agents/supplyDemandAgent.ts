import type { AgentRunContext } from "../types";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { SupplyDemandZone } from "../marketContext/detectors";

export interface SupplyDemandResult {
  zones: SupplyDemandZone[];
  nearestDemand: SupplyDemandZone | null;
  nearestSupply: SupplyDemandZone | null;
}

/** Supply/demand zones + nearest POI on each side of price. */
export async function runSupplyDemandAgent(
  ctx: AgentRunContext,
  market: AgentMarketContext,
): Promise<SupplyDemandResult> {
  ctx.emitActivity({
    type: "analysis",
    status: "started",
    message: "أحدّد مناطق الطلب والعرض ومناطق الدخول المحتملة.",
    // Narration-only: trace log, not UI.
    visible: false,
  });

  const zones = market.zones;
  const price = market.currentPrice ?? 0;

  // Nearest demand at/below price; nearest supply at/above price.
  const nearestDemand =
    zones
      .filter((z) => z.type === "demand" && z.high <= price)
      .sort((a, b) => price - a.high - (price - b.high))[0] ?? null;
  const nearestSupply =
    zones
      .filter((z) => z.type === "supply" && z.low >= price)
      .sort((a, b) => a.low - price - (b.low - price))[0] ?? null;

  ctx.emitActivity({
    type: "analysis",
    status: "completed",
    message: "حدّدت أقرب مناطق الطلب والعرض.",
    metadata: {
      zones: zones.length,
      hasDemand: Boolean(nearestDemand),
      hasSupply: Boolean(nearestSupply),
    },
  });

  return { zones, nearestDemand, nearestSupply };
}
