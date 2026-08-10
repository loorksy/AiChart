/**
 * The two execution-safety guarantees the choke point must make on its own.
 *
 * Both were found open by the final acceptance review:
 *
 *  1. **Approval must be proved by the server.** `/api/agent/trade/open` reads
 *     `approved_by_user` from the request body and, when it is true, skips the
 *     authorisation check entirely and stamps the intent `user_approved`. The
 *     body is composed by whoever calls the route — on the MCP surface that is a
 *     model. A boolean a caller asserts about itself is not proof that a human
 *     approved anything, so the choke point must require server-side evidence.
 *
 *  2. **`AUTO_EXECUTION_STAGE` must be enforced at the choke point.** It was read
 *     only by `autoExecutor`/`recommendationTracker`/`tradeManagement`, so it
 *     stopped the tracker's automatic executor while leaving every other route to
 *     the broker adapter ungated. `off` has to mean "nothing is placed at all",
 *     whatever the caller.
 *
 * These tests assert the REQUIRED behaviour, so they fail on the unfixed code.
 * No test here reaches a broker: refusals stop at the gate under test, and the
 * allowed cases are proven by the intent sailing past it into the verified-equity
 * check, which no test environment can satisfy.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-stage-approval-"));
process.env.DB_PATH = join(dir, "stage.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "stage-approval-test-secret";
delete process.env.DATABASE_URL;

/** The check AFTER the gates under test — reaching it proves the gates passed. */
const EQUITY_REASON = /equity/;

let owner = 0;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["stage-approval-owner@example.com", "x", "user", "active"],
  );
});

beforeEach(() => {
  process.env.AUTO_EXECUTION_STAGE = "off";
});

/**
 * An intent shaped exactly the way `/api/agent/trade/open` builds one when the
 * caller claims `approved_by_user: true` — already `approved`, already stamped
 * `user_approved`, with nothing on the server recording that a human ever acted.
 */
async function forgedApprovalIntent() {
  const { createIntent } = await import("@/lib/store");
  return createIntent(owner, {
    recommendation_id: null,
    authorization_source: "user_approved",
    symbol: "EURUSD",
    side: "buy",
    notional: 100,
    market: "forex",
    broker: "metaapi",
    entry: 1.1,
    stop_loss: 1.09,
    take_profit: 1.12,
    status: "approved",
    rationale: "claimed by the caller, not proved by the server",
  });
}

describe("AUTO_EXECUTION_STAGE is enforced at the choke point", () => {
  it("refuses every order while the stage is off, whatever the caller claims", async () => {
    const { executeIntent } = await import("@/lib/execution");
    const intent = await forgedApprovalIntent();

    const result = await executeIntent(owner, intent.id, { callerContext: "dashboard_approval", explicitApproval: true });

    assert.equal(result.ok, false, "stage off must place nothing at all");
    assert.equal(
      result.errorCode,
      "execution_stage_off",
      `stage off must refuse by name, got: ${result.errorCode} / ${result.reason}`,
    );
  });

  it("refuses a standing-auto order while the stage is off", async () => {
    const { createIntent } = await import("@/lib/store");
    const { executeIntent } = await import("@/lib/execution");
    const intent = await createIntent(owner, {
      recommendation_id: null,
      authorization_source: "standing_auto",
      symbol: "EURUSD",
      side: "buy",
      notional: 100,
      market: "forex",
      broker: "metaapi",
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
      status: "approved",
      rationale: "standing auto while stage is off",
    });

    const result = await executeIntent(owner, intent.id, { callerContext: "dashboard_approval", explicitApproval: false });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "execution_stage_off");
  });

  it("fails closed on an unrecognised stage value", async () => {
    process.env.AUTO_EXECUTION_STAGE = "banana";
    const { executeIntent } = await import("@/lib/execution");
    const intent = await forgedApprovalIntent();

    const result = await executeIntent(owner, intent.id, { callerContext: "dashboard_approval", explicitApproval: true });

    assert.equal(result.ok, false, "an unknown stage must never be treated as permissive");
    assert.equal(result.errorCode, "execution_stage_off");
  });
});

describe("explicit approval must be proved by the server, not asserted by the caller", () => {
  it("refuses an intent whose approval exists only as a caller-supplied flag", async () => {
    process.env.AUTO_EXECUTION_STAGE = "live";
    const { executeIntent } = await import("@/lib/execution");
    const intent = await forgedApprovalIntent();

    const result = await executeIntent(owner, intent.id, { callerContext: "dashboard_approval", explicitApproval: true });

    assert.equal(result.ok, false, "a self-asserted approval must not authorise an order");
    assert.equal(
      result.errorCode,
      "approval_not_verified",
      `expected the choke point to demand server-side proof, got: ${result.errorCode} / ${result.reason}`,
    );
  });

  it("lets an order through once the server itself recorded the approval", async () => {
    process.env.AUTO_EXECUTION_STAGE = "live";
    const db = await import("@/lib/db");
    const { executeIntent } = await import("@/lib/execution");
    const intent = await forgedApprovalIntent();

    // What a real operator action leaves behind: the server marks the intent
    // approved itself, in a request it authenticated.
    await db.execute(
      "UPDATE trade_intents SET approved_at = ?, approved_by_user_id = ? WHERE id = ?",
      [Date.now(), owner, intent.id],
    );
    // A connected account with zero equity: the order stops at the equity
    // check, proving the approval gate itself let it through.
    await db.execute("DELETE FROM mt_accounts WHERE user_id = ?", [owner]);
    await db.execute(
      `INSERT INTO mt_accounts
         (user_id, platform, server, login, password_enc, metaapi_account_id,
          state, connection_status, balance, equity, currency, account_trade_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [owner, "mt5", "Stage-Approval-Server", "1000", "enc", "acct-stage-approval", "DEPLOYED", "CONNECTED", 0, 0, "USD", "demo"],
    );

    const result = await executeIntent(owner, intent.id, { callerContext: "dashboard_approval", explicitApproval: true });

    assert.notEqual(
      result.errorCode,
      "approval_not_verified",
      "a server-recorded approval must satisfy the gate",
    );
    assert.match(
      result.reason,
      EQUITY_REASON,
      "it must sail past the approval gate into the equity check",
    );
  });

  it("does not accept one user's approval for another user's intent", async () => {
    process.env.AUTO_EXECUTION_STAGE = "live";
    const db = await import("@/lib/db");
    const { executeIntent } = await import("@/lib/execution");
    const stranger = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      [`stranger-${Date.now()}@example.com`, "x", "user", "active"],
    );
    const intent = await forgedApprovalIntent();
    await db.execute(
      "UPDATE trade_intents SET approved_at = ?, approved_by_user_id = ? WHERE id = ?",
      [Date.now(), stranger, intent.id],
    );

    const result = await executeIntent(owner, intent.id, { callerContext: "dashboard_approval", explicitApproval: true });

    assert.equal(result.ok, false);
    assert.equal(
      result.errorCode,
      "approval_not_verified",
      "an approval recorded for a different user must not authorise this order",
    );
  });

  it("refuses an approval that has already been consumed", async () => {
    process.env.AUTO_EXECUTION_STAGE = "live";
    const db = await import("@/lib/db");
    const { executeIntent } = await import("@/lib/execution");
    const intent = await forgedApprovalIntent();
    await db.execute(
      "UPDATE trade_intents SET approved_at = ?, approved_by_user_id = ?, approval_consumed_at = ? WHERE id = ?",
      [Date.now(), owner, Date.now(), intent.id],
    );

    const result = await executeIntent(owner, intent.id, { callerContext: "dashboard_approval", explicitApproval: true });

    assert.equal(result.ok, false, "an approval is single-use");
    assert.equal(result.errorCode, "approval_not_verified");
  });

  it("refuses an approval that has expired", async () => {
    process.env.AUTO_EXECUTION_STAGE = "live";
    const db = await import("@/lib/db");
    const { executeIntent } = await import("@/lib/execution");
    const intent = await forgedApprovalIntent();
    // Approved well outside any sane window for acting on a scalp plan.
    await db.execute(
      "UPDATE trade_intents SET approved_at = ?, approved_by_user_id = ? WHERE id = ?",
      [Date.now() - 24 * 60 * 60 * 1000, owner, intent.id],
    );

    const result = await executeIntent(owner, intent.id, { callerContext: "dashboard_approval", explicitApproval: true });

    assert.equal(result.ok, false, "a stale approval must not authorise an order");
    assert.equal(result.errorCode, "approval_not_verified");
  });
});
