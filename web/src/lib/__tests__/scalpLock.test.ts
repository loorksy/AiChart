import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Lease locks must: grant to exactly one holder, reject a second acquirer while
 * held, allow re-acquisition once the lease expires, and release on demand.
 * This is the concurrency primitive that stops double scalp ticks / cron runs.
 */
test("acquireLock/releaseLock/withLock provide mutual exclusion with expiry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-lock-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const { acquireLock, releaseLock, withLock } = await import("@/lib/locks");

  // First acquirer wins; second is rejected while the lease is held.
  const a = await acquireLock("scalp:user:1", 10_000);
  assert.ok(a, "first acquirer should win");
  const b = await acquireLock("scalp:user:1", 10_000);
  assert.equal(b, null, "second acquirer must be rejected while held");

  // After release, it can be acquired again.
  await releaseLock(a!);
  const c = await acquireLock("scalp:user:1", 50);
  assert.ok(c, "re-acquire after release");

  // After the lease expires, a new holder may steal it.
  await new Promise((r) => setTimeout(r, 80));
  const d = await acquireLock("scalp:user:1", 10_000);
  assert.ok(d, "expired lease can be stolen");
  await releaseLock(d!);

  // withLock runs the body once and is a no-op when already held.
  const held = await acquireLock("cron:scalp", 10_000);
  assert.ok(held);
  const skipped = await withLock("cron:scalp", 10_000, async () => "ran");
  assert.equal(skipped.ran, false, "withLock must skip when already held");
  await releaseLock(held!);
  const ran = await withLock("cron:scalp", 10_000, async () => "ran");
  assert.equal(ran.ran, true);
  assert.equal(ran.ran ? ran.result : null, "ran");
});
