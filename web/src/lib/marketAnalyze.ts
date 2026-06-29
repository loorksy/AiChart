import { buildSnapshot, buildForexSnapshot, type MarketSnapshot } from "./market";
import { profileForInterval, buildProfilePromptHints } from "./analysisProfile";
import type { AnalysisProfile } from "./analysisProfile";
import {
  fetchMarketContext,
  formatContextForPrompt,
  contextSummary,
  snapshotSummaryLines,
} from "./marketContext";
import { processRecommendations } from "./tradeFlow";
import type { TradingSettings, Recommendation } from "./types";
import type { MarketType } from "./markets/types";
import { overlaysFromAnalysis } from "./chartOverlays";
import {
  parseChartDrawingsJson,
  validateChartDrawings,
} from "./chartDrawings";
import type { ProcessedIntent } from "./tradeFlow";
import { updateRecommendationContext, updateRecommendationIntelligence, saveRecommendation } from "./store";
import { attachChartToRecommendation, notifyRecommendation } from "./recommendationChart";
import {
  searchSimilarLessons,
  formatLessonsForPrompt,
} from "./tradeMemory";
import type { DeliveryResult } from "./alerts";
import { deliveryReasonAr } from "./alerts";
import {
  buildChartSnapshotBufferForMarket,
  bufferToChatImage,
} from "./chartSnapshot";
import {
  validateChatImage,
  type ChatImagePayload,
} from "./chatImage";

import type { ChartVisionSource } from "./marketAnalyzeLabels";
import { fetchOhlc } from "./ohlc/fetchOhlc";
import { detectStructureLevels, type StructureAnalysis } from "./ohlc/structure";
import {
  runAnalysisEngine,
  formatAnalysisForPrompt,
} from "./analysis/analysisEngine";
import { enrichRecommendationAfterRecord } from "./recommendationLevels";
import type { AgentActivity } from "./agentActivity";
import { resolveMt5Symbol } from "./mt5SymbolMap";
import {
  formatStructureForPrompt,
  mergeSeedAndAgentDrawings,
  smcPromptBlock,
  structureToSeedDrawings,
} from "./chartStructureAnalysis";
import {
  runChartAnalyzeLlm,
  buildChartAnalyzeUserContent,
  type LiveReasoningEntry,
} from "./analysis/chartAnalyzeLlm";
import {
  formatCandlesForPrompt,
  processAgentDrawings,
} from "./chart/processDrawings";
import { evaluateCommittee } from "./committee";
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
    "SL يجب أن يكون تحت/فوق مستوى هيكلي مذكور في rationale — لا تضع SL و TP قريبين من بعض.",
    "TP على مسافة R:R ≥ الحد الأدنى — لا تُفضّل البيع تلقائياً؛ اختر buy/sell/wait حسب البنية والاتجاه HTF.",
    memoryBlock
      ? "إن وُجد درس مشابه أعلاه — اذكره صراحةً في rationale."
      : "",
    "سجّل قرارك في JSON: decision (buy/sell/wait) مع entry/stop_loss/targets/reason/narrative/drawings/factors/pattern_name.",
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
    "سجّل في JSON: decision + timeframe + drawings + pattern_name.",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface MarketAnalyzeResult {
  reply: string;
  overlays: ReturnType<typeof overlaysFromAnalysis>;
  drawings: ReturnType<typeof validateChartDrawings>;
  recommendation: Recommendation | null;
  activities: AgentActivity[];
  intents: ProcessedIntent[];
  profileLabel: string;
  analysisTier: string;
  contextSummary: string[];
  symbol: string;
  interval: string;
  telegramSent: boolean;
  telegramReasonAr?: string;
  chartVisionSource: ChartVisionSource;
  liveReasoningLog: LiveReasoningEntry[];
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
  const market: MarketType = opts?.market ?? "forex";
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
  // Precompute the full technical analysis in TypeScript (indicators, levels,
  // patterns, fib, channels, confluence, suggestion) so the model reasons on a
  // finished analysis in a single pass instead of discovering via many tools.
  const engine =
    ohlcResult && ohlcResult.candles.length >= 20
      ? runAnalysisEngine(ohlcResult.symbol, ohlcResult.interval, ohlcResult.candles)
      : null;
  if (engine) {
    emit({
      id: "analysis-engine",
      label: "محرّك التحليل: أنماط ومستويات وثقة",
      status: "done",
    });
  }

  const seedDrawings =
    structure && ohlcResult?.candles.length
      ? structureToSeedDrawings(structure, ohlcResult.candles)
      : [];
  const engineDrawings = engine?.drawings ?? [];

  const extraBlocks: string[] = [];
  if (engine) extraBlocks.push(formatAnalysisForPrompt(engine.analysis));
  if (structure) extraBlocks.push(formatStructureForPrompt(structure));
  if (ohlcResult?.candles.length) {
    extraBlocks.push(formatCandlesForPrompt(ohlcResult.candles));
  }
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

  const userContent = buildChartAnalyzeUserContent(
    prompt,
    useVision && chartImage ? chartImage : null,
  );

  emit({ id: "agent-llm", label: "تحليل OpenAI · توصية", status: "running", tool: "claude" });

  const { result: llmOut } = await runChartAnalyzeLlm({
    userId,
    settings,
    userPrompt: prompt,
    userContent,
    onDelta: opts?.onDelta,
  });

  emit({ id: "agent-llm", label: "تحليل OpenAI · توصية", status: "done", tool: "claude" });

  let reply = llmOut.narrative.trim() || llmOut.reason.trim();
  if (!reply || reply === EMPTY_AGENT_REPLY) {
    reply = buildAnalyzeFallbackReply(sym, interval, snap, structure);
  }

  let rec: Recommendation | null = null;
  const action =
    llmOut.decision === "buy" || llmOut.decision === "sell" ? llmOut.decision : "wait";

  const candles = ohlcResult?.candles ?? [];
  const processedAgent = processAgentDrawings(llmOut.drawings, {
    candles,
    decision: action,
    confidence: llmOut.confidence,
    profile,
    symbol: sym,
    market,
    sourceTimeframe: interval,
  });

  const mergedRaw = mergeSeedAndAgentDrawings(
    processAgentDrawings([...seedDrawings, ...engineDrawings], {
      candles,
      decision: action,
      confidence: llmOut.confidence,
      profile,
      symbol: sym,
      market,
      sourceTimeframe: interval,
    }),
    processedAgent,
  );

  const agentDrawings = processAgentDrawings(mergedRaw, {
    candles,
    decision: action,
    confidence: llmOut.confidence,
    profile,
    symbol: sym,
    market,
    sourceTimeframe: interval,
  });

  const liveReasoningLog = llmOut.liveReasoningLog ?? [];

  if (action === "buy" || action === "sell") {
    rec = await saveRecommendation(userId, {
      symbol: sym,
      action,
      confidence: llmOut.confidence,
      entry: llmOut.entry,
      stop_loss: llmOut.stop_loss,
      take_profit: llmOut.targets[0] ?? null,
      timeframe: interval,
      rationale: llmOut.reason || llmOut.narrative,
      factors: llmOut.factors,
      pattern_name: llmOut.selected_pattern,
      chart_drawings_json:
        agentDrawings.length > 0 ? JSON.stringify(agentDrawings) : null,
      analysis_tier: profile.tier,
      market,
    });
    if (similarLessons.length) {
      const memoryRefs = JSON.stringify(similarLessons.map((l) => l.id));
      await updateRecommendationIntelligence(rec.id, { memory_refs_json: memoryRefs });
      rec = { ...rec, memory_refs_json: memoryRefs };
    }
    void evaluateCommittee(userId, rec, similarLessons)
      .then((committee) =>
        updateRecommendationIntelligence(rec!.id, {
          committee_json: JSON.stringify(committee),
        }),
      )
      .catch((e) => console.error("[committee] async eval failed", e));
  }

  const intents = await processRecommendations(userId, rec ? [rec] : [], {
    allowAdvisoryApproval: true,
    market,
  });

  if (rec && ctx) {
    await updateRecommendationContext(rec.id, JSON.stringify(ctx));
    rec = { ...rec, context_json: JSON.stringify(ctx) };
  }

  if (rec && (rec.action === "buy" || rec.action === "sell")) {
    rec = await enrichRecommendationAfterRecord(userId, rec, settings, market);
  }

  const rawDrawings = rec ? parseChartDrawingsJson(rec.chart_drawings_json) : agentDrawings;
  const validatedDrawings = rawDrawings.length
    ? processAgentDrawings(rawDrawings, {
        candles,
        decision: rec?.action ?? action,
        confidence: rec?.confidence ?? llmOut.confidence,
        profile,
        symbol: sym,
        market,
        sourceTimeframe: interval,
      })
    : agentDrawings;
  const drawings = validatedDrawings;

  if (rec && (rec.action === "buy" || rec.action === "sell")) {
    const attached = await attachChartToRecommendation(userId, rec, {
      notify: false,
      drawings,
    });
    rec = attached.rec;
  }

  let telegram = pickTelegramDelivery(intents, undefined);

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
    activities: [],
    intents,
    profileLabel: profile.labelAr,
    analysisTier: profile.tier,
    contextSummary: summaryLines,
    symbol: sym,
    interval,
    telegramSent: telegram.delivered,
    telegramReasonAr: telegram.reasonAr,
    chartVisionSource,
    liveReasoningLog,
  };
}
