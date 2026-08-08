import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * "AI Scheduled Monitors" store: real SQLite backend (same convention as
 * `agent/chatHistory/__tests__/chatStore.test.ts`). Covers CRUD, per-user
 * scoping, and the cron sweep's own cross-tenant grouping query.
 */
test("monitor store: creates, updates, deletes, and scopes strictly by user", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-monitors-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["monitor-owner@test.com", "x", "user", "active"],
  );
  const other = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["monitor-other@test.com", "x", "user", "active"],
  );

  const store = await import("@/lib/quantAgent/monitorStore");

  // --- Create with defaults ---
  const monitor = await store.createMonitor(owner, { symbol: "xauusd", interval: "1h" });
  assert.equal(monitor.symbol, "XAUUSD");
  assert.equal(monitor.market, "forex");
  assert.equal(monitor.interval, "1h");
  assert.equal(monitor.notifyTelegram, true, "telegram defaults on");
  assert.equal(monitor.notifyPush, false, "push defaults off");
  assert.equal(monitor.notifyWebhookUrl, null);
  assert.equal(monitor.enabled, true);
  assert.equal(monitor.lastFiredRecommendationId, null);
  assert.equal(monitor.lastCheckedAt, null);

  const list = await store.listMonitors(owner);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, monitor.id);

  // --- Strict per-user scoping ---
  assert.equal((await store.listMonitors(other)).length, 0);
  assert.equal(await store.getMonitor(other, monitor.id), null, "another tenant cannot read it");
  assert.equal(
    await store.updateMonitor(other, monitor.id, { enabled: false }),
    null,
    "another tenant cannot update it",
  );
  assert.equal(await store.deleteMonitor(other, monitor.id), false, "another tenant cannot delete it");

  // --- Update: partial patch only touches given fields ---
  const updated = await store.updateMonitor(owner, monitor.id, {
    notifyPush: true,
    notifyWebhookUrl: "https://example.com/hook",
  });
  assert.ok(updated);
  assert.equal(updated!.notifyPush, true);
  assert.equal(updated!.notifyWebhookUrl, "https://example.com/hook");
  assert.equal(updated!.notifyTelegram, true, "untouched field is preserved");
  assert.equal(updated!.interval, "1h", "untouched field is preserved");

  // --- markMonitorFired / touchMonitorChecked ---
  const checkedAt = Date.now();
  await store.touchMonitorChecked(monitor.id, checkedAt);
  let reread = await store.getMonitor(owner, monitor.id);
  assert.equal(reread!.lastCheckedAt, checkedAt);
  assert.equal(reread!.lastFiredRecommendationId, null, "checking alone does not mark fired");

  const firedAt = checkedAt + 1;
  await store.markMonitorFired(monitor.id, "rec-123", firedAt);
  reread = await store.getMonitor(owner, monitor.id);
  assert.equal(reread!.lastFiredRecommendationId, "rec-123");
  assert.equal(reread!.lastCheckedAt, firedAt);

  // --- Delete ---
  assert.equal(await store.deleteMonitor(owner, monitor.id), true);
  assert.equal(await store.getMonitor(owner, monitor.id), null);
  assert.equal(await store.deleteMonitor(owner, monitor.id), false, "deleting again is a no-op false");
});

test("monitor store: cross-tenant grouping for the cron sweep", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-monitors-group-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const userA = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["group-a@test.com", "x", "user", "active"],
  );
  const userB = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["group-b@test.com", "x", "user", "active"],
  );

  const store = await import("@/lib/quantAgent/monitorStore");

  // Two different users watching the SAME (symbol, market, interval) — must
  // collapse into one group so the cron sweep only fetches candles once.
  const m1 = await store.createMonitor(userA, { symbol: "XAUUSD", interval: "1h" });
  const m2 = await store.createMonitor(userB, { symbol: "XAUUSD", interval: "1h" });
  // A different interval on the same symbol is its own group.
  const m3 = await store.createMonitor(userA, { symbol: "XAUUSD", interval: "15m" });
  // A disabled monitor must never appear in the sweep's groups at all.
  const m4 = await store.createMonitor(userB, { symbol: "EURUSD", interval: "1h" });
  await store.updateMonitor(userB, m4.id, { enabled: false });

  const groups = await store.listEnabledMonitorsGroupedBySymbolInterval();
  assert.equal(groups.length, 2, "two distinct (symbol, market, interval) groups");

  const xau1h = groups.find((g) => g.symbol === "XAUUSD" && g.interval === "1h");
  assert.ok(xau1h, "XAUUSD/1h group exists");
  assert.equal(xau1h!.market, "forex");
  assert.equal(xau1h!.monitors.length, 2, "both users' monitors are in the same group");
  assert.deepEqual(
    xau1h!.monitors.map((m) => m.id).sort((a, b) => a - b),
    [m1.id, m2.id].sort((a, b) => a - b),
  );

  const xau15m = groups.find((g) => g.symbol === "XAUUSD" && g.interval === "15m");
  assert.ok(xau15m, "XAUUSD/15m is a separate group from XAUUSD/1h");
  assert.equal(xau15m!.monitors.length, 1);
  assert.equal(xau15m!.monitors[0]!.id, m3.id);

  const eurGroup = groups.find((g) => g.symbol === "EURUSD");
  assert.equal(eurGroup, undefined, "disabled monitor's group is excluded entirely");
});
