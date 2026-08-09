/**
 * Pins the seam the reported bug lived in: `trackOneRecommendation` MUST pass
 * the stored activation rule to the evaluator AND move the live execution
 * state when the market satisfies it.
 *
 * The field case: a conditional XAUUSD SELL (entry 4348.27, stop 4360.78,
 * TP1 4316.80) whose condition — a wick through 4348.27 then a 15m close
 * below it — was met live, yet the card stayed "بانتظار التفعيل" forever.
 * Two stacked defects caused that: the tracker dropped `activationRule` at
 * the call site (the evaluator degraded to a bare entry touch, but nothing
 * was triggered because status never moved), and NOTHING ever wrote
 * `execution_state` after creation. Both are asserted here at the
 * trackOneRecommendation level — testing `evaluateRecommendation` directly
 * cannot catch either.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { trackedCompletePlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";
import type { ActivationRule } from "@/lib/recommendations/activationRule";

function candle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
) {
  return { time, open, high, low, close, volume: 100, complete: true };
}

test("tracker activation seam: rule gates the fill, execution state goes live", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lonora-activation-seam-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["activation@seam.com", "x", "user", "active"],
  );

  const store = await import("@/lib/recommendations/recommendationStore");
  const { trackOneRecommendation } = await import(
    "@/lib/recommendations/recommendationTracker"
  );
  const { upsertCandles } = await import("@/lib/candles/candleRepository");

  const bar = 15 * 60_000;
  // Recent past: the tracker grades expiry against the real clock, so a
  // historical epoch would read as "expired" before the rule is ever tested.
  const createdCandleTime = Date.now() - 20 * bar;
  const rejectionRule: ActivationRule = {
    kind: "rejection_confirmed",
    level: 4348.27,
    direction: "below",
    timeframe: "15m",
  };

  await store.createTrackedRecommendation({
    ...trackedCompletePlan({ planType: "conditional" }),
    activationRule: rejectionRule,
    triggerCondition:
      "يتفعّل البيع بعد اختراق 4348.27 بظل ثم إغلاق شمعة 15 دقيقة تحته.",
    id: "xau-sell-1",
    userId,
    chatId: "c1",
    symbol: "XAUUSD",
    interval: "15m",
    direction: "sell",
    entryType: "pending",
    entry: 4348.27,
    stopLoss: 4360.78,
    targets: [4316.8, 4297.97],
    invalidationLevel: 4360.78,
    status: "pending_entry",
    outcome: "pending",
    createdAt: createdCandleTime,
    createdCandleTime,
    expiresAt: createdCandleTime + 48 * 3600_000,
  });

  // Phase 1 — price grazes the entry WITHOUT satisfying the rule: a wick
  // through 4348.27 that CLOSES ABOVE it. Pre-fix, this bare touch filled the
  // sell; the rule demands a close back below.
  await upsertCandles("XAUUSD", "15m", [
    candle(createdCandleTime + 1 * bar, 4344, 4349.5, 4343, 4349.1),
  ]);
  let tracked = await store.getTrackedRecommendation(userId, "xau-sell-1");
  assert.ok(tracked);
  let result = await trackOneRecommendation(tracked);
  assert.equal(result.recommendation?.status, "pending_entry");
  assert.equal(
    result.recommendation?.executionState,
    "awaiting_activation",
    "a touch that fails the rule must leave the plan awaiting activation",
  );

  // Phase 2 — the stated condition happens: wick through the level, 15m close
  // back BELOW it (rejection confirmed), and the same candle reaches the entry.
  await upsertCandles("XAUUSD", "15m", [
    candle(createdCandleTime + 2 * bar, 4349, 4352, 4341, 4344.2),
    candle(createdCandleTime + 3 * bar, 4344, 4345, 4330, 4332),
  ]);
  tracked = await store.getTrackedRecommendation(userId, "xau-sell-1");
  assert.ok(tracked);
  assert.ok(tracked.activationRule, "the stored rule must survive the read path");
  result = await trackOneRecommendation(tracked);
  assert.equal(result.recommendation?.status, "triggered");
  assert.equal(
    result.recommendation?.executionState,
    "valid_now",
    "a satisfied condition must move the LIVE execution state — the card badge reads it",
  );
  assert.ok(
    result.events.some((event) => event.type === "activated"),
    "activation must be announced",
  );

  // The state survives a fresh read: the row, not the append-only revision,
  // is the live authority.
  const reread = await store.getTrackedRecommendation(userId, "xau-sell-1");
  assert.equal(reread?.executionState, "valid_now");
  assert.equal(reread?.status, "triggered");
});

test("tracker activation seam: a rule naming its own timeframe is graded on it", async () => {
  // 5m plan, 15m close-below rule: the 5m series closes below the level long
  // before any 15m candle does. Grading the rule on 5m candles would activate
  // a condition the operator never stated.
  const db = await import("@/lib/db");
  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["activation2@seam.com", "x", "user", "active"],
  );

  const store = await import("@/lib/recommendations/recommendationStore");
  const { trackOneRecommendation } = await import(
    "@/lib/recommendations/recommendationTracker"
  );
  const { upsertCandles } = await import("@/lib/candles/candleRepository");

  const bar5 = 5 * 60_000;
  const bar15 = 15 * 60_000;
  const createdCandleTime = Date.now() - 20 * bar15;
  const level = 2000;

  await store.createTrackedRecommendation({
    ...trackedCompletePlan({ planType: "conditional" }),
    activationRule: {
      kind: "candle_close_below",
      level,
      timeframe: "15m",
    },
    triggerCondition: "إغلاق شمعة 15 دقيقة تحت 2000.",
    id: "cross-tf-1",
    userId,
    chatId: "c2",
    symbol: "EURUSD",
    interval: "5m",
    direction: "sell",
    entryType: "pending",
    entry: 1999.5,
    stopLoss: 2006,
    targets: [1990, 1982],
    invalidationLevel: 2006,
    status: "pending_entry",
    outcome: "pending",
    createdAt: createdCandleTime,
    createdCandleTime,
    expiresAt: createdCandleTime + 48 * 3600_000,
  });

  // 5m candles: dip below the level and touch the entry — but the only
  // COMPLETE 15m candle in the warehouse closes back ABOVE it.
  await upsertCandles("EURUSD", "5m", [
    candle(createdCandleTime + 1 * bar5, 2001, 2001.5, 1998.8, 1999.2),
    candle(createdCandleTime + 2 * bar5, 1999.2, 2002, 1999, 2001.6),
    candle(createdCandleTime + 3 * bar5, 2001.6, 2002.2, 2000.8, 2002),
  ]);
  await upsertCandles("EURUSD", "15m", [
    candle(createdCandleTime + bar15, 2001, 2002.2, 1998.8, 2002),
  ]);

  let tracked = await store.getTrackedRecommendation(userId, "cross-tf-1");
  assert.ok(tracked);
  let result = await trackOneRecommendation(tracked);
  assert.equal(
    result.recommendation?.status,
    "pending_entry",
    "5m closes below the level must NOT satisfy a 15m close rule",
  );

  // Now a real 15m close below, then a 5m candle after that close reaches the entry.
  await upsertCandles("EURUSD", "15m", [
    candle(createdCandleTime + 2 * bar15, 2002, 2002.5, 1997, 1998.1),
  ]);
  await upsertCandles("EURUSD", "5m", [
    candle(createdCandleTime + 2 * bar15 + 0 * bar5, 2002, 2002.5, 1999, 1999.6),
    candle(createdCandleTime + 2 * bar15 + 1 * bar5, 1999.6, 2000.4, 1997, 1998.1),
    candle(createdCandleTime + 3 * bar15, 1998.1, 1999.8, 1996, 1997),
  ]);

  tracked = await store.getTrackedRecommendation(userId, "cross-tf-1");
  assert.ok(tracked);
  result = await trackOneRecommendation(tracked);
  assert.equal(result.recommendation?.status, "triggered");
  assert.equal(result.recommendation?.executionState, "valid_now");
});
