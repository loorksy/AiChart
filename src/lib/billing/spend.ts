import { queryOne } from "@/lib/db";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import type { PublicUser } from "@/lib/types";
import { getEntitlementForUser } from "@/lib/subscription/entitlement";
import { debitCredits, getCreditBalance, type DbExecutor } from "./credits";
import { getCreditPrice, type SpendOp } from "./planConfig";

/**
 * Billing v3 — the ONE spend gate. Every surface (web, Telegram, MCP) asks
 * this module the same question and gets one of the same named answers; no
 * surface invents its own reason. The precedence is contractual and must
 * never blur:
 *
 *   1. suspended account            → account_blocked
 *   2. subscription expired          → subscription_expired   (before ANY
 *      look at the balance — an expired subscriber is told to renew, never
 *      "your balance ran out")
 *   3. trial exhausted               → trial_exhausted
 *   4. active but balance < price    → insufficient_credits
 *
 * A frozen balance is exactly that: expiry never spends it, never deletes
 * it, and renewal makes the same number usable again.
 *
 * BILLING_ENFORCED (platform panel) is the master switch for CREDIT
 * enforcement and the expired/insufficient refusals. The trial
 * recommendation counter is product behavior and stays enforced at the
 * recommendation choke point regardless of the switch.
 */

export type SpendRefusalCode =
  | "subscription_expired"
  | "insufficient_credits"
  | "trial_exhausted"
  | "trial_locked_feature"
  | "account_blocked";

export type SpendMode = "admin" | "paid" | "trial" | "billing_off";

export type SpendDecision =
  | {
      allowed: true;
      mode: SpendMode;
      /** Credits this operation will cost when debited (0 = free). */
      price: number;
      balance: number | null;
    }
  | { allowed: false; code: SpendRefusalCode; balance: number | null };

export async function billingEnforced(): Promise<boolean> {
  try {
    const raw = await getPlatformValueAsync("BILLING_ENFORCED");
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

async function loadUser(
  userId: number,
): Promise<Pick<PublicUser, "id" | "role" | "status"> | null> {
  return queryOne<Pick<PublicUser, "id" | "role" | "status">>(
    "SELECT id, role, status FROM users WHERE id = ?",
    [userId],
  );
}

/**
 * The read-only decision: may this user perform `op`, and at what price?
 * UI contexts and preflights call this; the DEBIT itself happens through
 * `debitForSpend` inside the operation's own transaction.
 */
export async function resolveSpendGate(
  userId: number,
  op: SpendOp,
): Promise<SpendDecision> {
  const user = await loadUser(userId);
  if (!user || user.status === "suspended") {
    return { allowed: false, code: "account_blocked", balance: null };
  }
  const snapshot = await getEntitlementForUser(user);
  if (snapshot.isAdmin) {
    return { allowed: true, mode: "admin", price: 0, balance: null };
  }
  if (snapshot.planStatus === "suspended") {
    return { allowed: false, code: "account_blocked", balance: null };
  }

  if (!(await billingEnforced())) {
    // Credit enforcement off: everything spends nothing. Trial counting at
    // the recommendation choke point still applies (product behavior).
    if (snapshot.planStatus === "trial" && snapshot.access !== "trial") {
      return { allowed: false, code: "trial_exhausted", balance: null };
    }
    if (snapshot.planStatus === "trial" && op === "mt5_link") {
      return { allowed: false, code: "trial_locked_feature", balance: null };
    }
    return { allowed: true, mode: "billing_off", price: 0, balance: null };
  }

  if (snapshot.hasPaidAccess) {
    const price = await getCreditPrice(op);
    const balance = await getCreditBalance(userId);
    if (price > 0 && balance < price) {
      return { allowed: false, code: "insufficient_credits", balance };
    }
    return { allowed: true, mode: "paid", price, balance };
  }

  if (snapshot.planStatus === "expired") {
    // The frozen-balance state: renewal is the fix, never a top-up.
    return {
      allowed: false,
      code: "subscription_expired",
      balance: await getCreditBalance(userId),
    };
  }

  // Trial.
  if (op === "mt5_link") {
    return { allowed: false, code: "trial_locked_feature", balance: null };
  }
  if (snapshot.access === "trial") {
    return { allowed: true, mode: "trial", price: 0, balance: null };
  }
  return { allowed: false, code: "trial_exhausted", balance: null };
}

export type SpendCommit =
  | { ok: true; charged: number; balance: number | null }
  | { ok: false; code: SpendRefusalCode; balance: number | null };

const DEBIT_KIND: Record<SpendOp, "debit_recommendation" | "debit_chat" | "debit_mt5_link"> = {
  recommendation: "debit_recommendation",
  chat_turn: "debit_chat",
  mt5_link: "debit_mt5_link",
};

/**
 * Authorize AND debit, atomically with the operation: pass the operation's
 * own transaction executor and the debit commits or rolls back WITH the
 * work. `ref` makes the debit idempotent (redelivered work charges once) —
 * that guarantee is the ledger's UNIQUE constraint, nothing in code.
 */
export async function authorizeAndDebit(
  input: { userId: number; op: SpendOp; ref: string; note?: string },
  db?: DbExecutor,
): Promise<SpendCommit> {
  const decision = await resolveSpendGate(input.userId, input.op);
  if (!decision.allowed) {
    return { ok: false, code: decision.code, balance: decision.balance };
  }
  if (decision.mode !== "paid" || decision.price <= 0) {
    return { ok: true, charged: 0, balance: decision.balance };
  }
  const debit = await debitCredits(
    {
      userId: input.userId,
      amount: decision.price,
      kind: DEBIT_KIND[input.op],
      ref: input.ref,
      note: input.note ?? null,
    },
    db,
  );
  if (!debit.ok) {
    return { ok: false, code: "insufficient_credits", balance: debit.balance };
  }
  return {
    ok: true,
    charged: debit.alreadyApplied ? 0 : decision.price,
    balance: debit.balance,
  };
}
