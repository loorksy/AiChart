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

export interface FinalDecisionResult {
  decision: Exclude<AgentDecision, "informational" | "action_required">;
  confidence: number;
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
          ? ["خطر الأخبار غير معروف — لم يُفعَّل مزوّد الأخبار."]
          : [];

  // --- Hard risk veto → WAIT with the ACTUAL rejection reasons. ---
  if (risk?.veto) {
    const reasons = [...risk.validation.reasons, ...risk.accountWarnings].filter(
      Boolean,
    );
    const primary = reasons[0] ?? "شروط المخاطرة الحالية غير مناسبة للدخول.";
    ctx.emitActivity({
      type: "final",
      status: "warning",
      message: "حوّلت القرار إلى انتظار بسبب شروط المخاطرة.",
    });
    return {
      decision: "wait",
      confidence: 0.7,
      summary: `انتظار على ${symbol}: ${primary} السوق ${regimeAr} والبنية ${trendAr}.`,
      keyReasons: reasons.length ? reasons : [primary],
      riskWarnings: [...risk.validation.warnings, ...newsWarn],
      recommendation: { action: "wait" },
      publicReasoningSummary: [
        `البنية الحالية: ${trendAr}، ونظام السوق: ${regimeAr}.`,
        `سبب الرفض: ${primary}`,
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

    ctx.emitActivity({
      type: "final",
      status: "completed",
      message:
        trade.action === "buy"
          ? "القرار: شراء مشروط من منطقة الطلب."
          : "القرار: بيع مشروط من منطقة العرض.",
    });

    const dirAr = trade.action === "buy" ? "شراء" : "بيع";
    return {
      decision: trade.action,
      confidence: baseConfidence,
      summary:
        `${dirAr} مشروط على ${symbol} — إعداد ${setupAr} من ${poiAr} عند اللمس، وليس بمطاردة السعر. ` +
        `الدخول ${fmt(trade.entry)} والوقف ${fmt(trade.stop_loss)}` +
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
  return {
    decision: "wait",
    confidence: 0.6,
    summary: `انتظار على ${symbol}: ${missing} السوق ${regimeAr} والبنية ${trendAr}.`,
    keyReasons: [missing],
    riskWarnings: newsWarn,
    recommendation: { action: "wait" },
    publicReasoningSummary: [
      `البنية ${trendAr}، ونظام السوق ${regimeAr}.`,
      missing,
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

function fmt(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 5;
  return n.toFixed(digits);
}
