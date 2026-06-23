/**
 * DB-backed lease locks for safe concurrency across instances.
 *
 * Two cloud-scale hazards motivated this:
 *   1. Overlapping/duplicated cron invocations (or >1 web replica) double-run
 *      scalp ticks and deep monitor scans — duplicate LLM spend and trades.
 *   2. A scalp tick for one user can re-enter before the previous tick finishes.
 *
 * The lock is a single row keyed by name with an expiry (lease). Acquisition is
 * an atomic conditional UPSERT: insert if absent, or steal only if the existing
 * lease has expired. On Postgres the ON CONFLICT row lock serializes stealers so
 * exactly one wins; on single-writer SQLite there is no concurrency to race.
 * Leases auto-expire so a crashed holder never deadlocks the system.
 */
import crypto from "node:crypto";

import { execute } from "./db";

export interface LockHandle {
  name: string;
  token: string;
}

/**
 * Try to acquire `name` for `ttlMs`. Returns a handle if acquired, else null.
 * `changes > 0` is true only when this exact statement inserted or stole the
 * lease, which is the atomic signal that we now hold it.
 */
export async function acquireLock(
  name: string,
  ttlMs: number,
  holder?: string,
): Promise<LockHandle | null> {
  const token = holder ?? crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + ttlMs;
  const res = await execute(
    `INSERT INTO locks (name, holder, expires_at) VALUES (?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
     WHERE locks.expires_at < ?`,
    [name, token, expiresAt, now],
  );
  return res.changes > 0 ? { name, token } : null;
}

/** Release a lock we hold (no-op if the lease was already stolen/expired). */
export async function releaseLock(handle: LockHandle): Promise<void> {
  await execute("DELETE FROM locks WHERE name = ? AND holder = ?", [
    handle.name,
    handle.token,
  ]);
}

/** Extend our lease (e.g. mid long cron). Returns true if still held by us. */
export async function renewLock(
  handle: LockHandle,
  ttlMs: number,
): Promise<boolean> {
  const res = await execute(
    "UPDATE locks SET expires_at = ? WHERE name = ? AND holder = ?",
    [Date.now() + ttlMs, handle.name, handle.token],
  );
  return res.changes > 0;
}

export type WithLockResult<T> =
  | { ran: true; result: T }
  | { ran: false; result?: undefined };

/**
 * Run `fn` only if the lock is acquired; otherwise return `{ ran: false }`.
 * Always releases on completion (including errors).
 */
export async function withLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<WithLockResult<T>> {
  const handle = await acquireLock(name, ttlMs);
  if (!handle) return { ran: false };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await releaseLock(handle);
  }
}
