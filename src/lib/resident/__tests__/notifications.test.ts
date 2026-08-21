import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-notify-"));
process.env.DB_PATH = join(dir, "notify.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "notify-test-secret";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

import type { LifecycleEvent } from "@/lib/recommendations/lifecycleEvents";

let userId = 0;

const activationEvent = (over: Partial<LifecycleEvent> = {}): LifecycleEvent => ({
  type: "activated",
  recommendationId: "rec-77",
  symbol: "XAUUSD",
  revisionNo: 1,
  dedupeKey: "rec-77:1:activated",
  detail: "XAUUSD: تفعّلت الخطة بعد إغلاق ساعة فوق 4005.",
  terminal: false,
  occurredAt: Date.now(),
  ...over,
});

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["notify@example.com", "x", "user", "active"],
  );
  const { bindChannel } = await import("@/lib/resident/sessions");
  await bindChannel("telegram", "chat-notify-9", userId);
});

describe("proactive notifications", () => {
  it("acceptance: a simulated activation fires exactly one notification", async () => {
    const { MemoryBus } = await import("@/lib/resident/bus");
    const { ResidentHost } = await import("@/lib/resident/host");
    const { ResidentAgentRunner } = await import(
      "@/lib/resident/residentAgentRunner"
    );
    const { lifecycleToMarketEvent } = await import(
      "@/lib/resident/notifications"
    );

    const sent: { channelId: string; text: string }[] = [];
    const bus = new MemoryBus();
    const host = new ResidentHost({
      bus,
      runner: new ResidentAgentRunner(),
      healthPort: null,
      maxUptimeMs: 0,
      sweepEveryMs: 0,
      candleSyncEveryMs: 0,
    });
    host.registerSender("telegram", {
      sendText: async (channel, text) => {
        sent.push({ channelId: channel.id, text });
      },
    });
    await host.start();

    const event = lifecycleToMarketEvent(userId, activationEvent());
    assert.ok(event, "an activation is part of the push vocabulary");
    await bus.publish(event!);
    await bus.idle();

    assert.equal(sent.length, 1, "the activation notified exactly once");
    assert.equal(sent[0]!.channelId, "chat-notify-9");
    // The notification traces to the specific market event that caused it.
    assert.match(sent[0]!.text, /XAUUSD/);
    assert.match(sent[0]!.text, /rec-77/);
    assert.match(sent[0]!.text, /activated/);
    assert.match(sent[0]!.text, /تفعّلت/);

    // Redelivery of the SAME event (queue retry, second sweep observing the
    // same transition) stays silent — the claim is persisted, not in-memory.
    await bus.publish(lifecycleToMarketEvent(userId, activationEvent())!);
    await bus.idle();
    assert.equal(sent.length, 1, "the duplicate was suppressed");
    await host.shutdown("test");
  });

  it("honors per-user preferences per category", async () => {
    const {
      deliverMarketEventNotification,
      getNotificationPrefs,
      lifecycleToMarketEvent,
      setNotificationPrefs,
    } = await import("@/lib/resident/notifications");

    // Defaults: everything on.
    const defaults = await getNotificationPrefs(userId);
    assert.deepEqual(defaults, {
      activation: true,
      target: true,
      invalidation: true,
      news_block: true,
    });

    const updated = await setNotificationPrefs(userId, { target: false });
    assert.equal(updated.target, false);
    assert.equal(updated.activation, true);

    const sent: string[] = [];
    const ctx = {
      sender: () => ({
        sendText: async (_c: unknown, text: string) => {
          sent.push(text);
        },
      }),
    };

    const muted = await deliverMarketEventNotification(
      lifecycleToMarketEvent(
        userId,
        activationEvent({
          type: "tp1_hit",
          dedupeKey: "rec-77:1:tp1_hit",
          detail: "الهدف الأول تحقق.",
        }),
      )!,
      ctx,
    );
    assert.equal(muted.outcome, "skipped_prefs");
    assert.equal(sent.length, 0);

    const heard = await deliverMarketEventNotification(
      lifecycleToMarketEvent(
        userId,
        activationEvent({
          type: "sl_hit",
          dedupeKey: "rec-77:1:sl_hit",
          detail: "ضرب وقف الخسارة.",
          terminal: true,
        }),
      )!,
      ctx,
    );
    assert.equal(heard.outcome, "delivered");
    assert.equal(sent.length, 1);
    await setNotificationPrefs(userId, { target: true });
  });

  it("keeps ledger-only lifecycle events out of the push vocabulary", async () => {
    const { lifecycleToMarketEvent, categoryForLifecycleEvent } = await import(
      "@/lib/resident/notifications"
    );
    for (const type of [
      "reevaluation_confirmed",
      "opportunity_created",
      "approaching_entry",
      "entry_updated",
    ] as const) {
      assert.equal(categoryForLifecycleEvent(type), null);
      assert.equal(
        lifecycleToMarketEvent(userId, activationEvent({ type, dedupeKey: `x:${type}` })),
        null,
      );
    }
    assert.equal(categoryForLifecycleEvent("economic_event_near"), "news_block");
  });

  it("rejects a market_event with no traceable lifecycle payload — named error", async () => {
    const { deliverMarketEventNotification, MarketEventPayloadError } =
      await import("@/lib/resident/notifications");
    await assert.rejects(
      deliverMarketEventNotification(
        {
          kind: "market_event",
          event: "activated",
          symbol: "XAUUSD",
          userId,
          enqueuedAt: Date.now(),
        },
        { sender: () => ({ sendText: async () => {} }) },
      ),
      (err: Error) => err instanceof MarketEventPayloadError,
    );
  });

  it("publishes only the notifiable subset of sweep events, schema-valid", async () => {
    const { publishLifecycleNotifications } = await import(
      "@/lib/resident/notifications"
    );
    const { parseResidentEvent } = await import("@/lib/resident/events");
    const published: unknown[] = [];
    const count = await publishLifecycleNotifications(
      [
        { userId, event: activationEvent({ dedupeKey: "pub:1" }) },
        {
          userId,
          event: activationEvent({
            type: "reevaluation_confirmed",
            dedupeKey: "pub:2",
          }),
        },
        {
          userId,
          event: activationEvent({
            type: "invalidated",
            dedupeKey: "pub:3",
            terminal: true,
          }),
        },
      ],
      async (event) => {
        // Every published event must survive the host's own boundary parse.
        parseResidentEvent(event);
        published.push(event);
        return "id";
      },
    );
    assert.equal(count, 2, "the reevaluation stayed ledger-only");
    assert.equal(published.length, 2);
  });
});
