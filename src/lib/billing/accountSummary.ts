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
 * everything else (trial, exhausted trial, expired). The quiet alerts are
 * threshold facts (admin-set numbers), for banners — never modals.
 */
export interface AccountSummary {
  status: "free" | "pro";
  plan_status: string;
  /** The account's language — the same one the web and the bot use. */
  language: AppLocale;
  balance: number;
  trial_used: number;
  trial_limit: number;
  trial_remaining: number;
  expires_at: string | null;
  alerts: {
    /** Balance at/below the admin threshold (pro accounts only; 0 = off). */
    low_balance: boolean;
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
  const lowBalance =
    pro && plan.low_balance_threshold > 0 && balance <= plan.low_balance_threshold;
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
    trial_used: snapshot.trialUsed,
    trial_limit: snapshot.trialLimit,
    trial_remaining: snapshot.trialRemaining,
    expires_at: snapshot.expiresAt,
    alerts: { low_balance: lowBalance, expiring_soon: expiringSoon },
    thresholds: {
      low_balance: plan.low_balance_threshold,
      expiry_warn_days: plan.expiry_warn_days,
    },
  };
}
