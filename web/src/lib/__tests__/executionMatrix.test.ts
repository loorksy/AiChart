/**
 * The financial acceptance matrix, proven at executeIntent itself.
 *
 * Every row drives the REAL choke point — real database, real gates, in their
 * real order — against a counting broker adapter. The one number that matters
 * in every refusal row is `placeOrder calls === 0`: a denial that has already
 * talked to the broker is not a denial.
 *
 * The adapter is the singleton object the execution path resolves through
 * `getBrokerAdapter("mt_ea")`, so patching its method observes exactly the
 * calls production code would make.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-exec-matrix-"));
process.env.DB_PATH = join(dir, "matrix.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "execution-matrix-test-secret";
delete process.env.DATABASE_URL;

let owner = 0;
let placeOrderCalls = 0;
let originalPlaceOrder: unknown;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["matrix-owner@example.com", "x", "user", "active"],
  );
  // Technical execution permission — the matrix tests the gates ABOVE it.
  await db.execute(
    "INSERT INTO admin_limits (user_id, can_execute, claude_quota) VALUES (?,?,?) " +
      "ON CONFLICT (user_id) DO UPDATE SET can_execute = 1",
    [owner, 1, 1000],
  );

  // The counting broker. Success shape mirrors what the real adapter returns.
  const { eaAdapter } = await import("@/lib/brokers/eaAdapter");
  originalPlaceOrder = eaAdapter.placeOrder;
  eaAdapter.placeOrder = (async () => {
    placeOrderCalls += 1;
    return { ok: true, status: "executed", reason: "fake broker accepted", tradeId: 777 };
  }) as typeof eaAdapter.placeOrder;
});

after(async () => {
  const { eaAdapter } = await import("@/lib/brokers/eaAdapter");
  eaAdapter.placeOrder = originalPlaceOrder as typeof eaAdapter.placeOrder;
  delete process.env.AUTO_EXECUTION_STAGE;
});

beforeEach(() => {
  placeOrderCalls = 0;
  process.env.AUTO_EXECUTION_STAGE = "off";
});

/** A demo-account EA connection with verifiable equity. */
async function connectAccount(tradeMode: "demo" | "real" | "garbage"): Promise<void> {
  const db = await import("@/lib/db");
  await db.execute("DELETE FROM ea_connections WHERE user_id = ?", [owner]);
  await db.execute(
    `INSERT INTO ea_connections
       (user_id, platform, token_hash, account_currency, balance, equity, status,
        account_trade_mode, last_heartbeat_at)
     VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
    [owner, "mt5", "matrix-token-hash", "USD", 10_000, 10_000, "online", tradeMode],
  );
}

async function newIntent(
  overrides: Partial<{
    recommendation_id: number | null;
    recommendation_revision_no: number | null;
    authorization_source: "user_approved" | "standing_auto" | null;
  }> = {},
) {
  const { createIntent } = await import("@/lib/store");
  return createIntent(owner, {
    recommendation_id: null,
    authorization_source: "user_approved",
    symbol: "EURUSD",
    side: "buy",
    notional: 100,
    market: "forex",
    broker: "mt_ea",
    entry: 1.1,
    stop_loss: 1.09,
    take_profit: 1.12,
    status: "approved",
    rationale: "matrix",
    ...overrides,
  });
}

async function stampApproval(
  intentId: number,
  opts: { at?: number; by?: number; consumed?: boolean } = {},
): Promise<void> {
  const db = await import("@/lib/db");
  await db.execute(
    "UPDATE trade_intents SET approved_at = ?, approved_by_user_id = ?, approval_consumed_at = ? WHERE id = ?",
    [opts.at ?? Date.now(), opts.by ?? owner, opts.consumed ? Date.now() : null, intentId],
  );
}

async function run(intentId: number, explicitApproval = true) {
  const { executeIntent } = await import("@/lib/execution");
  return executeIntent(owner, intentId, { explicitApproval });
}

describe("execution matrix: stage gate", () => {
  it("off × server-approved intent on a demo account → denied, zero broker calls", async () => {
    await connectAccount("demo");
    const intent = await newIntent();
    await stampApproval(intent.id);
    const result = await run(intent.id);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "execution_stage_off");
    assert.equal(placeOrderCalls, 0);
  });

  it("off × standing_auto → denied, zero broker calls", async () => {
    await connectAccount("demo");
    const intent = await newIntent({ authorization_source: "standing_auto" });
    const result = await run(intent.id, false);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "execution_stage_off");
    assert.equal(placeOrderCalls, 0);
  });

  it("dry_run × server-approved → simulated refusal, zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "dry_run";
    await connectAccount("demo");
    const intent = await newIntent();
    await stampApproval(intent.id);
    const result = await run(intent.id);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "execution_stage_dry_run");
    assert.equal(placeOrderCalls, 0);
  });

  it("an unrecognised stage value is off, not permissive → zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "banana";
    await connectAccount("demo");
    const intent = await newIntent();
    await stampApproval(intent.id);
    const result = await run(intent.id);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "execution_stage_off");
    assert.equal(placeOrderCalls, 0);
  });

  it("demo × broker-reported REAL account → denied, zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "demo";
    await connectAccount("real");
    const intent = await newIntent();
    await stampApproval(intent.id);

    // Without the ops flag the dual-enablement halt refuses first — earlier and
    // stricter than the stage gate. Assert that layer, then open it to prove
    // the demo gate refuses the real account BY NAME even when ops said live
    // trading is allowed: the stage still outranks the flag.
    const halted = await run(intent.id);
    assert.equal(halted.ok, false, "real money without the ops flag must halt");
    assert.equal(placeOrderCalls, 0);

    // Dual enablement is env switch AND ops flag — open both.
    const { setFlag } = await import("@/lib/store");
    const { LIVE_ENABLED_FLAG } = await import("@/lib/executionKillSwitch");
    await setFlag(LIVE_ENABLED_FLAG, "1");
    process.env.LIVE_TRADING_ENABLED = "1";
    try {
      const result = await run(intent.id);
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, "execution_stage_demo_only");
      assert.equal(placeOrderCalls, 0);
    } finally {
      delete process.env.LIVE_TRADING_ENABLED;
      await setFlag(LIVE_ENABLED_FLAG, "0");
    }
  });

  it("demo × verified demo account × server approval → the order is PLACED", async () => {
    process.env.AUTO_EXECUTION_STAGE = "demo";
    await connectAccount("demo");
    const intent = await newIntent();
    await stampApproval(intent.id);
    const result = await run(intent.id);
    assert.equal(result.ok, true, `expected the fake broker to accept, got: ${result.reason}`);
    assert.equal(placeOrderCalls, 1, "exactly one order for one approval");
  });
});

describe("execution matrix: approval proof", () => {
  it("demo × forged approval (no server record) → denied, zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "demo";
    await connectAccount("demo");
    const intent = await newIntent();
    const result = await run(intent.id);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "approval_not_verified");
    assert.equal(placeOrderCalls, 0);
  });

  it("demo × consumed approval (replay) → denied, zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "demo";
    await connectAccount("demo");
    const intent = await newIntent();
    await stampApproval(intent.id, { consumed: true });
    const result = await run(intent.id);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "approval_not_verified");
    assert.equal(placeOrderCalls, 0);
  });

  it("demo × expired approval → denied, zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "demo";
    await connectAccount("demo");
    const intent = await newIntent();
    await stampApproval(intent.id, { at: Date.now() - 31 * 60 * 1000 });
    const result = await run(intent.id);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "approval_not_verified");
    assert.equal(placeOrderCalls, 0);
  });

  it("demo × another user's approval → denied, zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "demo";
    await connectAccount("demo");
    const db = await import("@/lib/db");
    const stranger = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      [`matrix-stranger-${Date.now()}@example.com`, "x", "user", "active"],
    );
    const intent = await newIntent();
    await stampApproval(intent.id, { by: stranger });
    const result = await run(intent.id);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "approval_not_verified");
    assert.equal(placeOrderCalls, 0);
  });

  it("a placed order consumes its approval: the same intent cannot fire twice", async () => {
    process.env.AUTO_EXECUTION_STAGE = "demo";
    await connectAccount("demo");
    const intent = await newIntent();
    await stampApproval(intent.id);
    const first = await run(intent.id);
    assert.equal(first.ok, true);
    assert.equal(placeOrderCalls, 1);
    // Force the status back as a hostile replay would wish it; the consumed
    // approval must still refuse a second order.
    const db = await import("@/lib/db");
    await db.execute("UPDATE trade_intents SET status = 'approved' WHERE id = ?", [intent.id]);
    const second = await run(intent.id);
    assert.equal(second.ok, false);
    assert.equal(second.errorCode, "approval_not_verified");
    assert.equal(placeOrderCalls, 1, "the broker must never see the replay");
  });
});

describe("execution matrix: downstream gates still hold with the stage open", () => {
  it("demo × stale revision → denied by the CAS, zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "demo";
    await connectAccount("demo");
    const { createCanonicalRecommendation } = await import(
      "@/lib/recommendations/canonical"
    );
    const { applyRecommendationRevision } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    const rec = await createCanonicalRecommendation({
      planType: "conditional",
      executionState: "awaiting_activation",
      userId: owner,
      analysisId: `matrix-${Math.floor(performance.now() * 1000)}`,
      sessionId: "s",
      chatId: "c",
      symbol: "EURUSD",
      market: "forex",
      timeframe: "5m",
      direction: "buy",
      entry: 1.1,
      stopLoss: 1.09,
      targets: [1.12],
      risk: { riskPercent: 1 },
      confidence: 70,
      strategyId: "unspecified",
      strategyVersion: "1",
      expiresAt: Date.now() + 3_600_000,
      source: "test",
      engineVersion: "matrix",
      entryType: "buy_limit",
    });
    const intent = await newIntent({
      recommendation_id: rec.recommendationId,
      recommendation_revision_no: 1,
    });
    await applyRecommendationRevision({
      userId: owner,
      recommendationId: rec.recommendationId,
      revision: { direction: "buy", entry: 1.095, reason: "moved", source: "market_update" },
    });
    await stampApproval(intent.id);
    const result = await run(intent.id);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "stale_revision");
    assert.equal(placeOrderCalls, 0);
  });

  it("demo × kill switch on → halted, zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "demo";
    await connectAccount("demo");
    const { setFlag } = await import("@/lib/store");
    const { KILL_SWITCH_FLAG } = await import("@/lib/executionKillSwitch");
    await setFlag(KILL_SWITCH_FLAG, "1");
    try {
      const intent = await newIntent();
      await stampApproval(intent.id);
      const result = await run(intent.id);
      assert.equal(result.ok, false);
      assert.equal(placeOrderCalls, 0);
    } finally {
      await setFlag(KILL_SWITCH_FLAG, "0");
    }
  });

  it("live × real account without the ops dual-enablement flag → halted, zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "live";
    await connectAccount("real");
    const intent = await newIntent();
    await stampApproval(intent.id);
    const result = await run(intent.id);
    assert.equal(result.ok, false, "real money needs the ops flag, not just the stage");
    assert.equal(placeOrderCalls, 0);
  });

  it("live × connected account with an unrecognised trade mode → fail closed, zero broker calls", async () => {
    process.env.AUTO_EXECUTION_STAGE = "live";
    await connectAccount("garbage");
    const intent = await newIntent();
    await stampApproval(intent.id);
    const result = await run(intent.id);
    assert.equal(result.ok, false, "an unverifiable environment must never trade");
    assert.equal(result.errorCode, "execution_stage_env_unknown");
    assert.equal(placeOrderCalls, 0);
  });

  it("concurrent duplicates: two executions of one approved intent produce at most one order", async () => {
    process.env.AUTO_EXECUTION_STAGE = "demo";
    await connectAccount("demo");
    const intent = await newIntent();
    await stampApproval(intent.id);
    const [a, b] = await Promise.all([run(intent.id), run(intent.id)]);
    const okCount = [a, b].filter((r) => r.ok).length;
    assert.equal(okCount, 1, "exactly one of two concurrent calls may place");
    assert.equal(placeOrderCalls, 1, "the broker must see exactly one order");
  });
});
