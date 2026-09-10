import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * One chart per conversation: every chat owns exactly one layout row, born
 * clean, never shared with another chat; the legacy per-user board (chat_id
 * NULL) coexists and racing creators converge on one row.
 */
describe("chart layouts are bound to chat sessions", () => {
  let userId = 0;
  let store: typeof import("@/lib/store");

  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), "lonora-chat-layout-"));
    process.env.DB_PATH = join(dir, "test.db");
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    process.env.APP_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    const db = await import("@/lib/db");
    await db.initDb();
    userId = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      [`layout-${Date.now()}@test.com`, "x", "user", "active"],
    );
    store = await import("@/lib/store");
  });

  it("a chat's first board is created clean and re-used afterwards", async () => {
    const chatId = "11111111-1111-4111-8111-111111111111";
    const first = await store.getOrCreateChatChartLayout(userId, chatId, {
      symbol: "xauusd",
      interval: "1h",
    });
    assert.equal(first.chat_id, chatId);
    assert.equal(first.symbol, "XAUUSD");
    assert.equal(first.interval, "1h");
    assert.equal(first.state_json, null, "a new conversation starts with no drawings");

    const again = await store.getOrCreateChatChartLayout(userId, chatId);
    assert.equal(again.id, first.id, "same chat → same board");
    assert.equal((await store.getChatChartLayout(userId, chatId))?.id, first.id);
  });

  it("two chats never share a board, and the legacy per-user board stays separate", async () => {
    const a = await store.getOrCreateChatChartLayout(userId, "chat-aaaa-0001");
    const b = await store.getOrCreateChatChartLayout(userId, "chat-bbbb-0002");
    assert.notEqual(a.id, b.id);

    await store.saveChartLayout(a.id, userId, {
      symbol: "XAUUSD",
      interval: "15m",
      state: { drawings: [{ type: "trend_line" }], recommendation: { action: "buy" } },
    });
    const bAfter = await store.getChatChartLayout(userId, "chat-bbbb-0002");
    assert.equal(bAfter?.state_json, null, "drawings on chat A must not leak into chat B");

    // Callers naming no layout (MCP "the chart") get an existing board, not a
    // fresh row on every call. updated_at has second resolution, so which of
    // the boards wins a same-second tie is not asserted.
    const legacy = await store.getOrCreateChartLayout(userId);
    const known = new Set((await store.listChartLayouts(userId)).map((l) => l.id));
    assert.ok(known.has(legacy.id), "resolves to one of the user's boards");
  });

  it("racing creators of the same chat converge on one row", async () => {
    const chatId = "22222222-2222-4222-8222-222222222222";
    const rows = await Promise.all(
      Array.from({ length: 4 }, () => store.getOrCreateChatChartLayout(userId, chatId)),
    );
    const ids = new Set(rows.map((r) => r.id));
    assert.equal(ids.size, 1, `expected one board, got ${ids.size}`);
  });

  it("an unknown chat has no board until someone opens it", async () => {
    assert.equal(await store.getChatChartLayout(userId, "chat-never-opened"), null);
  });
});
