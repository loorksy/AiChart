import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * End-to-end paper lifecycle of a grid bot through the engine + DB: seed → add a
 * Martingale level on an adverse move → bank the basket at take-profit. Proves
 * the state machine, persistence, and realized-PnL accounting work together.
 */
test("grid bot paper lifecycle: open → grid_add → take_profit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-bot-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.BOTS_LIVE_ENABLED; // paper

  const db = await import("@/lib/db");
  await db.initDb();
  const { createBotSession, getBotSession } = await import("@/lib/botStore");
  const { runBotTick } = await import("@/lib/botEngine");

  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["bot@test.com", "x", "user", "active"],
  );

  let bot = await createBotSession(userId, {
    strategy: "grid",
    symbol: "XAUUSD",
    market: "forex",
    side: "sell",
    executionMode: "paper",
    config: {
      side: "sell",
      initialLot: 0.01,
      gridStep: 2,
      multiplier: 2,
      takeProfit: 1,
      maxLevels: 5,
      maxTotalLot: 1,
      lotStep: 0.01,
    },
  });

  // Tick 1 — empty basket → first order at 100.
  let ev = await runBotTick(bot, { bid: 100, ask: 100 });
  assert.equal(ev[0]?.action, "open");
  bot = (await getBotSession(bot.id, userId))!;
  assert.equal(bot.state.levels.length, 1);
  assert.equal(bot.state.levels[0]!.price, 100);

  // Tick 2 — price rose +2 (adverse for sell) → add 0.02 level.
  ev = await runBotTick(bot, { bid: 102, ask: 102 });
  assert.equal(ev[0]?.action, "open");
  bot = (await getBotSession(bot.id, userId))!;
  assert.equal(bot.state.levels.length, 2);
  assert.equal(bot.state.levels[1]!.lot, 0.02);

  // Tick 3 — price dropped to 99; break-even ≈ 101.33, target hit → close all.
  ev = await runBotTick(bot, { bid: 99, ask: 99 });
  assert.equal(ev[0]?.action, "close_all");
  bot = (await getBotSession(bot.id, userId))!;
  assert.equal(bot.state.levels.length, 0, "basket closed");
  assert.ok(bot.realizedPnl > 0, "banked a positive paper PnL");
});

test("master kill stops the bot before any action", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-bot2-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const { createBotSession, getBotSession } = await import("@/lib/botStore");
  const { runBotTick } = await import("@/lib/botEngine");
  const { setFlag } = await import("@/lib/store");

  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["bot2@test.com", "x", "user", "active"],
  );
  const bot = await createBotSession(userId, {
    strategy: "grid",
    symbol: "XAUUSD",
    market: "forex",
    side: "sell",
    executionMode: "paper",
    config: {
      side: "sell",
      initialLot: 0.01,
      gridStep: 2,
      multiplier: 2,
      takeProfit: 1,
      maxLevels: 5,
      maxTotalLot: 1,
    },
  });

  await setFlag("master_kill", "1");
  const ev = await runBotTick(bot, { bid: 100, ask: 100 });
  assert.equal(ev[0]?.action, "stopped");
  const after = await getBotSession(bot.id, userId);
  assert.equal(after?.status, "stopped");
});
