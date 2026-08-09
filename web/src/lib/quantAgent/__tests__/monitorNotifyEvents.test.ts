import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * `dispatchMonitorNotification` is the single choke point for a monitor fire,
 * so this covers the three things that must hold there and nowhere else.
 *
 * No transport is stubbed. With no Telegram bot configured and no push keys —
 * the state a fresh test database is in — the real `deliverSignal` and
 * `sendPushToUser` both report a genuine failure, which is exactly the case
 * the feature exists for: **a failed send must still leave a queryable
 * record.** Mocking those two out would have tested the happy path only, and
 * the happy path was never the problem.
 */
async function freshDb(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.TELEGRAM_BOT_TOKEN;
  const db = await import("@/lib/db");
  await db.initDb();
  return db;
}

const PAYLOAD = {
  title: "Quant Agent monitor — XAUUSD (1h)",
  text: "Quant Agent monitor\nXAUUSD · 1h",
  symbol: "XAUUSD",
  recommendationId: "rec-1",
  interval: "1h",
  direction: "sell" as const,
  entry: 2410.5,
  stopLoss: 2425,
  takeProfit: null,
};

test("a fire whose Telegram send fails still leaves a queryable signal event", async () => {
  const db = await freshDb("qa-notify-events-");
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["notify-events@test.com", "x", "user", "active"],
  );

  const monitors = await import("@/lib/quantAgent/monitorStore");
  const events = await import("@/lib/quantAgent/signalEventStore");
  const { dispatchMonitorNotification } = await import("@/lib/quantAgent/monitorNotify");

  const monitor = await monitors.createMonitor(owner, {
    symbol: "XAUUSD",
    interval: "1h",
    notifyTelegram: true,
    notifyPush: true,
  });

  const outcome = await dispatchMonitorNotification(owner, monitor, PAYLOAD);
  assert.equal(outcome.telegram, false, "no bot is configured in a fresh database");
  assert.equal(outcome.push, false);
  assert.equal(outcome.webhook, null, "no webhook URL on this monitor => never attempted");
  assert.equal(outcome.suppressed, null, "the fire was allowed");
  assert.ok(outcome.eventId, "the fire was recorded even though nothing was delivered");

  const stored = await events.getSignalEvent(owner, outcome.eventId!);
  assert.ok(stored, "the record survives a total delivery failure");
  assert.equal(stored!.decision, "SELL", "direction 'sell' becomes decision SELL");
  assert.equal(stored!.stopLoss, 2425);
  assert.equal(stored!.entryPrice, 2410.5);
  assert.equal(stored!.takeProfit, null);
  assert.equal(stored!.recommendationId, "rec-1");
  assert.equal(stored!.fireRule, "always");
  assert.equal(stored!.delivered, false);
  assert.equal(stored!.delivery.telegram.status, "failed");
  assert.ok(stored!.delivery.telegram.error, "the failure carries a reason");
  assert.equal(stored!.delivery.push.status, "failed");
  assert.equal(
    stored!.delivery.webhook.status,
    "skipped",
    "a channel that was never switched on is 'skipped', not 'failed'",
  );

  // The monitor now remembers what it fired, which is what `on_change` reads.
  const reread = await monitors.getMonitor(owner, monitor.id);
  assert.equal(reread!.lastFiredDecision, "SELL");
});

test("the same condition inside one bar delivers once; a changed call is not a duplicate", async () => {
  const db = await freshDb("qa-notify-dedupe-");
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["notify-dedupe@test.com", "x", "user", "active"],
  );

  const monitors = await import("@/lib/quantAgent/monitorStore");
  const events = await import("@/lib/quantAgent/signalEventStore");
  const { dispatchMonitorNotification } = await import("@/lib/quantAgent/monitorNotify");

  const monitor = await monitors.createMonitor(owner, { symbol: "XAUUSD", interval: "1h" });
  // Pin the bar so the assertion cannot straddle an hour boundary.
  const barTime = events.barBucketStart("1h", Date.UTC(2026, 0, 2, 10, 0, 0));

  const first = await dispatchMonitorNotification(owner, monitor, { ...PAYLOAD, barTime });
  assert.equal(first.suppressed, null);
  assert.ok(first.eventId);

  // A second sweep inside the same bar with the same call. Re-read the monitor
  // so it carries the decision the first fire recorded, exactly as the cron
  // would on its next tick.
  const afterFirst = await monitors.getMonitor(owner, monitor.id);
  const second = await dispatchMonitorNotification(owner, afterFirst!, {
    ...PAYLOAD,
    barTime,
    recommendationId: "rec-2",
  });
  assert.equal(second.suppressed, "duplicate");
  assert.equal(second.eventId, null);
  assert.equal(second.telegram, false);

  // A real change of call inside the same bar is a different condition.
  const third = await dispatchMonitorNotification(owner, afterFirst!, {
    ...PAYLOAD,
    barTime,
    direction: "buy",
    stopLoss: 2390,
    recommendationId: "rec-3",
  });
  assert.equal(third.suppressed, null, "SELL -> BUY inside one bar is news");
  assert.ok(third.eventId);

  const page = await events.listSignalEvents(owner);
  assert.equal(page.items.length, 2, "two fires, not three");
  assert.deepEqual(
    page.items.map((item) => item.decision).sort(),
    ["BUY", "SELL"],
  );
});

test("an on_change monitor stays silent on an unchanged call and records nothing", async () => {
  const db = await freshDb("qa-notify-onchange-");
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["notify-onchange@test.com", "x", "user", "active"],
  );

  const monitors = await import("@/lib/quantAgent/monitorStore");
  const events = await import("@/lib/quantAgent/signalEventStore");
  const { dispatchMonitorNotification } = await import("@/lib/quantAgent/monitorNotify");

  const monitor = await monitors.createMonitor(owner, {
    symbol: "XAUUSD",
    interval: "1h",
    fireRule: "on_change",
  });

  // First fire always goes out — there is no previous call to differ from.
  const first = await dispatchMonitorNotification(owner, monitor, {
    ...PAYLOAD,
    barTime: events.barBucketStart("1h", Date.UTC(2026, 0, 2, 10, 0, 0)),
  });
  assert.equal(first.suppressed, null);

  // Next BAR, same call: `always` would fire, `on_change` must not.
  const afterFirst = await monitors.getMonitor(owner, monitor.id);
  assert.equal(afterFirst!.lastFiredDecision, "SELL");
  const second = await dispatchMonitorNotification(owner, afterFirst!, {
    ...PAYLOAD,
    barTime: events.barBucketStart("1h", Date.UTC(2026, 0, 2, 11, 0, 0)),
  });
  assert.equal(second.suppressed, "unchanged");
  assert.equal(second.eventId, null);

  // Next bar, the call changes.
  const third = await dispatchMonitorNotification(owner, afterFirst!, {
    ...PAYLOAD,
    direction: "buy",
    stopLoss: 2390,
    barTime: events.barBucketStart("1h", Date.UTC(2026, 0, 2, 12, 0, 0)),
  });
  assert.equal(third.suppressed, null, "HOLD/SELL -> BUY is what on_change is for");

  const page = await events.listSignalEvents(owner);
  assert.equal(page.items.length, 2, "the suppressed fire is not an event");
  assert.equal(page.items[0]!.decision, "BUY");
  assert.equal(page.items[0]!.previousDecision, "SELL", "the change itself is recorded");
  assert.equal(page.items[0]!.fireRule, "on_change");
});
