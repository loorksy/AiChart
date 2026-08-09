/**
 * Bot order path: simulation creates no intent; live stamps bot_id and
 * standing_auto, then enters executeIntent.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-bot-live-"));
process.env.DB_PATH = join(dir, "bot-live.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "bot-live-test-secret";
delete process.env.DATABASE_URL;

const FLAG = "QUANT_AGENT_BOT_EXECUTION_ENABLED";
const originalFlag = process.env[FLAG];
const originalStage = process.env.AUTO_EXECUTION_STAGE;

let owner = 0;

before(async () => {
  // Open the stage gate so the bot intent reaches the authorization check.
  process.env.AUTO_EXECUTION_STAGE = "live";
  // createIntent resolves a broker when none is stamped; give the suite one.
  process.env.METAAPI_TOKEN = process.env.METAAPI_TOKEN || "test-token";
  const db = await import("@/lib/db");
  await db.initDb();
  owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["bot-live-owner@example.com", "x", "user", "active"],
  );
});

after(() => {
  if (originalFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = originalFlag;
  if (originalStage === undefined) delete process.env.AUTO_EXECUTION_STAGE;
  else process.env.AUTO_EXECUTION_STAGE = originalStage;
});

function makeBot(overrides: Partial<{ executionMode: "simulation" | "live"; id: string }> = {}) {
  return {
    id: overrides.id ?? "qbot_unit_1",
    ownerUserId: owner,
    botType: "grid" as const,
    name: "Unit bot",
    symbol: "XAUUSD",
    market: "forex",
    interval: "1h",
    executionMode: overrides.executionMode ?? "simulation",
    initialCapital: 1000,
    feeRate: 0.001,
    config: {},
    levels: [],
    warnings: [],
    riskDiagnostics: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("executeBotOrder", () => {
  it("simulation bot creates no intent", async () => {
    process.env[FLAG] = "1";
    const store = await import("@/lib/store");
    const before = await store.listIntents(owner, undefined, 50);
    const { executeBotOrder } = await import("@/lib/quantAgent/bots/liveExecution");
    const result = await executeBotOrder({
      userId: owner,
      bot: makeBot({ executionMode: "simulation" }),
      side: "buy",
      entry: 2000,
      stopLoss: 1990,
      takeProfit: 2010,
    });
    assert.equal(result.ok, false);
    assert.equal(result.intentCreated, false);
    assert.equal(result.intentId, null);
    assert.equal(result.errorCode, "bot_simulation_only");
    const after = await store.listIntents(owner, undefined, 50);
    assert.equal(after.length, before.length);
  });

  it("deploy flag off creates no intent", async () => {
    delete process.env[FLAG];
    const store = await import("@/lib/store");
    const before = await store.listIntents(owner, undefined, 50);
    const { executeBotOrder } = await import("@/lib/quantAgent/bots/liveExecution");
    const result = await executeBotOrder({
      userId: owner,
      bot: makeBot({ executionMode: "live" }),
      side: "buy",
    });
    assert.equal(result.ok, false);
    assert.equal(result.intentCreated, false);
    assert.equal(result.errorCode, "bot_execution_disabled");
    const after = await store.listIntents(owner, undefined, 50);
    assert.equal(after.length, before.length);
  });

  it("live bot stamps bot_id + standing_auto and reaches executeIntent", async () => {
    process.env[FLAG] = "1";
    const { executeBotOrder } = await import("@/lib/quantAgent/bots/liveExecution");
    const store = await import("@/lib/store");
    const result = await executeBotOrder({
      userId: owner,
      bot: makeBot({ executionMode: "live", id: "qbot_live_path" }),
      side: "sell",
      entry: 1.1,
      stopLoss: 1.12,
      takeProfit: 1.08,
    });
    assert.equal(result.intentCreated, true);
    assert.ok(result.intentId != null);
    assert.equal(result.botId, "qbot_live_path");
    const intent = await store.getIntent(result.intentId!, owner);
    assert.ok(intent);
    assert.equal(intent!.bot_id, "qbot_live_path");
    assert.equal(intent!.authorization_source, "standing_auto");
    assert.equal(intent!.notional, 0);
    assert.equal(intent!.recommendation_id, null);
    // executeIntent ran: without a live bot row in quant-agent the standing
    // re-check revokes, or a later gate refuses. Either way the intent left
    // pending — proving we entered the choke point, not a side path.
    assert.notEqual(intent!.status, "pending");
    assert.equal(result.ok, false);
    assert.ok(
      result.errorCode === "bot_mode_revoked" ||
        /equity|مفتاح|halt|stage|unauthorized|bot_mode/i.test(result.reason),
      `unexpected refusal: ${result.errorCode} ${result.reason}`,
    );
  });
});
