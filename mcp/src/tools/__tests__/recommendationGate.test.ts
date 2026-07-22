import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { getToolDef } from "../schemas/index.js";

function parseRecommendation(input: unknown) {
  const def = getToolDef("create_recommendation");
  const schema =
    def.inputSchema instanceof z.ZodType
      ? def.inputSchema
      : z.object(def.inputSchema);
  return schema.safeParse(input);
}

describe("create_recommendation structural gate", () => {
  it("accepts WAIT without strategy evidence", () => {
    const parsed = parseRecommendation({
      symbol: "EURUSD",
      action: "wait",
      rationale: "No clear setup yet — we wait for confirmation.",
      factors: ["mixed structure"],
    });
    assert.equal(parsed.success, true);
  });

  it("rejects BUY without strategy_id and backtested_confidence", () => {
    const parsed = parseRecommendation({
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
    const parsed = parseRecommendation({
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

  it("rejects unknown strategy_id for SELL", () => {
    const parsed = parseRecommendation({
      symbol: "EURUSD",
      action: "sell",
      strategy_id: "invented_edge_v9",
      backtested_confidence: 70,
      market_regime: "trending_down",
      rationale: "We sell a made-up strategy that is not in the catalog.",
      factors: ["fake edge"],
      entry: 1.1,
      stop_loss: 1.12,
      take_profit: 1.08,
    });
    assert.equal(parsed.success, false);
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
