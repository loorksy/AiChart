/**
 * Delivery rules for lifecycle events, against a real database.
 *
 * The property that matters is not "does it send" — it is "does it stay quiet
 * when nothing happened". A sweep runs every few minutes forever, so a notifier
 * that re-announces an unchanged state is worse than silence: the operator
 * learns to ignore the channel, and then misses the stop-out.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import type { LifecycleEvent } from "@/lib/recommendations/lifecycleEvents";

const dir = mkdtempSync(join(tmpdir(), "aichart-notifier-"));
process.env.DB_PATH = join(dir, "notifier.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "notifier-test-secret";
delete process.env.DATABASE_URL;
// No Telegram token in tests: delivery is gated and logged, which is exactly
// the path we want to exercise — dedupe must not depend on a send succeeding.
delete process.env.TELEGRAM_BOT_TOKEN;

let userId = 0;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["notifier@example.com", "x", "user", "active"],
  );
});

function event(over: Partial<LifecycleEvent> = {}): LifecycleEvent {
  return {
    type: "activated",
    recommendationId: "rec-1",
    symbol: "XAUUSD",
    revisionNo: 1,
    dedupeKey: "rec-1:1:activated",
    detail: "تحقق شرط التفعيل.",
    terminal: false,
    occurredAt: Date.now(),
    ...over,
  };
}

describe("lifecycle notifications", () => {
  it("announces a change once and stays silent on re-sweeps", async () => {
    const { notifyLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleNotifier"
    );
    const first = await notifyLifecycleEvents(userId, [event()]);
    assert.equal(first.delivered, 1);

    const second = await notifyLifecycleEvents(userId, [event()]);
    assert.equal(second.delivered, 0);
    assert.equal(second.suppressedDuplicate, 1);
  });

  it("treats the same event on a new revision as a new thing to say", async () => {
    const { notifyLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleNotifier"
    );
    const result = await notifyLifecycleEvents(userId, [
      event({
        recommendationId: "rec-2",
        revisionNo: 2,
        dedupeKey: "rec-2:2:approaching_entry",
        type: "approaching_entry",
      }),
    ]);
    assert.equal(result.delivered, 1);
  });

  it("groups simultaneous changes to one plan into a single message", async () => {
    const { notifyLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleNotifier"
    );
    const result = await notifyLifecycleEvents(userId, [
      event({ recommendationId: "rec-3", dedupeKey: "rec-3:1:activated" }),
      event({
        recommendationId: "rec-3",
        dedupeKey: "rec-3:1:approaching_invalidation",
        type: "approaching_invalidation",
      }),
    ]);
    // Two real changes, one message.
    assert.equal(result.delivered, 1);
  });

  it("records without sending in silent mode", async () => {
    const { notifyLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleNotifier"
    );
    const silent = await notifyLifecycleEvents(
      userId,
      [event({ recommendationId: "rec-4", dedupeKey: "rec-4:1:activated" })],
      { silent: true },
    );
    assert.equal(silent.delivered, 0);
    assert.equal(silent.suppressedSilent, 1);

    // The key was still claimed, so leaving silent mode does not replay history.
    const after = await notifyLifecycleEvents(userId, [
      event({ recommendationId: "rec-4", dedupeKey: "rec-4:1:activated" }),
    ]);
    assert.equal(after.delivered, 0);
    assert.equal(after.suppressedDuplicate, 1);
  });

  it("caps chatter per symbol but never drops a terminal event", async () => {
    const { notifyLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleNotifier"
    );
    for (let i = 0; i < 8; i++) {
      await notifyLifecycleEvents(userId, [
        event({
          recommendationId: `noisy-${i}`,
          symbol: "EURUSD",
          dedupeKey: `noisy-${i}:1:approaching_entry`,
          type: "approaching_entry",
        }),
      ]);
    }
    const noisy = await notifyLifecycleEvents(userId, [
      event({
        recommendationId: "noisy-9",
        symbol: "EURUSD",
        dedupeKey: "noisy-9:1:approaching_entry",
        type: "approaching_entry",
      }),
    ]);
    assert.equal(noisy.delivered, 0);
    assert.equal(noisy.suppressedRateLimit, 1);

    // "Your stop was hit" is never rationed away.
    const stopped = await notifyLifecycleEvents(userId, [
      event({
        recommendationId: "noisy-9",
        symbol: "EURUSD",
        dedupeKey: "noisy-9:1:sl_hit",
        type: "sl_hit",
        terminal: true,
      }),
    ]);
    assert.equal(stopped.delivered, 1);
  });

  it("does nothing at all for an empty sweep", async () => {
    const { notifyLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleNotifier"
    );
    const result = await notifyLifecycleEvents(userId, []);
    assert.deepEqual(result, {
      delivered: 0,
      suppressedDuplicate: 0,
      suppressedRateLimit: 0,
      suppressedSilent: 0,
    });
  });
});
