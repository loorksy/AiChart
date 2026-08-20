import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-sessions-"));
process.env.DB_PATH = join(dir, "sessions.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "sessions-test-secret";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

let userId = 0;
let otherUserId = 0;
let sessions: typeof import("@/lib/resident/sessions");
let chatStore: typeof import("@/lib/agent/chatHistory/chatStore");

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  sessions = await import("@/lib/resident/sessions");
  chatStore = await import("@/lib/agent/chatHistory/chatStore");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["session-owner@example.com", "x", "user", "active"],
  );
  otherUserId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["session-other@example.com", "x", "user", "active"],
  );
  // Legacy telegram link (pre-bindings) for the fallback test.
  await db.execute(
    `INSERT INTO trading_settings (user_id, telegram_chat_id) VALUES (?, ?)
     ON CONFLICT (user_id) DO UPDATE SET telegram_chat_id = excluded.telegram_chat_id`,
    [userId, "tg-legacy-777"],
  );
});

describe("channel bindings", () => {
  it("maps two different channels to the same user", async () => {
    await sessions.bindChannel("telegram", "chat-100", userId);
    await sessions.bindChannel("web", String(userId), userId);
    assert.equal(await sessions.resolveChannel("telegram", "chat-100"), userId);
    assert.equal(await sessions.resolveChannel("web", String(userId)), userId);
    const bindings = await sessions.listChannelBindings(userId);
    assert.ok(bindings.some((b) => b.channelType === "telegram" && b.channelId === "chat-100"));
    assert.ok(bindings.some((b) => b.channelType === "web"));
  });

  it("heals an unbound telegram chat from the legacy link and persists the binding", async () => {
    assert.equal(await sessions.resolveChannel("telegram", "tg-legacy-777"), userId);
    // Second resolve hits the binding row, not the legacy fallback.
    const db = await import("@/lib/db");
    const row = await db.queryOne<{ user_id: number }>(
      "SELECT user_id FROM channel_bindings WHERE channel_type = 'telegram' AND channel_id = ?",
      ["tg-legacy-777"],
    );
    assert.equal(Number(row?.user_id), userId);
  });

  it("refuses unknown identities", async () => {
    assert.equal(await sessions.resolveChannel("telegram", "never-seen"), null);
    assert.equal(await sessions.resolveChannel("web", "999999"), null);
    assert.equal(await sessions.resolveChannel("carrier-pigeon", "coop-1"), null);
  });
});

describe("one session across channels", () => {
  it("continues a web conversation on telegram with full context", async () => {
    // Web thread…
    const webChat = await chatStore.createChat({ userId, title: "ويب" });
    await chatStore.appendMessage(userId, webChat.id, {
      role: "user",
      content: "أريد خطة على الذهب فريم ساعة، وسمِّها خطة أوميغا",
    });
    await chatStore.appendMessage(userId, webChat.id, {
      role: "assistant",
      content: "حسناً — خطة أوميغا: شراء فوق 4000 بهدف 4020.",
    });
    // …then, an hour later in wall-clock terms, a telegram thread.
    await chatStore.ensureChat({ id: "tg:555", userId, title: "تليجرام" });
    const context = await sessions.buildSessionConversationContext({
      userId,
      sessionId: "tg:555",
      userMessage: "ما وضع خطة أوميغا التي ذكرتها؟",
      locale: "ar",
    });
    const joined = context.messages.map((m) => m.content).join("\n");
    assert.match(joined, /خطة أوميغا/, "the web turn is visible from telegram");
    assert.match(joined, /4000/, "the web plan levels are visible from telegram");
  });

  it("keeps sessions strictly per-user", async () => {
    const context = await sessions.buildSessionConversationContext({
      userId: otherUserId,
      sessionId: "tg:999",
      userMessage: "مرحبا",
      locale: "ar",
    });
    const joined = context.messages.map((m) => m.content).join("\n");
    assert.doesNotMatch(joined, /خطة أوميغا/, "another user's turns never leak in");
  });
});

describe("rolling summarization", () => {
  it("stays verbatim below the threshold", async () => {
    const result = await sessions.maybeSummarizeResidentSession(otherUserId, {
      summarize: async () => "unused",
    });
    assert.deepEqual(result, { folded: 0, reason: "below_threshold" });
  });

  it("folds older turns into a summary and keeps the recent tail verbatim", async () => {
    const chat = await chatStore.createChat({ userId: otherUserId, title: "long" });
    for (let i = 0; i < 50; i++) {
      await chatStore.appendMessage(otherUserId, chat.id, {
        role: i % 2 ? "assistant" : "user",
        content: `turn-${i} ${i === 3 ? "الكلمة-المفتاحية-القديمة" : ""}`,
      });
    }
    let sawPrevious: string | null = "unset";
    const result = await sessions.maybeSummarizeResidentSession(otherUserId, {
      summarize: async ({ previousSummary, turns }) => {
        sawPrevious = previousSummary;
        return `ملخص ${turns.length} أدوار سابقة (يشمل الكلمة-المفتاحية-القديمة)`;
      },
    });
    assert.ok("folded" in result && result.folded === 50 - sessions.KEEP_VERBATIM_TURNS);
    assert.equal(sawPrevious, null);

    const session = await sessions.getResidentSession(otherUserId);
    assert.ok(session.summary!.includes("الكلمة-المفتاحية-القديمة"));
    assert.ok(session.summaryThroughMs > 0);

    // The context now carries the summary instead of the folded turns…
    const context = await sessions.buildSessionConversationContext({
      userId: otherUserId,
      sessionId: chat.id,
      userMessage: "متابعة",
      locale: "ar",
    });
    const summaryMessage = context.messages.find((m) => m.kind === "summary");
    assert.ok(summaryMessage, "summary message present");
    assert.match(summaryMessage!.content, /الكلمة-المفتاحية-القديمة/);
    const joined = context.messages.map((m) => m.content).join("\n");
    assert.doesNotMatch(joined, /turn-3 /, "folded turns are not re-sent verbatim");
    assert.match(joined, /turn-49/, "the recent tail stays verbatim");
  });

  it("defers without losing anything when the summarizer fails", async () => {
    const beforeSession = await sessions.getResidentSession(otherUserId);
    const chat = await chatStore.createChat({ userId: otherUserId, title: "more" });
    for (let i = 0; i < 45; i++) {
      await chatStore.appendMessage(otherUserId, chat.id, {
        role: i % 2 ? "assistant" : "user",
        content: `late-${i}`,
      });
    }
    const result = await sessions.maybeSummarizeResidentSession(otherUserId, {
      summarize: async () => {
        throw new Error("llm down");
      },
    });
    assert.deepEqual(result, { folded: 0, reason: "summarizer_failed" });
    const after = await sessions.getResidentSession(otherUserId);
    assert.equal(after.summaryThroughMs, beforeSession.summaryThroughMs);
    assert.equal(after.summary, beforeSession.summary);
  });
});
