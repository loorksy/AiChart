import { queryOne } from "@/lib/db";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import type { PublicUser } from "@/lib/types";
import { getEntitlementForUser } from "@/lib/subscription/entitlement";
import { debitCredits, getCreditBalance, type DbExecutor } from "./credits";
import { getCreditPrice, type SpendOp } from "./planConfig";

/**
 * The ONE spend gate. Every surface (web, Telegram, MCP) asks this module the
 * same question and gets one of the same named answers; no surface invents
 * its own reason, and nothing else decides access.
 *
 * There is ONE currency — credits — so there is one question: can this user
 * afford this operation? What differs is only what the user should DO about
 * a refusal, and that is decided here too, not guessed by each surface:
 *
 *   1. suspended account                → account_blocked      (support)
 *   2. subscription expired             → subscription_expired (renew)
 *      Checked BEFORE any look at the balance: a lapsed subscriber is told
 *      to renew, never "your balance ran out". Their credits are frozen —
 *      expiry never spends or deletes them, renewal makes them usable again.
 *   3. subscriber-only feature, Free    → subscription_required (subscribe)
 *      Bound to the SUBSCRIPTION, not the balance: a Free account with
 *      plenty of credits still cannot link a broker.
 *   4. balance < price                  → insufficient_credits
 *      Free  → subscribe (top-ups are for live subscribers only, so
 *               pointing a Free user at a top-up would be a dead end)
 *      Pro   → topup
 *
 * BILLING_ENFORCED (platform panel) is the master switch for CREDIT
 * enforcement. The subscriber-only feature lock is product behaviour and
 * stays enforced regardless of it.
 */

/** Operations only a live subscriber may perform, whatever their balance. */
const SUBSCRIBER_ONLY_OPS: ReadonlySet<SpendOp> = new Set<SpendOp>(["mt5_link"]);

export type SpendRefusalCode =
  | "account_blocked"
  | "subscription_expired"
  | "subscription_required"
  | "insufficient_credits";

/**
 * What the user should DO about a refusal. The server decides this because
 * the same code means different things to different accounts: a Free user
 * out of credits must subscribe (top-ups need a live subscription), while a
 * subscriber out of credits tops up.
 */
export type SpendRefusalAction = "subscribe" | "topup" | "renew" | "support";

export type SpendMode = "admin" | "paid" | "billing_off";

export interface SpendRefusal {
  allowed: false;
  code: SpendRefusalCode;
  action: SpendRefusalAction;
  balance: number | null;
}

export type SpendAllowance = {
  allowed: true;
  mode: SpendMode;
  /** Credits this operation will cost when debited (0 = free). */
  price: number;
  balance: number | null;
  /**
   * Whether this account is a live subscriber. Carried on the ALLOWED
   * decision so a caller whose debit later loses a race can name the right
   * next step without asking the entitlement layer again: the same balance
   * refusal sends Free to subscribe and Pro to top-up.
   */
  hasPaidAccess: boolean;
};

export type SpendDecision = SpendAllowance | SpendRefusal;

/** Where an empty balance should send this account. */
export function balanceRefusalAction(hasPaidAccess: boolean): SpendRefusalAction {
  return hasPaidAccess ? "topup" : "subscribe";
}

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
    return { allowed: false, code: "account_blocked", action: "support", balance: null };
  }
  const snapshot = await getEntitlementForUser(user);
  if (snapshot.isAdmin) {
    return { allowed: true, mode: "admin", price: 0, balance: null, hasPaidAccess: true };
  }
  if (snapshot.planStatus === "suspended") {
    return { allowed: false, code: "account_blocked", action: "support", balance: null };
  }

  // A lapsed subscription outranks every balance question: their credits are
  // frozen, and the fix is renewal, not a top-up.
  if (snapshot.planStatus === "expired") {
    return {
      allowed: false,
      code: "subscription_expired",
      action: "renew",
      balance: await getCreditBalance(userId),
    };
  }

  // Subscriber-only features are gated on the SUBSCRIPTION, never the
  // balance — product behaviour, so it survives the enforcement switch.
  if (SUBSCRIBER_ONLY_OPS.has(op) && !snapshot.hasPaidAccess) {
    return {
      allowed: false,
      code: "subscription_required",
      action: "subscribe",
      balance: null,
    };
  }

  if (!(await billingEnforced())) {
    return {
      allowed: true,
      mode: "billing_off",
      price: 0,
      balance: null,
      hasPaidAccess: snapshot.hasPaidAccess,
    };
  }

  // From here Free and Pro are the same question at the same prices: the
  // only difference is where a refusal sends them.
  const price = await getCreditPrice(op);
  const balance = await getCreditBalance(userId);
  if (price > 0 && balance < price) {
    return {
      allowed: false,
      code: "insufficient_credits",
      // Top-up packs are sold to live subscribers only, so sending a Free
      // account to the top-up page would be a dead end.
      action: balanceRefusalAction(snapshot.hasPaidAccess),
      balance,
    };
  }
  return {
    allowed: true,
    mode: "paid",
    price,
    balance,
    hasPaidAccess: snapshot.hasPaidAccess,
  };
}

export type SpendCommit =
  | { ok: true; charged: number; balance: number | null }
  | { ok: false; code: SpendRefusalCode; action: SpendRefusalAction; balance: number | null };

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
    return {
      ok: false,
      code: decision.code,
      action: decision.action,
      balance: decision.balance,
    };
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
    // The balance emptied between the gate and the debit (a concurrent
    // spend). The conditional debit refused rather than going negative.
    return {
      ok: false,
      code: "insufficient_credits",
      action: balanceRefusalAction(decision.hasPaidAccess),
      balance: debit.balance,
    };
  }
  return {
    ok: true,
    charged: debit.alreadyApplied ? 0 : decision.price,
    balance: debit.balance,
  };
}
