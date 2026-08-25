/**
 * The no-contradiction rule, pinned.
 *
 * The complaint: "any message gives me a recommendation in the same
 * conversation, even contradicting the recommendation it gave in the first
 * message." These tests fail on the old behaviour (every market word re-ran
 * the pipeline) and pass on the planner's rule: while a plan is live, an
 * ambiguous market message is a follow-up; only an explicit request re-opens
 * the pipeline, and then the old plan is superseded rather than ignored.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planTurn,
  wantsExplicitNewAnalysis,
} from "@/lib/agent/core/turnPlanner";
import { routeIntent } from "@/lib/agent/intentRouter";
import type { AgentRunContext } from "@/lib/agent/types";

const ctx = { requestId: "t", emitActivity: () => {} } as unknown as AgentRunContext;

/** The real router, so the guard is tested against what production feeds it. */
function intentsFor(message: string) {
  return routeIntent({ message, ctx });
}

describe("while a recommendation is live, ambiguity is a follow-up", () => {
  const live = { activeRecommendationLive: true };

  it("an Arabic market question does not mint a second plan", () => {
    // "ذهب" and "سعر" are TRADING_WORDS, so the router flags new_trade_analysis
    // — this exact message used to re-run the whole pipeline mid-conversation.
    const message = "شو وضع الذهب الآن؟ السعر عم يتحرك";
    const intents = intentsFor(message);
    assert.ok(intents.includes("new_trade_analysis"), "the router still over-triggers");
    const plan = planTurn({ intents, message, ...live });
    assert.equal(plan.mode, "recommendation_followup");
    assert.equal(plan.redirectedFromAnalysis, true);
    assert.equal(plan.tools.captureCharts, false, "a follow-up never spends the chart budget");
    assert.equal(plan.tools.fetchMarketData, true, "but it answers with fresh candles");
  });

  it("an English price comment stays a follow-up too", () => {
    const message = "gold looks weak here, what do you think?";
    const plan = planTurn({ intents: intentsFor(message), message, ...live });
    assert.equal(plan.mode, "recommendation_followup");
  });

  it("an explicit re-analysis supersedes instead of contradicting", () => {
    for (const message of [
      "حلل من جديد",
      "أعطني توصية جديدة",
      "give me a new recommendation",
      "analyze the chart again",
      "توصية سكالب سريعة",
    ]) {
      const plan = planTurn({ intents: intentsFor(message), message, ...live });
      assert.equal(
        plan.mode,
        "supersede_analysis",
        `"${message}" is an explicit request and must re-open the pipeline`,
      );
      assert.equal(plan.tools.runFullPipeline, true);
    }
  });
});

describe("without a live recommendation the pipeline runs as always", () => {
  it("the first trade request is a full analysis", () => {
    const message = "حلل الذهب على فريم 15 دقيقة";
    const plan = planTurn({
      intents: intentsFor(message),
      message,
      activeRecommendationLive: false,
    });
    assert.equal(plan.mode, "full_analysis");
    assert.equal(plan.reason, "no_active_recommendation");
    assert.equal(plan.tools.captureCharts, true);
  });

  it("even an ambiguous market message analyses when nothing is live", () => {
    const message = "شو وضع الذهب؟";
    const plan = planTurn({
      intents: intentsFor(message),
      message,
      activeRecommendationLive: false,
    });
    assert.equal(plan.mode, "full_analysis");
  });
});

describe("non-analysis turns never touch the market machinery", () => {
  it("a specialist intent is left to its own handler", () => {
    const plan = planTurn({
      intents: ["track_active_recommendation"],
      message: "شو وضع التوصية",
      activeRecommendationLive: true,
    });
    assert.equal(plan.mode, "specialist");
    assert.equal(plan.tools.fetchMarketData, false);
  });

  it("smalltalk is conversation — no tools at all", () => {
    const plan = planTurn({
      intents: ["general_question"],
      message: "صباح الخير",
      activeRecommendationLive: true,
    });
    assert.equal(plan.mode, "conversation");
    assert.deepEqual(plan.tools, {
      fetchMarketData: false,
      captureCharts: false,
      runFullPipeline: false,
    });
  });
});

describe("the explicitness line is where the rule says it is", () => {
  it("asking for work is explicit; talking about the market is not", () => {
    assert.equal(wantsExplicitNewAnalysis("حلل الشارت"), true);
    assert.equal(wantsExplicitNewAnalysis("توصية جديدة لو سمحت"), true);
    assert.equal(wantsExplicitNewAnalysis("new setup please"), true);
    assert.equal(wantsExplicitNewAnalysis("السعر نزل تحت الدخول"), false);
    assert.equal(wantsExplicitNewAnalysis("why is gold dropping?"), false);
    assert.equal(wantsExplicitNewAnalysis("هل نغلق الصفقة؟"), false);
  });
});
