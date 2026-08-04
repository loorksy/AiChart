import type { AppLocale } from "@/lib/i18n";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { ResultEnvelope } from "./resultEnvelope";
import type { AgentRecommendation } from "./types";

export function operatorMarketSourceLabel(
  source: "oanda" | "metaapi" | undefined,
  locale: AppLocale,
): string {
  if (source === "metaapi") {
    return locale === "ar"
      ? "MetaApi — حساب الوسيط السحابي"
      : "MetaApi broker cloud feed";
  }
  return locale === "ar" ? "OANDA — منصة Lonora" : "OANDA platform feed";
}

export function priceLevelsFromDrawings(drawings: ChartDrawing[]): number[] {
  const prices: number[] = [];
  for (const d of drawings) {
    for (const p of d.points ?? []) {
      if (typeof p.price === "number" && Number.isFinite(p.price)) {
        prices.push(p.price);
      }
    }
  }
  return dedupeSorted(prices).slice(0, 8);
}

export function keyLevelsFromRecommendation(
  rec?: AgentRecommendation | null,
): number[] {
  if (!rec) return [];
  const prices: number[] = [];
  if (typeof rec.entry === "number" && Number.isFinite(rec.entry)) prices.push(rec.entry);
  if (typeof rec.stop_loss === "number" && Number.isFinite(rec.stop_loss)) {
    prices.push(rec.stop_loss);
  }
  if (typeof rec.take_profit === "number" && Number.isFinite(rec.take_profit)) {
    prices.push(rec.take_profit);
  }
  for (const t of rec.targets ?? []) {
    if (typeof t === "number" && Number.isFinite(t)) prices.push(t);
  }
  return dedupeSorted(prices).slice(0, 8);
}

function dedupeSorted(prices: number[]): number[] {
  const rounded = prices.map((p) => Math.round(p * 100) / 100);
  return [...new Set(rounded)].sort((a, b) => a - b);
}

function formatLevelLine(levels: number[], locale: AppLocale): string {
  const pair = levels.slice(0, 2).map((l) => l.toFixed(2)).join(", ");
  return locale === "ar" ? `مستويات سعرية: ${pair}` : `Price levels: ${pair}`;
}

/**
 * Ensures operator-visible answers always name the market book and cite numeric
 * levels when we have them — independent of LLM phrasing.
 */
export function attachMandatoryPresentation(input: {
  summary: string;
  envelope: ResultEnvelope;
  source?: "oanda" | "metaapi";
  levels: number[];
  locale: AppLocale;
}): { summary: string; envelope: ResultEnvelope } {
  const sourceLabel = operatorMarketSourceLabel(input.source, input.locale);
  const levels = dedupeSorted(input.levels);
  const sourceLine =
    input.locale === "ar"
      ? `مصدر البيانات: ${sourceLabel}.`
      : `Data source: ${sourceLabel}.`;

  let summary = input.summary.trim();
  const namesSource =
    /OANDA|MetaApi|metaapi|منصة Lonora|الوسيط السحابي/i.test(summary);
  if (!namesSource) {
    summary = `${sourceLine}\n\n${summary}`;
  }

  const hasTwoNumbers = (summary.match(/\d{2,}\.\d{1,5}/g) ?? []).length >= 2;
  if (levels.length >= 2 && !hasTwoNumbers) {
    summary = `${summary}\n\n${formatLevelLine(levels, input.locale)}`;
  }

  return {
    summary,
    envelope: {
      ...input.envelope,
      market_data_source: sourceLabel,
      key_price_levels: levels.length ? levels : undefined,
    },
  };
}
