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

/** Deterministic read of the market at answer time (detectors, not a model). */
export interface FollowupMarketRead {
  price: number | null;
  atr: number | null;
  regime: string;
  support: number[];
  resistance: number[];
  nearestBuySideLiquidity: number | null;
  nearestSellSideLiquidity: number | null;
}

/**
 * The one-recommendation-per-conversation rule, as the reply states it. The
 * model must never invite the operator to "ask for a new analysis" while a
 * plan is live — that invitation was the polarity that minted contradicting
 * plans. The way to a new plan is the live one ending (target, stop, expiry)
 * or the operator cancelling it outright.
 */
const ONE_PLAN_RULE =
  "RULE — one recommendation per conversation: the recommendation below is still live, so you must NOT issue, hint at, or sketch a second plan (no new entry/stop/target set, no opposite direction). Do not tell the operator to ask for a new analysis; a new recommendation only becomes possible once this one ends (target, stop, invalidation, expiry) or the operator cancels it explicitly. You MAY and SHOULD give your honest read of the market (structure, momentum, nearby levels, what would strengthen or weaken the live plan) as opinion.";

/**
 * The operator's real question behind every follow-up is "did what was
 * supposed to happen happen?". `evaluation.progress` carries the facts
 * (entry touched or not, how far price ran for and against the plan, bars
 * used vs validity, live distance to stop and first target); the reply must
 * state the verdict in one plain sentence before anything else.
 */
const SCENARIO_PROGRESS_RULE =
  "SCENARIO CHECK — use evaluation.progress and say, first and plainly, whether the plan's scenario has played out so far: 'waiting' = the entry has not been touched and price is still on the waiting side (say what has to happen for the fill); 'moving_away' = the entry was never touched and price is already running toward the targets WITHOUT a fill — say clearly that the move is happening without us, that there is no position, and that chasing is not this plan; 'in_profit' / 'in_drawdown' = the position exists — give the excursion so far (maxFavorablePoints / maxAdversePoints), the room left to the stop and to the first target, and whether the structure the plan leaned on still holds. Never leave the operator guessing whether they are in a trade. ";

export async function composeRecommendationStatusAnswer(input: {
  userMessage?: string;
  recommendation: ActiveRecommendation;
  evaluation: RecommendationStatusEvaluation;
  /** English session block from core/tradingSessions — a fact the reply may cite. */
  tradingSession?: string;
  /** The operator explicitly asked for a new analysis / recommendation. */
  requestedNewPlan?: boolean;
  /** Localized one-recommendation notice (i18n `orch.one_rec_per_session`) for the model-less fallback. */
  onePlanNotice?: string;
  marketRead?: FollowupMarketRead;
}): Promise<string> {
  const task =
    (input.requestedNewPlan
      ? "The operator explicitly asked for a NEW analysis or recommendation, but a recommendation from this conversation is still live. Open by saying plainly, in one sentence, that you issue one recommendation per conversation and will not give a second until the current one ends. Then give what they actually wanted — your current read of the market from the data provided (regime, where price sits against the live plan's entry/stop/targets, the nearest levels and liquidity) and what it means for the LIVE plan. Report the plan's live status as well. "
      : "Update the operator on the previous recommendation's current status: still pending, triggered, target hit, stop hit, or invalidated. Answer the operator's actual question against this recommendation and the live evaluation, and add your short read of the market from the data provided when it helps. Be direct. ") +
    SCENARIO_PROGRESS_RULE +
    ONE_PLAN_RULE;
  return compose({
    task,
    payload: {
      question: input.userMessage,
      recommendation: publicRecommendation(input.recommendation),
      evaluation: input.evaluation,
      ...(input.marketRead ? { marketRead: input.marketRead } : {}),
      ...(input.tradingSession ? { tradingSession: input.tradingSession } : {}),
    },
    fallback:
      (input.requestedNewPlan && input.onePlanNotice ? `${input.onePlanNotice}\n` : "") +
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
