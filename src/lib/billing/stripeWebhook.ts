import { execute, queryOne } from "@/lib/db";
import { grantCredits } from "./credits";
import { getPlanPriceById, type PlanPriceRow } from "./planConfig";
import { createLogger } from "@/lib/logger";

const log = createLogger("billing.stripe.webhook");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Billing v3 webhook application — the webhooks are the SOURCE OF TRUTH for
 * money: credits are granted here on confirmed payment, never on a button
 * press. Idempotency is layered twice: `stripe_events` keys on the event id,
 * and every grant carries ref=stripe:<event_id> against the ledger's UNIQUE
 * constraint — a redelivered event can never double-credit.
 *
 * Terms come from the PINNED data: a new subscription grants what its
 * checkout metadata froze at session-create time; a renewal grants what the
 * subscriber's pinned plan-price row says — whatever the plan points at
 * today. Rollover is structural: grants ADD to the remaining balance.
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

async function upsertSubscription(row: {
  userId: number;
  status: string;
  periodEnd: number;
  priceId: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}): Promise<void> {
  const now = Date.now();
  const updated = await execute(
    `UPDATE subscriptions SET tier = 'full', status = ?, current_period_start = ?, current_period_end = ?,
       price_id = COALESCE(?, price_id),
       stripe_customer_id = COALESCE(?, stripe_customer_id),
       stripe_subscription_id = COALESCE(?, stripe_subscription_id),
       updated_at = ? WHERE user_id = ?`,
    [row.status, now, row.periodEnd, row.priceId, row.stripeCustomerId, row.stripeSubscriptionId, now, row.userId],
  );
  if (!updated.changes) {
    await execute(
      `INSERT INTO subscriptions (user_id, tier, status, started_at, current_period_start, current_period_end, price_id, stripe_customer_id, stripe_subscription_id, updated_at)
       VALUES (?, 'full', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.userId, row.status, now, now, row.periodEnd, row.priceId, row.stripeCustomerId, row.stripeSubscriptionId, now],
    );
  }
}

/** user_entitlements is THE access truth every gate reads — extend it here. */
async function activateEntitlement(userId: number, periodEnd: number): Promise<void> {
  await execute(
    `INSERT INTO user_entitlements (user_id, plan_status, subscription_expires_at, updated_at)
     VALUES (?, 'active', ?, ${process.env.DATABASE_URL ? "NOW()" : "datetime('now')"})
     ON CONFLICT (user_id) DO UPDATE SET
       plan_status = 'active',
       subscription_expires_at = excluded.subscription_expires_at,
       updated_at = excluded.updated_at`,
    [userId, new Date(periodEnd).toISOString()],
  );
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
        const credits = Number(meta.credits);
        if (!Number.isInteger(credits) || credits <= 0) return "topup_invalid_amount";
        await grantCredits({
          userId,
          amount: credits,
          kind: "topup",
          ref: `stripe:${event.id}`,
          note: meta.pack_id ? `pack:${meta.pack_id}` : null,
        });
        return "topup_granted";
      }

      if (meta.purpose === "subscription") {
        // The PINNED terms this checkout was created with.
        const credits = Number(meta.credits_per_cycle);
        const cycleDays = Number(meta.cycle_days);
        const priceRowId = Number(meta.price_row_id);
        if (!Number.isInteger(credits) || credits < 0 || !Number.isInteger(cycleDays) || cycleDays <= 0) {
          return "subscription_invalid_terms";
        }
        const periodEnd = Date.now() + cycleDays * DAY_MS;
        await upsertSubscription({
          userId,
          status: "active",
          periodEnd,
          priceId: Number.isInteger(priceRowId) ? priceRowId : null,
          stripeCustomerId: (obj.customer as string) ?? null,
          stripeSubscriptionId: (obj.subscription as string) ?? null,
        });
        await activateEntitlement(userId, periodEnd);
        if (credits > 0) {
          // ADDS to whatever remains — rollover is structural, never a reset.
          await grantCredits({
            userId,
            amount: credits,
            kind: "cycle_grant",
            ref: `stripe:${event.id}`,
            note: `price_row:${priceRowId}`,
          });
        }
        return "subscription_activated";
      }
      return "ignored_purpose";
    }

    case "invoice.payment_succeeded": {
      // Renewal cycle. The first invoice of a new subscription is covered by
      // checkout.session.completed — skip it via billing_reason.
      if ((obj.billing_reason as string) === "subscription_create") return "first_invoice_skipped";
      const subId = (obj.subscription as string) ?? null;
      if (!subId) return "no_subscription_id";
      const row = await queryOne<{ user_id: number; price_id: number | null }>(
        "SELECT user_id, price_id FROM subscriptions WHERE stripe_subscription_id = ?",
        [subId],
      );
      if (!row) return "unknown_subscription";
      // The subscriber's PINNED price row — an admin price change after they
      // subscribed must never alter what their renewal grants.
      let price: PlanPriceRow | null =
        row.price_id != null ? await getPlanPriceById(row.price_id) : null;
      if (!price) {
        log.warn("renewal.price_row_missing", { subId, priceId: row.price_id });
        const { getCurrentPlanPrice } = await import("./planConfig");
        price = await getCurrentPlanPrice();
      }
      if (!price) return "no_price_terms";
      const periodEnd = Date.now() + price.cycle_days * DAY_MS;
      await upsertSubscription({
        userId: row.user_id,
        status: "active",
        periodEnd,
        priceId: price.id,
        stripeCustomerId: null,
        stripeSubscriptionId: subId,
      });
      await activateEntitlement(row.user_id, periodEnd);
      if (price.credits_per_cycle > 0) {
        await grantCredits({
          userId: row.user_id,
          amount: price.credits_per_cycle,
          kind: "cycle_grant",
          ref: `stripe:${event.id}`,
          note: `renewal price_row:${price.id}`,
        });
      }
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
      // Access dies when the paid period ends (entitlements date), not the
      // moment Stripe reports the cancellation — the user keeps what they
      // paid for. The mirror records the state for the admin panel.
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
