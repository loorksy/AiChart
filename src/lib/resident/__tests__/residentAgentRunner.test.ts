import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-runner-"));
process.env.DB_PATH = join(dir, "runner.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "runner-test-secret";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

let userId = 0;
let runnerMod: typeof import("@/lib/resident/residentAgentRunner");
let hostMod: typeof import("@/lib/resident/host");
let busMod: typeof import("@/lib/resident/bus");
let loopMod: typeof import("@/lib/resident/agentLoop");

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  runnerMod = await import("@/lib/resident/residentAgentRunner");
  hostMod = await import("@/lib/resident/host");
  busMod = await import("@/lib/resident/bus");
  loopMod = await import("@/lib/resident/agentLoop");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["runner@example.com", "x", "user", "active"],
  );
});

describe("resident agent runner", () => {
  it("answers a user_message end-to-end and persists both turns to the session", async () => {
    const fakeLoop: typeof loopMod.runAgentLoop = async (input) => {
      input.onTextDelta?.("جارٍ ");
      input.onTextDelta?.("التحليل…");
      return {
        text: "الذهب أعلى 4000 — الانحياز شراء.",
        steps: 2,
        toolCalls: [{ name: "read_candles", input: { timeframe: "4h" } }],
        finishReason: "stop",
      };
    };
    const bus = new busMod.MemoryBus();
    const host = new hostMod.ResidentHost({
      bus,
      runner: new runnerMod.ResidentAgentRunner({ loop: fakeLoop }),
      healthPort: null, maxUptimeMs: 0, sweepEveryMs: 0, candleSyncEveryMs: 0,
    });
    const sent: { text: string; replyTo?: string }[] = [];
    host.registerSender("telegram", {
      sendText: async (_c, text, opts) => {
        sent.push({ text, replyTo: opts?.replyTo });
      },
    });
    await host.start();
    await bus.publish({
      kind: "user_message",
      userId,
      channel: { type: "telegram", id: "777" },
      text: "حلّل الذهب",
      messageRef: "m9",
      enqueuedAt: Date.now(),
    });
    await bus.idle();
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.text, /الانحياز شراء/);
    assert.equal(sent[0]!.replyTo, "m9");

    // Both turns persisted under the user's session (cross-channel view).
    const { getRecentMessagesForUser } = await import("@/lib/agent/chatHistory/chatStore");
    const turns = await getRecentMessagesForUser(userId, {});
    const contents = turns.map((t) => t.content);
    assert.ok(contents.some((c) => c.includes("حلّل الذهب")));
    assert.ok(contents.some((c) => c.includes("الانحياز شراء")));

    // The channel is now bound to the user (channel !== session).
    const sessions = await import("@/lib/resident/sessions");
    assert.equal(await sessions.resolveChannel("telegram", "777"), userId);
    await host.shutdown("test");
  });

  it("reports a named limit failure to the user honestly and rethrows", async () => {
    const failingLoop: typeof loopMod.runAgentLoop = async () => {
      throw new loopMod.AgentIterationLimitError(12);
    };
    const bus = new busMod.MemoryBus();
    const host = new hostMod.ResidentHost({
      bus,
      runner: new runnerMod.ResidentAgentRunner({ loop: failingLoop }),
      healthPort: null, maxUptimeMs: 0, sweepEveryMs: 0, candleSyncEveryMs: 0,
    });
    const sent: string[] = [];
    host.registerSender("telegram", {
      sendText: async (_c, text) => {
        sent.push(text);
      },
    });
    await host.start();
    await bus.publish({
      kind: "user_message",
      userId,
      channel: { type: "telegram", id: "777" },
      text: "حلّل",
      enqueuedAt: Date.now(),
    });
    await bus.idle();
    // Memory bus retries once → two honest failure notices, zero fake answers.
    assert.ok(sent.length >= 1);
    assert.ok(sent.every((text) => text.includes("حد خطوات الأدوات")));
    const health = await host.health();
    assert.ok(health.events.failed >= 1, "the host counted the failure");
    await host.shutdown("test");
  });
});
