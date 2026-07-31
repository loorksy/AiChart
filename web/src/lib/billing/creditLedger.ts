import { execute, queryOne } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("billing.credits");

/**
 * V2-A2 (#91): v0-style credit accounting.
 *
 * Two buckets per user: `monthly` (the subscription's included credits —
 * reset every period, no rollover) and `topup` (purchased — never expires).
 * Burns drain monthly first, then topup. `credit_ledger` is the append-only
 * audit truth; `credit_balances` is the fast row the gate reads. Every write
 * touches both, ledger first — a crash between the two leaves an auditable
 * trail, never phantom credit.
 */

export interface Balance {
  monthlyUsd: number;
  topupUsd: number;
  totalUsd: number;
  periodEnd: number | null;
}

interface BalanceRow {
  monthly_usd: number;
  topup_usd: number;
  period_end: number | null;
}

export async function getBalance(userId: number): Promise<Balance> {
  const row = await queryOne<BalanceRow>(
    "SELECT monthly_usd, topup_usd, period_end FROM credit_balances WHERE user_id = ?",
    [userId],
  );
  const monthly = row?.monthly_usd ?? 0;
  const topup = row?.topup_usd ?? 0;
  // An expired period's monthly bucket is worth nothing, whatever the row says.
  const expired = row?.period_end != null && row.period_end < Date.now();
  return {
    monthlyUsd: expired ? 0 : monthly,
    topupUsd: topup,
    totalUsd: (expired ? 0 : monthly) + topup,
    periodEnd: row?.period_end ?? null,
  };
}

async function upsertBalance(
  userId: number,
  monthlyUsd: number,
  topupUsd: number,
  periodEnd: number | null,
): Promise<void> {
  const updated = await execute(
    "UPDATE credit_balances SET monthly_usd = ?, topup_usd = ?, period_end = ?, updated_at = ? WHERE user_id = ?",
    [monthlyUsd, topupUsd, periodEnd, Date.now(), userId],
  );
  if (!updated.changes) {
    await execute(
      "INSERT INTO credit_balances (user_id, monthly_usd, topup_usd, period_end, updated_at) VALUES (?, ?, ?, ?, ?)",
      [userId, monthlyUsd, topupUsd, periodEnd, Date.now()],
    );
  }
}

async function writeLedger(
  userId: number,
  kind: string,
  amountUsd: number,
  bucket: "monthly" | "topup",
  ref?: string,
  note?: string,
): Promise<void> {
  await execute(
    "INSERT INTO credit_ledger (user_id, ts, kind, amount_usd, bucket, ref, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [userId, Date.now(), kind, amountUsd, bucket, ref ?? null, note ?? null],
  );
}

/** Period grant: REPLACES the monthly bucket (no rollover), keeps topup. */
export async function grantMonthly(
  userId: number,
  usd: number,
  periodEnd: number,
  kind: "monthly_grant" | "gift" | "trial_grant" = "monthly_grant",
  note?: string,
): Promise<void> {
  const current = await getBalance(userId);
  await writeLedger(userId, kind, usd, "monthly", undefined, note);
  await upsertBalance(userId, usd, current.topupUsd, periodEnd);
}

/** Top-up: adds to the never-expiring bucket. */
export async function grantTopup(
  userId: number,
  usd: number,
  ref?: string,
  note?: string,
): Promise<void> {
  const current = await getBalance(userId);
  await writeLedger(userId, "topup", usd, "topup", ref, note);
  await upsertBalance(
    userId,
    current.monthlyUsd,
    current.topupUsd + usd,
    current.periodEnd,
  );
}

/**
 * Burn retail cost: monthly bucket first, then topup. The last call may push
 * topup slightly negative — the gate blocks the NEXT call, we never abort work
 * already delivered.
 */
export async function burn(userId: number, usd: number, ref?: string): Promise<void> {
  if (usd <= 0) return;
  const current = await getBalance(userId);
  const fromMonthly = Math.min(current.monthlyUsd, usd);
  const fromTopup = usd - fromMonthly;
  if (fromMonthly > 0) await writeLedger(userId, "burn", -fromMonthly, "monthly", ref);
  if (fromTopup > 0) await writeLedger(userId, "burn", -fromTopup, "topup", ref);
  await upsertBalance(
    userId,
    current.monthlyUsd - fromMonthly,
    current.topupUsd - fromTopup,
    current.periodEnd,
  );
}

/** Admin manual adjustment — always into the topup bucket, reason mandatory. */
export async function adjustAdmin(
  userId: number,
  usd: number,
  reason: string,
  adminId: number,
): Promise<void> {
  const current = await getBalance(userId);
  await writeLedger(userId, "adjust", usd, "topup", `admin:${adminId}`, reason);
  await upsertBalance(
    userId,
    current.monthlyUsd,
    current.topupUsd + usd,
    current.periodEnd,
  );
  log.info("admin.adjust", { userId, usd, adminId });
}
