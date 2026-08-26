/**
 * The platform chart session's scaling and honesty proofs:
 *
 *  - concurrent identical requests coalesce onto ONE capture;
 *  - a burst inside the cache window costs ONE capture;
 *  - a snapshot past the window is re-captured, never served;
 *  - overlay-carrying requests bypass the cache both ways;
 *  - `fresh=true` (bypassCache) skips the stored cache read;
 *  - a mid-flight failure cleans up fully (nothing cached, nothing wedged);
 *  - host errors are NAMED (host_unreachable / host_not_ready), and the
 *    end-to-end platform RPC enforces the two-shot rule like any tab.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { PNG_1x1 } from "./fixtures/png";
import {
  capturePlatformSnapshot,
  captureChartWithPlatformFallback,
  clearPlatformSnapshotCacheForTests,
  ensureChartHostTab,
  getFreshPlatformSnapshot,
  layoutOverlaysFromState,
  platformSnapshotKey,
  platformSnapshotTtlMs,
  PLATFORM_SNAPSHOT_TTL_MS,
} from "@/lib/chart/platformCapture";
import {
  ackPlatformCapture,
  completePlatformCapture,
  listPendingPlatformCaptures,
  notePlatformTabPoll,
  requestPlatformCapture,
  resetLiveCaptureForTests,
  type ChartCaptureResult,
  type CaptureFailure,
} from "@/lib/chart/liveCapture";

function okResult(tag: string): ChartCaptureResult {
  return {
    ok: true,
    image_source: "tradingview_capture",
    drawings_included: false,
    studies_included: true,
    content_type: "image/png",
    image_base64: tag,
    images: [
      { label: "context", image_base64: tag },
      { label: "zoom", image_base64: `${tag}-zoom` },
    ],
  };
}

const ensureOk = async () => ({ ok: true as const });

beforeEach(() => {
  clearPlatformSnapshotCacheForTests();
  resetLiveCaptureForTests();
  delete process.env.CHART_SNAPSHOT_CACHE_TTL_MS;
});

afterEach(() => {
  clearPlatformSnapshotCacheForTests();
  resetLiveCaptureForTests();
  delete process.env.CHART_SNAPSHOT_CACHE_TTL_MS;
});

describe("platform snapshot cache + single-flight", () => {
  it("two concurrent requests → one capture, both served from it", async () => {
    let captures = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const request = async () => {
      captures += 1;
      await gate;
      return okResult("shared");
    };
    const input = { forUserId: 7, symbol: "XAUUSD", interval: "1h" };
    const first = capturePlatformSnapshot(input, { ensure: ensureOk, request });
    const second = capturePlatformSnapshot(input, { ensure: ensureOk, request });
    release!();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(captures, 1, "the second request waited on the first capture");
    assert.equal(a.result.ok && a.result.image_base64, "shared");
    assert.equal(b.result.ok && b.result.image_base64, "shared");
  });

  it("100 requests inside the cache window → one capture", async () => {
    let captures = 0;
    let now = 1_000_000;
    const deps = {
      ensure: ensureOk,
      request: async () => {
        captures += 1;
        return okResult("burst");
      },
      now: () => now,
    };
    const input = { forUserId: 7, symbol: "XAUUSD", interval: "1h" };
    for (let i = 0; i < 100; i++) {
      now += 100; // 10s total — all inside the 15s window
      const outcome = await capturePlatformSnapshot(input, deps);
      assert.ok(outcome.result.ok);
      if (i > 0) assert.equal(outcome.fromCache, true, `request ${i} hit the cache`);
    }
    assert.equal(captures, 1, "one hundred requests cost one capture");
  });

  it("a snapshot older than the window is re-captured, never served", async () => {
    let captures = 0;
    let now = 1_000_000;
    const deps = {
      ensure: ensureOk,
      request: async () => {
        captures += 1;
        return okResult(`shot-${captures}`);
      },
      now: () => now,
    };
    const input = { forUserId: 7, symbol: "XAUUSD", interval: "1h" };
    const first = await capturePlatformSnapshot(input, deps);
    assert.equal(first.result.ok && first.result.image_base64, "shot-1");

    now += PLATFORM_SNAPSHOT_TTL_MS + 1;
    const second = await capturePlatformSnapshot(input, deps);
    assert.equal(captures, 2, "past the window a fresh capture happens");
    assert.equal(second.fromCache, false);
    assert.equal(second.result.ok && second.result.image_base64, "shot-2");
    // And the read seam itself refuses the stale entry.
    const key = platformSnapshotKey({ symbol: "XAUUSD", interval: "1h", includeStudies: true });
    assert.equal(getFreshPlatformSnapshot(key, now + PLATFORM_SNAPSHOT_TTL_MS + 1), null);
  });

  it("the window is configurable and 0 disables caching", async () => {
    process.env.CHART_SNAPSHOT_CACHE_TTL_MS = "0";
    assert.equal(platformSnapshotTtlMs(), 0);
    let captures = 0;
    const deps = {
      ensure: ensureOk,
      request: async () => {
        captures += 1;
        return okResult("uncached");
      },
    };
    const input = { forUserId: 7, symbol: "XAUUSD", interval: "1h" };
    await capturePlatformSnapshot(input, deps);
    await capturePlatformSnapshot(input, deps);
    assert.equal(captures, 2, "TTL 0 means every request captures");
  });

  it("bypassCache (fresh=true) skips the stored cache read but still refreshes it", async () => {
    let captures = 0;
    const deps = {
      ensure: ensureOk,
      request: async () => {
        captures += 1;
        return okResult(`fresh-${captures}`);
      },
    };
    const input = { forUserId: 7, symbol: "XAUUSD", interval: "1h" };
    await capturePlatformSnapshot(input, deps);
    const forced = await capturePlatformSnapshot({ ...input, bypassCache: true }, deps);
    assert.equal(captures, 2, "fresh=true re-captured despite a valid cache entry");
    assert.equal(forced.result.ok && forced.result.image_base64, "fresh-2");
    // The forced shot became the shared moment for everyone after it.
    const after = await capturePlatformSnapshot(input, deps);
    assert.equal(after.fromCache, true);
    assert.equal(after.result.ok && after.result.image_base64, "fresh-2");
  });

  it("overlay-carrying requests bypass the cache both ways", async () => {
    let captures = 0;
    const deps = {
      ensure: ensureOk,
      request: async () => {
        captures += 1;
        return okResult(`overlay-${captures}`);
      },
    };
    const withOverlays = {
      forUserId: 7,
      symbol: "XAUUSD",
      interval: "1h",
      drawings: [{ type: "price_line", price: 4000 }],
    };
    await capturePlatformSnapshot(withOverlays, deps);
    await capturePlatformSnapshot(withOverlays, deps);
    assert.equal(captures, 2, "layout-specific shots are never shared");
    const key = platformSnapshotKey({ symbol: "XAUUSD", interval: "1h", includeStudies: true });
    assert.equal(getFreshPlatformSnapshot(key), null, "nothing was cached");
  });

  it("a failed capture caches nothing and releases the single-flight", async () => {
    let captures = 0;
    const failing = {
      ensure: ensureOk,
      request: async (): Promise<CaptureFailure> => {
        captures += 1;
        return { ok: false, reason: "capture_timeout" };
      },
    };
    const input = { forUserId: 7, symbol: "XAUUSD", interval: "1h" };
    const first = await capturePlatformSnapshot(input, failing);
    assert.equal(first.result.ok, false);
    const second = await capturePlatformSnapshot(input, {
      ensure: ensureOk,
      request: async () => okResult("recovered"),
    });
    assert.equal(second.result.ok && second.result.image_base64, "recovered");
    assert.equal(captures, 1);
  });

  it("host failures are named, not generic", async () => {
    const outcome = await capturePlatformSnapshot(
      { forUserId: 7, symbol: "XAUUSD", interval: "1h" },
      { ensure: async () => ({ ok: false as const, reason: "host_unreachable" as const }) },
    );
    assert.deepEqual(outcome.result, { ok: false, reason: "host_unreachable" });
  });
});

describe("ensureChartHostTab", () => {
  it("skips the container entirely when the tab is already fresh", async () => {
    let fetched = 0;
    const result = await ensureChartHostTab({
      isTabFresh: () => true,
      fetchImpl: (async () => {
        fetched += 1;
        return new Response("{}");
      }) as typeof fetch,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(fetched, 0);
  });

  it("an unreachable container is host_unreachable by name", async () => {
    process.env.CHART_HOST_URL = "http://127.0.0.1:9";
    process.env.AICHART_SERVICE_TOKEN = "test-service-token-16";
    try {
      const result = await ensureChartHostTab({
        isTabFresh: () => false,
        fetchImpl: (async () => {
          throw new Error("ECONNREFUSED");
        }) as typeof fetch,
      });
      assert.deepEqual(result, { ok: false, reason: "host_unreachable" });
    } finally {
      delete process.env.CHART_HOST_URL;
      delete process.env.AICHART_SERVICE_TOKEN;
    }
  });

  it("a container that answers but a tab that never polls is host_not_ready — and the zombie is torn down", async () => {
    process.env.CHART_HOST_URL = "http://chart-host.test";
    process.env.AICHART_SERVICE_TOKEN = "test-service-token-16";
    let now = 0;
    const calls: string[] = [];
    try {
      const result = await ensureChartHostTab({
        isTabFresh: () => false,
        fetchImpl: (async (url: RequestInfo | URL) => {
          calls.push(String(url));
          return new Response(JSON.stringify({ ok: true }));
        }) as typeof fetch,
        now: () => now,
        sleep: async () => {
          now += 30_000; // blow straight past the warmup window
        },
      });
      assert.deepEqual(result, { ok: false, reason: "host_not_ready" });
      // A page that survived a whole warmup without one poll is a zombie —
      // ensure() keeps reporting it alive and every ensure renews its idle
      // lease, so it MUST be closed here or the next attempt re-adopts it.
      assert.deepEqual(calls, [
        "http://chart-host.test/session/ensure",
        "http://chart-host.test/session/close",
      ]);
    } finally {
      delete process.env.CHART_HOST_URL;
      delete process.env.AICHART_SERVICE_TOKEN;
    }
  });
});

describe("the platform RPC end to end (in-process tab driver)", () => {
  function driveTabOnce(behavior: "complete" | "context_only") {
    const timer = setInterval(() => {
      const pending = listPendingPlatformCaptures();
      for (const request of pending) {
        ackPlatformCapture(request.id);
        const images =
          behavior === "complete"
            ? request.shots.map((shot) => ({ label: shot.label, buffer: PNG_1x1 }))
            : [{ label: "context", buffer: PNG_1x1 }];
        completePlatformCapture({
          requestId: request.id,
          images,
          drawingsRendered: request.drawings.length,
          studiesRendered: 0,
        });
      }
    }, 10);
    return () => clearInterval(timer);
  }

  it("delivers the two-shot pair and measures drawings off the upload", async () => {
    notePlatformTabPoll();
    const stop = driveTabOnce("complete");
    try {
      const result = await requestPlatformCapture({
        forUserId: 9,
        symbol: "xauusd",
        interval: "1h",
        drawings: [{ type: "price_line", price: 4000 }],
        ackTimeoutMs: 2_000,
        uploadTimeoutMs: 2_000,
      });
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.images.length, 2);
      assert.deepEqual(
        result.images.map((image) => image.label),
        ["context", "zoom"],
      );
      assert.equal(result.drawings_included, true, "measured from the upload");
      assert.equal(result.image_source, "tradingview_capture");
    } finally {
      stop();
    }
  });

  it("refuses a single-frame upload — the two-shot rule holds on the platform tab", async () => {
    notePlatformTabPoll();
    const stop = driveTabOnce("context_only");
    try {
      const result = await requestPlatformCapture({
        forUserId: 9,
        symbol: "XAUUSD",
        interval: "1h",
        ackTimeoutMs: 2_000,
        uploadTimeoutMs: 2_000,
      });
      assert.deepEqual(result, { ok: false, reason: "missing_shots" });
    } finally {
      stop();
    }
  });

  it("an unanswered request fails as host_not_ready, never hangs", async () => {
    const result = await requestPlatformCapture({
      forUserId: 9,
      symbol: "XAUUSD",
      interval: "1h",
      ackTimeoutMs: 100,
    });
    assert.deepEqual(result, { ok: false, reason: "host_not_ready" });
    assert.equal(listPendingPlatformCaptures().length, 0, "nothing left pending");
  });
});

describe("captureChartWithPlatformFallback", () => {
  it("a live-tab success never touches the platform path", async () => {
    let platformCalls = 0;
    const result = await captureChartWithPlatformFallback(
      { userId: 3, symbol: "XAUUSD", interval: "1h" },
      {
        direct: async () => okResult("direct"),
        configured: () => true,
        ensure: async () => {
          platformCalls += 1;
          return { ok: true as const };
        },
      },
    );
    assert.ok(result.ok && result.image_base64 === "direct");
    assert.equal(platformCalls, 0);
  });

  it("a real failure on a live tab stays a failure — no masking retry", async () => {
    const result = await captureChartWithPlatformFallback(
      { userId: 3, symbol: "XAUUSD", interval: "1h" },
      {
        direct: async () => ({ ok: false as const, reason: "upload_failed" as const }),
        configured: () => true,
        request: async () => okResult("should-not-happen"),
        ensure: ensureOk,
      },
    );
    assert.deepEqual(result, { ok: false, reason: "upload_failed" });
  });

  it("no live tab + host configured → the platform session answers", async () => {
    const result = await captureChartWithPlatformFallback(
      { userId: 3, symbol: "XAUUSD", interval: "1h" },
      {
        direct: async () => ({ ok: false as const, reason: "no_live_session" as const }),
        configured: () => true,
        ensure: ensureOk,
        request: async () => okResult("platform"),
      },
    );
    assert.ok(result.ok && result.image_base64 === "platform");
  });

  it("no live tab + no host → the honest failure of always", async () => {
    const result = await captureChartWithPlatformFallback(
      { userId: 3, symbol: "XAUUSD", interval: "1h" },
      {
        direct: async () => ({ ok: false as const, reason: "no_live_session" as const }),
        configured: () => false,
      },
    );
    assert.deepEqual(result, { ok: false, reason: "no_live_session" });
  });
});

describe("layout overlays parser", () => {
  it("reads drawings/studies leniently and never throws", () => {
    assert.deepEqual(layoutOverlaysFromState(null), { drawings: [], studies: [] });
    assert.deepEqual(layoutOverlaysFromState("not json"), { drawings: [], studies: [] });
    const parsed = layoutOverlaysFromState(
      JSON.stringify({ drawings: [{ type: "price_line" }, 42], studies: [{ id: "rsi" }] }),
    );
    assert.equal(parsed.drawings.length, 1);
    assert.equal(parsed.studies.length, 1);
  });
});
