import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Persistent signal history: real SQLite backend (same convention as
 * `monitorStore.test.ts`).
 *
 * The two properties worth pinning are the ones the feature is FOR:
 *  - the row exists BEFORE delivery, so a failed send is still queryable;
 *  - the claim is the delivery lock, so the same condition firing twice in one
 *    bar produces exactly one row and therefore exactly one delivery.
 */
async function freshDb(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  const db = await import("@/lib/db");
  await db.initDb();
  return db;
}

test("signal events: claim writes a row before delivery, dedupes per bar, and scopes by user", async () => {
  const db = await freshDb("qa-signal-events-");
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["signal-owner@test.com", "x", "user", "active"],
  );
  const other = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["signal-other@test.com", "x", "user", "active"],
  );

  const monitors = await import("@/lib/quantAgent/monitorStore");
  const store = await import("@/lib/quantAgent/signalEventStore");
  const monitor = await monitors.createMonitor(owner, { symbol: "XAUUSD", interval: "1h" });

  const firedAt = Date.UTC(2026, 0, 2, 10, 17, 30);
  const barTime = store.barBucketStart("1h", firedAt);
  assert.equal(barTime, Date.UTC(2026, 0, 2, 10, 0, 0), "1h bar bucket is the top of the hour");

  const claim = await store.claimSignalEvent(owner, {
    monitorId: monitor.id,
    symbol: "XAUUSD",
    interval: "1h",
    decision: "SELL",
    direction: "sell",
    entryPrice: 2410.5,
    stopLoss: 2425,
    takeProfit: null,
    confidence: 71,
    rationale: "EMA cross down with ADX confirmation",
    fireRule: "always",
    previousDecision: null,
    recommendationId: "rec-1",
    firedAt,
  });
  assert.equal(claim.claimed, true);
  assert.ok(claim.claimed && claim.event);
  const event = claim.claimed ? claim.event : null;
  assert.ok(event);

  // --- The row exists BEFORE any channel was touched, with nothing claimed
  //     as delivered.
  const stored = await store.getSignalEvent(owner, event!.id);
  assert.ok(stored);
  assert.equal(stored!.decision, "SELL");
  assert.equal(stored!.direction, "sell");
  assert.equal(stored!.entryPrice, 2410.5);
  assert.equal(stored!.stopLoss, 2425);
  assert.equal(stored!.takeProfit, null, "an absent target stays absent, never 0");
  assert.equal(stored!.confidence, 71);
  assert.equal(stored!.monitorId, monitor.id);
  assert.equal(stored!.fireRule, "always");
  assert.equal(stored!.recommendationId, "rec-1");
  assert.equal(stored!.barTime, barTime);
  assert.equal(stored!.delivered, false);
  assert.deepEqual(stored!.delivery, {
    telegram: { status: "skipped" },
    push: { status: "skipped" },
    webhook: { status: "skipped" },
  });

  // --- Same condition, same bar, later in the hour: no second row.
  const duplicate = await store.claimSignalEvent(owner, {
    monitorId: monitor.id,
    symbol: "XAUUSD",
    interval: "1h",
    decision: "SELL",
    direction: "sell",
    stopLoss: 2425,
    fireRule: "always",
    recommendationId: "rec-2",
    firedAt: firedAt + 20 * 60_000,
  });
  assert.equal(duplicate.claimed, false, "a second fire inside the same bar is a duplicate");
  assert.equal(duplicate.claimed === false && duplicate.reason, "duplicate");

  // --- A genuinely different decision in the SAME bar is a different tuple
  //     and does get recorded.
  const changed = await store.claimSignalEvent(owner, {
    monitorId: monitor.id,
    symbol: "XAUUSD",
    interval: "1h",
    decision: "BUY",
    direction: "buy",
    stopLoss: 2390,
    fireRule: "on_change",
    previousDecision: "SELL",
    firedAt: firedAt + 25 * 60_000,
  });
  assert.equal(changed.claimed, true, "SELL -> BUY inside one bar is not a duplicate");

  // --- The next bar re-opens the same decision.
  const nextBar = await store.claimSignalEvent(owner, {
    monitorId: monitor.id,
    symbol: "XAUUSD",
    interval: "1h",
    decision: "SELL",
    direction: "sell",
    stopLoss: 2425,
    fireRule: "always",
    firedAt: firedAt + 60 * 60_000,
  });
  assert.equal(nextBar.claimed, true, "a new bar may fire the same decision again");

  // --- A failed send still leaves a queryable record.
  await store.recordSignalEventDelivery(event!.id, {
    telegram: { status: "failed", error: "telegram_not_linked" },
    push: { status: "skipped" },
    webhook: { status: "delivered" },
  });
  const afterDelivery = await store.getSignalEvent(owner, event!.id);
  assert.equal(afterDelivery!.delivery.telegram.status, "failed");
  assert.equal(afterDelivery!.delivery.telegram.error, "telegram_not_linked");
  assert.equal(afterDelivery!.delivery.webhook.status, "delivered");
  assert.equal(afterDelivery!.delivered, true, "delivered is derived from the channel map");

  await store.recordSignalEventDelivery(event!.id, {
    telegram: { status: "failed", error: "telegram_not_linked" },
    push: { status: "failed", error: "push_not_configured" },
    webhook: { status: "skipped" },
  });
  const allFailed = await store.getSignalEvent(owner, event!.id);
  assert.equal(allFailed!.delivered, false, "no channel delivered => delivered is false");
  assert.ok(allFailed, "the record survives a total delivery failure");

  // --- Strict per-user scoping.
  assert.equal(await store.getSignalEvent(other, event!.id), null, "another tenant cannot read it");
  const otherPage = await store.listSignalEvents(other);
  assert.equal(otherPage.items.length, 0);
});

test("signal events: newest-first keyset pagination and filters", async () => {
  const db = await freshDb("qa-signal-events-list-");
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["signal-list@test.com", "x", "user", "active"],
  );

  const monitors = await import("@/lib/quantAgent/monitorStore");
  const store = await import("@/lib/quantAgent/signalEventStore");
  const xau = await monitors.createMonitor(owner, { symbol: "XAUUSD", interval: "1h" });
  const eur = await monitors.createMonitor(owner, { symbol: "EURUSD", interval: "1h" });

  const base = Date.UTC(2026, 0, 5, 0, 0, 0);
  for (let i = 0; i < 5; i += 1) {
    const claim = await store.claimSignalEvent(owner, {
      monitorId: i % 2 === 0 ? xau.id : eur.id,
      symbol: i % 2 === 0 ? "XAUUSD" : "EURUSD",
      interval: "1h",
      decision: i % 2 === 0 ? "BUY" : "SELL",
      direction: i % 2 === 0 ? "buy" : "sell",
      stopLoss: 100 + i,
      fireRule: "always",
      firedAt: base + i * 3_600_000,
    });
    assert.equal(claim.claimed, true, `claim ${i}`);
  }

  const first = await store.listSignalEvents(owner, { limit: 2 });
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  assert.ok(
    new Date(first.items[0]!.createdAt).getTime() >= new Date(first.items[1]!.createdAt).getTime(),
    "newest first",
  );

  const second = await store.listSignalEvents(owner, { limit: 2, cursor: first.nextCursor });
  const firstIds = new Set(first.items.map((item) => item.id));
  assert.ok(
    second.items.every((item) => !firstIds.has(item.id)),
    "the second page shares no rows with the first",
  );

  const buys = await store.listSignalEvents(owner, { decision: "BUY" });
  assert.equal(buys.items.length, 3);
  assert.ok(buys.items.every((item) => item.decision === "BUY"));

  const eurOnly = await store.listSignalEvents(owner, { monitorId: eur.id });
  assert.equal(eurOnly.items.length, 2);
  assert.ok(eurOnly.items.every((item) => item.symbol === "EURUSD"));

  const bySymbol = await store.listSignalEvents(owner, { symbol: "XAUUSD" });
  assert.equal(bySymbol.items.length, 3);
});
