import type { ChartDrawing } from "@/lib/chartDrawings";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";

function line(
  label: string,
  price: number,
  time: number,
  role: ChartDrawing["semanticRole"],
  color: string,
  strength: number,
): ChartDrawing {
  return {
    type: "price_line",
    confidence: Math.round(strength),
    label,
    color,
    semanticRole: role,
    points: [{ time, price }],
    meta: { drawingCommand: "draw_support_resistance", strength },
  };
}

export function buildSupportResistanceDrawing(
  market: AgentMarketContext,
): ChartDrawing[] {
  const lastTime = market.currentTfCandles.at(-1)?.time ?? Date.now();
  const current = market.currentPrice ?? market.currentTfCandles.at(-1)?.close ?? 0;
  const atr = market.atr ?? Math.max(current * 0.001, 0.0001);
  const strengthFor = (price: number) => {
    const distance = current > 0 ? Math.abs(price - current) / atr : 1;
    return Math.max(70, Math.min(90, 88 - distance * 4));
  };
  const supports = market.majorLevels.support
    .slice(-3)
    .map((l) => line("دعم", l.price, l.time ?? lastTime, "support", "#22c55e", strengthFor(l.price)));
  const resistances = market.majorLevels.resistance
    .slice(-3)
    .map((l) =>
      line("مقاومة", l.price, l.time ?? lastTime, "resistance", "#ef4444", strengthFor(l.price)),
    );
  return [...supports, ...resistances].slice(0, 6);
}
