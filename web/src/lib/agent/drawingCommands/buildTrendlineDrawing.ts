import type { ChartDrawing } from "@/lib/chartDrawings";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { AgentCandle } from "../marketContext/detectors";

function pivots(candles: AgentCandle[], side: "low" | "high"): AgentCandle[] {
  const out: AgentCandle[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]!;
    const price = side === "low" ? c.low : c.high;
    const ok =
      side === "low"
        ? price <= candles[i - 1]!.low &&
          price <= candles[i - 2]!.low &&
          price <= candles[i + 1]!.low &&
          price <= candles[i + 2]!.low
        : price >= candles[i - 1]!.high &&
          price >= candles[i - 2]!.high &&
          price >= candles[i + 1]!.high &&
          price >= candles[i + 2]!.high;
    if (ok) out.push(c);
  }
  return out;
}

export function buildTrendlineDrawing(
  market: AgentMarketContext,
): ChartDrawing[] {
  const candles = market.visibleCandles.length >= 20
    ? market.visibleCandles
    : market.currentTfCandles.slice(-180);
  if (candles.length < 10) return [];

  const first = candles[0]!;
  const last = candles[candles.length - 1]!;
  const useLows = last.close >= first.close;
  const points = pivots(candles, useLows ? "low" : "high").slice(-2);
  const selected =
    points.length >= 2
      ? points
      : useLows
        ? [first, last].sort((a, b) => a.low - b.low).slice(0, 2)
        : [first, last].sort((a, b) => b.high - a.high).slice(0, 2);
  if (selected.length < 2) return [];
  selected.sort((a, b) => a.time - b.time);

  return [
    {
      type: "trend_line",
      confidence: 70,
      label: "خط الاتجاه",
      color: useLows ? "#22c55e" : "#ef4444",
      semanticRole: "trendline",
      points: selected.map((c) => ({
        time: c.time,
        price: useLows ? c.low : c.high,
      })),
      meta: { drawingCommand: "draw_trendline" },
    },
  ];
}

