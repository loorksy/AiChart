import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LIVE_CAPTURE_CONCURRENCY,
  ackLiveCapture,
  captureChartImage,
  coerceVisualConfirmation,
  completeLiveCapture,
  drawingsIncludedFromCapture,
  listPendingLiveCaptures,
  liveCaptureActiveCount,
  hasFreshLiveTab,
  noteLiveCapturePoll,
  pickLiveLayoutId,
  resetLiveCaptureForTests,
  studiesIncludedFromCapture,
} from "@/lib/chart/liveCapture";
import { CHART_CONTEXT_CANDLES, CHART_ZOOM_CANDLES } from "@/lib/chart/captureWindow";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const bothShots = [
  { label: "context", buffer: PNG },
  { label: "zoom", buffer: PNG },
];

describe("honest capture flags", () => {
  it("drawings_included is true only when drawings were requested AND rendered", () => {
    assert.equal(
      drawingsIncludedFromCapture({ includeDrawings: true, drawingsRendered: 6 }),
      true,
    );
    assert.equal(
      drawingsIncludedFromCapture({ includeDrawings: true, drawingsRendered: 0 }),
      false,
    );
    assert.equal(
      drawingsIncludedFromCapture({ includeDrawings: false, drawingsRendered: 6 }),
      false,
    );
  });

  it("studies_included is true only when studies were requested AND rendered", () => {
    assert.equal(
      studiesIncludedFromCapture({ includeStudies: true, studiesRendered: 2 }),
      true,
    );
    assert.equal(
      studiesIncludedFromCapture({ includeStudies: true, studiesRendered: 0 }),
      false,
    );
    assert.equal(
      studiesIncludedFromCapture({ includeStudies: false, studiesRendered: 2 }),
      false,
    );
  });
});

describe("coerceVisualConfirmation", () => {
  afterEach(() => resetLiveCaptureForTests());

  it("forces not_checked when drawings were not in the last capture", () => {
    assert.equal(coerceVisualConfirmation("confirmed", 99), "not_checked");
    assert.equal(coerceVisualConfirmation("contradicted", 99), "not_checked");
    assert.equal(coerceVisualConfirmation("not_checked", 99), "not_checked");
  });
});

describe("pickLiveLayoutId", () => {
  afterEach(() => resetLiveCaptureForTests());

  it("prefers a layout that has polled recently over a stale preferred id", () => {
    noteLiveCapturePoll(7, "LiveTab01");
    assert.equal(pickLiveLayoutId(7, "StaleTab9"), "LiveTab01");
    assert.equal(pickLiveLayoutId(7), "LiveTab01");
  });

  it("keeps the preferred layout when that tab is the one polling", () => {
    noteLiveCapturePoll(7, "Prefer001");
    noteLiveCapturePoll(8, "OtherUser");
    assert.equal(pickLiveLayoutId(7, "Prefer001"), "Prefer001");
  });

  it("does not return a preferred layout that has not polled", () => {
    assert.equal(pickLiveLayoutId(7, "Prefer001"), undefined);
    assert.equal(hasFreshLiveTab(7, "Prefer001"), false);
  });
});

describe("completeLiveCapture ownership", () => {
  afterEach(() => resetLiveCaptureForTests());

  it("rejects an upload whose user/layout does not own the pending request", async () => {
    const unknown = completeLiveCapture({
      requestId: "cap_missing",
      userId: 1,
      layoutId: "abcdefgh",
      images: bothShots,
      drawingsRendered: 1,
      studiesRendered: 0,
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.error, "unknown_request");
  });
});

describe("TradingView-only: a browserless capture is a named failure, never an image", () => {
  afterEach(() => resetLiveCaptureForTests());

  it("unattended liveSession=false yields no image at all", async () => {
    const t0 = Date.now();
    const result = await captureChartImage({
      userId: 1,
      symbol: "XAUUSD",
      interval: "1h",
      liveSession: false,
    });
    assert.ok(Date.now() - t0 < 2_000);
    assert.deepEqual(result, { ok: false, reason: "no_live_session" });
    assert.equal(coerceVisualConfirmation("confirmed", 1), "not_checked");
  });

  it("invalid layout id is layout_not_found — no substitute render", async () => {
    const result = await captureChartImage({
      userId: 1,
      layoutId: "nope!!!!",
      symbol: "XAUUSD",
      interval: "1h",
      liveSession: true,
    });
    assert.deepEqual(result, { ok: false, reason: "layout_not_found" });
  });

  it("missing layout row is layout_not_found", async () => {
    const result = await captureChartImage({
      userId: 1,
      layoutId: "AbCdEfGh",
      symbol: "XAUUSD",
      interval: "1h",
      liveSession: true,
    });
    assert.deepEqual(result, { ok: false, reason: "layout_not_found" });
  });
});

describe("live capture round trip, two-shot rule, ownership, concurrency", () => {
  afterEach(() => resetLiveCaptureForTests());

  let userId = 0;
  let layoutId = "";

  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), "lonora-cap-"));
    process.env.DB_PATH = join(dir, "test.db");
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    process.env.APP_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    const db = await import("@/lib/db");
    await db.initDb();
    userId = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      [`cap-${Date.now()}@test.com`, "x", "user", "active"],
    );
    const store = await import("@/lib/store");
    const layout = await store.getOrCreateChartLayout(userId, "XAUUSD");
    layoutId = layout.id;
  });

  it("skips the ACK wait when no tab has polled recently — and stays imageless", async () => {
    const t0 = Date.now();
    const result = await captureChartImage({
      userId,
      layoutId,
      symbol: "XAUUSD",
      interval: "15m",
      liveSession: true,
      ackTimeoutMs: 8_000,
    });
    assert.ok(Date.now() - t0 < 2_000, "must not wait the ACK timeout");
    assert.deepEqual(result, { ok: false, reason: "no_live_session" });
  });

  it("requests the two-shot pair, accepts both PNGs, and caps concurrency at 2", async () => {
    noteLiveCapturePoll(userId, layoutId);
    const capture = captureChartImage({
      userId,
      layoutId,
      symbol: "XAUUSD",
      interval: "15m",
      liveSession: true,
      includeDrawings: true,
      includeStudies: true,
      ackTimeoutMs: 3_000,
    });

    let pending = listPendingLiveCaptures(userId, layoutId);
    const deadline = Date.now() + 2_000;
    while (pending.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      pending = listPendingLiveCaptures(userId, layoutId);
    }
    assert.ok(pending.length >= 1, "server queued a live-capture request");
    // The two-shot rule rides the request itself — the tab is TOLD both
    // windows, it does not choose.
    assert.deepEqual(
      pending[0]!.shots,
      [
        { label: "context", candles: CHART_CONTEXT_CANDLES },
        { label: "zoom", candles: CHART_ZOOM_CANDLES },
      ],
    );
    const requestId = pending[0]!.id;
    assert.equal(ackLiveCapture(userId, requestId), true);

    const owned = completeLiveCapture({
      requestId,
      userId: userId + 99,
      layoutId,
      images: bothShots,
      drawingsRendered: 6,
      studiesRendered: 2,
    });
    assert.equal(owned.ok, false);
    if (!owned.ok) assert.equal(owned.error, "layout_not_owned");

    const wrongLayout = completeLiveCapture({
      requestId,
      userId,
      layoutId: "ZzZzZzZz",
      images: bothShots,
      drawingsRendered: 6,
      studiesRendered: 2,
    });
    assert.equal(wrongLayout.ok, false);

    const ok = completeLiveCapture({
      requestId,
      userId,
      layoutId,
      images: bothShots,
      drawingsRendered: 6,
      studiesRendered: 2,
    });
    assert.equal(ok.ok, true);

    const result = await capture;
    assert.ok(result.ok);
    assert.equal(result.image_source, "tradingview_capture");
    assert.equal(result.drawings_included, true);
    assert.equal(result.studies_included, true);
    assert.equal(result.fallback_reason, undefined);
    assert.deepEqual(
      result.images.map((image) => image.label),
      ["context", "zoom"],
    );
    assert.equal(coerceVisualConfirmation("confirmed", userId), "confirmed");

    noteLiveCapturePoll(userId, layoutId);
    const started: Promise<unknown>[] = [];
    let peak = 0;
    const watch = setInterval(() => {
      peak = Math.max(peak, liveCaptureActiveCount());
    }, 10);
    for (let i = 0; i < 3; i++) {
      started.push(
        captureChartImage({
          userId,
          layoutId,
          symbol: "XAUUSD",
          interval: "15m",
          liveSession: true,
          ackTimeoutMs: 400,
        }),
      );
    }
    await Promise.all(started);
    clearInterval(watch);
    assert.ok(peak <= LIVE_CAPTURE_CONCURRENCY, `peak ${peak} exceeded cap`);
    assert.equal(liveCaptureActiveCount(), 0);
  });

  it("an upload that delivered only ONE shot is refused — missing_shots", async () => {
    noteLiveCapturePoll(userId, layoutId);
    const capture = captureChartImage({
      userId,
      layoutId,
      symbol: "XAUUSD",
      interval: "15m",
      liveSession: true,
      ackTimeoutMs: 2_000,
      uploadTimeoutMs: 2_000,
    });
    let pending = listPendingLiveCaptures(userId, layoutId);
    const deadline = Date.now() + 2_000;
    while (pending.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      pending = listPendingLiveCaptures(userId, layoutId);
    }
    assert.ok(pending.length >= 1);
    const requestId = pending[0]!.id;
    assert.equal(ackLiveCapture(userId, requestId), true);
    const single = completeLiveCapture({
      requestId,
      userId,
      layoutId,
      images: [{ label: "context", buffer: PNG }],
      drawingsRendered: 6,
      studiesRendered: 2,
    });
    assert.equal(single.ok, false);
    if (!single.ok) assert.equal(single.error, "missing_shots");
    const result = await capture;
    assert.deepEqual(result, { ok: false, reason: "missing_shots" });
    assert.equal(coerceVisualConfirmation("confirmed", userId), "not_checked");
  });

  it("empty upload rejects as upload_failed — no fallback image exists", async () => {
    noteLiveCapturePoll(userId, layoutId);
    const capture = captureChartImage({
      userId,
      layoutId,
      symbol: "XAUUSD",
      interval: "15m",
      liveSession: true,
      ackTimeoutMs: 2_000,
      uploadTimeoutMs: 2_000,
    });
    let pending = listPendingLiveCaptures(userId, layoutId);
    const deadline = Date.now() + 2_000;
    while (pending.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      pending = listPendingLiveCaptures(userId, layoutId);
    }
    assert.ok(pending.length >= 1);
    const requestId = pending[0]!.id;
    assert.equal(ackLiveCapture(userId, requestId), true);
    const empty = completeLiveCapture({
      requestId,
      userId,
      layoutId,
      images: [
        { label: "context", buffer: Buffer.alloc(0) },
        { label: "zoom", buffer: PNG },
      ],
      drawingsRendered: 6,
      studiesRendered: 2,
    });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.error, "upload_failed");
    const result = await capture;
    assert.deepEqual(result, { ok: false, reason: "upload_failed" });
    assert.equal(coerceVisualConfirmation("confirmed", userId), "not_checked");
  });

  it("upload timeout after ack is capture_timeout", async () => {
    noteLiveCapturePoll(userId, layoutId);
    const capture = captureChartImage({
      userId,
      layoutId,
      symbol: "XAUUSD",
      interval: "15m",
      liveSession: true,
      ackTimeoutMs: 2_000,
      uploadTimeoutMs: 80,
    });
    let pending = listPendingLiveCaptures(userId, layoutId);
    const deadline = Date.now() + 2_000;
    while (pending.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      pending = listPendingLiveCaptures(userId, layoutId);
    }
    assert.ok(pending.length >= 1);
    assert.equal(ackLiveCapture(userId, pending[0]!.id), true);
    const result = await capture;
    assert.deepEqual(result, { ok: false, reason: "capture_timeout" });
  });
});
