import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRecommendationInput } from "../schemas/coreSchemas.js";
import { getToolDef } from "../schemas/index.js";

describe("create_recommendation structural gate", () => {
  it("accepts WAIT without strategy evidence", () => {
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "wait",
      rationale: "No clear setup yet — we wait for confirmation.",
      factors: ["mixed structure"],
    });
    assert.equal(parsed.success, true);
  });

  it("rejects BUY without strategy_id and backtested_confidence", () => {
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "buy",
      confidence: 80,
      rationale: "We buy the bounce from demand.",
      factors: ["demand zone"],
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
    });
    assert.equal(parsed.success, false);
  });

  it("accepts BUY with catalog strategy evidence and levels", () => {
    const parsed = createRecommendationInput.safeParse({
      symbol: "EURUSD",
      action: "buy",
      strategy_id: "ema_trend_follow_v1",
      backtested_confidence: 62.5,
      market_regime: "trending_up",
      rationale: "We buy with the validated EMA trend follow edge.",
      factors: ["regime aligned", "catalog strategy"],
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
      timeframe: "1h",
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
      strategy_id: "invented_edge_v9",
      backtested_confidence: 70,
      market_regime: "trending_down",
      rationale: "Made-up strategy — the server, not the schema, rejects it.",
      factors: ["fake edge"],
      entry: 1.1,
      stop_loss: 1.12,
      take_profit: 1.08,
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
