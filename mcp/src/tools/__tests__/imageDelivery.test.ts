import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import { chartInlineContent, multiTimeframeContent } from "../chartInline.js";
import {
  encodeForInline,
  inspectPng,
  MAX_INLINE_IMAGE_BYTES,
  maxInlineImageBytes,
  prepareImage,
} from "../imageDelivery.js";

/** A real, complete 1×1 PNG — small enough to inline, valid enough to pass. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Noise resists compression, so this reliably lands far above any inline cap —
 * the worst case that must degrade to a URL rather than ship a broken block.
 */
async function noisyPng(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.allocUnsafe(width * height * 3);
  // Deterministic pseudo-noise: a seeded LCG keeps the fixture reproducible
  // while staying incompressible.
  let seed = 0x2f6e2b1;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = (seed >> 16) & 0xff;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

/**
 * A stand-in for the real thing: dark background, thin coloured candles.
 * Compression behaves like an actual capture, which is what the quality ladder
 * is tuned for — noise would prove nothing about charts.
 */
async function chartLikePng(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = 10;
    pixels[i + 1] = 14;
    pixels[i + 2] = 20;
  }
  const paint = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const o = (y * width + x) * 3;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
  };

  let seed = 0x51f3a7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >> 16) / 0x7fff;
  };

  let mid = height / 2;
  for (let x = 4; x < width - 4; x += 9) {
    mid = Math.max(60, Math.min(height - 60, mid + (rand() - 0.5) * 40));
    const body = 10 + rand() * 60;
    const up = rand() > 0.5;
    const [r, g, b] = up ? [34, 197, 94] : [239, 68, 68];
    for (let y = mid - body; y < mid + body; y++) {
      for (let w = 0; w < 6; w++) paint(x + w, Math.round(y), r, g, b);
    }
    for (let y = mid - body - 25; y < mid + body + 25; y++) {
      paint(x + 3, Math.round(y), r, g, b);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

let storeDir: string;

before(() => {
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "aichart-img-"));
  process.env.MCP_IMAGE_STORE_DIR = storeDir;
  process.env.MCP_IMAGE_PUBLIC_BASE = "https://example.test/mcp-images";
});

after(() => {
  fs.rmSync(storeDir, { recursive: true, force: true });
  delete process.env.MCP_IMAGE_STORE_DIR;
  delete process.env.MCP_IMAGE_PUBLIC_BASE;
  delete process.env.MCP_MAX_INLINE_IMAGE_BYTES;
});

describe("inspectPng", () => {
  it("accepts a complete PNG and reads its dimensions", () => {
    const check = inspectPng(TINY_PNG);
    assert.equal(check.valid, true);
    assert.equal(check.width, 1);
    assert.equal(check.height, 1);
  });

  it("rejects an empty buffer", () => {
    assert.deepEqual(inspectPng(Buffer.alloc(0)), {
      valid: false,
      reason: "empty_buffer",
    });
  });

  it("rejects a truncated PNG even though its header is perfect", () => {
    // This is the whole point: a half-written capture keeps a valid signature,
    // so only the missing IEND gives it away.
    const truncated = TINY_PNG.subarray(0, TINY_PNG.length - 12);
    const check = inspectPng(truncated);
    assert.equal(check.valid, false);
    assert.equal(check.reason, "truncated_missing_iend");
    assert.ok(truncated.subarray(0, 8).equals(TINY_PNG.subarray(0, 8)));
  });

  it("rejects bytes that are not a PNG at all", () => {
    const jpegish = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(64),
    ]);
    const check = inspectPng(jpegish);
    assert.equal(check.valid, false);
    assert.ok(check.reason?.startsWith("bad_signature_"));
  });

  it("rejects a non-buffer", () => {
    assert.equal(inspectPng("not bytes").valid, false);
    assert.equal(inspectPng(null).valid, false);
  });
});

describe("encodeForInline", () => {
  it("leaves a small PNG as PNG and under the cap", async () => {
    const encoded = await encodeForInline(TINY_PNG);
    assert.equal(encoded.mimeType, "image/png");
    assert.equal(encoded.overCap, false);
    assert.ok(encoded.buffer.length <= MAX_INLINE_IMAGE_BYTES);
  });

  it("downscales a wide capture to the 1200px inline width", async () => {
    const wide = await sharp({
      create: {
        width: 2400,
        height: 1200,
        channels: 3,
        background: { r: 12, g: 18, b: 28 },
      },
    })
      .png()
      .toBuffer();
    const encoded = await encodeForInline(wide);
    assert.equal(encoded.width, 1200);
    assert.equal(encoded.height, 600);
  });

  it("keeps a realistic chart capture as PNG under the shipped cap", async () => {
    // The everyday case: real captures land around 150KB at 2040px wide and
    // compress well once the long edge comes down to 1200.
    const chart = await chartLikePng(2040, 1440);
    const encoded = await encodeForInline(chart);
    assert.equal(encoded.overCap, false);
    assert.equal(encoded.mimeType, "image/png");
    assert.equal(encoded.width, 1200);
    assert.ok(encoded.buffer.length <= MAX_INLINE_IMAGE_BYTES);
  });

  it("steps down to JPEG when PNG alone cannot reach the cap", async () => {
    const chart = await chartLikePng(2040, 1440);
    const asPng = await encodeForInline(chart);
    const target = Math.floor(asPng.buffer.length / 2);

    const encoded = await encodeForInline(chart, { maxBytes: target });
    assert.equal(encoded.mimeType, "image/jpeg", "PNG was over, JPEG took over");
    assert.equal(encoded.overCap, false, "the ladder reached the cap");
    assert.ok(
      encoded.buffer.length <= target,
      `expected <= ${target}, got ${encoded.buffer.length}`,
    );
    assert.ok(encoded.width <= 1200);
  });

  it("reports overCap when even quality 65 cannot reach the target", async () => {
    // Incompressible noise: nothing on the ladder can save it, and the caller
    // must be told so rather than handed a block the host will drop.
    const big = await noisyPng(1600, 1000);
    const encoded = await encodeForInline(big, { maxBytes: 500 });
    assert.equal(encoded.overCap, true);
    // Still the smallest attempt, not the original — a caller that ignores
    // overCap should at least be sending the cheapest thing we produced.
    assert.ok(encoded.buffer.length < big.length);
  });
});

describe("prepareImage", () => {
  it("rejects a broken buffer instead of persisting it", async () => {
    const result = await prepareImage(TINY_PNG.subarray(0, 20), {
      tool: "capture_chart_snapshot",
      symbol: "XAUUSD",
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.reason.length > 0);
  });

  it("persists the full-resolution PNG and returns an expiring URL", async () => {
    const result = await prepareImage(TINY_PNG, {
      tool: "capture_chart_snapshot",
      symbol: "XAUUSD",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.stored);
    assert.match(result.stored!.url, /^https:\/\/example\.test\/mcp-images\/[0-9a-f]{32}\.png$/);
    assert.equal(result.stored!.bytes, TINY_PNG.length);
    assert.ok(Date.parse(result.stored!.expiresAt) > Date.now());
    // The stored copy is the ORIGINAL, not the downscaled one.
    const onDisk = fs.readFileSync(path.join(storeDir, `${result.stored!.id}.png`));
    assert.ok(onDisk.equals(TINY_PNG));
  });
});

describe("chartInlineContent", () => {
  it("attaches the image block and reports the bytes actually sent", async () => {
    const res = await chartInlineContent({ ok: true, status: "ready" }, TINY_PNG, {
      tool: "capture_chart_snapshot",
      symbol: "XAUUSD",
    });
    const images = res.content.filter((b) => b.type === "image");
    assert.equal(images.length, 1);

    const meta = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(meta.ok, true);
    assert.equal(meta.image_attached, true);
    assert.ok(meta.image_url);
    assert.equal(meta.bytes, TINY_PNG.length);
    assert.equal(meta.width, 1);

    // image_bytes must describe the block on the wire, not the capture size.
    const sent = Buffer.from((images[0] as { data: string }).data, "base64");
    assert.equal(meta.image_bytes, sent.length);
  });

  it("returns the URL alone, with NO image block, when over the cap", async () => {
    process.env.MCP_MAX_INLINE_IMAGE_BYTES = "500";
    try {
      const big = await noisyPng(1400, 900);
      const res = await chartInlineContent({ ok: true, status: "ready" }, big, {
        tool: "capture_chart_snapshot",
        symbol: "XAUUSD",
      });

      assert.equal(res.content.filter((b) => b.type === "image").length, 0);
      const meta = JSON.parse((res.content[0] as { text: string }).text);
      assert.equal(meta.image_attached, false);
      assert.equal(meta.image_bytes, 0);
      assert.ok(meta.image_url, "the URL is the fallback delivery path");
      assert.match(meta.image_delivery, /too large to inline/);
      assert.equal(maxInlineImageBytes(), 500);
    } finally {
      delete process.env.MCP_MAX_INLINE_IMAGE_BYTES;
    }
  });

  it("fails loudly on a truncated capture — never ok:true with a dead block", async () => {
    const res = await chartInlineContent(
      { ok: true, status: "ready" },
      TINY_PNG.subarray(0, TINY_PNG.length - 12),
      { tool: "capture_mt5_chart", symbol: "XAUUSD" },
    );

    assert.equal(res.isError, true);
    assert.equal(res.content.filter((b) => b.type === "image").length, 0);
    const meta = JSON.parse((res.content[0] as { text: string }).text);
    assert.equal(meta.ok, false);
    assert.equal(meta.status, "invalid_image");
    assert.equal(meta.image_captured, false);
    assert.equal(meta.failure_reason, "truncated_missing_iend");
    assert.match(meta.note, /Do NOT describe/);
  });

  it("accepts base64 as well as a buffer", async () => {
    const res = await chartInlineContent(
      { ok: true },
      TINY_PNG.toString("base64"),
      { tool: "capture_chart_snapshot" },
    );
    assert.equal(res.content.filter((b) => b.type === "image").length, 1);
  });
});

describe("multiTimeframeContent image delivery", () => {
  const frame = (timeframe: string, image_base64: string) => ({
    timeframe,
    content_type: "image/png",
    image_base64,
    captured_at: "2026-07-31T10:00:00.000Z",
    image_source: "platform_chart",
    from_cache: false,
    numeric_context: { price: 4130.02 },
  });

  it("keeps a broken frame out of the images and names it in missing_timeframes", async () => {
    const good = TINY_PNG.toString("base64");
    const broken = TINY_PNG.subarray(0, 20).toString("base64");
    const res = await multiTimeframeContent({
      ok: true,
      symbol: "XAUUSD",
      snapshots: [frame("15m", good), frame("1h", broken)],
    });

    assert.equal(res.content.filter((b) => b.type === "image").length, 1);
    const summary = JSON.parse((res.content[0] as { text: string }).text);
    assert.deepEqual(summary.captured_timeframes, ["15m"]);
    assert.equal(summary.partial_success, true);
    assert.equal(summary.missing_timeframes.length, 1);
    assert.match(summary.missing_timeframes[0].reason, /^invalid_image:/);
  });

  it("spends the response-wide budget and degrades the rest to URLs", async () => {
    process.env.MCP_MAX_TOTAL_INLINE_IMAGE_BYTES = "1";
    try {
      const good = TINY_PNG.toString("base64");
      const res = await multiTimeframeContent({
        ok: true,
        symbol: "XAUUSD",
        snapshots: [frame("15m", good), frame("1h", good)],
      });

      // Budget of 1 byte fits nothing, so every frame falls back to its URL.
      assert.equal(res.content.filter((b) => b.type === "image").length, 0);
      const summary = JSON.parse((res.content[0] as { text: string }).text);
      assert.equal(summary.ok, true);
      assert.equal(summary.snapshots.length, 2);
      for (const snap of summary.snapshots) {
        assert.equal(snap.image_attached, false);
        assert.equal(snap.image_bytes, 0);
        assert.ok(snap.image_url);
      }
    } finally {
      delete process.env.MCP_MAX_TOTAL_INLINE_IMAGE_BYTES;
    }
  });
});
