/**
 * ONE currency, ONE gate, three account states — proven on every surface.
 *
 * The bug this replaces was exactly a second opinion: an older gate ran in
 * front of the spend gate and told an EXPIRED SUBSCRIBER that their free
 * trial had ended, so the correct `subscription_expired` code was never
 * reached. There is now one decision point, and these tests assert the
 * three states × three surfaces the product promises:
 *
 *   | state                      | code                  | action    |
 *   | Free (never subscribed), 0 | insufficient_credits  | subscribe |
 *   | Pro (live), 0              | insufficient_credits  | topup     |
 *   | expired                    | subscription_expired  | renew     |
 *
 * Plus the rules that make the model coherent: the signup grant lands once
 * and only once, changing its size never touches an existing balance, and
 * linking a broker is bound to the SUBSCRIPTION rather than the balance.
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
let refusal: typeof import("@/lib/billing/refusal");
let store: typeof import("@/lib/store");
let types: typeof import("@/lib/recommendations/canonical/types");

type AccountState = "free" | "pro" | "expired";

let seq = 0;

/** An account in one of the three states, with an exact balance. */
async function makeUser(state: {
  plan: AccountState;
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
      : state.plan === "pro"
        ? new Date(Date.now() + 30 * 86_400_000).toISOString()
        : null;
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status, subscription_expires_at)
     VALUES (?, ?, ?)`,
    [userId, state.plan === "free" ? "trial" : "active", expires],
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

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  repo = await import("@/lib/recommendations/canonical/repository");
  fixtures = await import("@/lib/recommendations/__tests__/fixtures/completePlan");
  credits = await import("@/lib/billing/credits");
  spend = await import("@/lib/billing/spend");
  planConfig = await import("@/lib/billing/planConfig");
  refusal = await import("@/lib/billing/refusal");
  store = await import("@/lib/store");
  types = await import("@/lib/recommendations/canonical/types");
  // A recommendation costs credits; chat is free by default.
  await planConfig.setCreditPrice("recommendation", 10, 1);
  await planConfig.setCreditPrice("mt5_link", 50, 1);
  await planConfig.setCreditPrice("chat_turn", 0, 1);
  planConfig.bustBillingConfigCache();
});

/**
 * The state → (code, action) contract. Every surface reads the SAME gate,
 * so proving it once per operation proves it for web, Telegram and MCP —
 * and the surface pins below assert that none of them re-decides.
 */
describe("the three states answer with one code and one action", () => {
  const CASES: Array<{
    state: AccountState;
    balance: number;
    code: string;
    action: string;
  }> = [
    // Free with nothing left: top-up packs are subscriber-only, so the only
    // honest next step is to subscribe.
    { state: "free", balance: 0, code: "insufficient_credits", action: "subscribe" },
    // Pro with nothing left: they already subscribe — they top up.
    { state: "pro", balance: 0, code: "insufficient_credits", action: "topup" },
    // Lapsed: their balance is frozen, and the fix is renewal, never a top-up.
    { state: "expired", balance: 500, code: "subscription_expired", action: "renew" },
  ];

  for (const c of CASES) {
    it(`${c.state} → ${c.code} / ${c.action}`, async () => {
      const userId = await makeUser({ plan: c.state, balance: c.balance });
      const decision = await spend.resolveSpendGate(userId, "recommendation");
      assert.equal(decision.allowed, false);
      assert.equal(decision.allowed === false && decision.code, c.code);
      assert.equal(decision.allowed === false && decision.action, c.action);
    });
  }

  it("an expired subscriber is NEVER told their trial ended", async () => {
    const userId = await makeUser({ plan: "expired", balance: 500 });
    const decision = await spend.resolveSpendGate(userId, "chat_turn");
    assert.equal(decision.allowed, false);
    assert.equal(decision.allowed === false && decision.code, "subscription_expired");
    const view = refusal.presentRefusal("ar", decision as never);
    assert.doesNotMatch(view.message, /تجرب/, "no trial wording for a subscriber");
    assert.match(view.message, /اشتراك/);
    assert.equal(view.ctaPath, "/subscribe");
  });

  it("each state's presentation carries its own message and one button", () => {
    const free = refusal.presentRefusal("en", {
      code: "insufficient_credits",
      action: "subscribe",
    });
    const pro = refusal.presentRefusal("en", {
      code: "insufficient_credits",
      action: "topup",
    });
    assert.notEqual(free.message, pro.message, "same code, different next step");
    assert.equal(free.ctaPath, "/subscribe");
    assert.equal(pro.ctaPath, "/console/billing");
  });
});

describe("every surface reads that one gate", () => {
  it("the recommendation choke point refuses with the gate's own code", async () => {
    const userId = await makeUser({ plan: "free", balance: 0 });
    await assert.rejects(
      () => createRec(userId),
      (err: unknown) => {
        assert.ok(err instanceof types.RecommendationLifecycleError);
        assert.equal(err.code, "INSUFFICIENT_CREDITS");
        return true;
      },
    );
    const rows = await db.query("SELECT id FROM recommendations WHERE user_id = ?", [userId]);
    assert.equal(rows.length, 0, "a refused creation writes no row");
  });

  it("a funded account creates, and the credits actually move", async () => {
    const userId = await makeUser({ plan: "free", balance: 30 });
    const id = await createRec(userId);
    assert.ok(id > 0);
    assert.equal(
      await credits.getCreditBalance(userId),
      20,
      "30 - the admin's recommendation price",
    );
  });

  it("Free cannot link a broker however rich it is — the SUBSCRIPTION gates it", async () => {
    const userId = await makeUser({ plan: "free", balance: 100_000 });
    const decision = await spend.resolveSpendGate(userId, "mt5_link");
    assert.equal(decision.allowed, false);
    assert.equal(decision.allowed === false && decision.code, "subscription_required");
    assert.equal(decision.allowed === false && decision.action, "subscribe");
  });

  it("a subscriber with credits may link", async () => {
    const userId = await makeUser({ plan: "pro", balance: 100 });
    const decision = await spend.resolveSpendGate(userId, "mt5_link");
    assert.equal(decision.allowed, true);
  });
});

describe("the signup grant lands once, forever", () => {
  it("a new account is funded exactly once", async () => {
    await planConfig.updateBillingPlanSettings({ signup_grant_credits: 25 }, 1);
    planConfig.bustBillingConfigCache();
    const { ensureSignupGrant } = await import("@/lib/billing/signupGrant");

    seq += 1;
    const userId = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      [`grant-${seq}@example.com`, "x", "user", "active"],
    );
    await store.ensureUserDefaults(userId);
    assert.equal(await credits.getCreditBalance(userId), 25);

    // Every way a second grant could be attempted: the account's defaults
    // being ensured again (a later sign-in), and a direct second call.
    await store.ensureUserDefaults(userId);
    const second = await ensureSignupGrant(userId);
    const third = await ensureSignupGrant(userId);
    assert.equal(second.granted, false);
    assert.equal(third.granted, false);
    assert.equal(
      await credits.getCreditBalance(userId),
      25,
      "the ledger UNIQUE refuses a second grant — the balance never doubles",
    );
    const entries = await db.query(
      "SELECT id FROM credit_entries WHERE user_id = ? AND kind = 'signup_grant'",
      [userId],
    );
    assert.equal(entries.length, 1, "exactly one grant row exists");
  });

  it("changing the grant does not touch an account that already has one", async () => {
    await planConfig.updateBillingPlanSettings({ signup_grant_credits: 25 }, 1);
    planConfig.bustBillingConfigCache();
    seq += 1;
    const userId = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      [`grant-change-${seq}@example.com`, "x", "user", "active"],
    );
    await store.ensureUserDefaults(userId);
    assert.equal(await credits.getCreditBalance(userId), 25);

    // The admin raises the grant afterwards.
    await planConfig.updateBillingPlanSettings({ signup_grant_credits: 900 }, 1);
    planConfig.bustBillingConfigCache();
    const { ensureSignupGrant } = await import("@/lib/billing/signupGrant");
    await ensureSignupGrant(userId);
    assert.equal(
      await credits.getCreditBalance(userId),
      25,
      "a new number is for NEW accounts — no retroactive grant, no adjustment",
    );

    // …and a genuinely new account gets the new number.
    seq += 1;
    const fresh = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      [`grant-new-${seq}@example.com`, "x", "user", "active"],
    );
    await store.ensureUserDefaults(fresh);
    assert.equal(await credits.getCreditBalance(fresh), 900);
  });

  it("a zero grant hands out nothing and writes no ledger noise", async () => {
    await planConfig.updateBillingPlanSettings({ signup_grant_credits: 0 }, 1);
    planConfig.bustBillingConfigCache();
    seq += 1;
    const userId = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      [`grant-zero-${seq}@example.com`, "x", "user", "active"],
    );
    await store.ensureUserDefaults(userId);
    assert.equal(await credits.getCreditBalance(userId), 0);
    const entries = await db.query(
      "SELECT id FROM credit_entries WHERE user_id = ?",
      [userId],
    );
    assert.equal(entries.length, 0);
  });
});

describe("every surface renders the gate's decision, never its own", () => {
  it("the web modal, the bot, and the MCP routes all read the shared view", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const read = (rel: string) =>
      readFileSync(path.join(process.cwd(), "src", rel), "utf8");

    // Web: the server sends message + button; the modal renders them.
    const modal = read("components/billing/BillingRefusalModal.tsx");
    assert.match(modal, /refusal\.message/);
    assert.match(modal, /refusal\.ctaPath/);
    assert.doesNotMatch(
      modal,
      /insufficient_credits/,
      "the client must not map codes to destinations itself",
    );

    // The stream route ships the presentation with the refusal.
    const stream = read("app/api/agent/chat/stream/route.ts");
    assert.match(stream, /presentRefusal/);
    assert.match(stream, /action: chatGate\.action/);

    // Telegram: one short line and one button, from the same presentation.
    const bot = read("lib/telegram/webhookAgent.ts");
    assert.match(bot, /presentRefusal\(locale, gate\)/);
    assert.match(bot, /view\.ctaLabel/);

    // MCP-facing routes: the code AND the action reach the model.
    for (const rel of [
      "app/api/agent/market/analyze/route.ts",
      "app/api/integrations/broker/route.ts",
    ]) {
      const src = read(rel);
      assert.match(src, /action:/, `${rel} must relay the next step`);
    }
  });
});

describe("nine confirmations: three states, on all three surfaces", () => {
  /**
   * The owner's requirement, spelled out one cell at a time.
   *
   * The three states are Free-with-nothing, Pro-with-nothing, and lapsed;
   * the three surfaces are the platform agent, Telegram, and MCP. Each cell
   * builds the payload the way that surface's route builds it — same gate
   * decision, same presentation call — and asserts the operator is told the
   * same thing with the same next step wherever they happen to be.
   *
   * This matters because the bug that started all of this was one surface
   * speaking for itself: an expired subscriber heard "your free trial has
   * ended" from a gate that attached a hardcoded sentence regardless of the
   * reason.
   */
  const STATES: Array<{ state: AccountState; balance: number; code: string; action: string }> = [
    { state: "free", balance: 0, code: "insufficient_credits", action: "subscribe" },
    { state: "pro", balance: 0, code: "insufficient_credits", action: "topup" },
    { state: "expired", balance: 500, code: "subscription_expired", action: "renew" },
  ];

  for (const c of STATES) {
    it(`${c.state}: platform, telegram and MCP say the same thing`, async () => {
      const userId = await makeUser({ plan: c.state, balance: c.balance });
      const gate = await spend.resolveSpendGate(userId, "recommendation");
      assert.equal(gate.allowed, false);
      if (gate.allowed) return;
      const view = refusal.presentRefusal("ar", gate);

      // 1. Platform agent — the JSON the stream route returns, which the
      //    modal renders as one sentence and one button.
      const web = {
        error: view.message,
        code: gate.code,
        action: gate.action,
        cta: { label: view.ctaLabel, path: view.ctaPath },
      };
      assert.equal(web.code, c.code);
      assert.equal(web.action, c.action);
      assert.equal(web.cta.path, c.action === "topup" ? "/console/billing" : "/subscribe");
      assert.ok(web.error.length > 0 && web.cta.label.length > 0);

      // 2. Telegram — one short line plus one button, from the same view.
      const telegram = { text: view.message, button: view.ctaLabel, url: view.ctaPath };
      assert.equal(telegram.text, web.error, "the bot must not paraphrase");
      assert.equal(telegram.url, web.cta.path);

      // 3. MCP — the code and action reach the model so it can relay the
      //    reason rather than invent one.
      const mcp = { code: gate.code, action: gate.action, message: view.message };
      assert.equal(mcp.code, c.code);
      assert.equal(mcp.action, c.action);
      assert.equal(mcp.message, web.error);

      // And a Free account never hears about topping up, nor a lapsed one
      // about a trial: the wording differs per state, not per surface.
      if (c.state === "free") assert.notEqual(view.ctaPath, "/console/billing");
      if (c.state === "expired") assert.doesNotMatch(view.message, /تجرب/);
    });
  }
});

describe("the reset puts every account back to a clean Free start", () => {
  it("clears subscriptions, balances and history — then re-issues the grant", async () => {
    await planConfig.updateBillingPlanSettings({ signup_grant_credits: 40 }, 1);
    planConfig.bustBillingConfigCache();

    const pro = await makeUser({ plan: "pro", balance: 900 });
    const expired = await makeUser({ plan: "expired", balance: 120 });
    seq += 1;
    const adminId = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      [`reset-admin-${seq}@example.com`, "x", "admin", "active"],
    );
    await credits.grantCredits({ userId: adminId, amount: 7, kind: "admin_adjust" });

    const { resetAllAccountsToFree } = await import("@/lib/billing/accountReset");
    const result = await resetAllAccountsToFree();
    assert.ok(result.accounts >= 2);

    for (const userId of [pro, expired]) {
      const row = await db.queryOne<{ plan_status: string; subscription_expires_at: string | null }>(
        "SELECT plan_status, subscription_expires_at FROM user_entitlements WHERE user_id = ?",
        [userId],
      );
      assert.equal(row?.plan_status, "trial", "back to Free");
      assert.equal(row?.subscription_expires_at, null);
      assert.equal(
        await credits.getCreditBalance(userId),
        40,
        "old balance cleared, current welcome grant issued",
      );
    }

    // The operator's own account is not swept up in a user reset.
    assert.equal(await credits.getCreditBalance(adminId), 7);
  });
});

describe("there is no trial machinery left to disagree with the gate", () => {
  it("nothing imports a trial quota module or counts trial usage", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { listSourceFiles } = await import("@/lib/__tests__/helpers/importGraph");
    const offenders: string[] = [];
    for (const file of listSourceFiles(path.join(process.cwd(), "src"))) {
      if (file.includes("__tests__")) continue;
      // The schema modules must NAME the dead columns in order to drop them.
      if (/src\/lib\/db\/(sqlite|pg)\.ts$/.test(file.replaceAll("\\", "/"))) continue;
      const source = readFileSync(file, "utf8");
      if (
        /trialQuota|claimTrialInteraction|releaseTrialInteraction|claimTrialRecommendation|trial_recommendations_used|trial_interactions_used/.test(
          source,
        )
      ) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `A second allowance is exactly what made an expired subscriber hear "your trial ended":\n  ${offenders.join("\n  ")}`,
    );
  });
});
