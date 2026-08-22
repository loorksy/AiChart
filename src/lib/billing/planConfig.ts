import { execute, query, queryOne, transaction } from "@/lib/db";

/**
 * Billing v3 configuration — every priced or bounded number is a DATABASE
 * row the admin edits; zero pricing constants live in code. Zeros here mean
 * "not configured yet", never a price.
 *
 * `plan_prices` rows are IMMUTABLE: changing the platform price inserts a
 * new row and archives the old one; subscribers pin the row they bought.
 */

export interface BillingPlanRow {
  id: 1;
  current_price_id: number | null;
  trial_recommendations: number;
  trial_duration_minutes: number;
  low_balance_threshold: number;
  expiry_warn_days: number;
  updated_at: number;
  updated_by: number | null;
}

export interface PlanPriceRow {
  id: number;
  price_cents: number;
  credits_per_cycle: number;
  cycle_days: number;
  stripe_price_id: string | null;
  created_at: number;
  archived_at: number | null;
}

export type SpendOp = "recommendation" | "chat_turn" | "mt5_link";
export const SPEND_OPS: SpendOp[] = ["recommendation", "chat_turn", "mt5_link"];

/** Hot-path reads cache briefly; admin saves bust it. */
const CACHE_TTL_MS = 15_000;
let planCache: { row: BillingPlanRow; at: number } | null = null;
let priceCache: { map: Map<string, number>; at: number } | null = null;

export function bustBillingConfigCache(): void {
  planCache = null;
  priceCache = null;
}

export async function getBillingPlan(): Promise<BillingPlanRow> {
  if (planCache && Date.now() - planCache.at < CACHE_TTL_MS) return planCache.row;
  let row = await queryOne<BillingPlanRow>(
    `SELECT id, current_price_id, trial_recommendations, trial_duration_minutes,
            low_balance_threshold, expiry_warn_days, updated_at, updated_by
       FROM billing_plan WHERE id = 1`,
  );
  if (!row) {
    // Structural defaults only (trial=3 comes from the product spec; every
    // price stays unset until the admin writes it).
    await execute(
      `INSERT INTO billing_plan (id, trial_recommendations, trial_duration_minutes,
         low_balance_threshold, expiry_warn_days, updated_at)
       VALUES (1, 3, 0, 0, 0, ?)`,
      [Date.now()],
    ).catch(() => {});
    row = await queryOne<BillingPlanRow>(
      `SELECT id, current_price_id, trial_recommendations, trial_duration_minutes,
              low_balance_threshold, expiry_warn_days, updated_at, updated_by
         FROM billing_plan WHERE id = 1`,
    );
  }
  if (!row) throw new Error("billing_plan row missing");
  planCache = { row, at: Date.now() };
  return row;
}

/** Credits one operation costs. Missing row = 0 = free/unpriced. */
export async function getCreditPrice(op: SpendOp): Promise<number> {
  if (!priceCache || Date.now() - priceCache.at >= CACHE_TTL_MS) {
    const rows = await query<{ op: string; credits: number }>(
      "SELECT op, credits FROM credit_prices",
    );
    priceCache = {
      map: new Map(rows.map((r) => [r.op, Number(r.credits) || 0])),
      at: Date.now(),
    };
  }
  return priceCache.map.get(op) ?? 0;
}

export async function setCreditPrice(
  op: SpendOp,
  credits: number,
  adminId: number,
): Promise<void> {
  if (!Number.isInteger(credits) || credits < 0) {
    throw new Error("credit price must be a non-negative integer");
  }
  const now = Date.now();
  const updated = await execute(
    "UPDATE credit_prices SET credits = ?, updated_at = ?, updated_by = ? WHERE op = ?",
    [credits, now, adminId, op],
  );
  if (!updated.changes) {
    await execute(
      "INSERT INTO credit_prices (op, credits, updated_at, updated_by) VALUES (?, ?, ?, ?)",
      [op, credits, now, adminId],
    );
  }
  bustBillingConfigCache();
}

export async function updateBillingPlanSettings(
  patch: Partial<
    Pick<
      BillingPlanRow,
      | "trial_recommendations"
      | "trial_duration_minutes"
      | "low_balance_threshold"
      | "expiry_warn_days"
    >
  >,
  adminId: number,
): Promise<void> {
  const current = await getBillingPlan();
  const next = { ...current, ...patch };
  for (const key of [
    "trial_recommendations",
    "trial_duration_minutes",
    "low_balance_threshold",
    "expiry_warn_days",
  ] as const) {
    const v = next[key];
    if (!Number.isInteger(v) || v < 0) throw new Error(`${key} must be a non-negative integer`);
  }
  await execute(
    `UPDATE billing_plan SET trial_recommendations = ?, trial_duration_minutes = ?,
        low_balance_threshold = ?, expiry_warn_days = ?, updated_at = ?, updated_by = ?
      WHERE id = 1`,
    [
      next.trial_recommendations,
      next.trial_duration_minutes,
      next.low_balance_threshold,
      next.expiry_warn_days,
      Date.now(),
      adminId,
    ],
  );
  bustBillingConfigCache();
}

export async function getCurrentPlanPrice(): Promise<PlanPriceRow | null> {
  const plan = await getBillingPlan();
  if (plan.current_price_id == null) return null;
  return queryOne<PlanPriceRow>(
    `SELECT id, price_cents, credits_per_cycle, cycle_days, stripe_price_id, created_at, archived_at
       FROM plan_prices WHERE id = ?`,
    [plan.current_price_id],
  );
}

export async function getPlanPriceById(id: number): Promise<PlanPriceRow | null> {
  return queryOne<PlanPriceRow>(
    `SELECT id, price_cents, credits_per_cycle, cycle_days, stripe_price_id, created_at, archived_at
       FROM plan_prices WHERE id = ?`,
    [id],
  );
}

/**
 * "Change the price" = INSERT a new immutable row, archive the old, repoint
 * the plan. Never an UPDATE of a live price row — subscribers pinned to the
 * old row keep their terms, and an open checkout carries its own row id.
 */
export async function setPlanPrice(
  input: { priceCents: number; creditsPerCycle: number; cycleDays: number },
  adminId: number,
): Promise<PlanPriceRow> {
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    throw new Error("price_cents must be a non-negative integer");
  }
  if (!Number.isInteger(input.creditsPerCycle) || input.creditsPerCycle < 0) {
    throw new Error("credits_per_cycle must be a non-negative integer");
  }
  if (!Number.isInteger(input.cycleDays) || input.cycleDays <= 0) {
    throw new Error("cycle_days must be a positive integer");
  }
  await getBillingPlan(); // ensure the singleton row exists before repointing it
  const id = await transaction(async (db) => {
    const now = Date.now();
    const previous = await db.query<{ current_price_id: number | null }>(
      "SELECT current_price_id FROM billing_plan WHERE id = 1",
    );
    const newId = await db.insertReturningId(
      `INSERT INTO plan_prices (price_cents, credits_per_cycle, cycle_days, created_at)
       VALUES (?, ?, ?, ?)`,
      [input.priceCents, input.creditsPerCycle, input.cycleDays, now],
    );
    const prevId = previous[0]?.current_price_id ?? null;
    if (prevId != null) {
      await db.execute(
        "UPDATE plan_prices SET archived_at = ? WHERE id = ? AND archived_at IS NULL",
        [now, prevId],
      );
    }
    await db.execute(
      "UPDATE billing_plan SET current_price_id = ?, updated_at = ?, updated_by = ? WHERE id = 1",
      [newId, now, adminId],
    );
    return newId;
  });
  bustBillingConfigCache();
  const row = await getPlanPriceById(id);
  if (!row) throw new Error("plan price insert failed");
  return row;
}
