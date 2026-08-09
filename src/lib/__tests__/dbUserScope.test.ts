import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("admin bootstrap has no tracked default credentials", () => {
  const constants = readFileSync(
    join(process.cwd(), "src", "lib", "constants.ts"),
    "utf8",
  );
  const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
  assert.match(constants, /process\.env\.ADMIN_EMAIL\?\.trim\(\) \|\| ""/);
  assert.match(constants, /process\.env\.ADMIN_PASSWORD \|\| ""/);
  assert.match(example, /^ADMIN_PASSWORD=$/m);
  assert.match(example, /^AICHART_GATE_PASSWORD=$/m);
});

/**
 * Defense-in-depth: id-only store helpers must honor an optional userId guard so
 * a forgotten ownership check at a call site cannot leak or mutate another
 * tenant's row. We drive the real SQLite backend on a throwaway DB file.
 * The db layer is a module singleton, so all assertions share one setup.
 */
test("store helpers enforce the optional userId guard", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-scope-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["owner@test.com", "x", "user", "active"],
  );
  const attacker = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["attacker@test.com", "x", "user", "active"],
  );
  const intentId = await db.insertReturningId(
    "INSERT INTO trade_intents (user_id, symbol, side, notional, status) VALUES (?,?,?,?,?)",
    [owner, "EURUSD", "buy", 100, "pending"],
  );

  const store = await import("@/lib/store");

  // getIntent scoping
  assert.ok(await store.getIntent(intentId, owner), "owner reads their own intent");
  assert.equal(
    await store.getIntent(intentId, attacker),
    null,
    "another tenant must NOT read the intent",
  );
  assert.ok(
    await store.getIntent(intentId),
    "internal callers without a guard still resolve",
  );

  // updateIntentStatus scoping
  await store.updateIntentStatus(intentId, "rejected", "attacker", attacker);
  const afterAttack = await db.queryOne<{ status: string }>(
    "SELECT status FROM trade_intents WHERE id = ?",
    [intentId],
  );
  assert.equal(afterAttack?.status, "pending", "attacker write must be a no-op");

  await store.updateIntentStatus(intentId, "approved", "owner", owner);
  const afterOwner = await db.queryOne<{ status: string }>(
    "SELECT status FROM trade_intents WHERE id = ?",
    [intentId],
  );
  assert.equal(afterOwner?.status, "approved", "owner write must apply");

  // updateIntentDenied persists the structured execution denial, scoped by user.
  const denyId = await db.insertReturningId(
    "INSERT INTO trade_intents (user_id, symbol, side, notional, status) VALUES (?,?,?,?,?)",
    [owner, "GBPUSD", "sell", 80, "approved"],
  );
  await store.updateIntentDenied(denyId, "daily loss limit", "RISK_LIMIT", attacker);
  const notDenied = await db.queryOne<{ status: string; deny_code: string | null }>(
    "SELECT status, deny_code FROM trade_intents WHERE id = ?",
    [denyId],
  );
  assert.equal(notDenied?.status, "approved", "wrong tenant cannot deny");
  assert.equal(notDenied?.deny_code, null);

  await store.updateIntentDenied(denyId, "daily loss limit", "RISK_LIMIT", owner);
  const denied = await db.queryOne<{ status: string; deny_code: string | null }>(
    "SELECT status, deny_code FROM trade_intents WHERE id = ?",
    [denyId],
  );
  assert.equal(denied?.status, "failed");
  assert.equal(denied?.deny_code, "RISK_LIMIT", "deny code is persisted");
});
