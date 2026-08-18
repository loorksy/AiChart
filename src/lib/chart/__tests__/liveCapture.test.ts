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
  resetLiveCaptureForTests,
  studiesIncludedFromCapture,
} from "@/lib/chart/liveCapture";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

describe("completeLiveCapture ownership", () => {
  afterEach(() => resetLiveCaptureForTests());

  it("rejects an upload whose user/layout does not own the pending request", async () => {
    const unknown = completeLiveCapture({
      requestId: "cap_missing",
      userId: 1,
      layoutId: "abcdefgh",
      buffer: PNG,
      drawingsRendered: 1,
      studiesRendered: 0,
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.error, "unknown_request");
  });
});

describe("capture fallbacks", () => {
  afterEach(() => resetLiveCaptureForTests());

  it("unattended liveSession=false is no_live_session with drawings_included false", async () => {
    const t0 = Date.now();
    const result = await captureChartImage({
      userId: 1,
      symbol: "XAUUSD",
      interval: "1h",
      liveSession: false,
    });
    assert.ok(Date.now() - t0 < 8_000);
    if (!result) return; // QuickChart may have no candles in this env
    assert.equal(result.image_source, "quickchart_fallback");
    assert.equal(result.fallback_reason, "no_live_session");
    assert.equal(result.drawings_included, false);
    assert.equal(result.studies_included, false);
    assert.equal(coerceVisualConfirmation("confirmed", 1), "not_checked");
  });

  it("invalid layout id is layout_not_found with drawings_included false", async () => {
    const result = await captureChartImage({
      userId: 1,
      layoutId: "nope!!!!",
      symbol: "XAUUSD",
      interval: "1h",
      liveSession: true,
    });
    if (!result) return;
    assert.equal(result.image_source, "quickchart_fallback");
    assert.equal(result.fallback_reason, "layout_not_found");
    assert.equal(result.drawings_included, false);
  });

  it("missing layout row is layout_not_found", async () => {
    const result = await captureChartImage({
      userId: 1,
      layoutId: "AbCdEfGh",
      symbol: "XAUUSD",
      interval: "1h",
      liveSession: true,
    });
    if (!result) return;
    assert.equal(result.fallback_reason, "layout_not_found");
    assert.equal(result.drawings_included, false);
  });
});

describe("live capture round trip, ownership, fallbacks, concurrency", () => {
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

  it("accepts a TradingView PNG, reports drawings actually rendered, and caps concurrency at 2", async () => {
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
    const requestId = pending[0]!.id;
    assert.equal(ackLiveCapture(userId, requestId), true);

    const owned = completeLiveCapture({
      requestId,
      userId: userId + 99,
      layoutId,
      buffer: PNG,
      drawingsRendered: 6,
      studiesRendered: 2,
    });
    assert.equal(owned.ok, false);
    if (!owned.ok) assert.equal(owned.error, "layout_not_owned");

    const wrongLayout = completeLiveCapture({
      requestId,
      userId,
      layoutId: "ZzZzZzZz",
      buffer: PNG,
      drawingsRendered: 6,
      studiesRendered: 2,
    });
    assert.equal(wrongLayout.ok, false);

    const ok = completeLiveCapture({
      requestId,
      userId,
      layoutId,
      buffer: PNG,
      drawingsRendered: 6,
      studiesRendered: 2,
    });
    assert.equal(ok.ok, true);

    const result = await capture;
    assert.ok(result);
    assert.equal(result.image_source, "tradingview_capture");
    assert.equal(result.drawings_included, true);
    assert.equal(result.studies_included, true);
    assert.equal(result.fallback_reason, undefined);
    assert.equal(coerceVisualConfirmation("confirmed", userId), "confirmed");

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

  it("empty upload rejects as upload_failed and drawings_included is false", async () => {
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
      buffer: Buffer.alloc(0),
      drawingsRendered: 6,
      studiesRendered: 2,
    });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.error, "upload_failed");
    const result = await capture;
    if (!result) return;
    assert.equal(result.image_source, "quickchart_fallback");
    assert.equal(result.fallback_reason, "upload_failed");
    assert.equal(result.drawings_included, false);
    assert.equal(coerceVisualConfirmation("confirmed", userId), "not_checked");
  });

  it("upload timeout after ack is capture_timeout", async () => {
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
    if (!result) return;
    assert.equal(result.image_source, "quickchart_fallback");
    assert.equal(result.fallback_reason, "capture_timeout");
    assert.equal(result.drawings_included, false);
  });
});
