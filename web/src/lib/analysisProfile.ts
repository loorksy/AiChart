import { barDurationSec, normalizeInterval } from "./intervals";

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

export function profileForInterval(interval: string): AnalysisProfile {
  const iv = normalizeInterval(interval);
  // Duration-based tiering so any interval (derived 10m/45m/2d/2w and native
  // 8h/1M) maps to a tier without an explicit list entry.
  const sec = barDurationSec(iv);
  if (sec < 3600) return INTRADAY; // sub-hourly
  if (sec < 86400) return SWING; // hourly up to (not incl.) daily
  return POSITION; // daily and longer
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
    "استخدم chart_drawings بأنواع متعددة (price_line, trend_line, forecast_path, marker…) حسب ثقة كل عنصر.",
    "سيناريو تنبؤي تعليمي — ليس ضماناً.",
  );
  return lines;
}
