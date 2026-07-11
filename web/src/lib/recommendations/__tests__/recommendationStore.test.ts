import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Tracked recommendations persist, list, update, and cancel on the real SQLite
 * backend and are strictly tenant-scoped. One setup drives all assertions.
 */
test("tracked recommendation store: create/list/update/cancel + tenant isolation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lonora-rec-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["owner@rec.com", "x", "user", "active"],
  );
  const attacker = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["attacker@rec.com", "x", "user", "active"],
  );

  const store = await import("@/lib/recommendations/recommendationStore");
  const now = Date.now();

  const created = await store.createTrackedRecommendation({
    id: "rec-1",
    userId: owner,
    chatId: "chat-1",
    symbol: "XAUUSD",
    interval: "15m",
    direction: "buy",
    entryType: "market",
    entry: 100,
    stopLoss: 98,
    targets: [102, 104, 106],
    status: "triggered",
    outcome: "pending",
    setupType: "scalp",
    rr: 2,
    createdAt: now,
    createdCandleTime: now,
    expiresAt: now + 3600_000,
    triggeredAt: now,
  });
  assert.equal(created.id, "rec-1");
  assert.deepEqual(created.targets, [102, 104, 106]);

  // list (owner)
  const list = await store.listTrackedRecommendations(owner);
  assert.equal(list.length, 1);
  assert.equal(list[0].setupType, "scalp");

  // tenant isolation
  assert.equal(await store.getTrackedRecommendation(attacker, "rec-1"), null);
  assert.equal((await store.listTrackedRecommendations(attacker)).length, 0);

  // active list
  const active = await store.listActiveTrackedRecommendations({ userId: owner });
  assert.equal(active.length, 1);

  // update status → terminal
  const updated = await store.updateTrackedRecommendation(owner, "rec-1", {
    status: "tp3_hit",
    outcome: "win_tp3",
    tp1HitAt: now + 60_000,
    tp2HitAt: now + 120_000,
    tp3HitAt: now + 180_000,
  });
  assert.equal(updated?.outcome, "win_tp3");
  // no longer active
  assert.equal((await store.listActiveTrackedRecommendations({ userId: owner })).length, 0);

  // cancel a terminal record → stays terminal (win_tp3, not cancelled)
  const cancelTerminal = await store.cancelTrackedRecommendation(owner, "rec-1");
  assert.equal(cancelTerminal?.outcome, "win_tp3");

  // cancel a pending record
  await store.createTrackedRecommendation({
    id: "rec-2",
    userId: owner,
    symbol: "EURUSD",
    interval: "1h",
    direction: "sell",
    entryType: "limit",
    entry: 1.1,
    stopLoss: 1.12,
    targets: [1.08],
    status: "pending_entry",
    outcome: "pending",
    createdAt: now,
    createdCandleTime: now,
    expiresAt: now + 3600_000,
  });
  const cancelled = await store.cancelTrackedRecommendation(owner, "rec-2");
  assert.equal(cancelled?.outcome, "cancelled");
  assert.equal(cancelled?.status, "cancelled");

  // attacker cannot cancel owner's record
  assert.equal(await store.cancelTrackedRecommendation(attacker, "rec-1"), null);
});
