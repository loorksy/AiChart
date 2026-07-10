import { callLLM, isLLMConfigured } from "@/lib/llm";
import { sanitizePublicText } from "../activity";
import type { ActiveRecommendation } from "../sessionRecommendation";
import type { RecommendationStatusEvaluation } from "./evaluateRecommendationStatus";

export async function composeRecommendationExplanation(input: {
  userMessage?: string;
  recommendation: ActiveRecommendation;
}): Promise<string> {
  return compose({
    task:
      "اشرح للمستخدم على ماذا بُنيت التوصية السابقة. كن طبيعيًا ومحددًا، واذكر المستويات والسبب والإبطال. لا تخترع سببًا غير موجود.",
    payload: {
      question: input.userMessage,
      recommendation: publicRecommendation(input.recommendation),
    },
    fallback: fallbackExplain(input.recommendation),
  });
}

export async function composeRecommendationStatusAnswer(input: {
  userMessage?: string;
  recommendation: ActiveRecommendation;
  evaluation: RecommendationStatusEvaluation;
}): Promise<string> {
  return compose({
    task:
      "حدّث المستخدم بحالة التوصية السابقة الآن. اشرح هل ما زالت معلقة، تفعلت، ضربت هدفًا، ضربت الوقف، أو بطلت. كن مباشرًا ولا تعط توصية معاكسة جديدة.",
    payload: {
      question: input.userMessage,
      recommendation: publicRecommendation(input.recommendation),
      evaluation: input.evaluation,
    },
    fallback:
      `حالة التوصية ${input.recommendation.direction} على ${input.recommendation.symbol}: ${input.evaluation.status}.\n` +
      `${input.evaluation.reason}\nالسعر الحالي: ${input.evaluation.priceNow}. الدخول: ${input.recommendation.entry}، الوقف: ${input.recommendation.stopLoss}، الأهداف: ${input.recommendation.targets.join(", ")}.`,
  });
}

async function compose(input: {
  task: string;
  payload: Record<string, unknown>;
  fallback: string;
}): Promise<string> {
  if (!isLLMConfigured()) return input.fallback;
  try {
    const res = await callLLM({
      system:
        "أنت وكيل تداول داخل AiChart. اكتب إجابة عربية طبيعية ومختصرة من البيانات المعطاة فقط. لا تكشف تفكيرًا داخليًا، ولا تخترع مستويات أو أخبارًا، ولا تحوّل المتابعة إلى درس عام.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({ task: input.task, data: input.payload }),
        },
      ],
      maxTokens: 700,
    });
    const text = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return sanitizePublicText(text) || input.fallback;
  } catch {
    return input.fallback;
  }
}

function publicRecommendation(rec: ActiveRecommendation) {
  return {
    symbol: rec.symbol,
    interval: rec.interval,
    direction: rec.direction,
    status: rec.status,
    entry: rec.entry,
    entryType: rec.entryType,
    stopLoss: rec.stopLoss,
    targets: rec.targets,
    rr: rec.rr,
    triggerCondition: rec.triggerCondition,
    invalidationRule: rec.invalidationRule,
    setupType: rec.setupType,
    poi: rec.poi,
    summary: rec.summary,
    keyReasons: rec.keyReasons,
    riskWarnings: rec.riskWarnings,
    publicReasoningSummary: rec.publicReasoningSummary,
    priceAtCreation: rec.priceAtCreation,
  };
}

function fallbackExplain(rec: ActiveRecommendation): string {
  return (
    `التوصية السابقة كانت ${rec.direction} على ${rec.symbol} (${rec.interval}) من ${rec.entry}، الوقف ${rec.stopLoss}، الأهداف ${rec.targets.join(", ")}.\n` +
    `سببها:\n- ${rec.keyReasons.join("\n- ")}\n` +
    `الإبطال: ${rec.invalidationRule}`
  );
}
