/**
 * The welcome balance — handed to an account ONCE, forever.
 *
 * This replaces the old free-trial allowance. There is no separate trial
 * currency to reconcile: a new account simply starts with credits and spends
 * them at the ordinary prices, so every surface can ask the one spend gate
 * the one question ("can this user afford this?") and nothing else.
 *
 * Once-ever is a DATABASE guarantee, not a code check. The ledger carries a
 * partial UNIQUE on (user_id, kind, ref); this grant always writes
 * kind='signup_grant', ref='signup:<userId>', so a second attempt — from a
 * re-login, a re-registration race, a new Telegram link, a worker restart,
 * or an admin clicking twice — inserts nothing and moves no balance.
 *
 * Changing the grant size in the admin panel therefore affects NEW accounts
 * only: an account that already has its entry can never receive another,
 * whatever the number says today.
 */
import { createLogger } from "@/lib/logger";
import { grantCredits } from "./credits";
import { getBillingPlan } from "./planConfig";

const log = createLogger("billing.signup_grant");

export function signupGrantRef(userId: number): string {
  return `signup:${userId}`;
}

export interface SignupGrantResult {
  /** True only when THIS call moved the balance. */
  granted: boolean;
  amount: number;
}

/**
 * Give this account its welcome balance if it has never had one.
 *
 * Best-effort by design: a failure here must never block a registration or
 * a sign-in. The next call retries, and the UNIQUE key keeps that safe.
 */
export async function ensureSignupGrant(userId: number): Promise<SignupGrantResult> {
  try {
    const plan = await getBillingPlan();
    const amount = Math.max(0, plan.signup_grant_credits | 0);
    // A zero grant is a legitimate configuration ("no welcome balance"), and
    // writing a zero-amount ledger row would be noise.
    if (amount <= 0) return { granted: false, amount: 0 };

    const result = await grantCredits({
      userId,
      amount,
      kind: "signup_grant",
      ref: signupGrantRef(userId),
      note: "signup grant",
    });
    return { granted: result.applied, amount };
  } catch (err) {
    log.warn("signup grant skipped", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { granted: false, amount: 0 };
  }
}
