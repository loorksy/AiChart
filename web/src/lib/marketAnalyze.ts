import { buildSnapshot, buildForexSnapshot, type MarketSnapshot } from "./market";
import { profileForInterval, buildProfilePromptHints } from "./analysisProfile";
import type { AnalysisProfile } from "./analysisProfile";
import {
  fetchMarketContext,
  formatContextForPrompt,
  contextSummary,
  snapshotSummaryLines,
} from "./marketContext";
import { runAgent } from "./agent";
import { processRecommendations } from "./tradeFlow";
import type { TradingSettings } from "./types";
import type { MarketType } from "./markets/types";
import { overlaysFromAnalysis } from "./chartOverlays";
import {
  parseChartDrawingsJson,
  validateChartDrawings,
} from "./chartDrawings";
import type { ProcessedIntent } from "./tradeFlow";
import { updateRecommendationContext } from "./store";
import { attachChartToRecommendation, notifyRecommendation } from "./recommendationChart";
import type { DeliveryResult } from "./alerts";
import { deliveryReasonAr } from "./alerts";
import {
  buildChartSnapshotBufferForMarket,
  bufferToChatImage,
} from "./chartSnapshot";
import {
  buildUserMessageContent,
  validateChatImage,
  type ChatImagePayload,
} from "./chatImage";
import type { ContentBlock } from "./anthropic";

import type { ChartVisionSource } from "./marketAnalyzeLabels";

export const MARKET_ANALYZE_COST = 4;

export type { ChartVisionSource } from "./marketAnalyzeLabels";
export { chartVisionLabelAr } from "./marketAnalyzeLabels";

function buildAnalyzePrompt(
  symbol: string,
  interval: string,
  snap: MarketSnapshot,
  contextBlock: string,
  profile: AnalysisProfile,
): string {
  return [
    `حلّل ${symbol} على إطار ${interval} بالعربية.`,
    ...buildProfilePromptHints(symbol, interval, profile),
    ``,
    `البيانات الفنية: ${snap.summary}`,
    snap.rsi14 != null ? `RSI(14): ${snap.rsi14.toFixed(1)}` : "",
    snap.sma20 != null ? `SMA20: ${snap.sma20.toFixed(2)}` : "",
    snap.sma50 != null ? `SMA50: ${snap.sma50.toFixed(2)}` : "",
    `الاتجاه: ${snap.trend === "uptrend" ? "صاعد" : snap.trend === "downtrend" ? "هابط" : "عرضي"}`,
    ``,
    `سياق السوق:\n${contextBlock}`,
    ``,
    "المطلوب: تحليل مفصّل مع مستويات دخول ووقف خسارة وجني أرباح.",
    "سجّل التوصية عبر record_recommendation مع timeframe و chart_drawings و pattern_name.",
    "chart_drawings: استخدم الأنواع المناسبة كلها — price_line, trend_line, forecast_path, channel, zone, fib_retracement, baseline, marker, histogram_band — كل عنصر له confidence و points.",
    "مرّر timeframe نفس إطار التحليل.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildVisionAnalyzePrompt(
  symbol: string,
  interval: string,
  snap: MarketSnapshot,
  contextBlock: string,
  profile: AnalysisProfile,
): string {
  const trend =
    snap.trend === "uptrend"
      ? "صاعد"
      : snap.trend === "downtrend"
        ? "هابط"
        : "عرضي";
  return [
    `حلّل الشارت المرفق لـ ${symbol} على إطار ${interval} بالعربية.`,
    ...buildProfilePromptHints(symbol, interval, profile),
    `مرجع سريع: RSI ${snap.rsi14?.toFixed(1) ?? "—"} · اتجاه ${trend} · ${snap.summary}`,
    contextBlock ? `سياق:\n${contextBlock}` : "",
    "المطلوب: تحليل مرئي من الصورة — أنماط، دعم/مقاومة، مستويات دخول/SL/TP.",
    "سجّل عبر record_recommendation مع timeframe و chart_drawings و pattern_name.",
    "chart_drawings: price_line, trend_line, forecast_path, channel, zone, fib_retracement, baseline, marker, histogram_band.",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface MarketAnalyzeResult {
  reply: string;
  overlays: ReturnType<typeof overlaysFromAnalysis>;
  drawings: ReturnType<typeof validateChartDrawings>;
  recommendation: Awaited<ReturnType<typeof runAgent>>["recommendations"][0] | null;
  activities: Awaited<ReturnType<typeof runAgent>>["activities"];
  intents: ProcessedIntent[];
  profileLabel: string;
  analysisTier: string;
  contextSummary: string[];
  symbol: string;
  interval: string;
  telegramSent: boolean;
  telegramReasonAr?: string;
  chartVisionSource: ChartVisionSource;
}

function pickTelegramDelivery(
  intents: ProcessedIntent[],
  agentDeliveries?: DeliveryResult[],
): DeliveryResult {
  const intentWithTelegram = intents.find(
    (i) => i.telegramDelivered != null || i.telegramReasonAr,
  );
  if (intentWithTelegram) {
    return {
      delivered: intentWithTelegram.telegramDelivered ?? false,
      reasonAr: intentWithTelegram.telegramReasonAr,
    };
  }
  const agentDelivery = agentDeliveries?.[agentDeliveries.length - 1];
  if (agentDelivery) return agentDelivery;
  return {
    delivered: false,
    reason: "no_actionable_signal",
    reasonAr: deliveryReasonAr("no_actionable_signal"),
  };
}

async function resolveChartImage(
  userId: number,
  sym: string,
  interval: string,
  market: MarketType,
  clientImage?: ChatImagePayload | null,
): Promise<{ image: ChatImagePayload | null; source: ChartVisionSource }> {
  if (clientImage) {
    return { image: clientImage, source: "client" };
  }

  const buffer = await buildChartSnapshotBufferForMarket(
    userId,
    sym,
    interval,
    market,
  );
  const serverImage = buffer ? bufferToChatImage(buffer) : null;
  if (serverImage) {
    return { image: serverImage, source: "server" };
  }

  return { image: null, source: "text" };
}

export async function runMarketAnalyze(
  userId: number,
  settings: TradingSettings,
  symbol: string,
  interval: string,
  opts?: {
    onActivity?: (a: import("./agentActivity").AgentActivity) => void;
    onDelta?: (text: string) => void;
    telegramSession?: boolean;
    market?: MarketType;
    chartImage?: ChatImagePayload | null;
  },
): Promise<MarketAnalyzeResult> {
  const sym = symbol.toUpperCase().trim();
  const market: MarketType = opts?.market ?? "crypto";
  const profile = profileForInterval(interval);

  let snap: MarketSnapshot;
  let ctx: Awaited<ReturnType<typeof fetchMarketContext>> | null = null;
  if (market === "forex") {
    snap = await buildForexSnapshot(userId, sym, interval);
  } else {
    [snap, ctx] = await Promise.all([
      buildSnapshot(sym, interval),
      fetchMarketContext(sym, profile),
    ]);
  }
  const contextBlock = ctx
    ? formatContextForPrompt(ctx)
    : "سوق فوركس عبر MetaTrader — لا يتوفر سياق Web3/أخبار. اعتمد على التحليل الفني.";

  let validatedClient: ChatImagePayload | null = null;
  if (opts?.chartImage) {
    const check = validateChatImage(
      opts.chartImage.media_type,
      opts.chartImage.data,
    );
    if (check.ok) validatedClient = check.image;
  }

  const { image: chartImage, source: chartVisionSource } =
    await resolveChartImage(userId, sym, interval, market, validatedClient);

  const useVision = chartImage != null;
  if (useVision) {
    opts?.onActivity?.({
      id: "chart-vision",
      label:
        chartVisionSource === "client"
          ? "يحلّل الشارت المعروض على الشاشة"
          : "يحلّل لقطة شارت من الخادم",
      status: "done",
    });
  } else {
    opts?.onActivity?.({
      id: "chart-vision",
      label: "تحليل نصي — لم تُلتقط صورة الشارت",
      status: "done",
    });
  }
  const prompt = useVision
    ? buildVisionAnalyzePrompt(sym, interval, snap, contextBlock, profile)
    : buildAnalyzePrompt(sym, interval, snap, contextBlock, profile);

  const userContent: string | ContentBlock[] = useVision
    ? buildUserMessageContent(prompt, chartImage, false)
    : prompt;

  const result = await runAgent(
    { userId, settings, telegramSession: opts?.telegramSession ?? false },
    [{ role: "user", content: userContent }],
    {
      onActivity: opts?.onActivity,
      onDelta: opts?.onDelta,
      mode: useVision ? "chart_analyze" : "default",
    },
  );

  const intents = await processRecommendations(userId, result.recommendations, {
    allowAdvisoryApproval: true,
    market,
  });

  let rec =
    result.recommendations.find((r) => r.symbol === sym) ??
    result.recommendations[0] ??
    null;

  if (rec && ctx) {
    await updateRecommendationContext(rec.id, JSON.stringify(ctx));
    rec = { ...rec, context_json: JSON.stringify(ctx) };
  }

  const rawDrawings = rec ? parseChartDrawingsJson(rec.chart_drawings_json) : [];
  const drawings =
    rec && rawDrawings.length
      ? validateChartDrawings(
          rawDrawings,
          rec.action,
          rec.confidence,
          profile,
        )
      : [];

  if (rec && (rec.action === "buy" || rec.action === "sell")) {
    const attached = await attachChartToRecommendation(userId, rec, {
      notify: false,
      drawings,
    });
    rec = attached.rec;
  }

  let telegram = pickTelegramDelivery(intents, result.signalDeliveries);

  if (
    !telegram.delivered &&
    rec &&
    (rec.action === "buy" || rec.action === "sell") &&
    intents.length === 0
  ) {
    telegram = await notifyRecommendation(userId, rec);
  }

  const summaryLines = [
    ...snapshotSummaryLines(snap),
    ...(ctx ? contextSummary(ctx) : []),
  ];

  return {
    reply: result.reply,
    overlays: overlaysFromAnalysis(rec ?? undefined, snap),
    drawings,
    recommendation: rec,
    activities: result.activities,
    intents,
    profileLabel: profile.labelAr,
    analysisTier: profile.tier,
    contextSummary: summaryLines,
    symbol: sym,
    interval,
    telegramSent: telegram.delivered,
    telegramReasonAr: telegram.reasonAr,
    chartVisionSource,
  };
}
