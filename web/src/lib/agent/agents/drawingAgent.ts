import type { AgentRunContext } from "../types";
import type { ChartDrawing, ChartPoint } from "@/lib/chartDrawings";
import { barDurationMs } from "@/lib/intervals";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { FinalDecisionResult } from "./finalDecisionAgent";
import type { StructureResult } from "./structureAgent";
import type { SupplyDemandResult } from "./supplyDemandAgent";
import { sanitizeAgentDrawings } from "../drawings/drawingOwnership";

export interface DrawingAgentInput {
  analysisId: string;
  market: AgentMarketContext;
  finalDecision: FinalDecisionResult;
  structure: StructureResult | null;
  supplyDemand: SupplyDemandResult | null;
}

/**
 * Builds chart drawings for the decision. For buy/sell: entry, SL, targets,
 * POI zone, and a forecast path. For WAIT: key support/resistance zones and
 * scenarios instead of forcing a trade. All drawings are anchored to actual
 * candle times/prices, then sanitized + stamped with owner=agent + analysisId.
 */
export async function runDrawingAgent(
  ctx: AgentRunContext,
  input: DrawingAgentInput,
): Promise<ChartDrawing[]> {
  ctx.emitActivity({
    type: "drawing",
    status: "started",
    message: "أجهّز الرسومات المناسبة على الشارت.",
  });

  // Session preference: minimal drawings.
  if (ctx.session?.preferences.preferMinimalDrawings) {
    ctx.emitActivity({
      type: "drawing",
      status: "completed",
      message: "وضع الرسومات المختصرة مفعّل — سأرسم الحد الأدنى.",
    });
  }

  const candles = input.market.currentTfCandles;
  const lastTime = candles.at(-1)?.time ?? Date.now();
  const barMs = barDurationMs(input.market.interval) || 60_000;
  const rec = input.finalDecision.recommendation;
  const raw: ChartDrawing[] = [];

  if (rec.action === "buy" || rec.action === "sell") {
    if (rec.entry != null) {
      raw.push(priceLine("دخول", rec.entry, lastTime, "entry", "#3b82f6"));
    }
    if (rec.stop_loss != null) {
      raw.push(priceLine("وقف خسارة", rec.stop_loss, lastTime, "stop_loss", "#ef4444"));
    }
    (rec.targets ?? []).forEach((t, i) => {
      if (t != null) {
        raw.push(priceLine(`هدف ${i + 1}`, t, lastTime, "take_profit", "#22c55e"));
      }
    });

    // POI zone (demand for buy, supply for sell).
    const zone =
      rec.action === "buy"
        ? input.supplyDemand?.nearestDemand
        : input.supplyDemand?.nearestSupply;
    if (zone) {
      raw.push({
        type: rec.action === "buy" ? "demand_zone" : "supply_zone",
        confidence: 70,
        label: rec.action === "buy" ? "منطقة طلب" : "منطقة عرض",
        semanticRole: rec.action === "buy" ? "demand_zone" : "supply_zone",
        points: [
          { time: zone.time, price: zone.high },
          { time: lastTime, price: zone.low },
        ],
      });
    }

    // Forecast path: current → entry → first target.
    if (rec.entry != null && input.market.currentPrice != null) {
      raw.push({
        type: "forecast_path",
        confidence: 60,
        label: "المسار المتوقع",
        semanticRole: "forecast",
        points: buildForecastPath({
          lastTime,
          barMs,
          currentPrice: input.market.currentPrice,
          entry: rec.entry,
          target: rec.targets?.[0] ?? rec.entry,
        }),
      });
    }
  } else {
    // WAIT: draw the key zones/scenarios instead of a trade.
    for (const level of input.structure?.support ?? []) {
      raw.push(priceLine("دعم", level.price, level.time ?? lastTime, "support", "#22c55e"));
    }
    for (const level of input.structure?.resistance ?? []) {
      raw.push(priceLine("مقاومة", level.price, level.time ?? lastTime, "resistance", "#ef4444"));
    }
  }

  const bounds = priceBounds(candles);
  const drawings = sanitizeAgentDrawings(raw, {
    analysisId: input.analysisId,
    priceBounds: bounds,
    maxDrawings: ctx.session?.preferences.preferMinimalDrawings ? 6 : 40,
  });

  ctx.emitActivity({
    type: "drawing",
    status: "completed",
    message: "جهّزت الرسومات النهائية.",
    metadata: { count: drawings.length },
  });

  return drawings;
}

function priceLine(
  label: string,
  price: number,
  time: number,
  semanticRole: ChartDrawing["semanticRole"],
  color: string,
): ChartDrawing {
  return {
    type: "price_line",
    confidence: 65,
    label,
    color,
    semanticRole,
    points: [{ time, price }],
  };
}

function buildForecastPath(input: {
  lastTime: number;
  barMs: number;
  currentPrice: number;
  entry: number;
  target: number;
}): ChartPoint[] {
  return [
    { time: input.lastTime, price: input.currentPrice },
    { time: input.lastTime + input.barMs, price: input.entry },
    { time: input.lastTime + input.barMs * 3, price: input.target },
  ];
}

function priceBounds(
  candles: Array<{ high: number; low: number }>,
): { min: number; max: number } | null {
  if (!candles.length) return null;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const c of candles) {
    if (Number.isFinite(c.low)) low = Math.min(low, c.low);
    if (Number.isFinite(c.high)) high = Math.max(high, c.high);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
  const pad = (high - low) * 0.5;
  return { min: low - pad, max: high + pad };
}
