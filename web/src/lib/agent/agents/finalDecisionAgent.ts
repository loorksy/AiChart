import type {
  AgentRunContext,
  AgentDecision,
  AgentRecommendation,
} from "../types";
import type { RiskAgentResult } from "./riskAgent";
import type { NewsMacroResult } from "./newsMacroAgent";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { StructureResult } from "./structureAgent";
import type { SupplyDemandResult } from "./supplyDemandAgent";
import type { MultiTimeframeResult } from "./multiTimeframeAgent";
import type { ChartDrawing } from "@/lib/chartDrawings";
import {
  buildRecommendationConfidence,
  buildWaitConfidence,
  scoreDataQuality,
} from "../confidenceSemantics";

import type { ConfidenceSemantics } from "../confidenceSemantics";

export interface FinalDecisionResult {
  decision: Exclude<AgentDecision, "informational" | "action_required">;
  /**
   * Legacy single number kept for backward compatibility. Prefer
   * `confidenceSemantics.displayValue` for UI badges.
   */
  confidence: number;
  confidenceSemantics: ConfidenceSemantics;
  summary: string;
  keyReasons: string[];
  riskWarnings: string[];
  recommendation: AgentRecommendation;
  /** A short, user-safe reasoning trace (never raw chain-of-thought). */
  publicReasoningSummary: string[];
  /** True when the WAIT is a hard risk-veto safety stop. */
  riskVeto: boolean;
}

export interface FinalDecisionInput {
  userMessage: string;
  risk: RiskAgentResult | null;
  news: NewsMacroResult | null;
  market: AgentMarketContext;
  structure: StructureResult | null;
  supplyDemand: SupplyDemandResult | null;
  mtf: MultiTimeframeResult | null;
  chartDrawings?: ChartDrawing[];
}

const TREND_AR: Record<string, string> = {
  uptrend: "صاعد",
  downtrend: "هابط",
  range: "عرضي",
  unknown: "غير محدد",
};

/**
 * Synthesizes ONE final decision from the specialist outputs. The summary is
 * built from the ACTUAL context (symbol, trend, regime, the specific missing
 * condition, POI prices, news) — not a fixed canned string — so two different
 * WAITs never read the same. Risk veto stays a hard-coded safety stop.
 */
export async function runFinalDecisionAgent(
  ctx: AgentRunContext,
  input: FinalDecisionInput,
): Promise<FinalDecisionResult> {
  ctx.emitActivity({
    type: "analysis",
    status: "started",
    message: "أجمع نتائج الوكلاء في قرار نهائي واحد.",
  });

  const risk = input.risk;
  const symbol = input.market.symbol;
  const trend = input.structure?.trend ?? "unknown";
  const trendAr = TREND_AR[trend] ?? "غير محدد";
  const regimeAr = TREND_AR[input.market.marketRegime] ?? "غير محدد";
  const newsRisk = input.news?.newsRisk ?? "unknown";

  const newsWarn: string[] =
    newsRisk === "high"
      ? ["خطر إخباري مرتفع قريب — يفضّل تجنّب التنفيذ الآن."]
      : newsRisk === "medium"
        ? ["خطر إخباري متوسط — خُفّضت الثقة قليلاً."]
        : newsRisk === "unknown" && input.news
          ? [
              input.news.reason?.includes("Legacy") ||
              input.news.reason?.includes("plan")
                ? "مزوّد الأخبار مُعدّ لكن الخطة الحالية لا تغطي نقطة التقويم الاقتصادي."
                : "خطر الأخبار غير معروف — تعذّر جلب التقويم الاقتصادي من المزوّد.",
            ]
          : [];

  const coverage = input.market.dataQuality.coverage;
  const dataQualityScore = scoreDataQuality({
    sufficientForTrade: coverage?.sufficientForTrade ?? false,
    sufficientForAnalysis: coverage?.sufficientForAnalysis ?? input.market.dataQuality.sufficient,
    currentRatio:
      (coverage?.timeframes[0]?.available ?? input.market.dataQuality.currentTfCount) /
      Math.max(1, coverage?.timeframes[0]?.required ?? 500),
    higherRatio:
      (coverage?.timeframes[1]?.available ?? input.market.dataQuality.higherTfCount) /
      Math.max(1, coverage?.timeframes[1]?.required ?? 200),
    dailyRatio:
      (coverage?.timeframes[2]?.available ?? input.market.dataQuality.dailyCount) /
      Math.max(1, coverage?.timeframes[2]?.required ?? 100),
  });

  // --- Hard risk veto → WAIT with the ACTUAL rejection reasons. ---
  if (risk?.veto) {
    const reasons = [...risk.validation.reasons, ...risk.accountWarnings].filter(
      Boolean,
    );
    const primary =
      coverage && !coverage.sufficientForTrade
        ? coverage.summaryAr
        : (reasons[0] ?? "شروط المخاطرة الحالية غير مناسبة للدخول.");
    const waitSemantics = buildWaitConfidence({
      // High decision confidence when safety policy correctly rejects action.
      decisionConfidence: coverage && !coverage.sufficientForTrade ? 0.92 : 0.88,
      dataQualityScore,
      setupQuality: null,
      reasons: reasons.length ? reasons : [primary],
      riskVeto: true,
    });
    ctx.emitActivity({
      type: "final",
      status: "warning",
      message: "حوّلت القرار إلى انتظار بسبب شروط المخاطرة.",
    });
    return {
      decision: "wait",
      confidence:
        typeof waitSemantics.displayValue === "number"
          ? waitSemantics.displayValue
          : 0,
      confidenceSemantics: waitSemantics,
      summary: `انتظار على ${symbol}: ${primary} السوق ${regimeAr} والبنية ${trendAr}.`,
      keyReasons: reasons.length ? reasons : [primary],
      riskWarnings: [...risk.validation.warnings, ...newsWarn],
      recommendation: { action: "wait" },
      publicReasoningSummary: [
        `البنية الحالية: ${trendAr}، ونظام السوق: ${regimeAr}.`,
        `سبب الرفض: ${primary}`,
        `ثقة قرار الانتظار: ${Math.round((typeof waitSemantics.decisionConfidence === "number" ? waitSemantics.decisionConfidence : 0) * 100)}٪ — سياسة السلامة ترفض التنفيذ.`,
      ],
      riskVeto: true,
    };
  }

  const trade = risk?.proposedTrade;
  const candidate = risk?.selectedCandidate ?? null;
  const playbook = risk?.playbook ?? null;

  // --- Valid trade setup → buy/sell with POI + evidence + invalidation. ---
  if (trade && (trade.action === "buy" || trade.action === "sell")) {
    const rr = risk?.validation.rr;
    const poiAr = candidate
      ? `منطقة ${candidate.poi.type === "demand" ? "طلب" : "عرض"} (${candidate.poi.score.grade}/${candidate.poi.score.score}) عند ${fmt(candidate.poi.low)}–${fmt(candidate.poi.high)}`
      : "منطقة POI محددة";
    const setupAr =
      candidate?.setupType === "reversal_after_sweep"
        ? "انعكاس بعد سحب سيولة"
        : candidate?.setupType === "range_boundary"
          ? "ارتداد من حد النطاق"
          : candidate?.setupType === "breakout_retest"
            ? "إعادة اختبار بعد اختراق"
            : "استمرار مع الاتجاه";
    let baseConfidence =
      newsRisk === "high" ? 0.55 : newsRisk === "medium" ? 0.66 : 0.74;
    if (candidate?.poi.score.grade === "A") baseConfidence += 0.06;
    baseConfidence = Math.max(
      0.4,
      Math.min(0.9, baseConfidence + (playbook?.confidenceAdjustment ?? 0)),
    );
    const setupQuality = Math.max(
      0.4,
      Math.min(0.95, (candidate?.poi.score.score ?? 70) / 100),
    );
    const recSemantics = buildRecommendationConfidence({
      base: baseConfidence,
      dataQualityScore,
      setupQuality,
      newsRisk,
      dataSufficientForTrade: coverage?.sufficientForTrade ?? false,
    });
    const displayConfidence =
      typeof recSemantics.recommendationConfidence === "number"
        ? recSemantics.recommendationConfidence
        : 0;

    ctx.emitActivity({
      type: "final",
      status: "completed",
      message:
        trade.action === "buy"
          ? "القرار: شراء مشروط من منطقة الطلب."
          : "القرار: بيع مشروط من منطقة العرض.",
    });

    const dirAr = trade.action === "buy" ? "شراء" : "بيع";
    const entryTypeAr = entryTypeLabel(trade.entryType);
    return {
      decision: trade.action,
      confidence: displayConfidence,
      confidenceSemantics: recSemantics,
      summary:
        `${dirAr} مشروط على ${symbol} — إعداد ${setupAr} من ${poiAr} عند اللمس، وليس بمطاردة السعر. ` +
        `نوع الدخول: ${entryTypeAr}. الدخول ${fmt(trade.entry)} والوقف ${fmt(trade.stop_loss)}` +
        (rr ? ` بعائد/مخاطرة ~${rr.toFixed(1)}.` : ".") +
        ` ${candidate?.invalidationReason ?? "يُلغى السيناريو بإغلاق ما وراء الوقف."}`,
      keyReasons: candidate?.evidence.slice(0, 4) ?? [
        `الاتجاه ${trendAr} يدعم ${dirAr} من ${poiAr}.`,
        "الدخول مبني على منطقة POI مع وقف خلف المنطقة، لا على السعر الحالي.",
      ],
      riskWarnings: [
        ...(risk?.validation.warnings ?? []),
        ...(candidate?.warnings.slice(0, 2) ?? []),
        ...newsWarn,
      ],
      recommendation: {
        action: trade.action,
        entry: trade.entry,
        entryType: trade.entryType,
        stop_loss: trade.stop_loss,
        targets: trade.targets,
        take_profit: trade.targets?.[0],
        rr,
      },
      publicReasoningSummary: [
        `الاتجاه ${trendAr}، ونظام السوق ${regimeAr}.`,
        `الإعداد: ${setupAr} من ${poiAr}.`,
        `إبطال السيناريو: إغلاق ما وراء ${fmt(trade.stop_loss)}.`,
      ],
      riskVeto: false,
    };
  }

  // --- No setup → WAIT, naming the EXACT missing condition. ---
  ctx.emitActivity({
    type: "final",
    status: "completed",
    message: "القرار: انتظار — لا صفقة واضحة حالياً.",
  });

  const missing = explainMissingSetup(input, trend);
  const waitSemantics = buildWaitConfidence({
    decisionConfidence: 0.82,
    dataQualityScore,
    setupQuality: null,
    reasons: [missing],
    riskVeto: false,
  });
  return {
    decision: "wait",
    confidence:
      typeof waitSemantics.displayValue === "number"
        ? waitSemantics.displayValue
        : 0,
    confidenceSemantics: waitSemantics,
    summary: `انتظار على ${symbol}: ${missing} السوق ${regimeAr} والبنية ${trendAr}.`,
    keyReasons: [missing, "لا توجد توصية قابلة للتنفيذ حالياً."],
    riskWarnings: newsWarn,
    recommendation: { action: "wait" },
    publicReasoningSummary: [
      `البنية ${trendAr}، ونظام السوق ${regimeAr}.`,
      missing,
      `ثقة قرار الانتظار: ${Math.round((typeof waitSemantics.decisionConfidence === "number" ? waitSemantics.decisionConfidence : 0) * 100)}٪ — ليست ثقة توصية صفقة.`,
    ],
    riskVeto: false,
  };
}

/** Names the concrete reason no trade was proposed, so WAITs read differently. */
function explainMissingSetup(
  input: FinalDecisionInput,
  trend: string,
): string {
  // The playbook/candidate engine already computed the exact rejection.
  const rejected = input.risk?.candidatesResult?.rejectedReasons ?? [];
  if (rejected.length) return rejected[0]!;
  const blocking = input.risk?.playbook?.blockingReasons ?? [];
  if (blocking.length) return blocking[0]!;

  if (input.mtf?.conflict) {
    return "يوجد تعارض بين الفريم الحالي والفريم الأعلى، والدخول ضد الفريم الأكبر غير مبرَّر.";
  }
  if (trend === "range" || input.market.marketRegime === "range") {
    return "السعر داخل نطاق عرضي دون منطقة دخول واضحة على أحد الحدود.";
  }
  const hasDemand = Boolean(input.supplyDemand?.nearestDemand);
  const hasSupply = Boolean(input.supplyDemand?.nearestSupply);
  if (trend === "uptrend" && !hasDemand) {
    return "الاتجاه صاعد لكن لا توجد منطقة طلب قريبة صالحة للشراء عند الارتداد.";
  }
  if (trend === "downtrend" && !hasSupply) {
    return "الاتجاه هابط لكن لا توجد منطقة عرض قريبة صالحة للبيع عند الارتداد.";
  }
  return "السعر ليس عند منطقة POI مناسبة الآن، والدخول هنا يعني مطاردة السعر.";
}

function entryTypeLabel(type: AgentRecommendation["entryType"]): string {
  if (type === "market") return "سوق";
  if (type === "buy_limit" || type === "sell_limit") return "ليمت/تصحيح";
  if (type === "buy_stop" || type === "sell_stop") return "ستوب/اختراق";
  return "مشروط";
}

function fmt(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 5;
  return n.toFixed(digits);
}
