import type { AgentChartContext, AgentFinalResult, AgentIntent, AgentRunContext } from "../types";
import type { AppLocale } from "@/lib/i18n";
import { buildAgentMarketContext } from "../marketContext/buildAgentMarketContext";
import { operationalBlockerEnvelope, descriptiveEnvelope } from "../resultEnvelope";
import { newId } from "../activity";
import { sanitizeAgentDrawings } from "../drawings/drawingOwnership";
import { bilingual, composeStatusReply } from "../statusReply";
import { buildTrendlineDrawing } from "./buildTrendlineDrawing";
import { buildSupportResistanceDrawing } from "./buildSupportResistanceDrawing";
import {
  attachMandatoryPresentation,
  priceLevelsFromDrawings,
} from "../envelopePresentation";

export async function handleDrawingCommand(input: {
  intents: AgentIntent[];
  chartContext?: AgentChartContext;
  ctx: AgentRunContext;
  locale?: AppLocale;
  userMessage?: string;
}): Promise<AgentFinalResult> {
  const { intents, chartContext, ctx } = input;
  const locale: AppLocale = input.locale ?? "ar";
  const analysisId = newId();

  if (intents.includes("clear_agent_drawings")) {
    ctx.emitActivity({
      type: "drawing",
      status: "completed",
      message: bilingual(locale, "مسحت رسومات الوكيل من الشارت.", "Cleared the agent's drawings from the chart."),
    });
    const summary = await composeStatusReply({
      situation:
        "The operator asked to clear the agent-owned drawings from the chart and they were cleared. No trade recommendation was requested or issued. Acknowledge briefly.",
      facts: { clearedAgentDrawings: true, recommendationIssued: false },
      locale,
      userMessage: input.userMessage,
      fallback: bilingual(
        locale,
        "مسحت رسومات الوكيل من الشارت. لم أُصدر توصية تداول.",
        "Cleared my drawings from the chart. No trade recommendation was issued.",
      ),
    });
    return {
      decision: "informational",
      confidence: 0.9,
      summary,
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
      ? bilingual(locale, "أقرأ القمم والقيعان الواضحة لرسم خط الاتجاه.", "Reading clear swing highs/lows to draw the trend line.")
      : bilingual(locale, "أقرأ المستويات القوية لرسم الدعم والمقاومة.", "Reading strong levels to draw support and resistance."),
    metadata: { symbol, interval },
  });

  const market = await buildAgentMarketContext({
    userId: ctx.userId,
    symbol,
    interval,
    visibleRange: chartContext?.visibleRange,
    latestCandle: chartContext?.latestCandle,
    dataSource: chartContext?.dataSource,
    analysisKind: "drawing",
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
      // A sync failure is a platform fault, not a descriptive answer — label
      // it so the wrapper's descriptive default can never mask it as "ok".
      envelope: operationalBlockerEnvelope({
        failureStage: "market_data",
        failureCode: "stale_data",
        retryable: true,
        traceId: ctx.requestId,
      }),
      confidence: 0,
      summary: bilingual(
        locale,
        "تعذّر تأكيد أحدث الأسعار من حساب MetaTrader للرسم الآن. انتظر بضع ثوانٍ ثم أعد الطلب — لا حاجة لتحديث الصفحة.",
        "Could not confirm the latest broker prices for drawing right now. Wait a few seconds and ask again — no page refresh needed.",
      ),
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
      ? bilingual(locale, "رسمت المطلوب على الشارت دون إصدار توصية تداول.", "Drew the requested objects without issuing a trade recommendation.")
      : bilingual(locale, "لم أجد نقاطًا قوية كافية للرسم دون تضليل.", "No points strong enough to draw without being misleading."),
    metadata: { count: drawings.length },
  });

  const summary = await composeStatusReply({
    situation: drawings.length
      ? "The operator asked for a drawing-only action; the drawings were placed from real chart data. No risk evaluation or trade decision was run — describe briefly what was drawn."
      : "The operator asked for a drawing-only action, but the available points were too weak to draw reliably, so nothing was drawn. Explain honestly.",
    facts: {
      request: intents.includes("draw_support_resistance") ? "support_resistance" : "trendline",
      symbol,
      interval,
      drawingsPlaced: drawings.length,
      drawingTypes: [...new Set(drawings.map((d) => d.type))],
      recommendationIssued: false,
    },
    locale,
    userMessage: input.userMessage,
    fallback: drawings.length
      ? bilingual(
          locale,
          "رسمت المطلوب بناءً على بيانات الشارت الحالية. لم أُصدر توصية تداول لأن طلبك كان رسمًا فقط.",
          "Drew the requested objects from the current chart data. No trade recommendation was issued — the request was drawing only.",
        )
      : bilingual(
          locale,
          "لم أرسم شيئًا لأن النقاط المتاحة غير كافية لرسم موثوق. لم أُصدر توصية تداول.",
          "I did not draw anything — the available points were not strong enough for a reliable drawing. No trade recommendation was issued.",
        ),
  });

  const presented = attachMandatoryPresentation({
    summary,
    envelope: descriptiveEnvelope({ traceId: ctx.requestId }),
    source: chartContext?.dataSource ?? "metaapi",
    levels: priceLevelsFromDrawings(drawings),
    locale,
  });

  return {
    decision: "informational",
    confidence: drawings.length ? 0.85 : 0.55,
    summary: presented.summary,
    envelope: presented.envelope,
    keyReasons: [],
    riskWarnings: [],
    activityEvents: [],
    drawings,
    analysisId,
  };
}
