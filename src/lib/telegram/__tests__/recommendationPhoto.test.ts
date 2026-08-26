/**
 * The recommendation photo: real pixels, the right process, never a blocker.
 *
 * What these tests hold is the module's three contracts:
 *
 *  1. the drawings travel — locally as `platformDrawings`, remotely in the
 *     delegated request body — because a chart photo WITHOUT the plan's
 *     drawings is exactly the parity gap this closes;
 *  2. capability picks the process: a polling tab captures here, no tab
 *     delegates to the web process, a delegated NAMED failure is final
 *     (never re-spent locally) while a dead socket falls back;
 *  3. every failure is a named reason and nothing throws — the text answer
 *     must ship whether or not its photograph exists.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

process.env.APP_SECRET ??= "photo-test-secret-0123456789abcdef";

import {
  captureRecommendationPhoto,
  type RecommendationPhotoDeps,
} from "@/lib/telegram/recommendationPhoto";
import type { captureChartWithPlatformFallback } from "@/lib/chart/platformCapture";
import type { getPublicUser } from "@/lib/store";

const PNG = Buffer.from("fake-png-bytes").toString("base64");
const ZOOM = Buffer.from("fake-zoom-bytes").toString("base64");

const DRAWINGS = [
  { type: "entry_line", price: 4688.51 },
  { type: "stop_zone", from: 4700, to: 4702 },
];

function okCapture(): Awaited<ReturnType<typeof captureChartWithPlatformFallback>> {
  return {
    ok: true,
    content_type: "image/png",
    image_source: "tradingview_capture",
    drawings_included: true,
    studies_included: false,
    image_base64: PNG,
    images: [
      { label: "context", image_base64: PNG },
      { label: "zoom", image_base64: ZOOM },
    ],
  };
}

const user = (async () => ({ id: 7, email: "op@example.com" })) as unknown as typeof getPublicUser;

function input(over: Partial<Parameters<typeof captureRecommendationPhoto>[0]> = {}) {
  return {
    userId: 7,
    symbol: "XAUUSD",
    interval: "15m",
    drawings: DRAWINGS,
    ...over,
  };
}

afterEach(() => {
  delete process.env.AICHART_API_URL;
  delete process.env.AICHART_SERVICE_TOKEN;
});

describe("captureRecommendationPhoto", () => {
  it("refuses honestly when there is nothing to draw", async () => {
    const result = await captureRecommendationPhoto(input({ drawings: [] }), {
      hasLocalTab: () => true,
      captureLocally: (async () => okCapture()) as RecommendationPhotoDeps["captureLocally"],
    });
    assert.deepEqual(result, { ok: false, reason: "no_drawings" });
  });

  it("captures in THIS process when it holds the tab — drawings riding along", async () => {
    let seen: unknown;
    const result = await captureRecommendationPhoto(input(), {
      hasLocalTab: () => true,
      captureLocally: (async (arg: unknown) => {
        seen = arg;
        return okCapture();
      }) as RecommendationPhotoDeps["captureLocally"],
    });
    assert.ok(result.ok);
    assert.equal(result.image.toString(), "fake-png-bytes");
    assert.equal(result.zoom?.toString(), "fake-zoom-bytes");
    const captured = seen as { platformDrawings?: unknown[]; liveSession?: boolean };
    assert.deepEqual(captured.platformDrawings, DRAWINGS, "the plan's drawings must ship");
    assert.equal(captured.liveSession, false, "unattended: never wait for a browser");
  });

  it("delegates to the web process when this one has no tab — drawings in the body", async () => {
    process.env.AICHART_API_URL = "http://web:3000";
    process.env.AICHART_SERVICE_TOKEN = "service-token-0123456789";
    let requestedUrl = "";
    let requestedBody: Record<string, unknown> = {};
    let capturedLocally = false;
    const result = await captureRecommendationPhoto(input(), {
      hasLocalTab: () => false,
      lookupUser: user,
      fetchImpl: (async (url: string, init: { body: string }) => {
        requestedUrl = String(url);
        requestedBody = JSON.parse(init.body) as Record<string, unknown>;
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, image_base64: PNG, images: [] }),
        };
      }) as unknown as typeof fetch,
      captureLocally: (async () => {
        capturedLocally = true;
        return okCapture();
      }) as RecommendationPhotoDeps["captureLocally"],
    });
    assert.ok(result.ok);
    assert.match(requestedUrl, /\/api\/agent\/chart\/snapshot$/);
    assert.deepEqual(requestedBody.drawings, DRAWINGS, "delegation must carry the drawings");
    assert.equal(requestedBody.live_session, false);
    assert.equal(capturedLocally, false, "the tabless process must not capture");
  });

  it("treats a delegated NAMED failure as final — the budget is not spent twice", async () => {
    process.env.AICHART_API_URL = "http://web:3000";
    process.env.AICHART_SERVICE_TOKEN = "service-token-0123456789";
    let capturedLocally = false;
    const result = await captureRecommendationPhoto(input(), {
      hasLocalTab: () => false,
      lookupUser: user,
      fetchImpl: (async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: "x", reason: "host_unreachable" }),
      })) as unknown as typeof fetch,
      captureLocally: (async () => {
        capturedLocally = true;
        return okCapture();
      }) as RecommendationPhotoDeps["captureLocally"],
    });
    assert.deepEqual(result, { ok: false, reason: "host_unreachable" });
    assert.equal(capturedLocally, false);
  });

  it("falls back to the local path when the delegation socket dies fast", async () => {
    process.env.AICHART_API_URL = "http://web:3000";
    process.env.AICHART_SERVICE_TOKEN = "service-token-0123456789";
    const result = await captureRecommendationPhoto(input(), {
      hasLocalTab: () => false,
      lookupUser: user,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      captureLocally: (async () => okCapture()) as RecommendationPhotoDeps["captureLocally"],
    });
    assert.ok(result.ok, "a wiring fault must not kill a capture the local path can make");
  });

  it("captures locally when the delegation is not wired at all", async () => {
    // Single-process deployment: no bridge env — the local path IS the web
    // process, and the chart-host fallback inside it still gets its chance.
    const result = await captureRecommendationPhoto(input(), {
      hasLocalTab: () => false,
      captureLocally: (async () => okCapture()) as RecommendationPhotoDeps["captureLocally"],
    });
    assert.ok(result.ok);
  });

  it("returns the capture's own named reason and never throws", async () => {
    const failed = await captureRecommendationPhoto(input(), {
      hasLocalTab: () => true,
      captureLocally: (async () => ({
        ok: false as const,
        reason: "host_not_ready" as const,
      })) as RecommendationPhotoDeps["captureLocally"],
    });
    assert.deepEqual(failed, { ok: false, reason: "host_not_ready" });

    const threw = await captureRecommendationPhoto(input(), {
      hasLocalTab: () => true,
      captureLocally: (async () => {
        throw new Error("widget exploded");
      }) as RecommendationPhotoDeps["captureLocally"],
    });
    assert.deepEqual(threw, { ok: false, reason: "capture_failed" });
  });
});
