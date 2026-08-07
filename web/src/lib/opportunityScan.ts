import { DEFAULT_MARKET, resolveActiveMarket } from "@/lib/marketPolicy";
import { resolveScanAssetsForMarket } from "./allowedAssets.server";
import { isLLMConfigured } from "./llm";
import { withUsageContext } from "./billing/usageMeter";
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
import { scanForexSymbol, type OpportunityCandidate } from "./monitor";
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
  telegram?: { technical?: DeliveryResult; final?: DeliveryResult };
  errors: string[];
}

/** Cheap indicators rank what the AI should inspect; they never issue trades. */
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
  const base = opts?.focusOnly && focus
    ? [focus]
    : await resolveScanAssetsForMarket(settings.allowed_assets, market, settings.user_id, opts?.maxSymbols ?? 40);
  const symbols = focus && !opts?.focusOnly
    ? [focus, ...base.filter((symbol) => symbol !== focus)]
    : base;
  const result: OpportunityScanResult = {
    scannedAt: new Date().toISOString(),
    interval,
    market,
    symbolsChecked: 0,
    candidates: [],
    errors: [],
  };

  for (const symbol of symbols) {
    if (!opts?.skipCooldown && await isOnCooldown(userId, symbol)) continue;
    try {
      const candidate = await withUsageContext({ userId, kind: "scan" }, () =>
        scanForexSymbol(userId, symbol, interval),
      );
      result.symbolsChecked += 1;
      if (!candidate) continue;
      result.candidates.push({
        symbol: candidate.symbol,
        interval: candidate.interval,
        score: candidate.score,
        signals: candidate.signals,
        snapshot: candidate.snapshot,
      });
      if (!opts?.skipCooldown) await touchScanCooldown(userId, symbol);
    } catch (error) {
      result.errors.push(`${symbol}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  result.candidates.sort((a, b) => b.score - a.score);
  if (!opts?.deep || result.candidates.length === 0) return result;
  if (!isLLMConfigured()) {
    result.errors.push("تعذّر تشغيل نموذج القرار؛ أُعيدت نتائج المسح الفني فقط.");
    return result;
  }
  const used = await getTodayUsage(userId);
  if (isDailyQuotaEnforced() && limits.claude_quota > 0 && used >= limits.claude_quota) {
    result.errors.push("الرصيد غير كافٍ للتحليل العميق.");
    return result;
  }

  const top = result.candidates.slice(0, 3);
  let best: Recommendation | null = null;
  let reply = "";
  let finalDelivery: DeliveryResult | undefined;
  result.telegram = {
    technical: await dispatchAlert(userId, {
      type: "signal",
      title: `مرشح للمراجعة — ${top[0].symbol}`,
      text: `رصد المسح أدلة أولية على ${top[0].symbol}. يجري الآن تقييمها بواسطة مساعد Lonora.`,
      symbol: top[0].symbol,
    }),
  };

  for (const candidate of top) {
    try {
      const decision = await runUnifiedChartAgent({
        surface: "internal",
        userMessage: `راجع ${candidate.symbol} على ${candidate.interval} كفرصة سكالب. هذه مؤشرات أولية وليست قراراً: ${candidate.signals.join("، ")}. اختر BUY أو SELL أو WAIT من بيانات السوق الفعلية.`,
        chartContext: { symbol: candidate.symbol, interval: candidate.interval, dataSource: "metaapi" },
        requestContext: { requestId: newId(), userId, emitActivity: () => {} },
        account: null,
        canExecute: false,
      });
      await incrementUsage(userId, 1);
      await logAudit(userId, "opportunity_scan_ai", `${candidate.symbol}@${candidate.interval} decision=${decision.decision}`);
      reply = decision.summary;
      const rec = decision.recommendation;
      if (!best && rec && (rec.action === "buy" || rec.action === "sell")) {
        best = {
          symbol: candidate.symbol,
          action: rec.action,
          entry: rec.entry ?? null,
          stop_loss: rec.stop_loss ?? null,
          take_profit: rec.take_profit ?? rec.targets?.[0] ?? null,
          confidence: Math.round(decision.confidence * 100),
          timeframe: candidate.interval,
        } as Recommendation;
        // runUnifiedChartAgent already persisted this recommendation and announced it
        // exactly once through the lifecycle notifier's dedupe path (opportunity_created).
        // Sending a second, undeduped alert here would double-notify the user for one
        // opportunity — see docs/UNIFIED_AGENT_COMPLETION_AUDIT.md single-announcer contract.
        break;
      }
    } catch (error) {
      result.errors.push(`deep/${candidate.symbol}: ${error instanceof Error ? error.message : "error"}`);
    }
  }

  if (!best && reply) {
    finalDelivery = await dispatchAlert(userId, {
      type: "signal",
      title: `لا توجد فرصة حالية — ${top[0].symbol}`,
      text: reply,
      symbol: top[0].symbol,
    });
  }
  result.telegram.final = finalDelivery;
  result.deepAnalysis = {
    symbol: best?.symbol ?? top[0].symbol,
    recommendation: best,
    intents: [],
    reply,
  };
  return result;
}

export async function runOpportunityScanForUser(userId: number) {
  const settings = await getSettings(userId);
  const limits = await getLimits(userId);
  return runOpportunityScan(userId, settings, limits, { deep: true });
}
