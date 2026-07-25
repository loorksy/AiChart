import type { AgentRunContext } from "../types";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { FinalDecisionResult } from "./finalDecisionAgent";
import type {
  DrawingAnnotation,
  DrawingPlan,
} from "../drawings/buildDrawingPlan";
import { sanitizeAgentDrawings } from "../drawings/drawingOwnership";

export interface DrawingAgentInput {
  analysisId: string;
  market: AgentMarketContext;
  finalDecision: FinalDecisionResult;
  /** The single source of truth for what may be drawn. */
  plan: DrawingPlan;
}

/**
 * Renders the DrawingPlan — and ONLY the plan. It never re-detects levels, never
 * draws every fractal, and never forces support/resistance on a WAIT. If the
 * plan says `shouldDraw=false` the chart receives nothing. All drawings are
 * anchored to real candle times/prices, then sanitized + stamped owner=agent.
 */
export async function runDrawingAgent(
  ctx: AgentRunContext,
  input: DrawingAgentInput,
): Promise<ChartDrawing[]> {
  const { plan } = input;

  if (!plan.shouldDraw) {
    // Only surface a note when the reason is user-meaningful (e.g. thin data).
    ctx.emitActivity({
      type: "drawing",
      status: "completed",
      message: `لن أرسم الآن: ${plan.reason}`,
      metadata: { drawingIntent: plan.drawingIntent },
    });
    return [];
  }

  ctx.emitActivity({
    type: "drawing",
    status: "started",
    message: "أجهّز خطة الرسم النهائية على الشارت.",
    metadata: { drawingIntent: plan.drawingIntent },
  });

  const candles = input.market.currentTfCandles;
  const lastTime = candles.at(-1)?.time ?? Date.now();
  const rec = input.finalDecision.recommendation;
  const raw: ChartDrawing[] = [];

  if (plan.drawingIntent === "trade_setup") {
    if (rec.entry != null) {
      raw.push(priceLine("دخول", rec.entry, lastTime, "entry", "#3b82f6"));
    }
    if (rec.stop_loss != null) {
      raw.push(
        priceLine("وقف خسارة", rec.stop_loss, lastTime, "stop_loss", "#ef4444"),
      );
    }
    (rec.targets ?? []).forEach((t, i) => {
      if (t != null) {
        raw.push(priceLine(`هدف ${i + 1}`, t, lastTime, "take_profit", "#22c55e"));
      }
    });
  }

  // Plan-selected zones (POI for a trade, or strong WAIT zones).
  for (const zone of plan.selectedZones) {
    const isDemand = zone.type === "demand";
    raw.push({
      type:
        zone.type === "demand"
          ? "demand_zone"
          : zone.type === "supply"
            ? "supply_zone"
            : "range_box",
      confidence: Math.round(zone.strength),
      label: zoneLabel(zone.type),
      semanticRole:
        zone.type === "demand"
          ? "demand_zone"
          : zone.type === "supply"
            ? "supply_zone"
            : zone.type === "retest"
              ? "retest"
              : "range",
      points: [
        { time: zone.time, price: zone.high },
        { time: lastTime, price: zone.low },
      ],
      meta: { strength: zone.strength, reason: zone.reason, demand: isDemand },
    });
  }

  // Plan-selected levels (WAIT: only high-strength support/resistance).
  for (const level of plan.selectedLevels) {
    const color =
      level.type === "resistance"
        ? "#ef4444"
        : level.type === "liquidity"
          ? "#0284c7"
          : "#22c55e";
    const role =
      level.type === "resistance"
        ? "resistance"
        : level.type === "liquidity"
          ? "liquidity_sweep"
          : "support";
    raw.push({
      ...priceLine(levelLabel(level.type), level.price, level.time, role, color),
      confidence: Math.round(level.strength),
      meta: { strength: level.strength, reason: level.reason },
    });
  }

  // Structure/liquidity/range annotations from the plan.
  for (const ann of plan.selectedAnnotations ?? []) {
    raw.push(annotationDrawing(ann, lastTime));
  }

  // Shared-engine geometry: trendlines, channels, and patterns with their
  // forming/completed state — already strength-gated and bounded by the plan.
  raw.push(...(plan.selectedGeometry ?? []));

  // Scenario path (valid setups only) — a POSSIBLE route, never a guarantee.
  if (plan.forecastPath?.length) {
    raw.push({
      type: "forecast_path",
      confidence: 55,
      label: "سيناريو محتمل",
      semanticRole: "forecast",
      style: "dashed",
      points: plan.forecastPath.map((p) => ({ time: p.time, price: p.price })),
    });
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
    metadata: { count: drawings.length, drawingIntent: plan.drawingIntent },
  });

  return drawings;
}

/** Render a plan annotation (BOS/CHoCH/sweep/range/invalidation) faithfully. */
function annotationDrawing(
  ann: DrawingAnnotation,
  lastTime: number,
): ChartDrawing {
  switch (ann.type) {
    case "invalidation":
      return {
        type: "decision_zone",
        confidence: Math.round(ann.strength),
        label: ann.label,
        semanticRole: "decision_zone",
        color: "#ef4444",
        fill: true,
        points: [
          { time: ann.time, price: ann.price },
          { time: lastTime, price: ann.price2 ?? ann.price },
        ],
        meta: { annotation: ann.type },
      };
    case "sweep":
      return {
        ...priceLine(ann.label, ann.price, ann.time, "liquidity_sweep", "#0284c7"),
        confidence: Math.round(ann.strength),
        style: "dashed",
        meta: { annotation: ann.type },
      };
    case "bos":
    case "choch":
      return {
        ...priceLine(
          ann.label,
          ann.price,
          ann.time,
          "breakout",
          ann.direction === "bullish" ? "#22c55e" : "#ef4444",
        ),
        confidence: Math.round(ann.strength),
        style: "dashed",
        meta: { annotation: ann.type },
      };
    case "range_high":
    case "range_low":
    case "premium_discount":
    default:
      return {
        ...priceLine(ann.label, ann.price, ann.time, "range", "#eab308"),
        confidence: Math.round(ann.strength),
        style: ann.type === "premium_discount" ? "dotted" : "solid",
        meta: { annotation: ann.type },
      };
  }
}

function zoneLabel(type: "supply" | "demand" | "retest" | "range"): string {
  switch (type) {
    case "demand":
      return "منطقة طلب";
    case "supply":
      return "منطقة عرض";
    case "retest":
      return "منطقة إعادة اختبار";
    default:
      return "نطاق سعري";
  }
}

function levelLabel(type: "support" | "resistance" | "liquidity"): string {
  switch (type) {
    case "resistance":
      return "مقاومة";
    case "liquidity":
      return "سيولة";
    default:
      return "دعم";
  }
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
