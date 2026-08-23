/**
 * The account-status surface — one derivation for every surface:
 *
 *  - `status` is the two-value badge (pro = live subscription, free =
 *    everything else) with the numbers each state needs: balance and the
 *    expiry date;
 *  - the quiet alerts fire exactly on the ADMIN thresholds (data, not
 *    constants) and only for pro accounts;
 *  - the UI reads state as TEXT, never color alone, and the balance chip's
 *    LOW state comes from the same thresholds.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-account-status-"));
process.env.DB_PATH = join(dir, "status.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "status-test-secret";
delete process.env.DATABASE_URL;

let db: typeof import("@/lib/db");
let credits: typeof import("@/lib/billing/credits");
let planConfig: typeof import("@/lib/billing/planConfig");
let summaryMod: typeof import("@/lib/billing/accountSummary");

let seq = 0;
async function makeUser(state: {
  plan: "trial" | "active" | "expired";
  balance?: number;
  expiresInDays?: number;
}): Promise<{ id: number; role: "user"; status: "active" }> {
  seq += 1;
  const id = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`status-${seq}@example.com`, "x", "user", "active"],
  );
  const expires =
    state.plan === "expired"
      ? new Date(Date.now() - 60_000).toISOString()
      : state.plan === "active"
        ? new Date(Date.now() + (state.expiresInDays ?? 30) * 86_400_000).toISOString()
        : null;
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status, subscription_expires_at)
     VALUES (?, ?, ?)`,
    [id, state.plan === "trial" ? "trial" : "active", expires],
  );
  if (state.balance) {
    await credits.grantCredits({ userId: id, amount: state.balance, kind: "admin_adjust", note: "seed" });
  }
  return { id, role: "user", status: "active" };
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  credits = await import("@/lib/billing/credits");
  planConfig = await import("@/lib/billing/planConfig");
  summaryMod = await import("@/lib/billing/accountSummary");
});

describe("buildAccountSummary", () => {
  it("a never-subscribed account reads free, with its balance", async () => {
    const user = await makeUser({ plan: "trial", balance: 40 });
    const s = await summaryMod.buildAccountSummary(user);
    assert.equal(s.status, "free");
    assert.equal(s.plan_status, "trial");
    // ONE currency: a Free account is described by its BALANCE, never by a
    // separate trial allowance.
    assert.equal(s.balance, 40);
    assert.equal(s.alerts.low_balance, false);
    assert.equal(s.alerts.expiring_soon, false);
  });

  it("a live subscriber reads pro with balance and expiry date", async () => {
    const user = await makeUser({ plan: "active", balance: 500 });
    const s = await summaryMod.buildAccountSummary(user);
    assert.equal(s.status, "pro");
    assert.equal(s.balance, 500);
    assert.ok(s.expires_at, "the expiry date is part of the panel facts");
  });

  it("an expired subscriber reads free — with the frozen balance still visible", async () => {
    const user = await makeUser({ plan: "expired", balance: 120 });
    const s = await summaryMod.buildAccountSummary(user);
    assert.equal(s.status, "free");
    assert.equal(s.plan_status, "expired");
    assert.equal(s.balance, 120, "frozen, not hidden and not deleted");
  });

  it("the quiet alerts fire exactly on the ADMIN thresholds", async () => {
    await planConfig.updateBillingPlanSettings(
      { low_balance_threshold: 50, expiry_warn_days: 5 },
      1,
    );
    planConfig.bustBillingConfigCache();

    const low = await makeUser({ plan: "active", balance: 30 });
    const lowSummary = await summaryMod.buildAccountSummary(low);
    assert.equal(lowSummary.alerts.low_balance, true, "30 <= threshold 50");

    const fine = await makeUser({ plan: "active", balance: 500, expiresInDays: 30 });
    const fineSummary = await summaryMod.buildAccountSummary(fine);
    assert.equal(fineSummary.alerts.low_balance, false);
    assert.equal(fineSummary.alerts.expiring_soon, false, "30 days out > 5-day window");

    const ending = await makeUser({ plan: "active", balance: 500, expiresInDays: 3 });
    const endingSummary = await summaryMod.buildAccountSummary(ending);
    assert.equal(endingSummary.alerts.expiring_soon, true, "3 days < 5-day window");

    await planConfig.updateBillingPlanSettings(
      { low_balance_threshold: 0, expiry_warn_days: 0 },
      1,
    );
    planConfig.bustBillingConfigCache();
    const off = await summaryMod.buildAccountSummary(low);
    assert.equal(off.alerts.low_balance, false, "0 = the alert is off");
  });
});

describe("the status UI is readable without color", () => {
  const SRC = path.join(process.cwd(), "src");

  it("the badge spells the state as TEXT and marks alerts for screen readers", () => {
    const badge = readFileSync(
      path.join(SRC, "components/billing/AccountStatusBadge.tsx"),
      "utf8",
    );
    assert.match(badge, /account\.badge\.pro/);
    assert.match(badge, /account\.badge\.free/);
    assert.match(badge, /sr-only/, "the alert dot alone is never the message");
  });

  it("the balance chip reads the shared summary and the admin threshold — no constants", () => {
    const chip = readFileSync(path.join(SRC, "components/shell/BalanceChip.tsx"), "utf8");
    assert.match(chip, /useBillingSummary/);
    assert.match(chip, /alerts\.low_balance/);
    assert.doesNotMatch(chip, /LOW_BALANCE_USD/);
  });

  it("completed turns and link submissions refresh the badge instantly", () => {
    const hook = readFileSync(path.join(SRC, "hooks/useSmartChartAgent.ts"), "utf8");
    assert.match(hook, /notifyBillingChanged\(\)/);
    const card = readFileSync(
      path.join(SRC, "components/settings/BrokerLinkCard.tsx"),
      "utf8",
    );
    assert.match(card, /notifyBillingChanged\(\)/);
  });
});
