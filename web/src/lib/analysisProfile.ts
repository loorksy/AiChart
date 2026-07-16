export type AnalysisTier = "scalp";

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

/** The sole product cadence. Higher timeframes remain evidence for a scalp thesis. */
const SCALP: AnalysisProfile = {
  tier: "scalp",
  labelAr: "تحليل سكالب",
  newsLookbackHours: 2,
  taWeight: 0.75,
  contextWeight: 0.25,
  forecastBarsMin: 6,
  forecastBarsMax: 15,
  requireNewsFactors: 0,
  intentTtlMinutes: 30,
  entrySlippagePct: 0.5,
};

export function profileForInterval(_interval: string): AnalysisProfile {
  return SCALP;
}

export function buildProfilePromptHints(
  symbol: string,
  interval: string,
  profile: AnalysisProfile,
): string[] {
  return [
    `تحليل سكالب قصير الأفق على ${symbol} بإطار عرض ${interval}.`,
    "استخدم الزخم والبنية والسيولة والتذبذب والمستويات والأخبار المتاحة كأدلة، ولا تجعل أي عامل منفرد بوابة قرار.",
    `إن أفادت الرسوم فاجعل أفقها ${profile.forecastBarsMin}–${profile.forecastBarsMax} شمعة، ويمكن الامتناع عن الرسم.`,
    "لا تخترع نموذجًا مسمى ولا ترسم لمجرد ملء الشارت.",
  ];
}
