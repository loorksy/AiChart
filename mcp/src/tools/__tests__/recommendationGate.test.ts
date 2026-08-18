import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRecommendationInput } from "../schemas/coreSchemas.js";
import { getToolDef } from "../schemas/index.js";

/** The Complete Plan Contract layers every BUY/SELL must now carry. */
const completePlanFields = {
  invalidation_rule: "A full-candle close beyond the stop kills the idea.",
  alternative_scenario: "Failure flips the bias to the far side of the range.",
  validity_candles: 24,
};

/** The activation pair a conditional/anticipatory plan must add. */
const conditionalActivation = {
  activation_condition: "An hourly candle closes above the trigger level.",
  activation_rule: {
    kind: "candle_close_above" as const,
    level: 1.101,
    timeframe: "1h",
  },
};

describe("create_recommendation structural gate", () => {
  it("refuses WAIT — it is not an analytical outcome", () => {
    // Every successful analysis ends in a direction with a plan. A market that
    // genuinely cannot be read is a named operational blocker, reported as such,
    // not a recommendation to do nothing. Leaving this open kept the exact
    // asymmetry the doctrine removes: the platform engine cannot express a wait,
    // so the MCP surface must not be able to either.
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "wait",
      rationale: "No clear setup yet — we wait for confirmation.",
      factors: ["mixed structure"],
    });
    assert.equal(parsed.success, false);
  });

  it("refuses a direction with no plan type", () => {
    // The direction says what, the levels say where, and the plan type says
    // when. Without it the operator cannot tell "enter now" from "wait for the
    // trigger", which is the difference between a plan and an opinion.
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "buy",
      rationale: "Structure is bullish and the demand zone held twice.",
      factors: ["demand zone"],
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
    });
    assert.equal(parsed.success, false);
  });

  it("accepts each of the three plan types — complete", () => {
    for (const planType of ["immediate", "anticipatory", "conditional"] as const) {
      const parsed = createRecommendationInput.safeParse({
        symbol: "EURUSD",
        action: "buy",
        plan_type: planType,
        rationale: "Structure is bullish and the demand zone held twice.",
        factors: ["demand zone"],
        entry: 1.1,
        stop_loss: 1.09,
        take_profit: 1.12,
        ...completePlanFields,
        ...(planType === "immediate" ? {} : conditionalActivation),
      });
      assert.equal(parsed.success, true, `${planType} must be accepted`);
    }
  });

  it("refuses any plan type missing invalidation, alternative, or validity", () => {
    // Nine cases, none of which failed before the contract: a plan that does
    // not say what kills it, what replaces it, or how long it holds.
    for (const planType of ["immediate", "anticipatory", "conditional"] as const) {
      for (const missing of Object.keys(completePlanFields)) {
        const payload: Record<string, unknown> = {
          symbol: "EURUSD",
          action: "buy",
          plan_type: planType,
          rationale: "Structure is bullish and the demand zone held twice.",
          factors: ["demand zone"],
          entry: 1.1,
          stop_loss: 1.09,
          take_profit: 1.12,
          ...completePlanFields,
          ...(planType === "immediate" ? {} : conditionalActivation),
        };
        delete payload[missing];
        const parsed = createRecommendationInput.safeParse(payload);
        assert.equal(parsed.success, false, `${planType} without ${missing}`);
      }
    }
  });

  it("refuses a conditional plan without its activation pair", () => {
    for (const missing of ["activation_condition", "activation_rule"]) {
      const payload: Record<string, unknown> = {
        symbol: "EURUSD",
        action: "buy",
        plan_type: "conditional",
        rationale: "Entry waits for the close above the level.",
        factors: ["breakout setup"],
        entry: 1.1,
        stop_loss: 1.09,
        take_profit: 1.12,
        ...completePlanFields,
        ...conditionalActivation,
      };
      delete payload[missing];
      const parsed = createRecommendationInput.safeParse(payload);
      assert.equal(parsed.success, false, `conditional without ${missing}`);
    }
  });

  it("refuses an anticipatory plan without its activation pair", () => {
    const payload: Record<string, unknown> = {
      symbol: "EURUSD",
      action: "buy",
      plan_type: "anticipatory",
      rationale: "Entering while the structure is still forming.",
      factors: ["forming pattern"],
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
      ...completePlanFields,
    };
    const parsed = createRecommendationInput.safeParse(payload);
    assert.equal(parsed.success, false);
  });

  it("refuses a rule the evaluator could not grade", () => {
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "buy",
      plan_type: "conditional",
      rationale: "Entry waits for the close above the level.",
      factors: ["breakout setup"],
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
      ...completePlanFields,
      activation_condition: "An hourly candle closes above the trigger level.",
      activation_rule: { kind: "teleport", level: 1.101 },
    });
    assert.equal(parsed.success, false);
  });

  it("does not accept a client-supplied execution_state", () => {
    // Layer 3 is a server fact. The schema simply has no such field.
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "buy",
      plan_type: "immediate",
      rationale: "Structure is bullish and the demand zone held twice.",
      factors: ["demand zone"],
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
      ...completePlanFields,
      execution_state: "valid_now",
    });
    // Unknown keys are stripped, never honored: parsing succeeds but the field
    // does not survive into the parsed data.
    assert.equal(parsed.success, true);
    assert.ok(!("execution_state" in (parsed.success ? parsed.data : {})));
  });

  it("refuses a direction with no levels", () => {
    // A direction with nowhere to enter, stop, or take profit is not a plan.
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "buy",
      plan_type: "immediate",
      rationale: "Structure is bullish and the zone held.",
      factors: ["demand zone"],
    });
    assert.equal(parsed.success, false);
  });

  it("accepts BUY with levels but no strategy evidence (direct analysis)", () => {
    // A missing backtest downgrades the label, never the right to recommend.
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "buy",
      plan_type: "immediate",
      confidence: 80,
      rationale: "We buy the bounce from demand.",
      factors: ["demand zone"],
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
      ...completePlanFields,
    });
    assert.equal(parsed.success, true);
  });

  it("rejects BUY without levels — a direction with nowhere to act is not a plan", () => {
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "buy",
      plan_type: "immediate",
      confidence: 80,
      rationale: "We buy the bounce from demand.",
      factors: ["demand zone"],
    });
    assert.equal(parsed.success, false);
  });

  it("accepts BUY with levels and model-judgement confidence", () => {
    const parsed = createRecommendationInput.safeParse({
      symbol: "XAUUSD",
      action: "buy",
      plan_type: "immediate",
      confidence: 62.5,
      market_regime: "trending_up",
      rationale: "We buy the bounce from demand with a complete plan.",
      factors: ["demand zone", "structure"],
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
      timeframe: "1h",
      ...completePlanFields,
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("strategy_id" in parsed.data, false);
      assert.equal("backtested_confidence" in parsed.data, false);
    }
  });

  it("strips legacy backtest claim fields rather than storing them", () => {
    const parsed = createRecommendationInput.safeParse({
      symbol: "XAUUSD",
      action: "sell",
      plan_type: "conditional",
      strategy_id: "invented_edge_v9",
      backtested_confidence: 70,
      rationale: "Legacy client still sending deleted claim fields.",
      factors: ["structure"],
      entry: 1.1,
      stop_loss: 1.12,
      take_profit: 1.08,
      ...completePlanFields,
      activation_condition: "An hourly candle closes below the trigger level.",
      activation_rule: { kind: "candle_close_below", level: 1.099, timeframe: "1h" },
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("backtested_confidence" in parsed.data, false);
      assert.equal("strategy_id" in parsed.data, false);
    }
  });
});

describe("accuracy MCP tools are registered", () => {
  it("exposes detect_market_regime and does not expose get_strategy_performance", () => {
    const def = getToolDef("detect_market_regime");
    assert.ok(def.description.includes("When:"));
    assert.throws(() => getToolDef("get_strategy_performance"));
  });
});
