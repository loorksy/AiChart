import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { z } from "zod";
import { multiTimeframeContent } from "../chartInline.js";
import { createRecommendationInput } from "../schemas/coreSchemas.js";
import { getToolDef } from "../schemas/index.js";

/**
 * Real 1×1 PNGs, one per frame. Placeholder strings no longer work: the
 * delivery layer validates every buffer before it will attach an image block.
 */
const PNG_15M = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_1H = PNG_15M;
const PNG_4H = PNG_15M;

let storeDir: string;

before(() => {
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "aichart-mtf-"));
  process.env.MCP_IMAGE_STORE_DIR = storeDir;
  process.env.MCP_IMAGE_PUBLIC_BASE = "https://example.test/mcp-images";
});

after(() => {
  fs.rmSync(storeDir, { recursive: true, force: true });
  delete process.env.MCP_IMAGE_STORE_DIR;
  delete process.env.MCP_IMAGE_PUBLIC_BASE;
});

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
      image_base64: PNG_15M.toString("base64"),
      captured_at: "2026-07-25T10:00:00.000Z",
      image_source: "mt5",
      from_cache: false,
      numeric_context: { price: 4130.02, rsi: 54.7, adx: 28.4 },
    },
    {
      timeframe: "1h",
      content_type: "image/png",
      image_base64: PNG_1H.toString("base64"),
      captured_at: "2026-07-25T10:00:01.000Z",
      image_source: "tradingview_capture",
      from_cache: true,
      numeric_context: { price: 4130.02, nearest_support: 4106.7 },
    },
    {
      timeframe: "4h",
      content_type: "image/png",
      image_base64: PNG_4H.toString("base64"),
      captured_at: "2026-07-25T10:00:02.000Z",
      image_source: "tradingview_capture",
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
  it("emits one image block per captured timeframe", async () => {
    const result = await multiTimeframeContent(BRIDGE_RESULT);
    const images = result.content.filter((block) => block.type === "image");
    assert.equal(images.length, 3);
    for (const block of images) {
      // Every block carries the re-encoded copy, not the raw capture bytes.
      assert.ok(
        Buffer.from((block as { data: string }).data, "base64").length > 0,
      );
    }
  });

  it("labels each image with its own timeframe and numbers", async () => {
    const result = await multiTimeframeContent(BRIDGE_RESULT);
    // Blocks after the summary alternate label → image, so the model can bind
    // a chart to the timeframe it belongs to.
    const [, firstLabel, firstImage] = result.content;
    assert.equal(firstLabel!.type, "text");
    assert.equal(firstImage!.type, "image");
    const label = JSON.parse((firstLabel as { text: string }).text);
    assert.equal(label.timeframe, "15m");
    assert.equal(label.numeric_context.rsi, 54.7);
  });

  it("keeps base64 out of the JSON summary by default", async () => {
    const summary = (await multiTimeframeContent(BRIDGE_RESULT)).content[0] as {
      text: string;
    };
    const parsed = JSON.parse(summary.text);
    assert.equal(parsed.snapshots[0].imageBase64, undefined);
    assert.equal(parsed.snapshots[0].image_block_index, 0);
    assert.equal(parsed.snapshots[0].numeric_context.price, 4130.02);
    assert.ok(parsed.snapshots[0].image_url, "each frame keeps a durable URL");
    assert.ok(parsed.snapshots[0].display_markdown, "and a ready markdown image");
  });

  it("inlines base64 only when the caller asks", async () => {
    const summary = (
      await multiTimeframeContent(BRIDGE_RESULT, { inlineBase64: true })
    ).content[0] as { text: string };
    const first = JSON.parse(summary.text).snapshots[0];
    assert.ok(typeof first.imageBase64 === "string" && first.imageBase64.length > 0);
  });

  it("reports the missing timeframe without failing the whole call", async () => {
    const result = await multiTimeframeContent(BRIDGE_RESULT);
    assert.notEqual(result.isError, true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.partial_success, true);
    assert.deepEqual(parsed.missing_timeframes, [
      { timeframe: "1d", reason: "capture_timeout" },
    ]);
  });

  it("is an error only when nothing was captured", async () => {
    const result = await multiTimeframeContent({
      ...BRIDGE_RESULT,
      snapshots: [],
      captured_timeframes: [],
    });
    assert.equal(result.isError, true);
    assert.equal(result.content.filter((b) => b.type === "image").length, 0);
  });

  it("drops snapshot entries that carry no image", async () => {
    const result = await multiTimeframeContent({
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
    plan_type: "immediate" as const,
    market_regime: "trending",
    rationale: "We buy with the validated EMA trend follow edge.",
    factors: ["regime aligned"],
    entry: 4130,
    stop_loss: 4110,
    take_profit: 4180,
    timeframe: "1h",
    // The Complete Plan Contract layers, present so these tests keep proving
    // what they exist for — the VISUAL audit fields.
    invalidation_rule: "A full-candle close beyond the stop kills the idea.",
    alternative_scenario: "Failure flips the bias to the far side of the range.",
    validity_candles: 24,
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

  it("records a contradicted review on a real direction", () => {
    // Charts disagreeing with the numbers lowers the DISPLAYED confidence and is
    // recorded for audit. It does not remove the direction, and there is no
    // "wait" to fall back to.
    const parsed = createRecommendationInput.safeParse({
      ...base,
      visual_confirmation: "contradicted",
      timeframes_reviewed: ["1h"],
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.action, "buy");
    assert.equal(parsed.data?.visual_confirmation, "contradicted");
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
    const parsed = createRecommendationInput.safeParse({
      ...base,
      visual_confirmation: "confirmed",
      timeframes_reviewed: ["15m", "1h", "4h", "1D"],
    });
    assert.equal(parsed.success, true);
    assert.equal("strategy_id" in (parsed.data ?? {}), false);
  });
});
