import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Persistent chat history: sessions and messages survive on the real SQLite
 * backend. Titles are not copied from the raw first user message; AI meta is
 * applied via updateChatMeta. Strictly scoped by userId.
 */
test("agent chat history store persists, loads, titles, and scopes chats", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lonora-chat-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["owner@test.com", "x", "user", "active"],
  );
  const attacker = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["attacker@test.com", "x", "user", "active"],
  );

  const store = await import("@/lib/agent/chatHistory/chatStore");

  // --- Session is created and listed ---
  const chat = await store.createChat({
    userId: owner,
    agentId: "lonora",
    symbol: "XAUUSD",
    interval: "15m",
    language: "ar",
  });
  assert.ok(chat.id, "chat has an id");
  assert.equal(chat.title, "محادثة جديدة", "starts with the default title");

  const list = await store.listChats(owner, "lonora");
  assert.equal(list.length, 1);
  assert.equal(list[0].id, chat.id);
  assert.equal(list[0].symbol, "XAUUSD");

  // --- Messages persist (user + assistant with references) ---
  const userMsg = await store.appendMessage(owner, chat.id, {
    agentId: "lonora",
    role: "user",
    content: "أعطني توصية جديدة على الذهب\nسريعًا",
    symbol: "XAUUSD",
    interval: "15m",
  });
  assert.ok(userMsg, "user message stored");

  const assistantMsg = await store.appendMessage(owner, chat.id, {
    agentId: "lonora",
    role: "assistant",
    content: "توصية شراء على الذهب.",
    result: { decision: "buy", summary: "توصية شراء على الذهب." },
    recommendationId: "rec-123",
    analysisId: "an-456",
    symbol: "XAUUSD",
    interval: "15m",
  });
  assert.ok(assistantMsg, "assistant message stored");

  // --- Old chat loads its messages in order, with references + result ---
  const messages = await store.getMessages(owner, chat.id, "lonora");
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].recommendationId, "rec-123");
  assert.equal(messages[1].analysisId, "an-456");
  assert.deepEqual(messages[1].result, {
    decision: "buy",
    summary: "توصية شراء على الذهب.",
  });

  // --- Raw first user message is NOT used as the title ---
  const reloaded = await store.getChat(owner, chat.id, "lonora");
  assert.equal(reloaded?.title, "محادثة جديدة");
  assert.notEqual(reloaded?.title, "أعطني توصية جديدة على الذهب");
  assert.ok(reloaded?.lastMessagePreview, "preview is set");

  // --- AI / fallback meta can be stored without breaking chat ---
  const withMeta = await store.updateChatMeta(owner, chat.id, "lonora", {
    title: "تحليل فرصة الذهب",
    hook: "انتظار عودة السعر إلى منطقة البيع",
  });
  assert.equal(withMeta?.title, "تحليل فرصة الذهب");
  assert.equal(withMeta?.lastMessagePreview, "انتظار عودة السعر إلى منطقة البيع");
  assert.equal(
    await store.updateChatMeta(attacker, chat.id, "lonora", {
      title: "leak",
      hook: "leak",
    }),
    null,
    "another tenant cannot update chat meta",
  );
  assert.equal((await store.getChat(owner, chat.id, "lonora"))?.title, "تحليل فرصة الذهب");

  // --- Strict user scoping: another tenant cannot read or append ---
  assert.equal(await store.getChat(attacker, chat.id, "lonora"), null);
  assert.equal((await store.getMessages(attacker, chat.id, "lonora")).length, 0);
  assert.equal(
    await store.appendMessage(attacker, chat.id, {
      agentId: "lonora",
      role: "user",
      content: "leak",
    }),
    null,
    "another tenant cannot append to the chat",
  );
  assert.equal(
    (await store.getMessages(owner, chat.id, "lonora")).length,
    2,
    "owner's messages are untouched by the attacker",
  );

  // --- New chat is a distinct, fresh session ---
  const chat2 = await store.createChat({ userId: owner, agentId: "lonora" });
  assert.notEqual(chat2.id, chat.id);
  const list2 = await store.listChats(owner, "lonora");
  assert.equal(list2.length, 2);
  // Most recently updated first: chat (had messages) leads chat2 only if newer;
  // ordering is by updated_at DESC, so the just-created chat2 leads.
  assert.equal(list2[0].id, chat2.id);
});

test("deriveChatTitle: first meaningful line, trimmed and capped", async () => {
  const { deriveChatTitle } = await import("@/lib/agent/chatHistory/chatStore");
  assert.equal(deriveChatTitle("  حلل الشارت الآن  "), "حلل الشارت الآن");
  assert.equal(deriveChatTitle("\n\nنص السطر الأول\nسطر ثانٍ"), "نص السطر الأول");
  assert.equal(deriveChatTitle(""), "محادثة جديدة");
  const long = "ا".repeat(80);
  const title = deriveChatTitle(long);
  assert.ok(title.length <= 48, "title is capped");
  assert.ok(title.endsWith("…"), "long title is ellipsized");
});

test("long histories stay bounded, deletion is tenant-scoped, and reopen restores context", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lonora-chat2-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["owner2@test.com", "x", "user", "active"],
  );
  const attacker = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["attacker2@test.com", "x", "user", "active"],
  );
  const store = await import("@/lib/agent/chatHistory/chatStore");

  const chat = await store.createChat({
    userId: owner,
    agentId: "lonora",
    symbol: "EURUSD",
    interval: "1h",
  });
  for (let i = 0; i < 60; i += 1) {
    await store.appendMessage(owner, chat.id, {
      agentId: "lonora",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
    });
  }

  // Pagination limit is respected and returns the MOST RECENT window in order.
  const limited = await store.getMessages(owner, chat.id, "lonora", 20);
  assert.equal(limited.length, 20);
  assert.equal(limited.at(-1)?.content, "message 59");
  assert.equal(limited[0]?.content, "message 40");

  // Reopen restores chart/session context on the chat record.
  const reopened = await store.getChat(owner, chat.id, "lonora");
  assert.equal(reopened?.symbol, "EURUSD");
  assert.equal(reopened?.interval, "1h");

  // Deletion: another tenant cannot delete; the owner can.
  assert.equal(await store.deleteChat(attacker, chat.id, "lonora"), false);
  assert.ok(await store.getChat(owner, chat.id, "lonora"), "chat survives foreign delete");
  assert.equal(await store.deleteChat(owner, chat.id, "lonora"), true);
  assert.equal(await store.getChat(owner, chat.id, "lonora"), null);
  assert.equal((await store.getMessages(owner, chat.id, "lonora")).length, 0);
});

/**
 * Composer Coach (Feature B): `pending_task_json` round-trip via
 * `setPendingTask` — the store never interprets the shape, just persists and
 * parses it back the same defensive way `result_json` is parsed for
 * messages.
 */
test("setPendingTask persists, clears, round-trips through getChat, and is tenant-scoped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lonora-chat-pending-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["pending-owner@test.com", "x", "user", "active"],
  );
  const attacker = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["pending-attacker@test.com", "x", "user", "active"],
  );
  const store = await import("@/lib/agent/chatHistory/chatStore");

  const chat = await store.createChat({ userId: owner, agentId: "quant_agent" });
  assert.equal(chat.pendingTask, undefined, "a fresh chat has no pending task");

  const task = {
    type: "generate_strategy_guided",
    step: 2,
    collected: { directionBias: "buy" },
  };
  const updated = await store.setPendingTask(owner, chat.id, "quant_agent", task);
  assert.deepEqual(updated?.pendingTask, task);

  const reloaded = await store.getChat(owner, chat.id, "quant_agent");
  assert.deepEqual(reloaded?.pendingTask, task, "pendingTask round-trips through getChat");

  // Clearing with null removes it.
  const cleared = await store.setPendingTask(owner, chat.id, "quant_agent", null);
  assert.equal(cleared?.pendingTask, undefined);

  // Tenant-scoped exactly like updateChatMeta: another user cannot write it.
  await store.setPendingTask(owner, chat.id, "quant_agent", task);
  assert.equal(
    await store.setPendingTask(attacker, chat.id, "quant_agent", { hijacked: true }),
    null,
    "another tenant cannot set the pending task",
  );
  const stillOwners = await store.getChat(owner, chat.id, "quant_agent");
  assert.deepEqual(stillOwners?.pendingTask, task, "the attacker's write never landed");
});

/**
 * Isolation: a Lonora session (`agentId: "lonora"`) is structurally unable to
 * read or write another session's `pending_task_json` through this store —
 * `setPendingTask`/`getChat` are scoped by user_id AND agent_id exactly like
 * every other chatStore function.
 */
test("a Lonora session is completely unaffected by Composer Coach's pending_task_json / setPendingTask", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lonora-chat-pending-isolation-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["lonora-isolation-owner@test.com", "x", "user", "active"],
  );
  const store = await import("@/lib/agent/chatHistory/chatStore");

  const lonoraChat = await store.createChat({ userId: owner, agentId: "lonora" });
  const quantChat = await store.createChat({ userId: owner, agentId: "quant_agent" });

  const task = { type: "generate_strategy_guided", step: 1, collected: {} };
  await store.setPendingTask(owner, quantChat.id, "quant_agent", task);

  // The Lonora chat never picked up the quant_agent chat's pending task —
  // it's a different row entirely.
  const reloadedLonora = await store.getChat(owner, lonoraChat.id, "lonora");
  assert.equal(reloadedLonora?.pendingTask, undefined);

  // Setting a pending task with the WRONG agentId ("lonora") against the
  // quant_agent chat's id is a no-op, never a cross-agent write.
  const crossWrite = await store.setPendingTask(owner, quantChat.id, "lonora", { hijacked: true });
  assert.equal(crossWrite, null, "setPendingTask refuses to write across the agent boundary");
  const stillIntact = await store.getChat(owner, quantChat.id, "quant_agent");
  assert.deepEqual(stillIntact?.pendingTask, task, "the quant_agent chat's pending task survives the cross-agent attempt");

  // A Lonora chat can itself carry a value in the column (it's structurally
  // just an unused column for Lonora, per plan) without it ever leaking into
  // any quant_agent read.
  await store.setPendingTask(owner, lonoraChat.id, "lonora", { unused: "column" });
  const quantAfter = await store.getChat(owner, quantChat.id, "quant_agent");
  assert.deepEqual(quantAfter?.pendingTask, task, "unrelated to the Lonora chat's own column value");
});
