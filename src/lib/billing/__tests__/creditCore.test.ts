/**
 * Billing v3 hard guarantees, against the REAL schema:
 *
 *  - the balance NEVER goes below zero: a race over a balance that covers one
 *    of two debits produces exactly one success, and the loser is refused
 *    before anything happens;
 *  - a duplicate ref (replayed webhook, redelivered queue turn) moves the
 *    balance ONCE — the ledger's UNIQUE constraint is the guarantee;
 *  - renewal ADDS to the remaining balance (monthly rollover) — it never
 *    replaces it;
 *  - refusal precedence never blurs: an expired subscriber with a full
 *    frozen balance hears "subscription expired", never "balance ran out";
 *  - a zero-priced operation is allowed and debits nothing;
 *  - "changing" the plan price creates a NEW immutable row and archives the
 *    old one — the old row's numbers never move.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-credits-"));
process.env.DB_PATH = join(dir, "credits.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "credits-test-secret";
process.env.BILLING_ENFORCED = "1";
delete process.env.DATABASE_URL;

let db: typeof import("@/lib/db");
let credits: typeof import("@/lib/billing/credits");
let spend: typeof import("@/lib/billing/spend");
let planConfig: typeof import("@/lib/billing/planConfig");

let seq = 0;

/** A fresh user in the given entitlement state. */
async function makeUser(state: {
  plan: "trial" | "active" | "expired" | "suspended";
  expiresAt?: number;
  balance?: number;
}): Promise<number> {
  seq += 1;
  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`credit-${seq}@example.com`, "x", "user", "active"],
  );
  const planStatus = state.plan === "expired" ? "active" : state.plan;
  const expires =
    state.plan === "expired"
      ? new Date(Date.now() - 60_000).toISOString()
      : state.expiresAt
        ? new Date(state.expiresAt).toISOString()
        : state.plan === "active"
          ? new Date(Date.now() + 30 * 86_400_000).toISOString()
          : null;
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight, subscription_expires_at)
     VALUES (?, ?, 0, 0, ?)`,
    [userId, planStatus, expires],
  );
  if (state.balance) {
    await credits.grantCredits({
      userId,
      amount: state.balance,
      kind: "admin_adjust",
      note: "test seed",
    });
  }
  return userId;
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  credits = await import("@/lib/billing/credits");
  spend = await import("@/lib/billing/spend");
  planConfig = await import("@/lib/billing/planConfig");
});

beforeEach(async () => {
  planConfig.bustBillingConfigCache();
});

describe("atomic debit", () => {
  it("two racing debits over a balance that covers one → exactly one succeeds, never negative", async () => {
    const userId = await makeUser({ plan: "active", balance: 5 });
    const [a, b] = await Promise.all([
      credits.debitCredits({ userId, amount: 5, kind: "debit_recommendation", ref: "race-a" }),
      credits.debitCredits({ userId, amount: 5, kind: "debit_recommendation", ref: "race-b" }),
    ]);
    const outcomes = [a, b];
    assert.equal(outcomes.filter((o) => o.ok).length, 1, "exactly one winner");
    assert.equal(outcomes.filter((o) => !o.ok).length, 1, "exactly one refusal");
    assert.equal(await credits.getCreditBalance(userId), 0);
    const entries = await credits.listCreditEntries(userId);
    assert.equal(entries.filter((e) => e.kind === "debit_recommendation").length, 1);
  });

  it("an insufficient balance is refused BEFORE anything happens", async () => {
    const userId = await makeUser({ plan: "active", balance: 3 });
    const res = await credits.debitCredits({
      userId,
      amount: 10,
      kind: "debit_recommendation",
      ref: "too-big",
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "insufficient_credits");
    assert.equal(await credits.getCreditBalance(userId), 3, "balance untouched");
    const entries = await credits.listCreditEntries(userId);
    assert.equal(entries.some((e) => e.ref === "too-big"), false, "no ledger row for a refusal");
  });

  it("the same ref debited twice moves the balance ONCE (queue redelivery)", async () => {
    const userId = await makeUser({ plan: "active", balance: 10 });
    const first = await credits.debitCredits({
      userId,
      amount: 4,
      kind: "debit_chat",
      ref: "turn-77",
    });
    const replay = await credits.debitCredits({
      userId,
      amount: 4,
      kind: "debit_chat",
      ref: "turn-77",
    });
    assert.equal(first.ok, true);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.alreadyApplied, true);
    assert.equal(await credits.getCreditBalance(userId), 6, "charged once");
    const entries = await credits.listCreditEntries(userId);
    assert.equal(entries.filter((e) => e.ref === "turn-77").length, 1);
  });

  it("a debit inside a caller transaction rolls back WITH the caller's failure", async () => {
    const userId = await makeUser({ plan: "active", balance: 10 });
    await assert.rejects(
      db.transaction(async (tx) => {
        const res = await credits.debitCredits(
          { userId, amount: 7, kind: "debit_recommendation", ref: "doomed-op" },
          tx,
        );
        assert.equal(res.ok, true);
        throw new Error("operation failed after debit");
      }),
      /operation failed/,
    );
    assert.equal(await credits.getCreditBalance(userId), 10, "failed work costs nothing");
    const entries = await credits.listCreditEntries(userId);
    assert.equal(entries.some((e) => e.ref === "doomed-op"), false);
  });
});

describe("grants and rollover", () => {
  it("renewal ADDS to the remaining balance — never replaces it", async () => {
    const userId = await makeUser({ plan: "active", balance: 40 });
    const res = await credits.grantCredits({
      userId,
      amount: 100,
      kind: "cycle_grant",
      ref: "stripe:evt_renewal_1",
    });
    assert.equal(res.applied, true);
    assert.equal(res.balance, 140, "40 remaining + 100 renewal = 140");
  });

  it("a replayed grant ref credits ONCE (duplicate webhook)", async () => {
    const userId = await makeUser({ plan: "active" });
    await credits.grantCredits({ userId, amount: 100, kind: "cycle_grant", ref: "stripe:evt_9" });
    const replay = await credits.grantCredits({
      userId,
      amount: 100,
      kind: "cycle_grant",
      ref: "stripe:evt_9",
    });
    assert.equal(replay.applied, false);
    assert.equal(await credits.getCreditBalance(userId), 100);
    const entries = await credits.listCreditEntries(userId);
    assert.equal(entries.filter((e) => e.ref === "stripe:evt_9").length, 1);
  });

  it("the ledger records signed amounts with a coherent running balance", async () => {
    const userId = await makeUser({ plan: "active" });
    await credits.grantCredits({ userId, amount: 50, kind: "cycle_grant", ref: "g1" });
    await credits.debitCredits({ userId, amount: 20, kind: "debit_recommendation", ref: "d1" });
    const [latest, first] = await credits.listCreditEntries(userId);
    assert.equal(first!.amount, 50);
    assert.equal(first!.balance_after, 50);
    assert.equal(latest!.amount, -20);
    assert.equal(latest!.balance_after, 30);
  });
});

describe("the spend gate precedence", () => {
  it("an EXPIRED subscriber with a full frozen balance hears subscription_expired, never insufficient", async () => {
    const userId = await makeUser({ plan: "expired", balance: 100 });
    await planConfig.setCreditPrice("recommendation", 10, 1);
    const decision = await spend.resolveSpendGate(userId, "recommendation");
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.code, "subscription_expired");
      assert.equal(decision.balance, 100, "the frozen balance is intact and reported");
    }
  });

  it("an ACTIVE subscriber short of the price hears insufficient_credits", async () => {
    const userId = await makeUser({ plan: "active", balance: 3 });
    await planConfig.setCreditPrice("recommendation", 10, 1);
    const decision = await spend.resolveSpendGate(userId, "recommendation");
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.code, "insufficient_credits");
  });

  it("a zero-priced operation is allowed and debits nothing", async () => {
    const userId = await makeUser({ plan: "active", balance: 5 });
    await planConfig.setCreditPrice("chat_turn", 0, 1);
    const commit = await spend.authorizeAndDebit({ userId, op: "chat_turn", ref: "turn-z" });
    assert.equal(commit.ok, true);
    if (commit.ok) assert.equal(commit.charged, 0);
    assert.equal(await credits.getCreditBalance(userId), 5);
  });

  it("a priced operation debits atomically through authorizeAndDebit", async () => {
    const userId = await makeUser({ plan: "active", balance: 25 });
    await planConfig.setCreditPrice("recommendation", 10, 1);
    const commit = await spend.authorizeAndDebit({ userId, op: "recommendation", ref: "rec-1" });
    assert.equal(commit.ok, true);
    if (commit.ok) {
      assert.equal(commit.charged, 10);
      assert.equal(commit.balance, 15);
    }
  });

  it("MT5 linking inside the trial is refused by the gate itself", async () => {
    const userId = await makeUser({ plan: "trial" });
    const decision = await spend.resolveSpendGate(userId, "mt5_link");
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.code, "trial_locked_feature");
  });

  it("a suspended account is blocked outright", async () => {
    const userId = await makeUser({ plan: "suspended" });
    const decision = await spend.resolveSpendGate(userId, "recommendation");
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.code, "account_blocked");
  });
});

describe("immutable plan prices", () => {
  it("changing the price archives the old row untouched and points at a new one", async () => {
    const first = await planConfig.setPlanPrice(
      { priceCents: 18000, creditsPerCycle: 1200, cycleDays: 30 },
      1,
    );
    const second = await planConfig.setPlanPrice(
      { priceCents: 25000, creditsPerCycle: 1500, cycleDays: 30 },
      1,
    );
    assert.notEqual(second.id, first.id, "a new row, never an update");
    const oldRow = await planConfig.getPlanPriceById(first.id);
    assert.equal(oldRow!.price_cents, 18000, "the old row's numbers never move");
    assert.ok(oldRow!.archived_at != null, "the old row is archived");
    const current = await planConfig.getCurrentPlanPrice();
    assert.equal(current!.id, second.id);
    assert.equal(current!.archived_at, null);
  });
});
