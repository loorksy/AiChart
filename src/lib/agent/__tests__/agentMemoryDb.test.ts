import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("semantic memory metadata, keyword fallback, deletion and tenant isolation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-memory-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["memory-owner@test.com", "x", "user", "active"],
  );
  const other = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["memory-other@test.com", "x", "user", "active"],
  );
  const memory = await import("@/lib/semanticMemory");
  const inserted = await memory.insertSemanticMemory({
    userId: owner, category: "risk_preference", memoryType: "risk_preference",
    content: "I prefer one percent risk on XAUUSD", embedding: [1, 0],
    source: "explicit_user_preference", confidence: 0.9, locale: "en",
    symbol: "XAUUSD", timeframe: "15m", sourceChatId: "chat-1",
  });
  assert.equal(inserted.memory_type, "risk_preference");
  assert.equal(inserted.symbol, "XAUUSD");
  assert.equal(inserted.source_chat_id, "chat-1");
  assert.equal((await memory.searchSemanticMemoriesByKeyword(owner, "one percent XAUUSD", undefined, 5))[0]?.id, inserted.id);
  assert.equal((await memory.searchSemanticMemoriesByKeyword(other, "one percent XAUUSD", undefined, 5)).length, 0);
  assert.equal(await memory.archiveSemanticMemory(inserted.id, other), false);
  assert.equal(await memory.archiveSemanticMemory(inserted.id, owner), true);
});
