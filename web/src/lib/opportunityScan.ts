import { isSymbolAllowed } from "./allowedAssets";
import { DEFAULT_MARKET, resolveActiveMarket } from "@/lib/marketPolicy";
import { resolveScanAssetsForMarket } from "./allowedAssets.server";
import { isLLMConfigured } from "./llm";
import {
  getLimits,
  getSettings,
  getTodayUsage,
  incrementUsage,
  isDailyQuotaEnforced,
  isOnCooldown,
  logAudit,
  touchScanCooldown,
} from "./store";
import {
  scanForexSymbol,
  type OpportunityCandidate,
} from "./monitor";
import { runAgent } from "./agent";
import { metrics } from "./metrics";
import { processRecommendations, type ProcessedIntent } from "./tradeFlow";
import { notifyRecommendation } from "./recommendationChart";
import { dispatchAlert, type DeliveryResult } from "./alerts";
import { normalizeInterval } from "./intervals";
import type { Recommendation, TradingSettings } from "./types";
import type { AdminLimits } from "./types";
import type { MarketType } from "./markets/types";

export interface ScanResultItem {
  symbol: string;
  interval: string;
  score: number;
  signals: string[];
  snapshot: OpportunityCandidate["snapshot"];
}

export interface OpportunityScanResult {
  scannedAt: string;
  interval: string;
  market: MarketType;
  symbolsChecked: number;
  candidates: ScanResultItem[];
  deepAnalysis?: {
    symbol: string;
    recommendation: Recommendation | null;
    intents: ProcessedIntent[];
    reply: string;
  };
  telegram?: {
    technical?: DeliveryResult;
    final?: DeliveryResult;
  };
  errors: string[];
}

const MAX_DEEP_CANDIDATES = 3;

function effectiveInterval(
  settings: TradingSettings,
  interval?: string,
): string {
  return normalizeInterval(
    interval ?? settings.analysis_interval ?? "1h",
  );
}

async function scanOne(
  userId: number,
  symbol: string,
  style: TradingSettings["style"],
  interval: string,
  _market: MarketType,
): Promise<OpportunityCandidate | null> {
  return scanForexSymbol(userId, symbol, style, interval);
}

async function buildSymbolList(
  settings: TradingSettings,
  market: MarketType,
  opts?: {
    symbol?: string;
    focusOnly?: boolean;
    maxSymbols?: number;
  },
): Promise<string[]> {
  const max = opts?.maxSymbols ?? 40;
  const focus = opts?.symbol?.toUpperCase().trim();

  if (opts?.focusOnly && focus) {
    return [focus];
  }

  const base = await resolveScanAssetsForMarket(
    settings.allowed_assets,
    market,
    settings.user_id,
    max,
  );

  if (!focus) return base;

  return [focus, ...base.filter((s) => s !== focus)].slice(0, max);
}

function technicalPreviewText(c: ScanResultItem): string {
  return [
    `🔍 <b>فرصة فنية — ${c.symbol}</b> · ${c.interval}`,
    `نقاط: ${c.score}`,
    `إشارات: ${c.signals.join("، ")}`,
    c.snapshot.summary,
    "",
    "جارٍ التحليل العميق بالذكاء الاصطناعي…",
  ].join("\n");
}

function waitSummaryText(c: ScanResultItem, rationale?: string | null): string {
  return [
    `⏸ <b>لا توصية تنفيذية الآن — ${c.symbol}</b>`,
    rationale ? `السبب: ${rationale}` : "الوكيل يفضّل الانتظار رغم الإشارات الفنية.",
    "",
    `إشارات فنية: ${c.signals.join("، ")}`,
    c.snapshot.summary,
  ].join("\n");
}

/**
 * Cheap multi-symbol scan (no LLM). Optionally runs Claude on top candidates.
 * Respects user-selected symbol, interval, and market when provided.
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
  const market: MarketType = resolveActiveMarket(
    opts?.market ?? settings.active_market ?? DEFAULT_MARKET,
  );
  const interval = effectiveInterval(settings, opts?.interval);

  const result: OpportunityScanResult = {
    scannedAt: new Date().toISOString(),
    interval,
    market,
    symbolsChecked: 0,
    candidates: [],
    errors: [],
  };

  const symbols = await buildSymbolList(settings, market, opts);
  if (!symbols.length) {
    result.errors.push("لا توجد أزواج للمسح.");
    return result;
  }

  const candidates: ScanResultItem[] = [];

  for (const sym of symbols) {
    if (!isSymbolAllowed(settings.allowed_assets, sym, market)) {
      continue;
    }

    if (!opts?.skipCooldown && (await isOnCooldown(userId, sym))) continue;

    try {
      const candidate = await scanOne(
        userId,
        sym,
        settings.style,
        interval,
        market,
      );
      result.symbolsChecked++;
      if (!candidate) continue;

      candidates.push({
        symbol: candidate.symbol,
        interval: candidate.interval,
        score: candidate.score,
        signals: candidate.signals,
        snapshot: candidate.snapshot,
      });

      if (!opts?.skipCooldown) {
        await touchScanCooldown(userId, sym);
      }
    } catch (e) {
      result.errors.push(
        `${sym}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  result.candidates = candidates;

  if (!opts?.deep || candidates.length === 0) return result;

  if (!isLLMConfigured()) {
    result.errors.push("OpenAI غير مُفعّل — المسح السريع فقط.");
    return result;
  }

  const used = await getTodayUsage(userId);
  if (isDailyQuotaEnforced() && limits.claude_quota > 0 && used >= limits.claude_quota) {
    result.errors.push("رصيد Claude غير كافٍ للتحليل العميق.");
    return result;
  }

  const topCandidate = candidates[0];
  result.telegram = {
    technical: await dispatchAlert(userId, {
      type: "signal",
      title: `فرصة فنية — ${topCandidate.symbol}`,
      text: technicalPreviewText(topCandidate),
      symbol: topCandidate.symbol,
      bypassConfidenceGate: true,
    }),
  };

  const top = candidates.slice(0, MAX_DEEP_CANDIDATES);
  let bestRec: Recommendation | null = null;
  let bestReply = "";
  const allIntents: ProcessedIntent[] = [];
  let finalDelivery: DeliveryResult | undefined;

  for (const c of top) {
    try {
      const prompt =
        `راجع الرمز ${c.symbol} على إطار ${c.interval}. ` +
        `ظهرت إشارات فنية قوية (نقاط ${c.score}): ${c.signals.join("، ")}. ` +
        `البيانات: ${c.snapshot.summary}. ` +
        `الإشارات الفنية قوية — يجب تسجيل buy أو sell مع مستويات دخول ووقف خسارة وجني أرباح، ` +
        `أو wait مع تبرير صريح لماذا ترفض الإشارات. ` +
        `مرّر factors من الإشارات الفنية في record_recommendation.`;

      const agentResult = await runAgent(
        { userId, settings },
        [{ role: "user", content: prompt }],
      );
      metrics.agentRuns.inc({ mode: "monitor", status: "ok" });
      if (agentResult.toolCallsJson) {
        await logAudit(
          userId,
          "monitor_agent_trace",
          agentResult.toolCallsJson.slice(0, 2000),
        );
      }
      await incrementUsage(userId, 1);

      await logAudit(
        userId,
        "manual_scan_agent",
        `${c.symbol}@${c.interval}: ${c.signals.join(", ")}`,
      );

      if (agentResult.recommendations.length) {
        const intents = await processRecommendations(
          userId,
          agentResult.recommendations,
          { allowAdvisoryApproval: true, market },
        );
        allIntents.push(...intents);

        const actionable = agentResult.recommendations.find(
          (r) => r.action === "buy" || r.action === "sell",
        );
        const waitRec = agentResult.recommendations.find(
          (r) => r.action === "wait",
        );

        if (actionable && !bestRec) {
          bestRec = actionable;
          bestReply = agentResult.reply;

          const intentDelivery = intents.find(
            (i) =>
              i.telegramDelivered != null ||
              Boolean(i.telegramReasonAr),
          );
          if (intentDelivery) {
            finalDelivery = {
              delivered: intentDelivery.telegramDelivered ?? false,
              reasonAr: intentDelivery.telegramReasonAr,
            };
          } else if (intents.length > 0) {
            finalDelivery = {
              delivered: true,
              reason: "delivered",
              reasonAr: "أُرسل عبر مسار التنفيذ",
            };
          } else {
            finalDelivery = await notifyRecommendation(userId, actionable);
          }
        } else if (waitRec && !bestRec && !finalDelivery) {
          bestReply = agentResult.reply;
          finalDelivery = await dispatchAlert(userId, {
            type: "signal",
            title: `لا توصية — ${c.symbol}`,
            text: waitSummaryText(c, waitRec.rationale),
            symbol: c.symbol,
            bypassConfidenceGate: true,
          });
        }
      } else if (!bestRec && !finalDelivery) {
        finalDelivery = await dispatchAlert(userId, {
          type: "signal",
          title: `لا توصية — ${c.symbol}`,
          text: waitSummaryText(c, agentResult.reply.slice(0, 400)),
          symbol: c.symbol,
          bypassConfidenceGate: true,
        });
      }
    } catch (e) {
      result.errors.push(
        `deep/${c.symbol}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }

  if (result.telegram) {
    result.telegram.final = finalDelivery;
  }

  result.deepAnalysis = {
    symbol: bestRec?.symbol ?? top[0].symbol,
    recommendation: bestRec,
    intents: allIntents,
    reply: bestReply,
  };

  return result;
}

/**
 * Per-user deep scan wrapper for the worker tier: loads the user's settings +
 * limits and runs a deep opportunity scan. Used by the `opportunity_scan` job so
 * the monitor cron only enqueues (fast) and workers do the LLM-heavy analysis.
 */
export async function runOpportunityScanForUser(userId: number) {
  const settings = await getSettings(userId);
  const limits = await getLimits(userId);
  return runOpportunityScan(userId, settings, limits, { deep: true });
}
