import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-tg-adapter-"));
process.env.DB_PATH = join(dir, "adapter.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "adapter-test-secret";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.TELEGRAM_BOT_TOKEN;

let userId = 0;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["tg-adapter@example.com", "x", "user", "active"],
  );
});

describe("telegram channel adapter", () => {
  it("normalizes an inbound message into a valid resident user_message event", async () => {
    const { telegramUserMessageEvent } = await import(
      "@/lib/channels/telegram/adapter"
    );
    const { parseResidentEvent } = await import("@/lib/resident/events");
    const event = telegramUserMessageEvent({
      userId: 7,
      chatId: "4242",
      text: "كيف السوق؟",
      messageId: 55,
    });
    // The schema is the gate the resident host applies to every event; an
    // adapter emitting a shape it rejects would be dead on arrival.
    const parsed = parseResidentEvent(event);
    assert.equal(parsed.kind, "user_message");
    if (parsed.kind === "user_message") {
      assert.equal(parsed.userId, 7);
      assert.deepEqual(parsed.channel, { type: "telegram", id: "4242" });
      assert.equal(parsed.text, "كيف السوق؟");
      assert.equal(parsed.messageRef, "55");
    }
  });

  it("dedupes Telegram's redeliveries even when the first attempt failed", async () => {
    const { dispatchTelegramUpdate } = await import(
      "@/lib/channels/telegram/adapter"
    );
    const update = {
      update_id: 990_001,
      message: { message_id: 1, chat: { id: 555_001 }, text: "مرحبا" },
    };
    // Unlinked chat and no bot token configured: the link prompt cannot be
    // sent, and the adapter reports that failure instead of throwing at the
    // webhook (a non-200 would make Telegram redeliver forever).
    const first = await dispatchTelegramUpdate(update);
    assert.deepEqual(first, { kind: "handled", action: "failed" });
    const second = await dispatchTelegramUpdate(update);
    assert.deepEqual(second, { kind: "ignored", reason: "duplicate" });
  });

  it("ignores an update shape this channel does not answer", async () => {
    const { dispatchTelegramUpdate } = await import(
      "@/lib/channels/telegram/adapter"
    );
    const outcome = await dispatchTelegramUpdate({
      update_id: 990_002,
      message: { message_id: 2, chat: { id: 555_002 }, photo: [{}] },
    });
    assert.deepEqual(outcome, { kind: "ignored", reason: "unsupported_update" });
  });

  it("routes a queued telegram user_message to the full-parity presenter turn", async () => {
    const { MemoryBus } = await import("@/lib/resident/bus");
    const { ResidentHost } = await import("@/lib/resident/host");
    const { ResidentAgentRunner } = await import(
      "@/lib/resident/residentAgentRunner"
    );
    const calls: {
      userId: number;
      chatId: string;
      text: string;
      messageId?: number;
    }[] = [];
    const bus = new MemoryBus();
    const host = new ResidentHost({
      bus,
      runner: new ResidentAgentRunner({
        telegramTurn: async (input) => {
          calls.push(input);
          return "answered";
        },
      }),
      healthPort: null,
      maxUptimeMs: 0,
      sweepEveryMs: 0,
      candleSyncEveryMs: 0,
    });
    host.registerSender("telegram", { sendText: async () => {} });
    await host.start();
    await bus.publish({
      kind: "user_message",
      userId,
      channel: { type: "telegram", id: "888" },
      text: "حلل الذهب",
      messageRef: "3",
      enqueuedAt: Date.now(),
    });
    await bus.idle();
    await host.shutdown("test");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      userId,
      chatId: "888",
      text: "حلل الذهب",
      messageId: 3,
    });
  });
});
