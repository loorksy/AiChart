import { callLLM, isLLMConfigured } from "@/lib/llm";
import { sanitizePublicText } from "../activity";
import { canonicalIdentityCore } from "../canonicalIdentity";
import type { ActiveRecommendation } from "../sessionRecommendation";
import type { RecommendationStatusEvaluation } from "./evaluateRecommendationStatus";

export async function composeRecommendationExplanation(input: {
  userMessage?: string;
  recommendation: ActiveRecommendation;
}): Promise<string> {
  return compose({
    task:
      "Explain to the operator what the previous recommendation was built on. Be natural and specific: levels, reasoning, and invalidation. Never invent a reason that is not in the data.",
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
      "Update the operator on the previous recommendation's current status: still pending, triggered, target hit, stop hit, or invalidated. Be direct; do not issue a new opposite recommendation.",
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
      system: [
        canonicalIdentityCore(),
        "",
        "Write ONE short, natural follow-up reply grounded ONLY in the provided data. Mirror the language of the operator's question (Arabic question → Arabic reply, English → English). Do not reveal internal reasoning, do not invent levels or news, and do not turn a follow-up into a general lesson.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: JSON.stringify({ task: input.task, data: input.payload }),
        },
      ],
      maxTokens: 700,
    }, { tier: "quick" });
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
