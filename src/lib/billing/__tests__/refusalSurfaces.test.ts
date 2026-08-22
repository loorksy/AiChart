/**
 * The three account states against the REAL creation choke point — the one
 * every surface (web, Telegram, MCP) funnels through:
 *
 *  - ONE shared trial counter across all surfaces: exhausting it via one
 *    path refuses the next creation from any path, and the chat/link gates
 *    read the SAME exhaustion — no per-surface allowance exists anywhere;
 *  - the trial cap is the ADMIN's number (billing_plan), not a constant;
 *  - a paid creation debits the credit price ATOMICALLY with the insert:
 *    a refused creation writes no row and moves no balance;
 *  - expired subscription refuses by ITS name before any balance question;
 *  - MT5 linking is refused for trial accounts by the gate itself.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-refusals-"));
process.env.DB_PATH = join(dir, "refusals.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "refusals-test-secret";
process.env.BILLING_ENFORCED = "1";
delete process.env.DATABASE_URL;

let db: typeof import("@/lib/db");
let repo: typeof import("@/lib/recommendations/canonical/repository");
let fixtures: typeof import("@/lib/recommendations/__tests__/fixtures/completePlan");
let credits: typeof import("@/lib/billing/credits");
let spend: typeof import("@/lib/billing/spend");
let planConfig: typeof import("@/lib/billing/planConfig");
let types: typeof import("@/lib/recommendations/canonical/types");

let seq = 0;

async function makeUser(state: {
  plan: "trial" | "active" | "expired";
  balance?: number;
}): Promise<number> {
  seq += 1;
  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`refusal-${seq}@example.com`, "x", "user", "active"],
  );
  const expires =
    state.plan === "expired"
      ? new Date(Date.now() - 60_000).toISOString()
      : state.plan === "active"
        ? new Date(Date.now() + 30 * 86_400_000).toISOString()
        : null;
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight, subscription_expires_at)
     VALUES (?, ?, 0, 0, ?)`,
    [userId, state.plan === "trial" ? "trial" : "active", expires],
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

async function createRec(userId: number): Promise<number> {
  const plan = await fixtures.gatedCompletePlan(userId);
  const rec = await repo.createCanonicalRecommendation({
    userId,
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "1h",
    direction: "buy",
    entry: 4000,
    stopLoss: 3990,
    targets: [4020],
    confidence: 66,
    source: "web",
    analysisId: plan.analysisId,
    planType: plan.planType,
    executionState: plan.executionState,
    initialRevision: plan.initialRevision,
  });
  return rec.recommendationId;
}

async function expectRefusal(
  userId: number,
  code: string,
): Promise<void> {
  try {
    await createRec(userId);
    assert.fail(`expected ${code} refusal, creation succeeded`);
  } catch (error) {
    assert.ok(
      error instanceof types.RecommendationLifecycleError,
      `expected a lifecycle refusal, got: ${String(error)}`,
    );
    assert.equal((error as InstanceType<typeof types.RecommendationLifecycleError>).code, code);
  }
}

async function recommendationCount(userId: number): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM recommendations WHERE user_id = ?",
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  repo = await import("@/lib/recommendations/canonical/repository");
  fixtures = await import("@/lib/recommendations/__tests__/fixtures/completePlan");
  credits = await import("@/lib/billing/credits");
  spend = await import("@/lib/billing/spend");
  planConfig = await import("@/lib/billing/planConfig");
  types = await import("@/lib/recommendations/canonical/types");
});

describe("one trial counter across every surface", () => {
  it("the admin's cap, consumed anywhere, exhausts the account everywhere", async () => {
    // The cap is DATA: two recommendations for this platform, says the admin.
    await planConfig.updateBillingPlanSettings({ trial_recommendations: 2 }, 1);
    planConfig.bustBillingConfigCache();
    const userId = await makeUser({ plan: "trial" });

    await createRec(userId); // "web"
    await createRec(userId); // "telegram" — same account, same counter
    assert.equal(await recommendationCount(userId), 2);

    // Third creation — whichever surface carries it — is refused by name.
    await expectRefusal(userId, "TRIAL_RECOMMENDATION_LIMIT");
    assert.equal(await recommendationCount(userId), 2, "no row for a refusal");

    // And the OTHER surfaces' gates read the same exhaustion instantly:
    // the chat gate (web + Telegram) refuses trial_exhausted…
    const chat = await spend.resolveSpendGate(userId, "chat_turn");
    assert.equal(chat.allowed, false);
    if (!chat.allowed) assert.equal(chat.code, "trial_exhausted");
    // …and MT5 linking was never a trial feature to begin with.
    const link = await spend.resolveSpendGate(userId, "mt5_link");
    assert.equal(link.allowed, false);
    if (!link.allowed) assert.equal(link.code, "trial_locked_feature");

    await planConfig.updateBillingPlanSettings({ trial_recommendations: 3 }, 1);
    planConfig.bustBillingConfigCache();
  });
});

describe("paid creations debit atomically at the choke point", () => {
  it("a priced recommendation charges exactly once, with the insert", async () => {
    await planConfig.setCreditPrice("recommendation", 10, 1);
    const userId = await makeUser({ plan: "active", balance: 25 });

    const recId = await createRec(userId);
    assert.equal(await credits.getCreditBalance(userId), 15);
    const entries = await credits.listCreditEntries(userId);
    const debit = entries.find((e) => e.kind === "debit_recommendation");
    assert.ok(debit, "the ledger names the charge");
    assert.equal(debit!.ref, `rec:${recId}`, "keyed to the recommendation itself");
  });

  it("an empty balance refuses insufficient_credits — no row, no charge", async () => {
    await planConfig.setCreditPrice("recommendation", 10, 1);
    const userId = await makeUser({ plan: "active", balance: 4 });
    await expectRefusal(userId, "INSUFFICIENT_CREDITS");
    assert.equal(await recommendationCount(userId), 0);
    assert.equal(await credits.getCreditBalance(userId), 4, "balance untouched");
  });

  it("an expired subscription hears ITS name, never the balance's", async () => {
    await planConfig.setCreditPrice("recommendation", 10, 1);
    const userId = await makeUser({ plan: "expired", balance: 100 });
    await expectRefusal(userId, "SUBSCRIPTION_EXPIRED");
    assert.equal(await recommendationCount(userId), 0);
    assert.equal(await credits.getCreditBalance(userId), 100, "the frozen balance is intact");
  });

  it("with no price configured, a paid creation spends nothing", async () => {
    await planConfig.setCreditPrice("recommendation", 0, 1);
    const userId = await makeUser({ plan: "active", balance: 5 });
    await createRec(userId);
    assert.equal(await credits.getCreditBalance(userId), 5);
  });
});
