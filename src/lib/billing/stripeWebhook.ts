import { execute, queryOne } from "@/lib/db";
import { grantMonthly, grantTopup } from "./creditLedger";
import { tierDef } from "./tiers";
import { createLogger } from "@/lib/logger";

const log = createLogger("billing.stripe.webhook");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * V2-A3 (#92): webhook event application, separated from HTTP so it is
 * directly testable. Idempotency first: `stripe_events` keys on the event id —
 * Stripe redelivers, and a redelivered grant must never double-credit.
 */

export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/** Returns false when the event was already applied (idempotent replay). */
async function claimEvent(event: StripeEventLike): Promise<boolean> {
  const seen = await queryOne("SELECT id FROM stripe_events WHERE id = ?", [event.id]);
  if (seen) return false;
  await execute(
    "INSERT INTO stripe_events (id, type, ts) VALUES (?, ?, ?)",
    [event.id, event.type, Date.now()],
  );
  return true;
}

function metaUserId(obj: Record<string, unknown>): number | null {
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  const id = Number(meta.user_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function upsertSubscription(
  userId: number,
  tier: string,
  status: string,
  periodEnd: number,
  stripeCustomerId: string | null,
  stripeSubscriptionId: string | null,
): Promise<void> {
  const now = Date.now();
  const updated = await execute(
    `UPDATE subscriptions SET tier = ?, status = ?, current_period_start = ?, current_period_end = ?,
       stripe_customer_id = COALESCE(?, stripe_customer_id),
       stripe_subscription_id = COALESCE(?, stripe_subscription_id),
       updated_at = ? WHERE user_id = ?`,
    [tier, status, now, periodEnd, stripeCustomerId, stripeSubscriptionId, now, userId],
  );
  if (!updated.changes) {
    await execute(
      `INSERT INTO subscriptions (user_id, tier, status, started_at, current_period_start, current_period_end, stripe_customer_id, stripe_subscription_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, tier, status, now, now, periodEnd, stripeCustomerId, stripeSubscriptionId, now],
    );
  }
}

/** Apply one verified event. Returns a short outcome string for logging/tests. */
export async function applyStripeEvent(event: StripeEventLike): Promise<string> {
  if (!(await claimEvent(event))) return "duplicate_skipped";
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      const userId = metaUserId(obj);
      if (!userId) return "no_user_id";
      if (meta.purpose === "topup") {
        const usd = Number(meta.topup_usd);
        if (Number.isFinite(usd) && usd > 0) {
          await grantTopup(userId, usd, `stripe:${event.id}`, "top-up purchase");
          return "topup_granted";
        }
        return "topup_invalid_amount";
      }
      if (meta.purpose === "subscription") {
        const tier = tierDef(meta.tier);
        if (!tier) return "unknown_tier";
        const periodEnd = Date.now() + 30 * DAY_MS;
        await upsertSubscription(
          userId,
          tier.id,
          "active",
          periodEnd,
          (obj.customer as string) ?? null,
          (obj.subscription as string) ?? null,
        );
        await grantMonthly(userId, tier.includedCreditsUsd, periodEnd, "monthly_grant", `stripe:${event.id}`);
        return "subscription_activated";
      }
      return "ignored_purpose";
    }

    case "invoice.payment_succeeded": {
      // Renewal cycle: re-grant the month. First invoice of a new sub is
      // covered by checkout.session.completed — skip it via billing_reason.
      if ((obj.billing_reason as string) === "subscription_create") return "first_invoice_skipped";
      const subId = (obj.subscription as string) ?? null;
      if (!subId) return "no_subscription_id";
      const row = await queryOne<{ user_id: number; tier: string }>(
        "SELECT user_id, tier FROM subscriptions WHERE stripe_subscription_id = ?",
        [subId],
      );
      if (!row) return "unknown_subscription";
      const tier = tierDef(row.tier);
      if (!tier) return "unknown_tier";
      const periodEnd = Date.now() + 30 * DAY_MS;
      await upsertSubscription(row.user_id, tier.id, "active", periodEnd, null, subId);
      await grantMonthly(row.user_id, tier.includedCreditsUsd, periodEnd, "monthly_grant", `stripe:${event.id}`);
      return "renewal_granted";
    }

    case "invoice.payment_failed": {
      const subId = (obj.subscription as string) ?? null;
      if (!subId) return "no_subscription_id";
      await execute(
        "UPDATE subscriptions SET status = 'past_due', updated_at = ? WHERE stripe_subscription_id = ?",
        [Date.now(), subId],
      );
      return "marked_past_due";
    }

    case "customer.subscription.deleted": {
      const subId = (obj.id as string) ?? null;
      if (!subId) return "no_subscription_id";
      await execute(
        "UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE stripe_subscription_id = ?",
        [Date.now(), subId],
      );
      return "canceled";
    }

    default:
      log.debug("event.ignored", { type: event.type });
      return "ignored_type";
  }
}
