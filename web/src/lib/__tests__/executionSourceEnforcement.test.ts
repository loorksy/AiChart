/**
 * The authorization gate at the execution choke point, against a real database.
 *
 * Route-level checks say who MAY call executeIntent; this pins what the choke
 * point itself does with the source stamped on the intent. No broker order
 * except `user_approved` (with the approval actually in hand) or `standing_auto`
 * (re-verified at the moment of execution) — and the stale-revision CAS holds
 * for every order that references a recommendation, including legacy rows
 * written before creators stamped a revision number.
 *
 * No test here reaches a broker: the refusal cases stop at the gates under
 * test, and the allowed cases are proven by the intent sailing PAST those gates
 * into the next check (verified equity), which no test environment can satisfy.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { canonicalCompletePlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";

const dir = mkdtempSync(join(tmpdir(), "aichart-source-enforcement-"));
process.env.DB_PATH = join(dir, "enforcement.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "source-enforcement-test-secret";
delete process.env.DATABASE_URL;

const UNAUTHORIZED = "unauthorized_source";
const REVOKED = "auto_mode_revoked";
/** The check AFTER the gates under test — reaching it proves the gates passed. */
const EQUITY_REASON = /equity/;

let owner = 0;

before(async () => {
  // The stage gate sits UPSTREAM of every gate this file tests and fails
  // closed (unset -> off). Open it so each test reaches its actual target;
  // the stage gate's own behaviour is pinned in executionStageAndApproval.test.ts.
  process.env.AUTO_EXECUTION_STAGE = "live";
  const db = await import("@/lib/db");
  await db.initDb();
  owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["source-enforcement-owner@example.com", "x", "user", "active"],
  );
});

after(() => {
  delete process.env.AUTO_EXECUTION_STAGE;
});

/**
 * What the authenticated approval path (respondToApproval) leaves behind: the
 * server's own record that THIS user approved THIS intent just now. Tests whose
 * target gate lies beyond the approval-proof check need it; the choke point no
 * longer accepts `explicitApproval` alone.
 */
async function stampServerApproval(intentId: number): Promise<void> {
  const db = await import("@/lib/db");
  await db.execute(
    "UPDATE trade_intents SET approved_at = ?, approved_by_user_id = ? WHERE id = ?",
    [Date.now(), owner, intentId],
  );
}

/**
 * A connected account with ZERO equity. Lets the order reach the equity
 * check — which still fails, because equity is 0 — so a gate-passthrough
 * test proves what it means to: every gate ahead of the equity check let
 * this order through.
 */
async function seedConnectedAccountNoEquity(): Promise<void> {
  const db = await import("@/lib/db");
  await db.execute("DELETE FROM mt_accounts WHERE user_id = ?", [owner]);
  await db.execute(
    `INSERT INTO mt_accounts
       (user_id, platform, server, login, password_enc, metaapi_account_id,
        state, connection_status, balance, equity, currency, account_trade_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [owner, "mt5", "Src-Enf-Server", "1000", "enc", "acct-src-enf", "DEPLOYED", "CONNECTED", 0, 0, "USD", "demo"],
  );
}

/** An intent that is technically valid, so only the gates under test decide. */
async function newIntent(
  overrides: Partial<{
    recommendation_id: number | null;
    recommendation_revision_no: number | null;
    authorization_source: "user_approved" | "standing_auto" | "trade_management" | null;
    symbol: string;
    entry: number | null;
    stop_loss: number | null;
    take_profit: number | null;
  }> = {},
) {
  const { createIntent } = await import("@/lib/store");
  return createIntent(owner, {
    recommendation_id: null,
    symbol: "EURUSD",
    side: "buy",
    notional: 100,
    market: "forex",
    broker: "metaapi",
    entry: 1.1,
    stop_loss: 1.09,
    take_profit: 1.12,
    status: "approved",
    ...overrides,
  });
}

async function newRecommendation() {
  const lifecycle = await import("@/lib/recommendations/canonical");
  return lifecycle.createCanonicalRecommendation({
    ...canonicalCompletePlan({ planType: "conditional" }),
    userId: owner,
    analysisId: `analysis-${Math.floor(performance.now() * 1000)}`,
    sessionId: "session-1",
    chatId: "chat-1",
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "5m",
    direction: "buy",
    entry: 3992,
    stopLoss: 3986,
    targets: [4010],
    risk: { riskPercent: 1 },
    confidence: 70,
    strategyId: "unspecified",
    strategyVersion: "1",
    expiresAt: Date.now() + 3_600_000,
    source: "test",
    engineVersion: "source-enforcement-test",
    entryType: "buy_limit",
  });
}

describe("authorization source enforcement at the choke point", () => {
  it("refuses a source this build does not recognise", async () => {
    const db = await import("@/lib/db");
    const { executeIntent } = await import("@/lib/execution");
    const intent = await newIntent();
    // Written by some future (or corrupted) component: not one of the known
    // sources, so raw SQL is the only way to produce it.
    await db.execute("UPDATE trade_intents SET authorization_source = ? WHERE id = ?", [
      "mystery_source",
      intent.id,
    ]);

    const result = await executeIntent(owner, intent.id, { explicitApproval: true });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, UNAUTHORIZED, "an unknown source is refused, never guessed at");
  });

  it("refuses a trade_management proposal even with an approval in hand", async () => {
    const { executeIntent } = await import("@/lib/execution");
    // An SL/TP-modify proposal for an already-open position. Executing it as an
    // order would open a second position on top of the live one.
    const intent = await newIntent({ authorization_source: "trade_management" });

    const result = await executeIntent(owner, intent.id, { explicitApproval: true });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, UNAUTHORIZED);
  });

  it("refuses standing_auto by name when the grant no longer holds", async () => {
    const { executeIntent } = await import("@/lib/execution");
    // No live broker connection in this environment, so standing authorisation
    // cannot hold — exactly the state after a revoke or a dropped connection.
    const intent = await newIntent({ authorization_source: "standing_auto" });

    const result = await executeIntent(owner, intent.id, { explicitApproval: false });
    assert.equal(result.ok, false);
    assert.equal(
      result.errorCode,
      REVOKED,
      "a standing_auto intent must be re-verified at execution time, not trusted from creation",
    );
  });

  it("refuses user_approved without the explicit approval actually in hand", async () => {
    const { executeIntent } = await import("@/lib/execution");
    const intent = await newIntent({ authorization_source: "user_approved" });

    const result = await executeIntent(owner, intent.id, {});
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, UNAUTHORIZED, "the stamp alone is not the approval");
  });

  it("lets a legacy unstamped intent through only under explicit approval", async () => {
    const { executeIntent } = await import("@/lib/execution");
    // A pending intent from before sources were stamped must still work when
    // the operator approves it — that is the one authorisation a stale row
    // cannot forge. "Approves it" now means the server recorded the approval.
    const intent = await newIntent({ authorization_source: null });
    await stampServerApproval(intent.id);
    await seedConnectedAccountNoEquity();

    const result = await executeIntent(owner, intent.id, { explicitApproval: true });
    assert.notEqual(result.errorCode, UNAUTHORIZED, "the authorization gate must not refuse it");
    assert.match(
      result.reason,
      EQUITY_REASON,
      "it must sail past the authorization gate into the equity check",
    );
  });

  it("refuses a legacy unstamped intent without explicit approval", async () => {
    const { executeIntent } = await import("@/lib/execution");
    const intent = await newIntent({ authorization_source: null });

    const result = await executeIntent(owner, intent.id, {});
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, UNAUTHORIZED);
  });
});

describe("stale-revision CAS on every order that references a recommendation", () => {
  it("refuses an order built from a superseded revision", async () => {
    const { executeIntent } = await import("@/lib/execution");
    const { applyRecommendationRevision } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    const rec = await newRecommendation();
    // The order was built from revision 1 (seeded at creation)...
    const intent = await newIntent({
      recommendation_id: rec.recommendationId,
      recommendation_revision_no: 1,
      authorization_source: "user_approved",
      symbol: "XAUUSD",
      entry: 3992,
      stop_loss: 3986,
      take_profit: 4010,
    });
    // ...and the plan moved while it waited.
    await applyRecommendationRevision({
      userId: owner,
      recommendationId: rec.recommendationId,
      revision: { direction: "buy", entry: 3988, reason: "market moved", source: "market_update" },
    });
    // The approval is real — the CAS must be what refuses, not the auth gate.
    await stampServerApproval(intent.id);

    const result = await executeIntent(owner, intent.id, { explicitApproval: true });
    assert.equal(result.ok, false);
    assert.match(result.reason, /النسخة الفعالة الآن 2/, "the stale order names the revision now in force");
  });

  it("backfills a legacy null revision to the current effective one", async () => {
    const { executeIntent } = await import("@/lib/execution");
    const { applyRecommendationRevision } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    const rec = await newRecommendation();
    // The plan has even been revised since — a legacy intent means "execute the
    // plan as it stands now", so the CAS is evaluated against revision 2 and
    // passes, rather than being skipped or refused.
    await applyRecommendationRevision({
      userId: owner,
      recommendationId: rec.recommendationId,
      revision: { direction: "buy", entry: 3988, reason: "market moved", source: "market_update" },
    });
    const intent = await newIntent({
      recommendation_id: rec.recommendationId,
      recommendation_revision_no: null,
      authorization_source: "user_approved",
      symbol: "XAUUSD",
      entry: 3988,
      stop_loss: 3984,
      take_profit: 4008,
    });
    await stampServerApproval(intent.id);
    await seedConnectedAccountNoEquity();

    const result = await executeIntent(owner, intent.id, { explicitApproval: true });
    assert.doesNotMatch(result.reason, /النسخة|نسخة فعالة/, "the revision gate must not refuse it");
    assert.match(
      result.reason,
      EQUITY_REASON,
      "it must sail past the revision gate into the equity check",
    );
  });
});

describe("executeIntent locks every intent, even without a recommendation", () => {
  it("lets only one of two concurrent calls proceed for a standalone (recommendation_id=null) intent", async () => {
    const { executeIntent } = await import("@/lib/execution");
    // Standalone trades (no recommendation) are a legitimate, reachable state
    // (web/src/app/api/agent/trade/open/route.ts passes recommendation_id ?? null).
    // Before the fix, this path was completely unlocked: two concurrent
    // executeIntent calls could both sail past every gate and both reach the
    // broker. The fix locks on the intent itself unconditionally.
    const intent = await newIntent({
      recommendation_id: null,
      authorization_source: "user_approved",
    });
    await stampServerApproval(intent.id);

    const [first, second] = await Promise.all([
      executeIntent(owner, intent.id, { explicitApproval: true }),
      executeIntent(owner, intent.id, { explicitApproval: true }),
    ]);

    const busyCount = [first, second].filter((r) => r.errorCode === "intent_busy").length;
    const throughCount = [first, second].filter((r) => r.errorCode !== "intent_busy").length;
    assert.equal(busyCount, 1, "exactly one concurrent call must be rejected as intent_busy");
    assert.equal(throughCount, 1, "exactly one concurrent call must proceed through the gates");
  });
});
