import { DEFAULT_MARKET, resolveActiveMarket } from "@/lib/marketPolicy";
import { resolveScanAssetsForMarket } from "./allowedAssets.server";
import { isLLMConfigured } from "./llm";
import {
  getLimits,
  getSettings,
  getTodayUsage,
  incrementUsage,
  logAudit,
  isDailyQuotaEnforced,
  isOnCooldown,
  touchScanCooldown,
} from "./store";
import { scanForexSymbol, type MarketScreeningItem } from "./monitor";
import { runUnifiedChartAgent } from "./agent/orchestrator";
import { newId } from "./agent/activity";
import { dispatchAlert, type DeliveryResult } from "./alerts";
import { normalizeInterval } from "./intervals";
import type { Recommendation, TradingSettings, AdminLimits } from "./types";
import type { ProcessedIntent } from "./tradeFlow";
import type { MarketType } from "./markets/types";

export interface ScanResultItem {
  symbol: string;
  interval: string;
  activityScore: number;
  neutralEvidence: string[];
  sourceHealth: MarketScreeningItem["sourceHealth"];
  quoteFreshnessMs: number | null;
  spread: number | null;
  volatilityActivityPct: number | null;
  candleCoverage: number | null;
  structuralActivity: string | null;
  neutralSummary: string;
  snapshot: MarketScreeningItem["snapshot"];
}

export interface OpportunityScanResult {
  scannedAt: string;
  interval: string;
  market: MarketType;
  symbolsChecked: number;
  /** Bounded neutral shortlist — never a trade recommendation list. */
  screeningItems: ScanResultItem[];
  /**
   * @deprecated Alias of screeningItems for transitional callers.
   * Do not treat as trade proposals.
   */
  candidates: ScanResultItem[];
  deepAnalysis?: {
    symbol: string;
    recommendation: Recommendation | null;
    intents: ProcessedIntent[];
    reply: string;
    shortlistCompared: boolean;
  };
  telegram?: { technical?: DeliveryResult; final?: DeliveryResult };
  errors: string[];
}

function toScanItem(item: MarketScreeningItem): ScanResultItem {
  return {
    symbol: item.symbol,
    interval: item.interval,
    activityScore: item.activityScore,
    neutralEvidence: item.neutralEvidence,
    sourceHealth: item.sourceHealth,
    quoteFreshnessMs: item.quoteFreshnessMs,
    spread: item.spread,
    volatilityActivityPct: item.volatilityActivityPct,
    candleCoverage: item.candleCoverage,
    structuralActivity: item.structuralActivity,
    neutralSummary: item.neutralSummary,
    snapshot: item.snapshot,
  };
}

/**
 * Cheap indicators rank what the AI should inspect; they never issue trades.
 * Deep mode supplies the complete bounded shortlist to the model — it does not
 * auto-select the highest activity item as a recommendation.
 */
export async function runOpportunityScan(
  userId: number,
  settings: TradingSettings,
  limits: AdminLimits,
  opts?: {
    deep?: boolean;
    skipCooldown?: boolean;
    maxSymbols?: number;
    symbol?: string;
    interval?: string;
    market?: MarketType;
    focusOnly?: boolean;
  },
): Promise<OpportunityScanResult> {
  const market = resolveActiveMarket(opts?.market ?? DEFAULT_MARKET);
  const interval = normalizeInterval(opts?.interval ?? "5m");
  const focus = opts?.symbol?.toUpperCase().trim();
  const base =
    opts?.focusOnly && focus
      ? [focus]
      : await resolveScanAssetsForMarket(
          settings.allowed_assets,
          market,
          settings.user_id,
          opts?.maxSymbols ?? 40,
        );
  const symbols =
    focus && !opts?.focusOnly
      ? [focus, ...base.filter((symbol) => symbol !== focus)]
      : base;
  const result: OpportunityScanResult = {
    scannedAt: new Date().toISOString(),
    interval,
    market,
    symbolsChecked: 0,
    screeningItems: [],
    candidates: [],
    errors: [],
  };

  for (const symbol of symbols) {
    if (!opts?.skipCooldown && (await isOnCooldown(userId, symbol))) continue;
    try {
      const item = await scanForexSymbol(userId, symbol, interval);
      result.symbolsChecked += 1;
      if (!item) continue;
      result.screeningItems.push(toScanItem(item));
      if (!opts?.skipCooldown) await touchScanCooldown(userId, symbol);
    } catch (error) {
      result.errors.push(
        `${symbol}: ${error instanceof Error ? error.message : "error"}`,
      );
    }
  }
  result.screeningItems.sort((a, b) => b.activityScore - a.activityScore);
  // Keep a bounded shortlist for the model — never a trade selection.
  result.screeningItems = result.screeningItems.slice(0, 8);
  result.candidates = result.screeningItems;

  if (!opts?.deep || result.screeningItems.length === 0) return result;
  if (!isLLMConfigured()) {
    result.errors.push(
      "تعذّر تشغيل نموذج القرار؛ أُعيدت نتائج المسح الفني فقط.",
    );
    return result;
  }
  const used = await getTodayUsage(userId);
  if (
    isDailyQuotaEnforced() &&
    limits.claude_quota > 0 &&
    used >= limits.claude_quota
  ) {
    result.errors.push("الرصيد غير كافٍ للتحليل العميق.");
    return result;
  }

  const shortlist = result.screeningItems;
  const shortlistText = shortlist
    .map(
      (item, index) =>
        `${index + 1}. ${item.symbol}@${item.interval} activity=${item.activityScore} evidence=${item.neutralEvidence.join("; ") || "none"}`,
    )
    .join("\n");

  result.telegram = {
    technical: await dispatchAlert(userId, {
      type: "signal",
      title: `قائمة محايدة للمراجعة — ${shortlist.length} رمز`,
      text: `رصد المسح أدلة نشاط محايدة على ${shortlist.length} رموز. يقارن النموذج القائمة كاملة قبل اختيار الرمز والاتجاه.`,
      symbol: shortlist[0]!.symbol,
    }),
  };

  let reply = "";
  let best: Recommendation | null = null;
  let finalDelivery: DeliveryResult | undefined;
  let shortlistCompared = false;

  try {
    // One model call receives the complete bounded shortlist. The model —
    // not activity ranking — selects symbol/timeframe and BUY/SELL/WAIT.
    const decision = await runUnifiedChartAgent({
      userMessage: [
        "قارن القائمة التالية كاملة كأدلة نشاط محايدة فقط (ليست توصيات).",
        "اختر بنفسك الرمز والإطار والاتجاه BUY أو SELL أو WAIT من بيانات السوق الفعلية.",
        "لا تعتمد ترتيب النشاط كقرار تداول.",
        shortlistText,
      ].join("\n"),
      chartContext: {
        symbol: shortlist[0]!.symbol,
        interval: shortlist[0]!.interval,
        dataSource: "oanda",
      },
      requestContext: {
        requestId: newId(),
        userId,
        emitActivity: () => {},
      },
      account: null,
      canExecute: false,
    });
    shortlistCompared = true;
    await incrementUsage(userId, 1);
    await logAudit(
      userId,
      "opportunity_scan_ai",
      `shortlist=${shortlist.length} decision=${decision.decision}`,
    );
    reply = decision.summary;
    const rec = decision.recommendation;
    const decidedSymbol =
      typeof decision.activeRecommendation?.symbol === "string"
        ? decision.activeRecommendation.symbol
        : shortlist[0]!.symbol;
    if (rec && (rec.action === "buy" || rec.action === "sell")) {
      best = {
        symbol: decidedSymbol,
        action: rec.action,
        entry: rec.entry ?? null,
        stop_loss: rec.stop_loss ?? null,
        take_profit: rec.take_profit ?? rec.targets?.[0] ?? null,
        confidence: Math.round(decision.confidence * 100),
        timeframe: shortlist[0]!.interval,
      } as Recommendation;
      finalDelivery = await dispatchAlert(userId, {
        type: "signal",
        title: `${rec.action === "buy" ? "BUY" : "SELL"} — ${decidedSymbol}`,
        text: decision.summary,
        symbol: decidedSymbol,
      });
    }
  } catch (error) {
    result.errors.push(
      `deep/shortlist: ${error instanceof Error ? error.message : "error"}`,
    );
  }

  if (!best && reply) {
    finalDelivery = await dispatchAlert(userId, {
      type: "signal",
      title: `لا توجد فرصة حالية — مراجعة القائمة`,
      text: reply,
      symbol: shortlist[0]!.symbol,
    });
  }
  result.telegram.final = finalDelivery;
  result.deepAnalysis = {
    symbol: best?.symbol ?? shortlist[0]!.symbol,
    recommendation: best,
    intents: [],
    reply:
      reply ||
      "Neutral shortlist ready. The host model must compare all items before choosing.",
    shortlistCompared,
  };
  return result;
}

export async function runOpportunityScanForUser(userId: number) {
  const settings = await getSettings(userId);
  const limits = await getLimits(userId);
  return runOpportunityScan(userId, settings, limits, { deep: true });
}
