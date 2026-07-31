import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { recommendationWithAutoChart } from "../chartInline.js";
import type { BridgeClient } from "../../bridge/client.js";

// Isolated store + public URL so imageDelivery can persist and mint links.
process.env.MCP_IMAGE_STORE_DIR = mkdtempSync(join(tmpdir(), "rec-autochart-"));
process.env.MCP_IMAGE_PUBLIC_BASE = "https://test.example/mcp-images";

const TINY_PNG = await sharp({
  create: { width: 1, height: 1, channels: 3, background: { r: 8, g: 8, b: 8 } },
})
  .png()
  .toBuffer();

const REC = {
  ok: true,
  recommendation: {
    id: 123,
    symbol: "XAUUSD",
    side: "buy",
    timeframe: "1h",
    entry: 4054,
    stop_loss: 4034,
    take_profit: 4086,
    confidence: 0.62,
  },
};

function bridgeStub(post: (path: string) => unknown): BridgeClient {
  return {
    post: async (path: string) => post(path),
  } as unknown as BridgeClient;
}

describe("recommendationWithAutoChart (V2-A0)", () => {
  it("attaches the chart + card + display_markdown on success", async () => {
    const bridge = bridgeStub((path) => {
      assert.equal(path, "/api/agent/chart/snapshot");
      return { ok: true, image_base64: TINY_PNG.toString("base64") };
    });
    const res = await recommendationWithAutoChart(bridge, REC, {});
    assert.equal(res.content.filter((b) => b.type === "image").length, 1);

    const meta = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(meta.chart_auto_attached, true);
    assert.equal(meta.recommendation_card.symbol, "XAUUSD");
    assert.equal(meta.recommendation_card.side, "buy");
    assert.equal(meta.recommendation_card.stop_loss, 4034);
    assert.match(meta.display_markdown, /^!\[XAUUSD 1h chart\]\(https:\/\//);
    // The original bridge payload survives untouched.
    assert.equal(meta.recommendation.id, 123);
    assert.equal(res.isError, undefined);
  });

  it("keeps the recommendation ok when capture fails — explicit no-image note", async () => {
    const bridge = bridgeStub(() => {
      throw new Error("capture backend down");
    });
    const res = await recommendationWithAutoChart(bridge, REC, {});
    assert.equal(res.content.filter((b) => b.type === "image").length, 0);
    assert.equal(res.isError, undefined, "recommendation must not surface as failed");

    const meta = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(meta.chart_auto_attached, false);
    assert.equal(meta.image_captured, false);
    assert.match(meta.note, /Do NOT describe/);
    assert.equal(meta.recommendation_card.id, 123);
  });

  it("degrades to no-image when the capture returns a broken PNG", async () => {
    const bridge = bridgeStub(() => ({
      ok: true,
      image_base64: TINY_PNG.subarray(0, 12).toString("base64"),
    }));
    const res = await recommendationWithAutoChart(bridge, REC, {});
    assert.equal(res.content.filter((b) => b.type === "image").length, 0);
    assert.equal(res.isError, undefined);
    const meta = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(meta.image_captured, false);
  });

  it("falls back to request symbol/timeframe when the payload lacks them", async () => {
    let requested: unknown;
    const bridge = {
      post: async (_path: string, body: unknown) => {
        requested = body;
        return { ok: true, image_base64: TINY_PNG.toString("base64") };
      },
    } as unknown as BridgeClient;
    await recommendationWithAutoChart(bridge, { ok: true }, {
      symbol: "eurusd",
      timeframe: "15m",
    });
    assert.deepEqual(requested, {
      symbol: "EURUSD",
      interval: "15m",
      market: "forex",
      response_format: "json",
    });
  });
});
