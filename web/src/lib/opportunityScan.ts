import {
  resolveScanAssetsForMarket,
  isSymbolAllowed,
} from "./allowedAssets";
import { isAnthropicConfigured } from "./anthropic";
import {
  getTodayUsage,
  incrementUsage,
  isOnCooldown,
  logAudit,
  touchScanCooldown,
} from "./store";
import {
  scanSymbol,
  scanForexSymbol,
  type OpportunityCandidate,
} from "./monitor";
import { runAgent } from "./agent";
import { processRecommendations, type ProcessedIntent } from "./tradeFlow";
import { notifyRecommendation } from "./recommendationChart";
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
  market: MarketType,
): Promise<OpportunityCandidate | null> {
  if (market === "forex") {
    return scanForexSymbol(userId, symbol, style, interval);
  }
  return scanSymbol(symbol, style, interval);
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
    max,
  );

  if (!focus) return base;

  return [focus, ...base.filter((s) => s !== focus)].slice(0, max);
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
  const market: MarketType =
    opts?.market ?? settings.active_market ?? "crypto";
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

  if (!isAnthropicConfigured()) {
    result.errors.push("وكيل Claude غير مُفعّل — المسح السريع فقط.");
    return result;
  }

  const used = await getTodayUsage(userId);
  if (limits.claude_quota > 0 && used >= limits.claude_quota) {
    result.errors.push("رصيد Claude غير كافٍ للتحليل العميق.");
    return result;
  }

  const top = candidates.slice(0, MAX_DEEP_CANDIDATES);
  let bestRec: Recommendation | null = null;
  let bestReply = "";
  let allIntents: ProcessedIntent[] = [];

  for (const c of top) {
    try {
      const prompt =
        `راجع الرمز ${c.symbol} على إطار ${c.interval}. ` +
        `ظهرت إشارات فنية: ${c.signals.join("، ")}. ` +
        `البيانات: ${c.snapshot.summary}. ` +
        `هل توجد فرصة حقيقية الآن؟ سجّل توصية منظّمة على إطار ${c.interval} للرمز ${c.symbol} أو انتظر.`;

      const agentResult = await runAgent(
        { userId, settings },
        [{ role: "user", content: prompt }],
      );
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
        if (actionable && !bestRec) {
          bestRec = actionable;
          bestReply = agentResult.reply;
          await notifyRecommendation(userId, actionable, {
            notifyTelegram: true,
            notifyWeb: true,
          });
        }
      }
    } catch (e) {
      result.errors.push(
        `deep/${c.symbol}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }

  result.deepAnalysis = {
    symbol: bestRec?.symbol ?? top[0].symbol,
    recommendation: bestRec,
    intents: allIntents,
    reply: bestReply,
  };

  return result;
}
