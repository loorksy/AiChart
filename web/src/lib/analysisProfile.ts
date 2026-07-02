import { barDurationSec, normalizeInterval } from "./intervals";
import type { TradingStyle } from "./types";

export type AnalysisTier = "intraday" | "swing" | "position";

export interface AnalysisProfile {
  tier: AnalysisTier;
  labelAr: string;
  newsLookbackHours: number;
  taWeight: number;
  contextWeight: number;
  forecastBarsMin: number;
  forecastBarsMax: number;
  requireNewsFactors: number;
  intentTtlMinutes: number;
  entrySlippagePct: number;
}

const INTRADAY: AnalysisProfile = {
  tier: "intraday",
  labelAr: "تحليل لحظي",
  newsLookbackHours: 2,
  taWeight: 0.75,
  contextWeight: 0.25,
  forecastBarsMin: 6,
  forecastBarsMax: 15,
  requireNewsFactors: 0,
  intentTtlMinutes: 30,
  entrySlippagePct: 0.5,
};

const SWING: AnalysisProfile = {
  tier: "swing",
  labelAr: "تحليل متوسط المدى (1h–4h)",
  newsLookbackHours: 48,
  taWeight: 0.55,
  contextWeight: 0.45,
  forecastBarsMin: 8,
  forecastBarsMax: 20,
  requireNewsFactors: 1,
  intentTtlMinutes: 120,
  entrySlippagePct: 1,
};

const POSITION: AnalysisProfile = {
  tier: "position",
  labelAr: "تحليل شامل",
  newsLookbackHours: 336,
  taWeight: 0.35,
  contextWeight: 0.65,
  forecastBarsMin: 5,
  forecastBarsMax: 12,
  requireNewsFactors: 2,
  intentTtlMinutes: 1440,
  entrySlippagePct: 1.5,
};

export function profileForTradingStyle(style: TradingStyle): AnalysisProfile {
  switch (style) {
    case "scalp":
    case "day":
      return INTRADAY;
    case "swing":
      return SWING;
    case "position":
      return POSITION;
    default:
      return INTRADAY;
  }
}

const STYLE_LABELS: Record<TradingStyle, string> = {
  scalp: "سكالب",
  day: "يومي",
  swing: "سوينغ",
  position: "مركزي (استثمار)",
};

export function buildTradingStylePromptHints(style: TradingStyle): string[] {
  const label = STYLE_LABELS[style];
  const common = [`نوع التداول المختار: ${label}.`];
  switch (style) {
    case "scalp":
      return [
        ...common,
        "تحليل سكالب: SL ضيق عند هيكل قريب، أهداف قصيرة (1–2R)، R:R ≥ 1.",
        "ركّز على زخم 1m–5m — لا توصية swing على هذا النوع.",
        "chart_drawings: entry + stop_loss + take_profit إلزامية عند buy/sell.",
      ];
    case "day":
      return [
        ...common,
        "تحليل يومي: R:R ≥ 1.5، SL عند مستوى هيكلي واضح، هدف واحد أو جزئي.",
        "اجمع بين اتجاه HTF وسياق الجلسة.",
        "chart_drawings: entry + stop_loss + take_profit إلزامية عند buy/sell.",
      ];
    case "swing":
      return [
        ...common,
        "تحليل سوينغ: أهداف أوسع (2–3R)، SL تحت/فوق swing structure.",
        "اذكر عوامل سياق 24–48 ساعة في factors.",
        "chart_drawings: entry + stop_loss + take_profit + forecast_path.",
      ];
    case "position":
      return [
        ...common,
        "تحليل مركزي: أفق أيام–أسابيع، SL واسع عند structure رئيسي.",
        "لا buy/sell من الشارت وحده — اذكر 2+ عوامل سياق/أخبار.",
        "chart_drawings: entry + stop_loss + take_profit عند ثقة عالية فقط.",
      ];
  }
}

export function profileForInterval(interval: string): AnalysisProfile {
  const iv = normalizeInterval(interval);
  // Duration-based tiering so any interval (derived 10m/45m/2d/2w and native
  // 8h/1M) maps to a tier without an explicit list entry.
  const sec = barDurationSec(iv);
  if (sec < 3600) return INTRADAY; // sub-hourly
  if (sec < 86400) return SWING; // hourly up to (not incl.) daily
  return POSITION; // daily and longer
}

/**
 * The AI infers the session type from the selected timeframe — there is no
 * manual trading-style choice. ≤5m → scalp, ≤1h → day, ≤1D → swing, else
 * position.
 */
export function tradingStyleForInterval(interval: string): TradingStyle {
  const sec = barDurationSec(normalizeInterval(interval));
  if (sec <= 300) return "scalp"; // 1m–5m
  if (sec <= 3600) return "day"; // 15m–1h
  if (sec <= 86400) return "swing"; // 2h–1D
  return "position"; // 1W and longer
}

export function buildProfilePromptHints(
  symbol: string,
  interval: string,
  profile: AnalysisProfile,
): string[] {
  const lines = [
    `ملف التحليل: ${profile.labelAr} · إطار ${interval}`,
    `وزن تقريبي: فني ${Math.round(profile.taWeight * 100)}% · سياق ${Math.round(profile.contextWeight * 100)}%`,
  ];
  if (profile.tier === "position") {
    lines.push(
      `ابدأ بالأخبار والسياق لآخر ${Math.round(profile.newsLookbackHours / 24)} أيام لـ ${symbol}، ثم أكّد بالتحليل الفني على ${interval}.`,
      `لا تُصدر توصية شراء/بيع من الشارت وحده — اذكر ${profile.requireNewsFactors}+ عوامل سياق في factors.`,
      `chart_drawings: مسار تنبؤي ${profile.forecastBarsMin}–${profile.forecastBarsMax} نقطة.`,
    );
  } else if (profile.tier === "swing") {
    lines.push(
      "اجمع بين نمط الشارت وأخبار/مزاج السوق خلال 24–48 ساعة.",
      `chart_drawings: forecast_path ${profile.forecastBarsMin}–${profile.forecastBarsMax} نقطة عند ثقة ≥ 70%.`,
    );
  } else {
    lines.push(
      "اعتمد على الزخم والشارت؛ الأخبار فقط إن كانت عاجلة خلال الساعتين الماضيتين.",
      `chart_drawings: مسار قصير ${profile.forecastBarsMin}–${profile.forecastBarsMax} شمعة.`,
    );
  }
  lines.push(
    "ارسم النماذج بصرياً: polyline_pattern, range_box, triangle, channel, neckline — كل نقطة time+price.",
    "حد أقصى 7 رسومات · 3 price_line · liveReasoningLog 3–7 عناصر.",
    "سيناريو تنبؤي تعليمي — ليس ضماناً.",
  );
  return lines;
}
