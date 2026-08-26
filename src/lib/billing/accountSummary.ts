import type { PublicUser } from "@/lib/types";
import { getEntitlementForUser } from "@/lib/subscription/entitlement";
import { getCreditBalance } from "./credits";
import { getBillingPlan } from "./planConfig";
import { resolveUserLocale } from "@/lib/i18n/userLocale";
import type { AppLocale } from "@/lib/i18n";

/**
 * The account-status surface (billing v3): ONE composed answer every surface
 * reads — the web badge/panel, the Telegram command, and the MCP tool — so
 * the user's state is never derived twice in two ways.
 *
 * `status` is the two-value badge: `pro` for a live subscription, `free` for
 * everything else (never subscribed, or expired). There is no trial state to
 * report any more — a Free account simply has a balance like everyone else.
 * The quiet alerts are threshold facts (admin-set numbers), for banners —
 * never modals.
 */
export interface AccountSummary {
  status: "free" | "pro";
  plan_status: string;
  /** The account's language — the same one the web and the bot use. */
  language: AppLocale;
  balance: number;
  expires_at: string | null;
  alerts: {
    /**
     * Balance LOW but not gone: above zero and at/below the admin threshold
     * (pro accounts only; 0 = off). Mutually exclusive with `exhausted` —
     * an account at zero must never be told it is "running low".
     */
    low_balance: boolean;
    /**
     * Balance fully spent (zero or below), free or pro. Spending operations
     * are refused in this state, so the surfaces must say THAT — "your
     * balance has run out" with a renewal/top-up path — not a warning about
     * something that already happened.
     */
    exhausted: boolean;
    /** Subscription ends within the admin warning window (0 = off). */
    expiring_soon: boolean;
  };
  thresholds: {
    low_balance: number;
    expiry_warn_days: number;
  };
}

export async function buildAccountSummary(
  user: Pick<PublicUser, "id" | "role" | "status">,
  now = Date.now(),
): Promise<AccountSummary> {
  const [snapshot, balance, plan] = await Promise.all([
    getEntitlementForUser(user),
    getCreditBalance(user.id),
    getBillingPlan(),
  ]);
  const pro = snapshot.isAdmin || snapshot.hasPaidAccess;
  const expiresMs = snapshot.expiresAt ? new Date(snapshot.expiresAt).getTime() : null;
  // Admins never pay per operation, so an empty balance stops nothing for them.
  const exhausted = !snapshot.isAdmin && balance <= 0;
  const lowBalance =
    pro &&
    !exhausted &&
    plan.low_balance_threshold > 0 &&
    balance <= plan.low_balance_threshold;
  const expiringSoon =
    pro &&
    plan.expiry_warn_days > 0 &&
    expiresMs != null &&
    expiresMs - now <= plan.expiry_warn_days * 86_400_000 &&
    expiresMs > now;
  return {
    status: pro ? "pro" : "free",
    plan_status: snapshot.planStatus,
    // The account's language travels with its status, so the MCP surface
    // answers this user in the language they chose on the web instead of
    // guessing one per client.
    language: await resolveUserLocale(user.id),
    balance,
    expires_at: snapshot.expiresAt,
    alerts: { low_balance: lowBalance, exhausted, expiring_soon: expiringSoon },
    thresholds: {
      low_balance: plan.low_balance_threshold,
      expiry_warn_days: plan.expiry_warn_days,
    },
  };
}
