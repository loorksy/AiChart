import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { multiTimeframeContent } from "../chartInline.js";
import { createRecommendationInput } from "../schemas/coreSchemas.js";
import { getToolDef } from "../schemas/index.js";

const BRIDGE_RESULT = {
  ok: true,
  symbol: "XAUUSD",
  market: "forex",
  requested_timeframes: ["15m", "1h", "4h", "1d"],
  captured_timeframes: ["15m", "1h", "4h"],
  missing_timeframes: [{ timeframe: "1d", reason: "capture_timeout" }],
  partial_success: true,
  elapsed_ms: 6_120,
  guardrails: ["Images confirm shape only"],
  snapshots: [
    {
      timeframe: "15m",
      content_type: "image/png",
      image_base64: "AAAA",
      captured_at: "2026-07-25T10:00:00.000Z",
      image_source: "mt5",
      from_cache: false,
      numeric_context: { price: 4130.02, rsi: 54.7, adx: 28.4 },
    },
    {
      timeframe: "1h",
      content_type: "image/png",
      image_base64: "BBBB",
      captured_at: "2026-07-25T10:00:01.000Z",
      image_source: "quickchart",
      from_cache: true,
      numeric_context: { price: 4130.02, nearest_support: 4106.7 },
    },
    {
      timeframe: "4h",
      content_type: "image/png",
      image_base64: "CCCC",
      captured_at: "2026-07-25T10:00:02.000Z",
      image_source: "quickchart",
      from_cache: false,
      numeric_context: null,
    },
  ],
};

describe("capture_multi_timeframe_snapshot tool definition", () => {
  const def = getToolDef("capture_multi_timeframe_snapshot");

  it("is read-only and carries a usage hint", () => {
    assert.equal(def.annotations.readOnlyHint, true);
    assert.equal(def.annotations.destructiveHint, false);
    assert.ok(def.description.includes("When:"));
  });

  it("documents the parallel capture, the default set, and partial success", () => {
    assert.ok(def.description.includes("IN PARALLEL"));
    assert.ok(def.description.includes("15m/1h/4h/1D"));
    assert.ok(def.description.includes("missing_timeframes"));
  });

  it("states the shape-only guardrail in the description itself", () => {
    assert.ok(def.description.includes("numeric_context"));
    assert.ok(def.description.toLowerCase().includes("never read off the pixels"));
  });

  it("defaults symbol-only calls to a usable request", () => {
    const parsed = z.object(def.inputSchema).safeParse({ symbol: "XAUUSD" });
    assert.equal(parsed.success, true);
  });

  it("rejects an image budget beyond the hard ceiling", () => {
    const schema = z.object(def.inputSchema);
    assert.equal(schema.safeParse({ symbol: "XAUUSD", max_images: 6 }).success, true);
    assert.equal(schema.safeParse({ symbol: "XAUUSD", max_images: 7 }).success, false);
    assert.equal(schema.safeParse({ symbol: "XAUUSD", max_images: 0 }).success, false);
  });
});

describe("multiTimeframeContent", () => {
  it("emits one image block per captured timeframe", () => {
    const result = multiTimeframeContent(BRIDGE_RESULT);
    const images = result.content.filter((block) => block.type === "image");
    assert.equal(images.length, 3);
    assert.deepEqual(
      images.map((block) => (block as { data: string }).data),
      ["AAAA", "BBBB", "CCCC"],
    );
  });

  it("labels each image with its own timeframe and numbers", () => {
    const result = multiTimeframeContent(BRIDGE_RESULT);
    // Blocks after the summary alternate label → image, so the model can bind
    // a chart to the timeframe it belongs to.
    const [, firstLabel, firstImage] = result.content;
    assert.equal(firstLabel!.type, "text");
    assert.equal(firstImage!.type, "image");
    const label = JSON.parse((firstLabel as { text: string }).text);
    assert.equal(label.timeframe, "15m");
    assert.equal(label.numeric_context.rsi, 54.7);
  });

  it("keeps base64 out of the JSON summary by default", () => {
    const summary = multiTimeframeContent(BRIDGE_RESULT).content[0] as {
      text: string;
    };
    assert.ok(!summary.text.includes("AAAA"));
    const parsed = JSON.parse(summary.text);
    assert.equal(parsed.snapshots[0].imageBase64, undefined);
    assert.equal(parsed.snapshots[0].image_block_index, 0);
    assert.equal(parsed.snapshots[0].numeric_context.price, 4130.02);
  });

  it("inlines base64 only when the caller asks", () => {
    const summary = multiTimeframeContent(BRIDGE_RESULT, {
      inlineBase64: true,
    }).content[0] as { text: string };
    assert.equal(JSON.parse(summary.text).snapshots[0].imageBase64, "AAAA");
  });

  it("reports the missing timeframe without failing the whole call", () => {
    const result = multiTimeframeContent(BRIDGE_RESULT);
    assert.notEqual(result.isError, true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.partial_success, true);
    assert.deepEqual(parsed.missing_timeframes, [
      { timeframe: "1d", reason: "capture_timeout" },
    ]);
  });

  it("is an error only when nothing was captured", () => {
    const result = multiTimeframeContent({
      ...BRIDGE_RESULT,
      snapshots: [],
      captured_timeframes: [],
    });
    assert.equal(result.isError, true);
    assert.equal(result.content.filter((b) => b.type === "image").length, 0);
  });

  it("drops snapshot entries that carry no image", () => {
    const result = multiTimeframeContent({
      ...BRIDGE_RESULT,
      snapshots: [{ timeframe: "1h", image_base64: "" }],
    });
    assert.equal(result.content.filter((b) => b.type === "image").length, 0);
  });
});

describe("create_recommendation visual audit fields", () => {
  const base = {
    symbol: "XAUUSD",
    action: "buy" as const,
    strategy_id: "ema_trend_follow_v1" as const,
    backtested_confidence: 62.5,
    market_regime: "trending",
    rationale: "We buy with the validated EMA trend follow edge.",
    factors: ["regime aligned"],
    entry: 4130,
    stop_loss: 4110,
    take_profit: 4180,
    timeframe: "1h",
  };

  it("stays valid without the new fields (backward compatible)", () => {
    assert.equal(createRecommendationInput.safeParse(base).success, true);
  });

  it("accepts the enum and records the reviewed timeframes", () => {
    const parsed = createRecommendationInput.safeParse({
      ...base,
      visual_confirmation: "contradicted",
      timeframes_reviewed: ["15m", "1h", "4h", "1D"],
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.visual_confirmation, "contradicted");
    assert.deepEqual(parsed.data?.timeframes_reviewed, ["15m", "1h", "4h", "1D"]);
  });

  it("accepts the boolean shorthand", () => {
    const parsed = createRecommendationInput.safeParse({
      ...base,
      visual_confirmation: true,
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.visual_confirmation, true);
  });

  it("accepts visual review on WAIT decisions too", () => {
    const parsed = createRecommendationInput.safeParse({
      symbol: "XAUUSD",
      action: "wait",
      rationale: "Chart and numbers disagree — we wait.",
      factors: ["conflicting evidence"],
      visual_confirmation: "contradicted",
      timeframes_reviewed: ["1h"],
    });
    assert.equal(parsed.success, true);
  });

  it("rejects an invalid state rather than guessing", () => {
    const parsed = createRecommendationInput.safeParse({
      ...base,
      visual_confirmation: "looks_good",
    });
    assert.equal(parsed.success, false);
  });

  it("accepts a confirmed visual review with no backtest behind it", () => {
    // The recommendation is recorded as direct analysis; what visual review
    // must never do is imply statistical backing, and it does not — the server
    // labels support separately from anything the chart showed.
    const { strategy_id: _s, backtested_confidence: _b, ...withoutEvidence } = base;
    const parsed = createRecommendationInput.safeParse({
      ...withoutEvidence,
      visual_confirmation: "confirmed",
      timeframes_reviewed: ["15m", "1h", "4h", "1D"],
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.strategy_id, undefined);
  });
});
