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
import { updateRecommendationContext, updateRecommendationIntelligence } from "./store";
import { attachChartToRecommendation, notifyRecommendation } from "./recommendationChart";
import {
  searchSimilarLessons,
  formatLessonsForPrompt,
} from "./tradeMemory";
import {
  evaluateCommittee,
} from "./committee";
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
import { fetchOhlc } from "./ohlc/fetchOhlc";
import { detectStructureLevels, type StructureAnalysis } from "./ohlc/structure";
import { resolveMt5Symbol } from "./mt5SymbolMap";
import {
  formatStructureForPrompt,
  mergeSeedAndAgentDrawings,
  smcPromptBlock,
  structureToSeedDrawings,
} from "./chartStructureAnalysis";
import {
  fetchTradingViewContext,
  formatTradingViewForPrompt,
} from "./tradingview/client";

export const MARKET_ANALYZE_COST = 4;

const EMPTY_AGENT_REPLY = "لم أتمكّن من صياغة رد. حاول مجدداً.";

function buildAnalyzeFallbackReply(
  sym: string,
  interval: string,
  snap: MarketSnapshot,
  structure: StructureAnalysis | null,
): string {
  const trend =
    snap.trend === "uptrend"
      ? "صاعد"
      : snap.trend === "downtrend"
        ? "هابط"
        : "عرضي";
  const lines = [
    `**تحليل ${sym} · ${interval}**`,
    snap.summary || `السعر ${snap.price}`,
    `الاتجاه: ${trend}`,
  ];
  if (snap.rsi14 != null) lines.push(`RSI(14): ${snap.rsi14.toFixed(1)}`);
  if (snap.sma20 != null) lines.push(`SMA20: ${snap.sma20.toFixed(2)}`);
  if (structure?.summary) lines.push(structure.summary);
  if (structure?.nearestSupport != null) {
    lines.push(`أقرب دعم: ${structure.nearestSupport.toFixed(2)}`);
  }
  if (structure?.nearestResistance != null) {
    lines.push(`أقرب مقاومة: ${structure.nearestResistance.toFixed(2)}`);
  }
  lines.push(
    "لم يُسجَّل قرار تنفيذي من الوكيل — راجع المستويات على الشارت أو أعد المحاولة.",
  );
  return lines.join("\n");
}

export type { ChartVisionSource } from "./marketAnalyzeLabels";
export { chartVisionLabelAr } from "./marketAnalyzeLabels";

function buildAnalyzePrompt(
  symbol: string,
  interval: string,
  snap: MarketSnapshot,
  contextBlock: string,
  profile: AnalysisProfile,
  memoryBlock = "",
  extraBlocks: string[] = [],
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
    ...extraBlocks,
    ``,
    `سياق السوق:\n${contextBlock}`,
    memoryBlock ? `\n${memoryBlock}` : "",
    ``,
    smcPromptBlock(),
    "المطلوب: تحليل مفصّل مع مستويات دخول ووقف خسارة وجني أرباح.",
    memoryBlock
      ? "إن وُجد درس مشابه أعلاه — اذكره صراحةً في rationale."
      : "",
    "سجّل التوصية عبر record_recommendation مع timeframe و chart_drawings و pattern_name.",
    "chart_drawings: price_line, trend_line, forecast_path, channel, zone, fib_retracement, baseline, marker — confidence + meta.rationale.",
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
  memoryBlock = "",
  extraBlocks: string[] = [],
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
    ...extraBlocks,
    contextBlock ? `سياق:\n${contextBlock}` : "",
    memoryBlock ? memoryBlock : "",
    smcPromptBlock(),
    "المطلوب: تحليل مرئي — أنماط، دعم/مقاومة، OB/FVG، مستويات دخول/SL/TP.",
    memoryBlock ? "اذكر أي درس مشابه من الذاكرة في rationale." : "",
    "سجّل عبر record_recommendation مع timeframe و chart_drawings و pattern_name.",
    "chart_drawings: كل عنصر label عربي + meta.rationale.",
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
  const market: MarketType = opts?.market ?? "crypto";
  let sym = symbol.toUpperCase().trim();
  if (market === "forex") {
    const resolved = await resolveMt5Symbol(userId, sym);
    if (resolved) sym = resolved;
  }
  const profile = profileForInterval(interval);
  const emit = (a: import("./agentActivity").AgentActivity) =>
    opts?.onActivity?.(a);

  let snap: MarketSnapshot;
  let ctx: Awaited<ReturnType<typeof fetchMarketContext>> | null = null;

  emit({ id: "mkt-data", label: "جلب لقطة السوق والشموع", status: "running" });
  const [snapResult, ohlcResult, tvContext] = await Promise.all([
    market === "forex"
      ? buildForexSnapshot(userId, sym, interval)
      : buildSnapshot(sym, interval),
    fetchOhlc({ userId, symbol: sym, interval, market, limit: 120 }).catch(
      () => null,
    ),
    fetchTradingViewContext(sym, interval, market),
  ]);
  emit({ id: "mkt-data", label: "جلب لقطة السوق والشموع", status: "done" });
  if (tvContext?.ok) {
    emit({
      id: "tv-context",
      label: "مؤشرات TradingView متعددة الأطر",
      status: "done",
      tool: "tradingview",
    });
  }

  snap = snapResult;
  if (market !== "forex") {
    ctx = await fetchMarketContext(sym, profile).catch(() => null);
  }

  const structure =
    ohlcResult && ohlcResult.candles.length >= 10
      ? detectStructureLevels(
          ohlcResult.symbol,
          ohlcResult.interval,
          ohlcResult.candles,
        )
      : null;

  if (structure) {
    emit({
      id: "structure",
      label: "تحليل البنية: الدعم والمقاومة والسيولة",
      status: "done",
    });
  }
  const seedDrawings = structure ? structureToSeedDrawings(structure) : [];

  const extraBlocks: string[] = [];
  if (structure) extraBlocks.push(formatStructureForPrompt(structure));
  const tvBlock = formatTradingViewForPrompt(tvContext);
  if (tvBlock) extraBlocks.push(tvBlock);

  const contextBlock = ctx
    ? formatContextForPrompt(ctx)
    : "سوق فوركس عبر MetaTrader — لا يتوفر سياق Web3/أخبار. اعتمد على التحليل الفني.";

  emit({ id: "memory", label: "مطابقة دروس صفقات سابقة", status: "running" });
  const similarLessons = await searchSimilarLessons(userId, {
    symbol: sym,
    snapshot: { rsi: snap.rsi14, trend: snap.trend },
    limit: 3,
  });
  emit({
    id: "memory",
    label: similarLessons.length
      ? `دروس مشابهة: ${similarLessons.length}`
      : "لا دروس مشابهة سابقة",
    status: "done",
  });
  const memoryBlock = formatLessonsForPrompt(similarLessons);

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
    ? buildVisionAnalyzePrompt(
        sym,
        interval,
        snap,
        contextBlock,
        profile,
        memoryBlock,
        extraBlocks,
      )
    : buildAnalyzePrompt(
        sym,
        interval,
        snap,
        contextBlock,
        profile,
        memoryBlock,
        extraBlocks,
      );

  const userContent: string | ContentBlock[] = useVision
    ? buildUserMessageContent(prompt, chartImage, false)
    : prompt;

  const result = await runAgent(
    { userId, settings, telegramSession: opts?.telegramSession ?? false },
    [{ role: "user", content: userContent }],
    {
      onActivity: opts?.onActivity,
      onDelta: opts?.onDelta,
      mode: "chart_analyze",
      hasImage: useVision,
    },
  );

  let reply = result.reply.trim();
  if (!reply || reply === EMPTY_AGENT_REPLY) {
    reply = buildAnalyzeFallbackReply(sym, interval, snap, structure);
  }

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

  if (rec && similarLessons.length) {
    await updateRecommendationIntelligence(rec.id, {
      memory_refs_json: JSON.stringify(similarLessons.map((l) => l.id)),
    });
    rec = {
      ...rec,
      memory_refs_json: JSON.stringify(similarLessons.map((l) => l.id)),
    };
  }

  if (rec && (rec.action === "buy" || rec.action === "sell")) {
    emit({
      id: "committee",
      label: "تصويت لجنة المخاطر (3 شخصيات)",
      status: "running",
    });
    const committee = await evaluateCommittee(userId, rec, similarLessons);
    await updateRecommendationIntelligence(rec.id, {
      committee_json: JSON.stringify(committee),
    });
    rec = { ...rec, committee_json: JSON.stringify(committee) };
    emit({
      id: "committee",
      label: committee.veto ? "لجنة المخاطر: تحفّظ (نقض)" : "تقييم لجنة المخاطر",
      status: "done",
      detail: committee.summary_ar?.slice(0, 80),
    });
  }

  const rawDrawings = rec ? parseChartDrawingsJson(rec.chart_drawings_json) : [];
  const agentDrawings = rawDrawings.length
    ? validateChartDrawings(
        rawDrawings,
        rec?.action ?? "wait",
        rec?.confidence ?? 60,
        profile,
      )
    : [];
  const drawings = mergeSeedAndAgentDrawings(seedDrawings, agentDrawings);

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
    reply,
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
