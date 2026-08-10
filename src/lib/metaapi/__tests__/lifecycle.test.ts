import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "metaapi-life-")), "test.db");
delete process.env.DATABASE_URL;
process.env.METAAPI_HOURLY_USD = "0.02";
process.env.BILLING_RETAIL_MULTIPLIER = "1.5";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let lifecycle: any;
let ledger: any;

const HOUR = 3_600_000;

before(async () => {
  db = await import("@/lib/db");
  lifecycle = await import("../lifecycle");
  ledger = await import("@/lib/billing/creditLedger");
  await db.initDb();
  await db.execute(
    "INSERT INTO users (id, email, password_hash, role, status) VALUES (30, 'mt5@t.local', 'x', 'user', 'active')",
  );
});

describe("computeSessionHours", () => {
  it("is minute-resolution and never negative", () => {
    assert.equal(lifecycle.computeSessionHours(0, 2 * HOUR), 2);
    assert.equal(lifecycle.computeSessionHours(0, 90 * 60_000), 1.5);
    assert.equal(lifecycle.computeSessionHours(HOUR, 0), 0);
  });
});

describe("deploy session metering", () => {
  it("opens once, closes with hours + retail burn from the owner's credits", async () => {
    await ledger.grantTopup(30, 10, "seed");
    await lifecycle.openDeploySession(30, "acct-1", "test");
    await lifecycle.openDeploySession(30, "acct-1", "test-dup");
    const open = await db.query(
      "SELECT id FROM metaapi_deploy_sessions WHERE user_id = 30 AND undeployed_at IS NULL",
    );
    assert.equal(open.length, 1, "double-open never double-meters");

    // Backdate the deploy so the session has billable hours.
    await db.execute(
      "UPDATE metaapi_deploy_sessions SET deployed_at = ? WHERE id = ?",
      [Date.now() - 2 * HOUR, open[0].id],
    );
    const closed = await lifecycle.closeDeploySession(30, "acct-1", "idle");
    assert.ok(closed);
    assert.equal(closed.hours, 2);
    // 2h × $0.02 × 1.5 multiplier = $0.06
    assert.ok(Math.abs(closed.retailUsd - 0.06) < 1e-9);

    const balance = await ledger.getBalance(30);
    assert.ok(Math.abs(balance.topupUsd - 9.94) < 1e-9, "burned from credits");

    const again = await lifecycle.closeDeploySession(30, "acct-1", "idle");
    assert.equal(again, null, "closing a closed session is a no-op");
  });
});
