import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Watchlist store: real SQLite backend (same convention as
 * `agent/chatHistory/__tests__/chatStore.test.ts`). Covers add/list/remove,
 * idempotent re-adds, and strict per-user scoping.
 */
test("watchlist store: adds, lists, dedupes, and scopes strictly by user", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-watchlist-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["watchlist-owner@test.com", "x", "user", "active"],
  );
  const other = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["watchlist-other@test.com", "x", "user", "active"],
  );

  const store = await import("@/lib/quantAgent/watchlistStore");

  // --- Add + normalize ---
  const item = await store.addToWatchlist(owner, " xauusd ");
  assert.equal(item.symbol, "XAUUSD", "symbol is trimmed and uppercased");
  assert.equal(item.market, "forex");
  assert.equal(item.userId, owner);

  const list = await store.listWatchlist(owner);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.symbol, "XAUUSD");

  // --- Idempotent re-add: no duplicate row ---
  const again = await store.addToWatchlist(owner, "XAUUSD");
  assert.equal(again.id, item.id, "re-adding the same symbol returns the existing row");
  assert.equal((await store.listWatchlist(owner)).length, 1, "no duplicate row was created");

  // --- A second symbol is a distinct row, most-recent first ---
  await store.addToWatchlist(owner, "EURUSD");
  const list2 = await store.listWatchlist(owner);
  assert.equal(list2.length, 2);
  assert.equal(list2[0]!.symbol, "EURUSD", "most recently added is first");

  // --- Strict per-user scoping ---
  assert.equal((await store.listWatchlist(other)).length, 0, "another tenant sees nothing");
  assert.equal(
    await store.removeFromWatchlist(other, item.id),
    false,
    "another tenant cannot remove someone else's watchlist row",
  );
  assert.equal((await store.listWatchlist(owner)).length, 2, "owner's rows are untouched by the attempt");

  // --- Owner can remove their own row ---
  assert.equal(await store.removeFromWatchlist(owner, item.id), true);
  assert.equal((await store.listWatchlist(owner)).length, 1);
  assert.equal(await store.removeFromWatchlist(owner, item.id), false, "removing again is a no-op false");
});
