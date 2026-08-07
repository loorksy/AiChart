import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "credits-gate-")), "test.db");
delete process.env.DATABASE_URL;
// Enforce billing for gate tests via env-backed platform value.
process.env.BILLING_ENFORCED = "1";
process.env.TRIAL_CREDIT_USD = "3";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let ledger: any;
let gate: any;
let tiers: any;

const DAY = 24 * 60 * 60 * 1000;

before(async () => {
  db = await import("@/lib/db");
  ledger = await import("../creditLedger");
  gate = await import("../gate");
  tiers = await import("../tiers");
  await db.initDb();
  // The gate needs real users for FK integrity.
  for (const id of [1, 2, 3, 4]) {
    await db.execute(
      "INSERT INTO users (id, email, password_hash, role, status) VALUES (?, ?, 'x', 'user', 'active')",
      [id, `u${id}@test.local`],
    );
  }
});

describe("credit ledger", () => {
  it("burns monthly first, then topup, and audits every movement", async () => {
    await ledger.grantMonthly(1, 10, Date.now() + 30 * DAY);
    await ledger.grantTopup(1, 5, "stripe:test");
    await ledger.burn(1, 12, "req-1");
    const b = await ledger.getBalance(1);
    assert.equal(b.monthlyUsd, 0);
    assert.ok(Math.abs(b.topupUsd - 3) < 1e-9);
    const rows = await db.query(
      "SELECT kind, bucket, amount_usd FROM credit_ledger WHERE user_id = 1 ORDER BY id",
    );
    // grant + topup + two burn legs (monthly then topup).
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((r: { kind: string; bucket: string }) => `${r.kind}:${r.bucket}`),
      ["monthly_grant:monthly", "topup:topup", "burn:monthly", "burn:topup"],
    );
  });

  it("monthly grant replaces the bucket — no rollover — and keeps topup", async () => {
    await ledger.grantMonthly(2, 20, Date.now() + 30 * DAY);
    await ledger.grantTopup(2, 7);
    await ledger.burn(2, 5);
    await ledger.grantMonthly(2, 20, Date.now() + 60 * DAY);
    const b = await ledger.getBalance(2);
    assert.equal(b.monthlyUsd, 20, "fresh grant, not 35");
    assert.equal(b.topupUsd, 7, "topup untouched by the period reset");
  });

  it("an expired period is worth zero even before any write", async () => {
    await ledger.grantMonthly(3, 50, Date.now() - DAY);
    const b = await ledger.getBalance(3);
    assert.equal(b.monthlyUsd, 0);
  });
});

describe("spend gate", () => {
  it("grants the one-time trial to a new user, then allows until it runs dry", async () => {
    const first = await gate.checkSpendAllowed(4);
    assert.equal(first.allowed, true);
    assert.equal(first.reason, "trial");
    assert.ok(Math.abs(first.balanceUsd - 3) < 1e-9);

    await ledger.burn(4, 3, "spent-it-all");
    const second = await gate.checkSpendAllowed(4);
    assert.equal(second.allowed, false);
    assert.equal(second.reason, "no_subscription");
    assert.ok(second.message!.includes("اشترك"), "block message names the fix");

    // The trial never re-grants.
    const grants = await db.query(
      "SELECT id FROM credit_ledger WHERE user_id = 4 AND kind = 'trial_grant'",
    );
    assert.equal(grants.length, 1);
  });

  it("allows an active subscriber with balance and blocks at zero", async () => {
    const now = Date.now();
    await db.execute(
      `INSERT INTO subscriptions (user_id, tier, status, started_at, current_period_start, current_period_end, updated_at)
       VALUES (1, 'plus', 'active', ?, ?, ?, ?)`,
      [now, now, now + 30 * DAY, now],
    );
    // User 1 still has $3 topup from the ledger test.
    const ok = await gate.checkSpendAllowed(1);
    assert.equal(ok.allowed, true);
    assert.equal(ok.reason, "subscribed");
    assert.equal(ok.tier.id, "full"); // legacy "plus" row resolves to the one plan

    await ledger.burn(1, 999, "drain");
    const blocked = await gate.checkSpendAllowed(1);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, "no_credits");
    assert.ok(blocked.message!.includes("اشحن"));
  });
});

describe("tiers (single plan)", () => {
  it("one $180 plan with every feature on and the whole model catalogue", () => {
    assert.deepEqual(tiers.TIER_ORDER, ["full"]);
    const plan = tiers.TIERS.full;
    assert.equal(plan.priceUsd, 180);
    assert.ok(plan.priceUsd <= 400, "hard price ceiling");
    assert.ok(plan.includedCreditsUsd > 0);
    for (const enabled of Object.values(plan.features)) {
      assert.equal(enabled, true);
    }
    assert.equal(plan.allowedModels.length, 0);
    assert.equal(tiers.tierAllowsModel("full", "anthropic/claude-fable-5"), true);
  });

  it("legacy tier ids keep resolving — stored rows must not orphan", () => {
    for (const legacy of ["lite", "plus", "pro", "promax"]) {
      assert.equal(tiers.tierDef(legacy)?.id, "full");
    }
    assert.equal(tiers.tierDef("nonsense"), null);
  });
});
