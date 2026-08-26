/**
 * The turn planner — the agent's no-contradiction rule, as code.
 *
 * The complaint this exists for, verbatim: "any message gives me a
 * recommendation in the same conversation, even contradicting the
 * recommendation it gave in the first message." The cause is mechanical: the
 * intent router treats broad market words (price, gold, chart — in either
 * language) as a trade signal, so a follow-up QUESTION about a live
 * recommendation re-ran the whole pipeline and minted a fresh plan —
 * sometimes the opposite one — while the first plan was still open.
 *
 * The rule is stated once, here:
 *
 *   While a recommendation is LIVE, an ambiguous market message is a
 *   follow-up about it — answered with fresh data, never with a new plan.
 *   Only an EXPLICIT request for a new analysis re-opens the pipeline, and
 *   then the old plan is superseded out loud: discussed, closed, replaced.
 *
 * The planner decides; the orchestrator obeys. It is deliberately pure (text
 * + intents + one boolean in, a plan out) so the contract is testable without
 * a market, an LLM, or a session store.
 */
import type { AgentIntent } from "../types";

export type TurnMode =
  /** No live plan in the way — run the full analysis pipeline as always. */
  | "full_analysis"
  /**
   * A live plan exists AND the operator explicitly asked for a fresh analysis:
   * run the pipeline, but the old plan must be discussed and closed before the
   * new one stands (the orchestrator cancels it when the new plan is stored,
   * and the synthesizer prompt receives the old plan to speak to).
   */
  | "supersede_analysis"
  /**
   * A live plan exists and the message is an ambiguous market comment or
   * question: answer it AS a follow-up about that plan, with fresh market
   * data — never by minting a competing recommendation.
   */
  | "recommendation_followup"
  /** Another specialist path (drawing, tracking, news…) already owns the turn. */
  | "specialist"
  /** Plain conversation — no market machinery at all. */
  | "conversation";

export interface TurnPlan {
  mode: TurnMode;
  reason:
    | "no_active_recommendation"
    | "explicit_new_analysis"
    | "ambiguous_with_live_recommendation"
    | "specialist_intent"
    | "no_trade_signal";
  /** True when a would-be analysis was redirected to the follow-up path. */
  redirectedFromAnalysis: boolean;
  /**
   * Tool policy for the turn — which machinery the mode is entitled to. The
   * follow-up path reads fresh candles but never spends the chart-capture
   * budget; conversation spends nothing.
   */
  tools: {
    fetchMarketData: boolean;
    captureCharts: boolean;
    runFullPipeline: boolean;
  };
}

/**
 * Wording that UNAMBIGUOUSLY asks for a fresh analysis or a new plan.
 *
 * Deliberately narrower than the router's TRADING_WORDS: mentioning the gold
 * price is talking ABOUT the market; these are asking the agent to WORK. Kept
 * as plain substrings (same convention as intentRouter) so behaviour is
 * auditable by reading the list.
 */
const EXPLICIT_NEW_ANALYSIS_PHRASES = [
  // Arabic imperatives and requests
  "حلل", // covers حلل الشارت / حلل من جديد / حلل الوضع
  "حلّل",
  "تحليل جديد",
  "توصية جديدة",
  "توصيه جديدة",
  "توصية ثانية",
  "فرصة جديدة",
  "صفقة جديدة",
  "أعطني توصية",
  "اعطني توصية",
  "اعطيني توصية",
  "بدي توصية",
  "أريد توصية",
  "اريد توصية",
  "ابغى توصية",
  "أبغى توصية",
  "من جديد",
  "سكالب",
  "سكلب",
  // English imperatives and requests
  "analyze",
  "analyse",
  "reanalyze",
  "re-analyze",
  "new recommendation",
  "another recommendation",
  "new trade",
  "new setup",
  "new signal",
  "fresh analysis",
  "give me a recommendation",
  "give me a trade",
  "give me a setup",
  "scalp",
];

export function wantsExplicitNewAnalysis(message: string): boolean {
  const text = message.toLowerCase();
  return EXPLICIT_NEW_ANALYSIS_PHRASES.some((phrase) => text.includes(phrase));
}

/** Intent families that already have their own handler ahead of the pipeline. */
const SPECIALIST_INTENTS: AgentIntent[] = [
  "draw_active_recommendation",
  "explain_active_recommendation",
  "track_active_recommendation",
  "cancel_active_recommendation",
  "modify_active_recommendation",
  "draw_on_chart",
  "draw_trendline",
  "draw_support_resistance",
  "draw_poi_zones",
  "enable_indicators",
  "clear_agent_drawings",
  "explain_chart_drawings",
  "discuss_user_drawing",
  "modify_user_drawing",
  "move_user_drawing",
  "delete_user_drawing",
  "clarify_drawing_reference",
  "trade_execution",
  "trade_management",
];

const ANALYSIS_INTENTS: AgentIntent[] = [
  "new_trade_analysis",
  "chart_analysis",
  "analyze_with_user_drawings",
];

const NO_TOOLS = { fetchMarketData: false, captureCharts: false, runFullPipeline: false };
const FOLLOWUP_TOOLS = { fetchMarketData: true, captureCharts: false, runFullPipeline: false };
const FULL_TOOLS = { fetchMarketData: true, captureCharts: true, runFullPipeline: true };

export function planTurn(input: {
  intents: readonly AgentIntent[];
  message: string;
  /** isActiveRecommendationLive(...) — a non-terminal plan exists for this session. */
  activeRecommendationLive: boolean;
}): TurnPlan {
  const wantsAnalysis = input.intents.some((intent) =>
    ANALYSIS_INTENTS.includes(intent),
  );

  if (!wantsAnalysis) {
    const specialist = input.intents.some((intent) =>
      SPECIALIST_INTENTS.includes(intent),
    );
    return {
      mode: specialist ? "specialist" : "conversation",
      reason: specialist ? "specialist_intent" : "no_trade_signal",
      redirectedFromAnalysis: false,
      tools: NO_TOOLS,
    };
  }

  if (!input.activeRecommendationLive) {
    return {
      mode: "full_analysis",
      reason: "no_active_recommendation",
      redirectedFromAnalysis: false,
      tools: FULL_TOOLS,
    };
  }

  if (wantsExplicitNewAnalysis(input.message)) {
    return {
      mode: "supersede_analysis",
      reason: "explicit_new_analysis",
      redirectedFromAnalysis: false,
      tools: FULL_TOOLS,
    };
  }

  return {
    mode: "recommendation_followup",
    reason: "ambiguous_with_live_recommendation",
    redirectedFromAnalysis: true,
    tools: FOLLOWUP_TOOLS,
  };
}
