/**
 * The MT5 link charge and the expiry disconnect — billing v3's contract:
 *
 *  - the ONE-TIME charge and the link row are one transaction: a refused
 *    charge deletes the fresh cloud account, leaves any previous link
 *    untouched, and moves no balance;
 *  - a failed provisioning charges nothing;
 *  - relinking is a NEW link event with a new charge; the same account can
 *    never charge twice (ledger UNIQUE on the account-keyed ref);
 *  - a lapsed subscription UNDEPLOYS the link — and does NOTHING else: the
 *    fake broker below exposes only `undeploy`, so any attempt to touch an
 *    order or position would throw. The link state flips to UNDEPLOYED,
 *    which is exactly what the execution layer's DEPLOYED requirement
 *    refuses on — no change to that layer.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-mt5-charge-"));
process.env.DB_PATH = join(dir, "mt5.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "mt5-test-secret";
process.env.BILLING_ENFORCED = "1";
delete process.env.DATABASE_URL;

let db: typeof import("@/lib/db");
let credits: typeof import("@/lib/billing/credits");
let planConfig: typeof import("@/lib/billing/planConfig");
let linkFlow: typeof import("@/lib/brokerLink/linkFlow");
let sweep: typeof import("@/lib/brokerLink/expirySweep");
let store: typeof import("@/lib/brokerLink/store");

let seq = 0;

async function makeUser(state: {
  plan: "trial" | "active" | "expired";
  balance?: number;
}): Promise<number> {
  seq += 1;
  const userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`mt5-${seq}@example.com`, "x", "user", "active"],
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
      note: "seed",
    });
  }
  return userId;
}

/** Fake MetaAPI: records provisioning calls, exposes NOTHING trade-shaped. */
function fakeMetaapi(behavior: { createFails?: boolean } = {}) {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    create: async (input: { userId: number }) => {
      calls.push("create");
      if (behavior.createFails) throw new Error("provisioning down");
      n += 1;
      return { id: `acct-${input.userId}-${n}`, state: "DEPLOYED" as const };
    },
    remove: async (input: { accountId: string }) => {
      calls.push(`delete:${input.accountId}`);
    },
  };
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  credits = await import("@/lib/billing/credits");
  planConfig = await import("@/lib/billing/planConfig");
  linkFlow = await import("@/lib/brokerLink/linkFlow");
  sweep = await import("@/lib/brokerLink/expirySweep");
  store = await import("@/lib/brokerLink/store");
});

describe("the one-time link charge", () => {
  it("charges once, atomically with the link row, keyed to the account", async () => {
    const userId = await makeUser({ plan: "active", balance: 100 });
    const broker = fakeMetaapi();
    const res = await linkFlow.linkBrokerAccountCharged({
      token: "tok",
      userId,
      server: "Srv-One",
      login: "111",
      password: "pw",
      hasExistingLink: false,
      deps: { create: broker.create, remove: broker.remove, price: async () => 25 },
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.charged, 25);
    assert.equal(await credits.getCreditBalance(userId), 75);
    const entries = await credits.listCreditEntries(userId);
    const debit = entries.find((e) => e.kind === "debit_mt5_link");
    assert.ok(debit && debit.ref?.startsWith("mt5link:acct-"), "ledger keyed to the account");
    const row = await store.getBrokerLink(userId);
    assert.equal(row?.state, "DEPLOYED");
    assert.deepEqual(broker.calls, ["create"], "no cleanup on success");
  });

  it("an insufficient balance at charge time undoes EVERYTHING: no link, no charge, account deleted", async () => {
    const userId = await makeUser({ plan: "active", balance: 10 });
    const broker = fakeMetaapi();
    const res = await linkFlow.linkBrokerAccountCharged({
      token: "tok",
      userId,
      server: "Srv-One",
      login: "111",
      password: "pw",
      hasExistingLink: false,
      deps: { create: broker.create, remove: broker.remove, price: async () => 25 },
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "insufficient_credits");
    assert.equal(await credits.getCreditBalance(userId), 10, "balance untouched");
    assert.equal(await store.getBrokerLink(userId), null, "no link row survives");
    assert.equal(broker.calls.filter((c) => c.startsWith("delete:")).length, 1, "the fresh account was removed");
  });

  it("a failed provisioning charges nothing", async () => {
    const userId = await makeUser({ plan: "active", balance: 50 });
    const broker = fakeMetaapi({ createFails: true });
    await assert.rejects(() =>
      linkFlow.linkBrokerAccountCharged({
        token: "tok",
        userId,
        server: "Srv-One",
        login: "111",
        password: "pw",
        hasExistingLink: false,
        deps: { create: broker.create, remove: broker.remove, price: async () => 25 },
      }),
    );
    assert.equal(await credits.getCreditBalance(userId), 50);
    assert.equal(await store.getBrokerLink(userId), null);
  });

  it("relinking is a NEW event with a new charge; the connection itself never recharges", async () => {
    const userId = await makeUser({ plan: "active", balance: 100 });
    const broker = fakeMetaapi();
    const deps = { create: broker.create, remove: broker.remove, price: async () => 20 };
    const first = await linkFlow.linkBrokerAccountCharged({
      token: "tok",
      userId,
      server: "Srv-One",
      login: "111",
      password: "pw",
      hasExistingLink: false,
      deps,
    });
    assert.equal(first.ok, true);
    const second = await linkFlow.linkBrokerAccountCharged({
      token: "tok",
      userId,
      server: "Srv-One",
      login: "111",
      password: "pw",
      hasExistingLink: true,
      deps,
    });
    assert.equal(second.ok, true);
    assert.equal(await credits.getCreditBalance(userId), 60, "two link events, two charges");
    const entries = await credits.listCreditEntries(userId);
    assert.equal(entries.filter((e) => e.kind === "debit_mt5_link").length, 2);
  });

  it("a free price (0) links without touching the ledger", async () => {
    const userId = await makeUser({ plan: "active", balance: 5 });
    const broker = fakeMetaapi();
    const res = await linkFlow.linkBrokerAccountCharged({
      token: "tok",
      userId,
      server: "Srv-One",
      login: "111",
      password: "pw",
      hasExistingLink: false,
      deps: { create: broker.create, remove: broker.remove, price: async () => 0 },
    });
    assert.equal(res.ok, true);
    assert.equal(await credits.getCreditBalance(userId), 5);
  });
});

describe("subscription expiry disconnects the link — and touches nothing else", () => {
  it("undeploys expired users' links, marks UNDEPLOYED, notifies; active users untouched", async () => {
    const expired = await makeUser({ plan: "expired", balance: 40 });
    const active = await makeUser({ plan: "active" });
    const broker = fakeMetaapi();
    const deps = { create: broker.create, remove: broker.remove, price: async () => 0 };
    for (const userId of [expired, active]) {
      const res = await linkFlow.linkBrokerAccountCharged({
        token: "tok",
        userId,
        server: "Srv-One",
        login: "111",
        password: "pw",
        hasExistingLink: false,
        deps,
      });
      assert.equal(res.ok, true);
    }

    // The sweep's broker surface exposes ONLY undeploy — an attempt to close
    // a position or cancel an order has nowhere to land.
    const touched: string[] = [];
    const notified: number[] = [];
    const result = await sweep.sweepExpiredBrokerLinks({
      token: "tok",
      undeploy: async ({ accountId }) => {
        touched.push(`undeploy:${accountId}`);
      },
      notify: async (userId) => {
        notified.push(userId);
      },
    });

    assert.deepEqual(result.disconnected, [expired]);
    assert.equal(result.failures.length, 0);
    assert.equal(touched.length, 1, "exactly one call, and it is an undeploy");
    assert.ok(touched[0]!.startsWith("undeploy:acct-"), "connection off — nothing else");
    assert.deepEqual(notified, [expired]);

    const expiredRow = await store.getBrokerLink(expired);
    assert.equal(expiredRow?.state, "UNDEPLOYED");
    const activeRow = await store.getBrokerLink(active);
    assert.equal(activeRow?.state, "DEPLOYED", "a live subscriber is never touched");

    // The frozen balance survives the disconnect untouched.
    assert.equal(await credits.getCreditBalance(expired), 40);

    // A second sweep finds nothing: the state filter makes it idempotent.
    const again = await sweep.sweepExpiredBrokerLinks({
      token: "tok",
      undeploy: async () => {
        throw new Error("must not be called again");
      },
    });
    assert.equal(again.scanned, 0);
  });
});
