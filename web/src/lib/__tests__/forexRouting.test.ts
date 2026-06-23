import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * End-to-end execution routing: a user's saved forex_backend choice must drive
 * which broker a newly created forex intent targets — so EA users execute via
 * the EA bridge and "platform" users via the server-side MT5 bridge, on the
 * same deployment.
 */
test("createIntent routes forex broker by the user's forex_backend choice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-fx-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  process.env.MT5_BRIDGE_URL = "http://mt5.local"; // mt5local available
  delete process.env.FOREX_BACKEND;
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const store = await import("@/lib/store");

  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["fx@test.com", "x", "user", "active"],
  );
  await store.getSettings(userId); // materialize default settings row

  // Choice: server-side platform → mt5_local broker.
  await store.updateSettings(userId, { forex_backend: "mt5local" });
  const platformIntent = await store.createIntent(userId, {
    symbol: "EURUSD",
    side: "buy",
    notional: 100,
    market: "forex",
    status: "pending",
  });
  assert.equal(platformIntent.broker, "mt5_local");

  // Choice: EA bridge on the user's device → mt_ea broker.
  await store.updateSettings(userId, { forex_backend: "ea" });
  const eaIntent = await store.createIntent(userId, {
    symbol: "EURUSD",
    side: "buy",
    notional: 100,
    market: "forex",
    status: "pending",
  });
  assert.equal(eaIntent.broker, "mt_ea");

  // Crypto always routes to binance regardless of forex choice.
  const cryptoIntent = await store.createIntent(userId, {
    symbol: "BTCUSDT",
    side: "buy",
    notional: 100,
    market: "crypto",
    status: "pending",
  });
  assert.equal(cryptoIntent.broker, "binance");
});
