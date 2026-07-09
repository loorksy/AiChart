import type { AgentRunContext } from "../types";
import { affectedCurrencies } from "@/lib/markets/symbolMapping";
import {
  getNewsProvider,
  newsProviderConfigured,
  type EconomicEvent,
} from "../news/newsProvider";

export interface NewsMacroResult {
  newsRisk: "low" | "medium" | "high" | "unknown";
  biasImpact: "bullish" | "bearish" | "mixed" | "unknown";
  affectedCurrencies: string[];
  upcomingEvents: EconomicEvent[];
  /** Advisory only — the News agent NEVER opens trades or decides alone. It can
   *  reduce confidence, warn, or temporarily block. */
  tradeAllowed: boolean;
  reason: string;
}

/**
 * News & Macro Risk agent. Checks both currencies of a pair (USD/Fed/yields for
 * gold). With no provider configured, returns newsRisk=unknown and never fakes
 * events. A high-impact event within the next hour blocks execution temporarily.
 */
export async function runNewsMacroAgent(
  ctx: AgentRunContext,
  input: { symbol?: string; message?: string },
): Promise<NewsMacroResult> {
  const symbol = input.symbol ?? "";
  const currencies = affectedCurrencies(symbol);

  ctx.emitActivity({
    type: "news",
    status: "started",
    message: symbol
      ? `أراجع الأخبار والأحداث المؤثرة على ${symbol}.`
      : "أراجع السياق الإخباري المطلوب.",
    metadata: { symbol, currencies },
  });

  if (!newsProviderConfigured()) {
    ctx.emitActivity({
      type: "news",
      status: "warning",
      message: "لا يوجد مزوّد أخبار مفعّل — سأعتبر خطر الأخبار غير معروف.",
    });
    return {
      newsRisk: "unknown",
      biasImpact: "unknown",
      affectedCurrencies: currencies,
      upcomingEvents: [],
      tradeAllowed: true,
      reason: "News provider is not configured.",
    };
  }

  const provider = getNewsProvider();
  if (!provider) {
    return {
      newsRisk: "unknown",
      biasImpact: "unknown",
      affectedCurrencies: currencies,
      upcomingEvents: [],
      tradeAllowed: true,
      reason: "News provider unavailable.",
    };
  }

  const now = new Date();
  const to = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  let events: EconomicEvent[] = [];
  try {
    events = await provider.getEconomicEvents({ currencies, from: now, to });
  } catch {
    ctx.emitActivity({
      type: "news",
      status: "warning",
      message: "تعذّر جلب الأخبار — سأعتبر خطر الأخبار غير معروف.",
    });
    return {
      newsRisk: "unknown",
      biasImpact: "unknown",
      affectedCurrencies: currencies,
      upcomingEvents: [],
      tradeAllowed: true,
      reason: "News provider request failed.",
    };
  }

  const highImpactSoon = events.some((e) => {
    const minutes = (new Date(e.time).getTime() - Date.now()) / 60_000;
    return e.impact === "high" && minutes >= 0 && minutes <= 60;
  });

  const newsRisk: NewsMacroResult["newsRisk"] = highImpactSoon
    ? "high"
    : events.length
      ? "medium"
      : "low";

  ctx.emitActivity({
    type: "news",
    status: newsRisk === "high" ? "warning" : "completed",
    message:
      newsRisk === "high"
        ? "يوجد خطر إخباري مرتفع قريب."
        : "راجعت الأخبار دون خطر مرتفع فوري.",
    metadata: { newsRisk, events: events.length },
  });

  return {
    newsRisk,
    biasImpact: "unknown",
    affectedCurrencies: currencies,
    upcomingEvents: events,
    tradeAllowed: !highImpactSoon,
    reason: highImpactSoon
      ? "High-impact event scheduled within the next hour."
      : "No immediate high-impact event detected.",
  };
}
