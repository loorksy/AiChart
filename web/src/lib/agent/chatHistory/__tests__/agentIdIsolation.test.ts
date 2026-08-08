import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";

/**
 * `agent_id` schema expansion (agent_chats/agent_chat_messages): the
 * foundational, highest-risk step of adding a second chat-capable agent
 * (Quant Agent) alongside Lonora.
 *
 * Covers:
 *  (a) a pre-migration-shaped Lonora row (no agent_id column yet, simulating
 *      an old database) survives schema init and comes back as 'lonora'.
 *  (b) chats created under different agentIds never leak into each other's
 *      listChats().
 *  (c) getChat / appendMessage / deleteChat / updateChatMeta called with the
 *      WRONG agentId for an existing chatId are a no-op (null/false), never
 *      a cross-agent read or write — even though the chatId is valid and the
 *      userId is the real owner.
 *
 * All three sub-tests intentionally live in ONE file/process: `@/lib/db`
 * memoizes `initDb()` per module instance (see chatStore.test.ts), so the
 * pre-migration simulation below must be the very first thing that touches
 * the sqlite file — before `@/lib/db` is ever imported in this process.
 */

const dir = mkdtempSync(join(tmpdir(), "aichart-agentid-"));
const dbPath = join(dir, "test.db");
process.env.DB_PATH = dbPath;
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "test-secret";
delete process.env.DATABASE_URL;

// --- Simulate an old database: create agent_chats in its PRE-agent_id shape
// and insert a row directly, before initDb()/the schema pass ever runs. The
// real migration path is PRAGMA table_info + conditional ALTER TABLE ADD
// COLUMN ... DEFAULT 'lonora', which SQLite backfills onto existing rows —
// so this row's agent_id is "implicit via the column default", never set here.
const LEGACY_CHAT_ID = "legacy-chat-pre-migration";
const LEGACY_USER_ID = 987654;
{
  const raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE agent_chats (
      id                   TEXT PRIMARY KEY,
      user_id              INTEGER NOT NULL,
      title                TEXT NOT NULL DEFAULT 'محادثة جديدة',
      symbol               TEXT,
      interval             TEXT,
      language             TEXT NOT NULL DEFAULT 'ar',
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      last_message_preview TEXT
    )
  `);
  raw
    .prepare(
      `INSERT INTO agent_chats
         (id, user_id, title, symbol, interval, language, created_at, updated_at, last_message_preview)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      LEGACY_CHAT_ID,
      LEGACY_USER_ID,
      "محادثة قديمة",
      "XAUUSD",
      "15m",
      "ar",
      Date.now(),
      Date.now(),
      null,
    );
  raw.close();
}

test("pre-migration Lonora chat row survives schema init, defaults to agent_id='lonora', and is isolated from quant_agent", async () => {
  // First touch of @/lib/db in this process: runs SCHEMA (agent_chats already
  // exists, so CREATE TABLE IF NOT EXISTS is a no-op) then migrate(), which
  // must detect the missing column and ALTER TABLE ADD COLUMN agent_id.
  const db = await import("@/lib/db");
  await db.initDb();

  const store = await import("@/lib/agent/chatHistory/chatStore");

  // Backfilled to the default — the pre-migration row is unmodified data.
  const lonoraList = await store.listChats(LEGACY_USER_ID, "lonora");
  assert.equal(lonoraList.length, 1, "legacy row is returned under lonora");
  assert.equal(lonoraList[0]!.id, LEGACY_CHAT_ID);
  assert.equal(lonoraList[0]!.agentId, "lonora");
  assert.equal(lonoraList[0]!.symbol, "XAUUSD", "other columns are untouched by the migration");

  // The same row must never surface under the new agent's scope.
  const quantList = await store.listChats(LEGACY_USER_ID, "quant_agent");
  assert.equal(quantList.length, 0, "legacy lonora row does not leak into quant_agent's list");

  const viaLonora = await store.getChat(LEGACY_USER_ID, LEGACY_CHAT_ID, "lonora");
  assert.ok(viaLonora, "getChat succeeds with the matching agentId");
  const viaQuant = await store.getChat(LEGACY_USER_ID, LEGACY_CHAT_ID, "quant_agent");
  assert.equal(viaQuant, null, "getChat returns null across the agent boundary");
});

test("chats created under different agentIds for the same user never appear in each other's listChats", async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  const store = await import("@/lib/agent/chatHistory/chatStore");

  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["agentid-owner@test.com", "x", "user", "active"],
  );

  const lonoraChat = await store.createChat({ userId: owner, agentId: "lonora" });
  const quantChat = await store.createChat({ userId: owner, agentId: "quant_agent" });
  assert.notEqual(lonoraChat.id, quantChat.id);
  assert.equal(lonoraChat.agentId, "lonora");
  assert.equal(quantChat.agentId, "quant_agent");

  const lonoraList = await store.listChats(owner, "lonora");
  assert.ok(lonoraList.some((c) => c.id === lonoraChat.id), "lonora list has the lonora chat");
  assert.ok(
    !lonoraList.some((c) => c.id === quantChat.id),
    "lonora list never contains the quant_agent chat",
  );

  const quantList = await store.listChats(owner, "quant_agent");
  assert.ok(quantList.some((c) => c.id === quantChat.id), "quant_agent list has the quant_agent chat");
  assert.ok(
    !quantList.some((c) => c.id === lonoraChat.id),
    "quant_agent list never contains the lonora chat",
  );
});

test("getChat/getMessages/appendMessage/updateChatMeta/deleteChat with the WRONG agentId are a no-op, never a cross-agent read or write", async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  const store = await import("@/lib/agent/chatHistory/chatStore");

  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["agentid-boundary@test.com", "x", "user", "active"],
  );

  const chat = await store.createChat({ userId: owner, agentId: "lonora" });
  const stored = await store.appendMessage(owner, chat.id, {
    agentId: "lonora",
    role: "user",
    content: "سؤال حقيقي على المحادثة الصحيحة",
  });
  assert.ok(stored, "message stored under the correct agentId");

  // --- Reads across the boundary: null / empty, never the real data ---
  assert.equal(
    await store.getChat(owner, chat.id, "quant_agent"),
    null,
    "getChat refuses the wrong agentId even for the real owner",
  );
  assert.equal(
    (await store.getMessages(owner, chat.id, "quant_agent")).length,
    0,
    "getMessages returns nothing across the agent boundary",
  );

  // --- Writes across the boundary: no-op, and nothing new appears in either scope ---
  const crossAppend = await store.appendMessage(owner, chat.id, {
    agentId: "quant_agent",
    role: "user",
    content: "quant_agent trying to write into a lonora chatId",
  });
  assert.equal(crossAppend, null, "appendMessage refuses to write across the agent boundary");

  const crossMeta = await store.updateChatMeta(owner, chat.id, "quant_agent", {
    title: "hijacked title",
    hook: "hijacked hook",
  });
  assert.equal(crossMeta, null, "updateChatMeta refuses to write across the agent boundary");

  const crossDelete = await store.deleteChat(owner, chat.id, "quant_agent");
  assert.equal(crossDelete, false, "deleteChat refuses to delete across the agent boundary");

  // --- The chat and its message are completely untouched by the above ---
  const stillThere = await store.getChat(owner, chat.id, "lonora");
  assert.ok(stillThere, "chat survives every cross-agent attempt");
  assert.notEqual(stillThere!.title, "hijacked title");
  const messages = await store.getMessages(owner, chat.id, "lonora");
  assert.equal(messages.length, 1, "no cross-agent message was actually inserted");
  assert.equal(messages[0]!.content, "سؤال حقيقي على المحادثة الصحيحة");

  // --- The correct agentId can still delete it (proves the no-op above was
  // scoping, not a broken deleteChat) ---
  assert.equal(await store.deleteChat(owner, chat.id, "lonora"), true);
  assert.equal(await store.getChat(owner, chat.id, "lonora"), null);
});
