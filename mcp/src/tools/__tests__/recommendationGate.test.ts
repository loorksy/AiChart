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

  it("accepts BUY with catalog strategy evidence and levels", () => {
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "buy",
      plan_type: "immediate",
      strategy_id: "ema_trend_follow_v1",
      backtested_confidence: 62.5,
      market_regime: "trending_up",
      rationale: "We buy with the validated EMA trend follow edge.",
      factors: ["regime aligned", "catalog strategy"],
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
      timeframe: "1h",
      ...completePlanFields,
    });
    assert.equal(parsed.success, true);
  });

  it("rejects malformed strategy ids at the schema layer", () => {
    for (const badId of ["Invented Edge!", "UPPERCASE_V1", "no_version_suffix", "x"]) {
      const parsed = createRecommendationInput.safeParse({
        symbol: "EURUSD",
        action: "sell",
        strategy_id: badId,
        backtested_confidence: 70,
        market_regime: "trending_down",
        rationale: "We sell a strategy with a malformed identifier.",
        factors: ["fake edge"],
        entry: 1.1,
        stop_loss: 1.12,
        take_profit: 1.08,
      });
      assert.equal(parsed.success, false, badId);
    }
  });

  it("passes well-formed unknown ids through to SERVER validation (409)", () => {
    // The web catalog is the single source of truth. The MCP schema validates
    // shape only, so a growing catalog never churns the tool contract — an id
    // the server does not know is rejected there with 409, and BUY/SELL
    // additionally require a validated deployment for the symbol+timeframe.
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "sell",
      plan_type: "conditional",
      strategy_id: "invented_edge_v9",
      backtested_confidence: 70,
      market_regime: "trending_down",
      rationale: "Made-up strategy — the server, not the schema, rejects it.",
      factors: ["fake edge"],
      entry: 1.1,
      stop_loss: 1.12,
      take_profit: 1.08,
      ...completePlanFields,
      activation_condition: "An hourly candle closes below the trigger level.",
      activation_rule: { kind: "candle_close_below", level: 1.099, timeframe: "1h" },
    });
    assert.equal(parsed.success, true);
  });
});

describe("accuracy MCP tools are registered", () => {
  it("exposes run_backtest, get_strategy_performance, detect_market_regime", () => {
    for (const name of [
      "run_backtest",
      "get_strategy_performance",
      "detect_market_regime",
    ]) {
      const def = getToolDef(name);
      assert.ok(def.description.includes("When:"), name);
    }
  });
});
