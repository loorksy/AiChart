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
  // The vehicle used to be `trade_intents`, which the execution layer owned and
  // which no longer exists. The PROPERTY it was protecting is unchanged and now
  // matters more, not less: `recommendations` is this platform's core table,
  // and `getRecommendation` carries exactly the same optional-guard shape.
  const recId = await db.insertReturningId(
    `INSERT INTO recommendations (user_id, symbol, action, confidence, status, expires_at)
     VALUES (?,?,?,?,?,?)`,
    [owner, "XAUUSD", "buy", 60, "active", Date.now() + 3_600_000],
  );

  const store = await import("@/lib/store");

  assert.ok(
    await store.getRecommendation(recId, owner),
    "owner reads their own recommendation",
  );
  assert.equal(
    await store.getRecommendation(recId, attacker),
    null,
    "another tenant must NOT read the recommendation",
  );
  assert.ok(
    await store.getRecommendation(recId),
    "internal callers without a guard still resolve",
  );
});
