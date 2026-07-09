import type {
  AgentRunContext,
  AgentDecision,
  AgentRecommendation,
} from "../types";
import type { RiskAgentResult } from "./riskAgent";
import type { NewsMacroResult } from "./newsMacroAgent";

export interface FinalDecisionResult {
  decision: Exclude<AgentDecision, "informational" | "action_required">;
  confidence: number;
  summary: string;
  keyReasons: string[];
  riskWarnings: string[];
  recommendation: AgentRecommendation;
}

export interface FinalDecisionInput {
  userMessage: string;
  risk: RiskAgentResult | null;
  news: NewsMacroResult | null;
}

/** Collapses the specialist outputs into ONE final decision. */
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

  // Risk veto (setup invalid or account limit) → WAIT.
  if (risk?.veto) {
    ctx.emitActivity({
      type: "final",
      status: "warning",
      message: "حوّلت القرار إلى انتظار بسبب شروط المخاطرة.",
    });
    return {
      decision: "wait",
      confidence: 0.72,
      summary:
        "الأفضل الانتظار حالياً لأن شروط المخاطرة أو موقع الدخول غير مناسبة.",
      keyReasons: [...risk.validation.reasons, ...risk.accountWarnings],
      riskWarnings: risk.validation.warnings,
      recommendation: { action: "wait" },
    };
  }

  const trade = risk?.proposedTrade;
  const newsWarn =
    input.news && input.news.newsRisk === "medium"
      ? ["خطر إخباري متوسط — خُفّضت الثقة قليلاً."]
      : [];

  if (trade && (trade.action === "buy" || trade.action === "sell")) {
    const baseConfidence = input.news?.newsRisk === "medium" ? 0.66 : 0.74;
    ctx.emitActivity({
      type: "final",
      status: "completed",
      message:
        trade.action === "buy"
          ? "القرار: شراء مشروط من منطقة الطلب."
          : "القرار: بيع مشروط من منطقة العرض.",
    });
    return {
      decision: trade.action,
      confidence: baseConfidence,
      summary:
        trade.action === "buy"
          ? "السيناريو الأفضل شراء مشروط من منطقة الطلب المحددة عند اللمس."
          : "السيناريو الأفضل بيع مشروط من منطقة العرض المحددة عند اللمس.",
      keyReasons: [
        "القرار مبني على منطقة POI وليس مطاردة السعر الحالي.",
        "روجعت بنية السوق والفريم الأكبر والمخاطرة.",
      ],
      riskWarnings: [...(risk?.validation.warnings ?? []), ...newsWarn],
      recommendation: {
        action: trade.action,
        entry: trade.entry,
        stop_loss: trade.stop_loss,
        targets: trade.targets,
        take_profit: trade.targets?.[0],
        rr: risk?.validation.rr,
      },
    };
  }

  ctx.emitActivity({
    type: "final",
    status: "completed",
    message: "القرار: انتظار — لا صفقة واضحة حالياً.",
  });
  return {
    decision: "wait",
    confidence: 0.65,
    summary:
      "لا توجد صفقة واضحة حالياً. الأفضل انتظار وصول السعر إلى منطقة أوضح.",
    keyReasons: ["السعر ليس في منطقة دخول مناسبة."],
    riskWarnings: newsWarn,
    recommendation: { action: "wait" },
  };
}
