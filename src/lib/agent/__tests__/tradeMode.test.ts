/**
 * Standing execution authorisation, against a real database.
 *
 * The stakes here are money, so the tests are written around what must NOT
 * happen: auto without a live account, auto surviving a disconnect, an order
 * with no authorisation at all, or a stage default that places real trades
 * because someone deployed the file.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-trademode-"));
process.env.DB_PATH = join(dir, "trademode.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "trademode-test-secret";
delete process.env.DATABASE_URL;
delete process.env.AUTO_EXECUTION_STAGE;

let userId = 0;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["trademode@example.com", "x", "user", "active"],
  );
  await db.execute("INSERT INTO trading_settings (user_id) VALUES (?)", [userId]);
});

describe("trade mode", () => {
  it("defaults to advisory and never assumes consent", async () => {
    const { getTradeMode, isAutoExecutionAuthorized } = await import(
      "@/lib/agent/tradeMode"
    );
    const view = await getTradeMode(userId);
    assert.equal(view.mode, "advisory");
    assert.equal(view.storedMode, "unset");
    assert.equal(await isAutoExecutionAuthorized(userId), false);
  });

  it("refuses auto without a live broker connection", async () => {
    const { setTradeMode } = await import("@/lib/agent/tradeMode");
    await assert.rejects(
      setTradeMode({ userId, mode: "auto", actor: "platform" }),
      /حساب متصل/,
    );
  });

  it("accepts advisory at any time and reports it as chosen", async () => {
    const { setTradeMode, getTradeMode } = await import("@/lib/agent/tradeMode");
    await setTradeMode({ userId, mode: "advisory", actor: "mcp" });
    const view = await getTradeMode(userId);
    assert.equal(view.mode, "advisory");
    assert.equal(view.needsChoice, false);
  });

  it("suspends a stored auto grant when the connection drops", async () => {
    const db = await import("@/lib/db");
    const { getTradeMode, suspendAutoOnDisconnect } = await import(
      "@/lib/agent/tradeMode"
    );
    // Simulate a grant made while connected, then the account going away.
    await db.execute(
      `UPDATE trading_settings
          SET agent_trade_mode = 'auto', agent_trade_mode_epoch = ?, agent_trade_mode_updated_at = ?
        WHERE user_id = ?`,
      ["7:12345", Date.now(), userId],
    );
    const suspended = await suspendAutoOnDisconnect(userId);
    assert.equal(suspended, true);

    const view = await getTradeMode(userId);
    assert.equal(view.mode, "advisory");
    assert.equal(await (await import("@/lib/agent/tradeMode")).isAutoExecutionAuthorized(userId), false);
  });

  it("treats a grant from a previous connection as spent", async () => {
    const db = await import("@/lib/db");
    const { getTradeMode } = await import("@/lib/agent/tradeMode");
    await db.execute(
      `UPDATE trading_settings
          SET agent_trade_mode = 'auto', agent_trade_mode_epoch = 'stale:0'
        WHERE user_id = ?`,
      [userId],
    );
    const view = await getTradeMode(userId);
    // No live connection in this test environment, so it reads as advisory and
    // the operator will be asked again rather than silently resumed.
    assert.equal(view.mode, "advisory");
  });
});

describe("auto execution staging", () => {
  it("is off unless an operator turns it on", async () => {
    const { autoExecutionStage } = await import("@/lib/recommendations/autoExecutor");
    assert.equal(autoExecutionStage(), "off");
  });

  it("places nothing while the stage is off", async () => {
    const { maybeAutoExecute } = await import("@/lib/recommendations/autoExecutor");
    const outcome = await maybeAutoExecute({
      recommendation: {
        id: "rec-1",
        userId,
        symbol: "XAUUSD",
        interval: "5m",
        direction: "buy",
        entryType: "limit",
        entry: 4000,
        stopLoss: 3990,
        targets: [4020],
        status: "triggered",
        outcome: "pending",
        createdAt: Date.now(),
        createdCandleTime: Date.now(),
        expiresAt: Date.now() + 3_600_000,
      },
      events: [
        {
          type: "activated",
          recommendationId: "rec-1",
          symbol: "XAUUSD",
          revisionNo: 1,
          dedupeKey: "rec-1:1:activated",
          detail: "activated",
          terminal: false,
          occurredAt: Date.now(),
        },
      ],
    });
    assert.equal(outcome.placed, false);
    assert.equal(outcome.placed === false && outcome.code, "stage_off");
  });

  it("has a conservative default daily cap", async () => {
    const { autoExecutionDailyCap } = await import("@/lib/recommendations/autoExecutor");
    assert.ok(autoExecutionDailyCap() > 0 && autoExecutionDailyCap() <= 20);
  });
});
