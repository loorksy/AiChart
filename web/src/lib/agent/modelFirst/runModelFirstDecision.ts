/**
 * Model-first final decision: Responses API + Structured Outputs + repair pass.
 * No candidate binding. Direction is never rewritten by validation.
 */
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { sanitizePublicText } from "../activity";
import type { AgentRunContext } from "../types";
import type { FinalDecisionResult } from "../agents/finalDecisionAgent";
import {
  buildRecommendationConfidence,
  buildWaitConfidence,
} from "../confidenceSemantics";
import type { AppLocale } from "@/lib/i18n";
import {
  pickDefaultModelId,
  type ReasoningEffort,
  validateReasoningForModel,
  validateUserModelSelection,
} from "./modelRegistry";
import { loadModelRegistry } from "./modelRegistryStore";
import { llmTradingTimeoutMs } from "@/lib/externalFetch";
import {
  callOpenAIResponses,
  type ResponsesImageInput,
} from "./openaiResponses";
import {
  MODEL_FIRST_SYSTEM_PROMPT,
  MODEL_TRADE_PLAN_JSON_SCHEMA,
  ModelTradePlanSchema,
  type ModelTradePlan,
} from "./modelTradePlan";
import { validateTradePlanTechnically, type ValidatedTradePlan } from "./validatedTradePlan";
import type { NeutralMarketEvidence } from "./buildNeutralEvidence";
import { assertNoCandidateAuthority } from "./buildNeutralEvidence";

export type ModelFirstMode = "off" | "shadow" | "live";

export function getModelFirstMode(): ModelFirstMode {
  const raw = (process.env.MODEL_FIRST_MODE ?? "live").trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "live") return raw;
  return "live";
}

export interface ModelFirstDecisionDeps {
  apiKey?: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort | null;
  callResponses?: typeof callOpenAIResponses;
}

export interface ModelFirstDecisionOutcome {
  result: FinalDecisionResult | null;
  validated: ValidatedTradePlan | null;
  usedLLM: boolean;
  modelId: string | null;
  reasoningEffort: ReasoningEffort | null;
  responseId: string | null;
  repaired: boolean;
  visionUsed: boolean;
  candidateLeakKeys: string[];
  shadowOnly: boolean;
  responseIds?: string[];
  tokenUsage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? trimmed;
}

function toFinalResult(
  plan: ModelTradePlan,
  validated: ValidatedTradePlan,
  marketPrice: number | null,
): FinalDecisionResult {
  const clean = (arr: string[], max: number) =>
    arr.map((s) => sanitizePublicText(s).slice(0, 240)).filter(Boolean).slice(0, max);
  const keyReasons = clean(plan.keyReasons, 6);
  const riskWarnings = clean(
    plan.warnings,
    6,
  );
  if (!validated.executionReady && plan.decision !== "wait") {
    riskWarnings.unshift(
      "اتجاه السوق محفوظ من التحليل، لكن مستويات التنفيذ غير صالحة حالياً وتحتاج تحديثاً.",
    );
  }
  const confidenceSemantics =
    plan.decision === "wait" || !validated.executionReady
      ? buildWaitConfidence({
          decisionConfidence: plan.confidence,
          dataQualityScore: 1,
          setupQuality: null,
          reasons: keyReasons,
        })
      : buildRecommendationConfidence({
          base: plan.confidence,
          dataQualityScore: 1,
          setupQuality: plan.confidence,
          newsRisk: "unknown",
          dataSufficientForTrade: true,
        });

  return {
    decision: plan.decision,
    confidence: plan.confidence,
    confidenceSemantics,
    summary: sanitizePublicText(plan.summary).slice(0, 900),
    keyReasons,
    riskWarnings,
    publicReasoningSummary: clean([plan.marketThesis], 5),
    recommendation: {
      action: plan.decision,
      entry: validated.executionReady ? validated.entry ?? undefined : undefined,
      entryType:
        plan.activation === "immediate"
          ? "market"
          : plan.activation === "conditional"
            ? plan.decision === "buy"
              ? "buy_limit"
              : plan.decision === "sell"
                ? "sell_limit"
                : undefined
            : undefined,
      stop_loss: validated.executionReady
        ? validated.stopLoss ?? undefined
        : undefined,
      targets: validated.executionReady ? validated.targets : undefined,
      take_profit: validated.executionReady
        ? validated.targets[0] ?? undefined
        : undefined,
      activationClass:
        plan.activation === "immediate" || plan.activation === "conditional"
          ? plan.activation
          : undefined,
      triggerCondition: plan.requiredConfirmation ?? undefined,
      invalidationLevel: plan.invalidation ?? undefined,
      invalidationRule: plan.requiredConfirmation ?? undefined,
    },
  };
}

async function resolveModel(
  preferredModelId: string | undefined,
  preferredEffort: ReasoningEffort | null | undefined,
): Promise<{
  modelId: string;
  effort: ReasoningEffort | null;
}> {
  const records = await loadModelRegistry();
  if (!records?.length) throw new Error("model_registry_unavailable");
  const selectedId =
    preferredModelId ??
    pickDefaultModelId(records) ??
    records.find((r) => r.available)?.id;
  if (!selectedId) {
    throw new Error("no_available_model");
  }
  const validated = validateUserModelSelection(selectedId, records);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const effortCheck = validateReasoningForModel(
    preferredEffort ?? undefined,
    validated.record,
  );
  if (!effortCheck.ok) {
    throw new Error(effortCheck.error);
  }
  return { modelId: validated.record.id, effort: effortCheck.effort };
}

export async function runModelFirstDecision(
  ctx: AgentRunContext,
  input: {
    evidence: NeutralMarketEvidence;
    images: ResponsesImageInput[];
    locale?: AppLocale;
    preferredModelId?: string;
    preferredReasoning?: ReasoningEffort | null;
    currentPrice: number | null;
    quoteAgeMs?: number | null;
    tickSize?: number | null;
  },
  deps: ModelFirstDecisionDeps = {},
): Promise<ModelFirstDecisionOutcome> {
  const mode = getModelFirstMode();
  const shadowOnly = mode === "shadow";
  const apiKey =
    deps.apiKey ?? (await getPlatformValueAsync("OPENAI_API_KEY"))?.trim();
  if (!apiKey) {
    return {
      result: null,
      validated: null,
      usedLLM: false,
      modelId: null,
      reasoningEffort: null,
      responseId: null,
      repaired: false,
      visionUsed: input.images.length > 0,
      candidateLeakKeys: [],
      shadowOnly,
    };
  }

  let modelId: string;
  let effort: ReasoningEffort | null;
  try {
    const resolved = await resolveModel(
      deps.modelId ?? input.preferredModelId,
      deps.reasoningEffort ?? input.preferredReasoning,
    );
    modelId = resolved.modelId;
    effort = resolved.effort;
  } catch {
    return {
      result: null,
      validated: null,
      usedLLM: false,
      modelId: null,
      reasoningEffort: null,
      responseId: null,
      repaired: false,
      visionUsed: input.images.length > 0,
      candidateLeakKeys: [],
      shadowOnly,
    };
  }

  const language = input.locale === "en" ? "English" : "Arabic";
  const instructions = `${MODEL_FIRST_SYSTEM_PROMPT}\n\nWrite summary/keyReasons/warnings in ${language}.`;
  const evidencePayload = input.evidence;
  const candidateLeakKeys = assertNoCandidateAuthority(evidencePayload);
  if (candidateLeakKeys.length > 0) {
    ctx.emitDebug?.({
      type: "model_first_payload_rejected",
      code: "candidate_authority_leak",
      paths: candidateLeakKeys,
    });
    return {
      result: null,
      validated: null,
      usedLLM: false,
      modelId,
      reasoningEffort: effort,
      responseId: null,
      repaired: false,
      visionUsed: input.images.length > 0,
      candidateLeakKeys,
      shadowOnly,
    };
  }
  const userText = JSON.stringify({
    evidence: evidencePayload,
    visionNote:
      input.images.length > 0
        ? "Chart images are attached in order matching visionImages metadata."
        : "No chart images attached; use numeric candles only.",
  });

  const call = deps.callResponses ?? callOpenAIResponses;
  const schema = {
    name: "aichart_model_trade_plan",
    schema: MODEL_TRADE_PLAN_JSON_SCHEMA,
    strict: true as const,
  };
  const responseIds: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let hasInputTokens = false;
  let hasOutputTokens = false;
  let hasTotalTokens = false;

  const tradingTimeoutMs = llmTradingTimeoutMs(effort);

  async function once(extraRepair?: string): Promise<{
    plan: ModelTradePlan;
    responseId: string | null;
  }> {
    const res = await call({
      apiKey: apiKey!,
      model: modelId,
      instructions,
      inputText: extraRepair
        ? `${userText}\n\nTECHNICAL_REPAIR:\n${extraRepair}`
        : userText,
      images: input.images,
      reasoningEffort: effort,
      // Leave headroom for visible JSON after hidden reasoning tokens.
      maxOutputTokens: 8192,
      store: false,
      schema,
      signal: ctx.signal,
      timeoutMs: tradingTimeoutMs,
    });
    if (res.responseId) responseIds.push(res.responseId);
    if (res.usage.inputTokens != null) {
      inputTokens += res.usage.inputTokens;
      hasInputTokens = true;
    }
    if (res.usage.outputTokens != null) {
      outputTokens += res.usage.outputTokens;
      hasOutputTokens = true;
    }
    if (res.usage.totalTokens != null) {
      totalTokens += res.usage.totalTokens;
      hasTotalTokens = true;
    }
    const parsed = ModelTradePlanSchema.parse(JSON.parse(extractJson(res.text)));
    return { plan: parsed, responseId: res.responseId };
  }

  const effortHint =
    effort === "xhigh" || effort === "max"
      ? " مستوى التفكير مرتفع جداً — قد يستغرق عدة دقائق حتى يكتمل التفكير."
      : effort === "high"
        ? " مستوى التفكير عالٍ — انتظر حتى يُكمل النموذج تحليله."
        : "";
  ctx.emitActivity({
    type: "analysis",
    status: "started",
    message: `أحلّل السوق بالأدلة الحية والشموع والرسوم — القرار للنموذج فقط.${effortHint}`,
  });

  let plan: ModelTradePlan;
  let responseId: string | null = null;
  let repaired = false;
  try {
    const first = await once();
    plan = first.plan;
    responseId = first.responseId;
  } catch {
    ctx.emitActivity({
      type: "analysis",
      status: "failed",
      message: "تعذّر إكمال قرار النموذج.",
    });
    return {
      result: null,
      validated: null,
      usedLLM: true,
      modelId,
      reasoningEffort: effort,
      responseId: null,
      repaired: false,
      visionUsed: input.images.length > 0,
      candidateLeakKeys,
      shadowOnly,
      responseIds,
      tokenUsage: {
        inputTokens: hasInputTokens ? inputTokens : null,
        outputTokens: hasOutputTokens ? outputTokens : null,
        totalTokens: hasTotalTokens ? totalTokens : null,
      },
    };
  }

  let validated = validateTradePlanTechnically({
    plan,
    currentPrice: input.currentPrice,
    tickSize: input.tickSize,
    quoteAgeMs: input.quoteAgeMs,
  });

  if (
    plan.decision !== "wait" &&
    !validated.executionReady &&
    validated.technicalErrors.length
  ) {
    try {
      const repairHint = validated.technicalErrors
        .map((e) => `- ${e}`)
        .join("\n");
      const second = await once(
        `Preserve decision=${plan.decision}. Fix ONLY technical level errors:\n${repairHint}\nDo not change market direction.`,
      );
      plan = { ...second.plan, decision: plan.decision };
      responseId = second.responseId ?? responseId;
      repaired = true;
      validated = validateTradePlanTechnically({
        plan,
        currentPrice: input.currentPrice,
        tickSize: input.tickSize,
        quoteAgeMs: input.quoteAgeMs,
      });
      // Direction lock after repair
      if (validated.decision !== plan.decision) {
        validated = {
          ...validated,
          decision: plan.decision,
          directionPreserved: true,
        };
      }
    } catch {
      /* keep first validated */
    }
  }

  const result = toFinalResult(plan, validated, input.currentPrice);
  ctx.emitActivity({
    type: "final",
    status: validated.executionReady ? "completed" : "warning",
    message:
      plan.decision === "wait"
        ? "النتيجة: انتظار — لا توجد أفضلية كافية الآن."
        : validated.executionReady
          ? `النتيجة: ${plan.decision === "buy" ? "شراء" : "بيع"} مع مستويات قابلة للتنفيذ.`
          : `النتيجة: ${plan.decision === "buy" ? "شراء" : "بيع"} (الرأي محفوظ؛ المستويات تحتاج تحديثاً).`,
  });

  return {
    result,
    validated,
    usedLLM: true,
    modelId,
    reasoningEffort: effort,
    responseId,
    repaired,
    visionUsed: input.images.length > 0,
    candidateLeakKeys,
    shadowOnly,
    responseIds,
    tokenUsage: {
      inputTokens: hasInputTokens ? inputTokens : null,
      outputTokens: hasOutputTokens ? outputTokens : null,
      totalTokens: hasTotalTokens ? totalTokens : null,
    },
  };
}
