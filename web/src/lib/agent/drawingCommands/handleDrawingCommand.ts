import type { AgentChartContext, AgentFinalResult, AgentIntent, AgentRunContext } from "../types";
import { buildAgentMarketContext } from "../marketContext/buildAgentMarketContext";
import { newId } from "../activity";
import { sanitizeAgentDrawings } from "../drawings/drawingOwnership";
import { buildTrendlineDrawing } from "./buildTrendlineDrawing";
import { buildSupportResistanceDrawing } from "./buildSupportResistanceDrawing";

export async function handleDrawingCommand(input: {
  intents: AgentIntent[];
  chartContext?: AgentChartContext;
  ctx: AgentRunContext;
}): Promise<AgentFinalResult> {
  const { intents, chartContext, ctx } = input;
  const analysisId = newId();

  if (intents.includes("clear_agent_drawings")) {
    ctx.emitActivity({
      type: "drawing",
      status: "completed",
      message: "مسحت رسومات الوكيل من الشارت.",
    });
    return {
      decision: "informational",
      confidence: 0.9,
      summary: "مسحت رسومات الوكيل من الشارت. لم أُصدر توصية تداول لأن طلبك كان مسح الرسم فقط.",
      keyReasons: [],
      riskWarnings: [],
      activityEvents: [],
      drawings: [],
      analysisId,
    };
  }

  const symbol = chartContext?.symbol ?? "EURUSD";
  const interval = chartContext?.interval ?? "15m";
  ctx.emitActivity({
    type: "drawing",
    status: "started",
    message: intents.includes("draw_trendline")
      ? "أقرأ القمم والقيعان الواضحة لرسم خط الاتجاه."
      : "أقرأ المستويات القوية لرسم الدعم والمقاومة.",
    metadata: { symbol, interval },
  });

  const market = await buildAgentMarketContext({
    userId: ctx.userId,
    symbol,
    interval,
    visibleRange: chartContext?.visibleRange,
    latestCandle: chartContext?.latestCandle,
    dataSource: chartContext?.dataSource,
  });

  if (!market.sync.ok) {
    ctx.emitActivity({
      type: "drawing",
      status: "failed",
      message: market.sync.reason,
      metadata: {
        warehouseLastTime: market.sync.warehouseLastTime,
        liveLastTime: market.sync.liveLastTime,
        chartLastTime: market.sync.chartLastTime,
      },
    });
    return {
      decision: "action_required",
      confidence: 0,
      summary:
        "لم أرسم شيئًا لأن بيانات الوكيل غير متزامنة مع الشارت الحالي. حدّث الشارت أو انتظر اكتمال مزامنة الشموع ثم أعد طلب الرسم.",
      keyReasons: [market.sync.reason],
      riskWarnings: [],
      activityEvents: [],
      drawings: [],
      analysisId,
    };
  }

  const raw = intents.includes("draw_support_resistance")
    ? buildSupportResistanceDrawing(market)
    : buildTrendlineDrawing(market);
  const drawings = sanitizeAgentDrawings(raw, {
    analysisId,
    maxDrawings: ctx.session?.preferences.preferMinimalDrawings ? 3 : 8,
  });

  ctx.emitActivity({
    type: "drawing",
    status: "completed",
    message: drawings.length
      ? "رسمت المطلوب على الشارت دون إصدار توصية تداول."
      : "لم أجد نقاطًا قوية كافية للرسم دون تضليل.",
    metadata: { count: drawings.length },
  });

  return {
    decision: "informational",
    confidence: drawings.length ? 0.85 : 0.55,
    summary: drawings.length
      ? "رسمت المطلوب بناءً على بيانات الشارت الحالية. لم أُصدر توصية تداول لأن طلبك كان رسمًا فقط."
      : "لم أرسم شيئًا لأن النقاط المتاحة غير كافية أو غير متزامنة بما يكفي لرسم موثوق. لم أُصدر توصية تداول.",
    keyReasons: drawings.length ? ["طلبك كان رسمًا فقط، لذلك لم أشغّل تقييم المخاطر أو قرار شراء/بيع."] : [],
    riskWarnings: [],
    activityEvents: [],
    drawings,
    analysisId,
  };
}
