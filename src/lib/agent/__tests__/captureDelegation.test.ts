/**
 * Where a chart frame is captured, when this process cannot capture it.
 *
 * The rendezvous the chart-host container polls is module state — a Map and a
 * timestamp living in `chart/liveCapture.ts`. Only `/api/chart/host-capture`
 * writes to them, and that route is served by the WEB process, while a
 * platform analysis runs in the WORKER behind the Redis turn queue. Two Node
 * processes hold two private copies, so a capture the worker filed was never
 * the one the container collected: every frame timed out, every analysis
 * reported "no chart snapshot", and the identical capture through MCP — which
 * lands on web — returned three real frames in 6.2s.
 *
 * These tests exist because the fix FAILS SILENTLY by design: every unhappy
 * path falls back to a local capture that returns an empty-but-valid result.
 * A regression here does not throw and does not log an error — it just quietly
 * goes blind again, which is exactly the symptom that took this long to find.
 * So each branch is pinned by name.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  captureWhereTheTabLives,
  type CaptureRouteDeps,
} from "@/lib/agent/visualEvidence";

const BODY = {
  symbol: "XAUUSD",
  timeframes: ["15m", "1h", "4h"],
  maxImages: 3,
  imageTimeoutMs: 9_000,
  liveSession: false,
};

/** A capture result with `n` frames, in the real payload shape. */
function payload(n: number) {
  return {
    symbol: "XAUUSD",
    market: "forex",
    requested_timeframes: BODY.timeframes,
    captured_timeframes: BODY.timeframes.slice(0, n),
    missing_timeframes: BODY.timeframes.slice(n).map((timeframe) => ({
      timeframe,
      reason: "capture_timeout",
    })),
    partial_success: n > 0 && n < BODY.timeframes.length,
    snapshots: Array.from({ length: n }, (_, i) => ({
      timeframe: BODY.timeframes[i],
      image_base64: "iVBORw0KGgo=",
      images: [],
      image_source: "tradingview_capture",
      drawings_included: true,
    })),
    elapsed_ms: 6_211,
    guardrails: [],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Deps that make every fallback observable instead of hitting the network. */
function deps(over: Partial<CaptureRouteDeps> & { localFrames?: number } = {}) {
  const calls = { local: 0, remote: 0 };
  const base: CaptureRouteDeps = {
    hasLocalTab: () => false,
    lookupUser: (async () => ({ id: 7, email: "op@example.com" })) as never,
    captureLocally: (async () => {
      calls.local += 1;
      return payload(over.localFrames ?? 0);
    }) as never,
    fetchImpl: (async () => {
      calls.remote += 1;
      return jsonResponse(200, { ok: true, ...payload(3) });
    }) as never,
    ...over,
  };
  return { deps: base, calls };
}

describe("a capture goes to the process that owns the tab", () => {
  const saved = {
    url: process.env.AICHART_API_URL,
    token: process.env.AICHART_SERVICE_TOKEN,
  };
  beforeEach(() => {
    process.env.AICHART_API_URL = "http://127.0.0.1:3010";
    process.env.AICHART_SERVICE_TOKEN = "service-token-long-enough";
  });
  afterEach(() => {
    if (saved.url === undefined) delete process.env.AICHART_API_URL;
    else process.env.AICHART_API_URL = saved.url;
    if (saved.token === undefined) delete process.env.AICHART_SERVICE_TOKEN;
    else process.env.AICHART_SERVICE_TOKEN = saved.token;
  });

  it("captures locally, without a network hop, when THIS process holds the tab", async () => {
    const { deps: d, calls } = deps({ hasLocalTab: () => true, localFrames: 3 });
    const result = await captureWhereTheTabLives(1, BODY, d);
    assert.equal(calls.local, 1, "the web fast path must stay in-process");
    assert.equal(calls.remote, 0, "and must never pay for a round trip");
    assert.equal(result.snapshots.length, 3);
  });

  it("delegates when this process has no tab, and returns the frames it gets", async () => {
    const { deps: d, calls } = deps();
    const result = await captureWhereTheTabLives(1, BODY, d);
    assert.equal(calls.remote, 1, "the worker must ask the process that can answer");
    assert.equal(calls.local, 0, "and must not also capture blind locally");
    assert.equal(result.snapshots.length, 3, "the delegated frames are the answer");
  });

  it("sends the bridge credentials and preserves live_session", async () => {
    // Collected into an array rather than a nullable local: TypeScript cannot
    // see that the fetch callback ever ran, so `let sent = null` stays narrowed
    // to `null` and every field read after the assert fails to compile.
    const sent: { url: string; init: RequestInit }[] = [];
    const { deps: d } = deps({
      fetchImpl: (async (url: string, init: RequestInit) => {
        sent.push({ url, init });
        return jsonResponse(200, { ok: true, ...payload(3) });
      }) as never,
    });
    await captureWhereTheTabLives(1, BODY, d);
    assert.equal(sent.length, 1, "exactly one request was made");
    const { url, init } = sent[0]!;
    assert.match(url, /\/api\/agent\/chart\/multi-snapshot$/);
    const headers = init.headers as Record<string, string>;
    assert.equal(headers["x-agent-token"], "service-token-long-enough");
    assert.equal(headers["x-aichart-user-email"], "op@example.com");
    assert.ok(headers["x-aichart-user-sig"], "the bridge signature is required");
    // An unattended run must stay unattended on the far side: `live_session`
    // false is what lets the capture fall through to the SHARED chart-host tab
    // instead of waiting on an operator tab that is not there.
    assert.equal(JSON.parse(init.body as string).live_session, false);
  });

  it("keeps a 503 body instead of re-running the capture it just failed", async () => {
    // The route answers `{ok, ...result}` for BOTH 200 and 503, reserving 503
    // for "not one frame came back" — a complete, truthful answer with a
    // reason per frame. Treating it as an error threw that away and sent the
    // worker to repeat, locally and blind, the capture it had just been told
    // could not be made: the budget spent twice for the same empty result.
    const { deps: d, calls } = deps({
      fetchImpl: (async () => jsonResponse(503, { ok: false, ...payload(0) })) as never,
    });
    const result = await captureWhereTheTabLives(1, BODY, d);
    assert.equal(calls.local, 0, "a 503 is an answer, not a reason to redo the work");
    assert.equal(result.missing_timeframes.length, 3);
    assert.equal(result.snapshots.length, 0);
  });

  it("still falls back locally when the delegation fails FAST", async () => {
    // A refused route or a dead socket costs no budget, so the local path is
    // still affordable and might well succeed — this is the wiring fault the
    // fallback exists for.
    let t = 1_000;
    const { deps: d, calls } = deps({
      localFrames: 2,
      now: () => t,
      fetchImpl: (async () => {
        t += 40;
        throw new Error("ECONNREFUSED");
      }) as never,
    });
    const result = await captureWhereTheTabLives(1, BODY, d);
    assert.equal(calls.local, 1, "40ms spent leaves the whole budget intact");
    assert.equal(result.snapshots.length, 2);
  });

  it("does NOT double-spend the budget when the delegation times out", async () => {
    // The visual stage gets 9s inside a run whose total budget is exact. A
    // remote attempt that burns those 9s and THEN starts a fresh 9s local one
    // turns a 9s stage into 20s and overruns the deadline governing the whole
    // run — which is how a capture problem becomes a decision timeout.
    let t = 1_000;
    const { deps: d, calls } = deps({
      now: () => t,
      fetchImpl: (async () => {
        t += 11_000;
        throw new Error("TimeoutError");
      }) as never,
    });
    const result = await captureWhereTheTabLives(1, BODY, d);
    assert.equal(calls.local, 0, "there is nothing left to buy a second attempt with");
    assert.equal(result.snapshots.length, 0);
    assert.deepEqual(
      result.missing_timeframes.map((m) => m.timeframe),
      BODY.timeframes,
      "and every requested frame is reported missing, by name",
    );
  });

  it("captures locally when the bridge is not configured at all", async () => {
    delete process.env.AICHART_API_URL;
    const { deps: d, calls } = deps({ localFrames: 1 });
    await captureWhereTheTabLives(1, BODY, d);
    assert.equal(calls.remote, 0);
    assert.equal(calls.local, 1, "an unconfigured bridge must not cost a frame");
  });

  it("captures locally when the user has no email to sign with", async () => {
    const { deps: d, calls } = deps({
      lookupUser: (async () => null) as never,
      localFrames: 1,
    });
    await captureWhereTheTabLives(1, BODY, d);
    assert.equal(calls.remote, 0, "an unsignable request is not worth sending");
    assert.equal(calls.local, 1);
  });
});
