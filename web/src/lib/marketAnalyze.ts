import { buildSnapshot, buildForexSnapshot } from "./market";
import { profileForInterval, buildProfilePromptHints } from "./analysisProfile";
import {
  fetchMarketContext,
  formatContextForPrompt,
  contextSummary,
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
import { attachChartToRecommendation } from "./recommendationChart";

export const MARKET_ANALYZE_COST = 3;

function buildAnalyzePrompt(
  symbol: string,
  interval: string,
  snap: Awaited<ReturnType<typeof buildSnapshot>>,
  contextBlock: string,
  profile: ReturnType<typeof profileForInterval>,
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
  telegramSent: boolean;
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
  },
): Promise<MarketAnalyzeResult> {
  const sym = symbol.toUpperCase().trim();
  const market: MarketType = opts?.market ?? "crypto";
  const profile = profileForInterval(interval);

  let snap: Awaited<ReturnType<typeof buildSnapshot>>;
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
  const prompt = buildAnalyzePrompt(sym, interval, snap, contextBlock, profile);

  const result = await runAgent(
    { userId, settings, telegramSession: opts?.telegramSession ?? true },
    [{ role: "user", content: prompt }],
    { onActivity: opts?.onActivity, onDelta: opts?.onDelta },
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

  let telegramSent = intents.some((i) => i.status === "pending");

  if (
    rec &&
    (rec.action === "buy" || rec.action === "sell") &&
    intents.length === 0
  ) {
    const enriched = await attachChartToRecommendation(userId, rec, {
      notify: true,
      drawings,
    });
    rec = enriched;
    telegramSent = true;
  }

  return {
    reply: result.reply,
    overlays: overlaysFromAnalysis(rec ?? undefined, snap),
    drawings,
    recommendation: rec,
    activities: result.activities,
    intents,
    profileLabel: profile.labelAr,
    analysisTier: profile.tier,
    contextSummary: ctx ? contextSummary(ctx) : [],
    telegramSent,
  };
}
