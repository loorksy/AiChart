/**
 * The LLM bot-config recommender.
 *
 * Three things matter and are tested in order of how badly they would hurt:
 *
 *   1. It never fabricates a market number. With no candles, the market block
 *      says there is no data — it does not invent a price, a range or a trend.
 *   2. It emits the vocabulary the ENGINE reads. Upstream's recommender emits
 *      keys (`maPeriod`, `priceDropPct`, `dipThreshold`) that nothing anywhere
 *      consumes; a port that copied them would produce configs no bot can run.
 *   3. Upstream's clamps are reproduced value for value, including the rule
 *      that an out-of-range number is pulled to the boundary rather than
 *      rejected.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnthropicResponse } from "@/lib/llm";
import type { QuantOhlcBar } from "@/lib/quantAgent/types";
import {
  BOT_RECOMMEND_SYSTEM_PROMPT,
  BotRecommendationError,
  buildBotMarketContext,
  clampInt,
  clampNumber,
  coerceBool,
  coerceRatio,
  extractJsonObject,
  normalizeBotRecommendation,
  recommendBotConfig,
} from "@/lib/quantAgent/bots/recommendConfig";

function bars(count: number, base = 100): QuantOhlcBar[] {
  return Array.from({ length: count }, (_value, index) => ({
    time: Date.UTC(2026, 0, 1, index),
    open: base + index,
    high: base + index + 1,
    low: base + index - 1,
    close: base + index,
    volume: 100,
  }));
}

function reply(text: string): AnthropicResponse {
  return {
    id: "msg_test",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  } as AnthropicResponse;
}

describe("market context is measured or absent, never invented", () => {
  it("says there is no data rather than inventing a price", () => {
    const context = buildBotMarketContext("XAUUSD", "1h", []);
    assert.equal(context.currentPrice, null);
    assert.match(context.block, /no recent K-line data was available/);
    assert.match(context.block, /manually verify the upper\/lower bounds/);
    assert.doesNotMatch(context.block, /Current Price:/);
  });

  it("refuses to summarise fewer than five candles", () => {
    assert.equal(buildBotMarketContext("XAUUSD", "1h", bars(4)).currentPrice, null);
  });

  it("computes upstream's statistics from real candles", () => {
    const context = buildBotMarketContext("XAUUSD", "1h", bars(10));
    assert.equal(context.currentPrice, 109);
    assert.match(context.block, /Current Price: 109/);
    assert.match(context.block, /Period High: 110/);
    assert.match(context.block, /Period Low: 99/);
    assert.match(context.block, /Trend: Bullish \(SMA5 > SMA20\)/);
    assert.match(context.block, /=== END MARKET DATA ===/);
  });
});

describe("the prompt asks for keys the engine can read", () => {
  it("offers only bot types that have an engine", () => {
    for (const type of ["grid", "dca", "martingale", "layered_martingale"]) {
      assert.ok(BOT_RECOMMEND_SYSTEM_PROMPT.includes(type), `${type} missing from the prompt`);
    }
  });

  it("never mentions the dead `trend` schema or its parameters", () => {
    for (const dead of ["maPeriod", "confirmBars", "positionPct", "dipThreshold", "priceDropPct"]) {
      assert.ok(
        !BOT_RECOMMEND_SYSTEM_PROMPT.includes(dead),
        `${dead} is upstream dead code and must not be requested`,
      );
    }
  });

  it("uses executor-vocabulary keys, not the legacy camelCase ones", () => {
    assert.ok(BOT_RECOMMEND_SYSTEM_PROMPT.includes("start_price"));
    assert.ok(BOT_RECOMMEND_SYSTEM_PROMPT.includes("total_amount_quote"));
    assert.ok(BOT_RECOMMEND_SYSTEM_PROMPT.includes("dca_total_budget_pct"));
    assert.ok(!BOT_RECOMMEND_SYSTEM_PROMPT.includes("upperPrice"));
    assert.ok(!BOT_RECOMMEND_SYSTEM_PROMPT.includes("amountPerGrid"));
  });

  it("says out loud that these bots never place an order", () => {
    assert.match(BOT_RECOMMEND_SYSTEM_PROMPT, /SIMULATION ONLY/);
    assert.match(BOT_RECOMMEND_SYSTEM_PROMPT, /never places an order/);
  });
});

describe("coercion primitives match upstream", () => {
  it("clamps rather than rejects", () => {
    assert.equal(clampNumber(500, 10, 1, 100), 100);
    assert.equal(clampNumber(-5, 10, 1, 100), 1);
    assert.equal(clampNumber("nonsense", 7), 7);
    assert.equal(clampNumber(undefined, 7), 7);
  });

  it("rounds to an int after clamping", () => {
    assert.equal(clampInt(2.6, 5, 1, 10), 3);
    assert.equal(clampInt(99, 5, 1, 10), 10);
  });

  it("accepts upstream's truthy strings", () => {
    assert.equal(coerceBool("yes"), true);
    assert.equal(coerceBool("TRUE"), true);
    assert.equal(coerceBool("no"), false);
    assert.equal(coerceBool(null, true), true);
  });

  it("clamps to [0.001, 100] first, then divides by 100 only above 1", () => {
    assert.equal(coerceRatio(3, 0.03), 0.03);
    assert.equal(coerceRatio(0.5, 0.03), 0.5);
    assert.equal(coerceRatio(1, 0.03), 1);
    assert.equal(coerceRatio(500, 0.03), 1);
  });

  it("extracts JSON from a fence or from surrounding prose", () => {
    assert.equal(extractJsonObject('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(extractJsonObject('here you go: {"a":1} hope that helps'), '{"a":1}');
    assert.equal(extractJsonObject('{"a":{"b":2}}'), '{"a":{"b":2}}');
  });
});

describe("normalization keeps the answer inside the engine's range", () => {
  const base = { symbol: "XAUUSD", interval: "1h", currentPrice: 2400 };

  it("an unrecognised bot type becomes grid", () => {
    const out = normalizeBotRecommendation({ botType: "trend" }, base);
    assert.equal(out.botType, "grid");
  });

  it("the caller's symbol always wins over the model's", () => {
    const out = normalizeBotRecommendation(
      { botType: "grid", baseConfig: { symbol: "BTCUSDT", marketType: "swap", leverage: 20 } },
      base,
    );
    assert.equal(out.baseConfig.symbol, "XAUUSD");
    // Forex on this platform is spot and unlevered; not negotiable by prompt.
    assert.equal(out.baseConfig.marketType, "spot");
    assert.equal(out.baseConfig.leverage, 1);
    assert.equal(out.baseConfig.market, "forex");
  });

  it("grid parameters are clamped to the engine's ranges", () => {
    const out = normalizeBotRecommendation(
      {
        botType: "grid",
        strategyParams: {
          start_price: -10,
          end_price: 2500,
          grid_count: 9999,
          grid_mode: "logarithmic",
          side: "neutral",
          max_open_orders: 900,
          initial_position_pct: 500,
        },
      },
      base,
    );
    assert.equal(out.strategyParams.start_price, 0);
    assert.equal(out.strategyParams.end_price, 2500);
    assert.equal(out.strategyParams.grid_count, 200);
    assert.equal(out.strategyParams.grid_mode, "arithmetic");
    // Neutral needs a swap market, which forex is not — clamped to long.
    assert.equal(out.strategyParams.side, "long");
    assert.equal(out.strategyParams.max_open_orders, 50);
    assert.equal(out.strategyParams.initial_position_pct, 100);
  });

  it("with no market data it does not invent an entry price", () => {
    const out = normalizeBotRecommendation({ botType: "martingale", strategyParams: {} }, {
      ...base,
      currentPrice: null,
    });
    assert.equal(out.strategyParams.entry_price, 0);
    const withPrice = normalizeBotRecommendation({ botType: "martingale", strategyParams: {} }, base);
    assert.equal(withPrice.strategyParams.entry_price, 2400);
  });

  it("martingale multipliers cannot go below 1", () => {
    const out = normalizeBotRecommendation(
      {
        botType: "martingale",
        strategyParams: { step_multiplier: 0.1, volume_multiplier: 99, max_layers: 500 },
      },
      base,
    );
    assert.equal(out.strategyParams.step_multiplier, 1);
    assert.equal(out.strategyParams.volume_multiplier, 5);
    assert.equal(out.strategyParams.max_layers, 20);
  });

  it("unknown extra params survive, as upstream leaves them", () => {
    const out = normalizeBotRecommendation(
      { botType: "grid", strategyParams: { dynamic_anchor: true, mystery: 4 } },
      base,
    );
    assert.equal(out.strategyParams.dynamic_anchor, true);
    assert.equal(out.strategyParams.mystery, 4);
  });

  it("risk defaults land on upstream's numbers", () => {
    const out = normalizeBotRecommendation({ botType: "grid" }, base);
    assert.equal(out.riskConfig.equityStopLossPct, 10);
    assert.equal(out.riskConfig.equityTakeProfitPct, 20);
  });

  it("an out-of-list interval falls back to the caller's", () => {
    const out = normalizeBotRecommendation(
      { botType: "grid", baseConfig: { interval: "3s" } },
      base,
    );
    assert.equal(out.baseConfig.interval, "1h");
  });
});

describe("the end-to-end call", () => {
  it("parses a fenced answer and clamps it", async () => {
    const out = await recommendBotConfig(
      { prompt: "a grid on gold", symbol: "XAUUSD", interval: "1h", bars: bars(30, 2400) },
      {
        callLLM: async () =>
          reply(
            '```json\n{"botType":"grid","botName":"Gold grid","reason":"range",' +
              '"strategyParams":{"start_price":2380,"end_price":2420,"grid_count":8}}\n```',
          ),
      },
    );
    assert.equal(out.botType, "grid");
    assert.equal(out.botName, "Gold grid");
    assert.equal(out.strategyParams.start_price, 2380);
    assert.equal(out.strategyParams.grid_count, 8);
  });

  it("passes the measured market block to the model", async () => {
    let seen = "";
    await recommendBotConfig(
      { prompt: "grid", symbol: "XAUUSD", interval: "4h", bars: bars(30, 2400) },
      {
        callLLM: async (params) => {
          const first = params.messages[0];
          seen = typeof first.content === "string" ? first.content : "";
          return reply('{"botType":"grid"}');
        },
      },
    );
    assert.match(seen, /REAL-TIME MARKET DATA for XAUUSD/);
    assert.match(seen, /4h timeframe/);
  });

  it("a non-JSON answer is an error, not a silently empty config", async () => {
    await assert.rejects(
      recommendBotConfig(
        { prompt: "grid", symbol: "XAUUSD", interval: "1h", bars: bars(30) },
        { callLLM: async () => reply("I would rather not.") },
      ),
      BotRecommendationError,
    );
  });

  it("a JSON array is rejected too", async () => {
    await assert.rejects(
      recommendBotConfig(
        { prompt: "grid", symbol: "XAUUSD", interval: "1h", bars: bars(30) },
        { callLLM: async () => reply("[1,2,3]") },
      ),
      BotRecommendationError,
    );
  });
});
