import { queryOne } from "@/lib/db";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { getBalance, grantMonthly } from "./creditLedger";
import { tierDef, type TierDef } from "./tiers";
import { createLogger } from "@/lib/logger";

const log = createLogger("billing.gate");

/**
 * V2-A2 (#91): the ONE enforcement point AI-spending routes call before
 * running the agent.
 *
 * Flag-gated: with BILLING_ENFORCED unset/off the gate always allows —
 * today's behavior, unchanged, until Stripe is live and the operator flips
 * the flag. Blocking refuses NEW work only; it never interrupts a running
 * analysis, and browsing stays untouched (the gate simply isn't consulted
 * on read-only routes).
 */

export interface SubscriptionRow {
  tier: string;
  status: string;
  current_period_end: number;
}

export interface GateResult {
  allowed: boolean;
  reason: "billing_off" | "subscribed" | "trial" | "no_credits" | "no_subscription";
  balanceUsd: number;
  tier: TierDef | null;
  /** Arabic operator-facing message when blocked. */
  message?: string;
}

export async function billingEnforced(): Promise<boolean> {
  try {
    const raw = await getPlatformValueAsync("BILLING_ENFORCED");
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

export async function getSubscription(userId: number): Promise<SubscriptionRow | null> {
  return queryOne<SubscriptionRow>(
    "SELECT tier, status, current_period_end FROM subscriptions WHERE user_id = ?",
    [userId],
  );
}

async function trialCreditUsd(): Promise<number> {
  try {
    const raw = Number(await getPlatformValueAsync("TRIAL_CREDIT_USD"));
    return Number.isFinite(raw) && raw >= 0 ? raw : 3;
  } catch {
    return 3;
  }
}

/** Has this user EVER received the one-time trial grant? */
async function trialAlreadyGranted(userId: number): Promise<boolean> {
  const row = await queryOne(
    "SELECT id FROM credit_ledger WHERE user_id = ? AND kind = 'trial_grant' LIMIT 1",
    [userId],
  );
  return row != null;
}

export async function checkSpendAllowed(userId: number): Promise<GateResult> {
  if (!(await billingEnforced())) {
    return { allowed: true, reason: "billing_off", balanceUsd: 0, tier: null };
  }

  const sub = await getSubscription(userId);
  const active =
    sub && sub.status === "active" && sub.current_period_end > Date.now();
  const tier = active ? tierDef(sub!.tier) : null;

  if (!active) {
    // No live subscription: the one-time trial credit carries new users.
    if (!(await trialAlreadyGranted(userId))) {
      const usd = await trialCreditUsd();
      if (usd > 0) {
        await grantMonthly(
          userId,
          usd,
          Date.now() + 30 * 24 * 60 * 60 * 1000,
          "trial_grant",
          "one-time trial credit",
        );
        log.info("trial.granted", { userId, usd });
      }
    }
    const balance = await getBalance(userId);
    if (balance.totalUsd > 0) {
      return { allowed: true, reason: "trial", balanceUsd: balance.totalUsd, tier: null };
    }
    return {
      allowed: false,
      reason: "no_subscription",
      balanceUsd: balance.totalUsd,
      tier: null,
      message:
        "انتهى رصيدك التجريبي. اشترك في إحدى الباقات لمواصلة استخدام التحليل الذكي — التصفح ومتابعة توصياتك السابقة متاحان دائماً.",
    };
  }

  const balance = await getBalance(userId);
  if (balance.totalUsd <= 0) {
    return {
      allowed: false,
      reason: "no_credits",
      balanceUsd: balance.totalUsd,
      tier,
      message:
        "نفد رصيد الاستخدام لهذا الشهر. اشحن رصيداً إضافياً أو انتظر تجديد باقتك — التصفح ومتابعة توصياتك متاحان دائماً.",
    };
  }
  return { allowed: true, reason: "subscribed", balanceUsd: balance.totalUsd, tier };
}
