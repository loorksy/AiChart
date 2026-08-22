import { getPlatformValueAsync } from "@/lib/platformConfig";
import { getEntitlementForUser } from "@/lib/subscription/entitlement";
import { queryOne } from "@/lib/db";
import type { PublicUser } from "@/lib/types";
import { getStripeKeys, stripePost } from "./stripe";
import {
  activeOfferAt,
  getCurrentPlanPrice,
  getTopupPack,
  setOfferStripeCoupon,
  type OfferRow,
  type PlanPriceRow,
} from "./planConfig";

/**
 * Billing v3 — the ONE payment facade. Everything Stripe-shaped sits behind
 * this module; the rest of the platform never talks to Stripe directly.
 *
 * The contract:
 *  - WITHOUT keys, nothing crashes: status() says "unconfigured" and every
 *    entry point answers the named refusal `payments_unconfigured`. Pasting
 *    the keys in the platform panel turns everything on with zero code
 *    change.
 *  - Prices are IMMUTABLE rows: a checkout pins the plan-price row id and
 *    its terms into the session metadata at creation, so a later admin
 *    change never touches an open session, and the webhook grants from the
 *    METADATA, never from "current".
 *  - Offers apply only to checkouts created inside their window, as Stripe
 *    Coupons — never by editing the base price.
 *  - Top-up purchase is for ACTIVE subscribers only; an expired account is
 *    pointed at renewal instead.
 */

export type PaymentRefusal =
  | "payments_unconfigured"
  | "plan_price_unset"
  | "subscription_expired"
  | "pack_not_found";

export class PaymentError extends Error {
  constructor(public readonly code: PaymentRefusal) {
    super(code);
    this.name = "PaymentError";
  }
}

export interface PaymentDeps {
  /** Raw Stripe POST — injectable so tests run with zero network. */
  post?: typeof stripePost;
  now?: () => number;
}

export async function paymentStatus(): Promise<{ configured: boolean }> {
  return { configured: (await getStripeKeys()) != null };
}

async function appUrl(): Promise<string> {
  return (await getPlatformValueAsync("APP_URL")) ?? "https://aichart.lork.cloud";
}

/**
 * Ensure the ACTIVE offer exists as a Stripe coupon and return its id.
 * Created lazily on first use (offers can be authored while Stripe is not
 * configured) and stored back on the row.
 */
async function ensureOfferCoupon(
  offer: OfferRow,
  secretKey: string,
  post: typeof stripePost,
): Promise<string> {
  if (offer.stripe_coupon_id) return offer.stripe_coupon_id;
  const coupon = await post(secretKey, "/coupons", {
    duration: "once",
    ...(offer.kind === "percent"
      ? { percent_off: offer.value }
      : { amount_off: offer.value, currency: "usd" }),
    metadata: { offer_id: String(offer.id) },
  });
  const id = String(coupon.id);
  await setOfferStripeCoupon(offer.id, id);
  return id;
}

export interface CheckoutStart {
  url: string;
  /** The pinned terms this session was created with (audit + tests). */
  pinned: { priceRowId?: number; packId?: number; offerId?: number | null };
}

/** Subscription checkout: pins the CURRENT immutable price row. */
export async function startSubscriptionCheckout(
  user: Pick<PublicUser, "id" | "email">,
  deps: PaymentDeps = {},
): Promise<CheckoutStart> {
  const keys = await getStripeKeys();
  if (!keys) throw new PaymentError("payments_unconfigured");
  const price = await getCurrentPlanPrice();
  if (!price || price.price_cents <= 0) throw new PaymentError("plan_price_unset");
  const post = deps.post ?? stripePost;
  const now = deps.now?.() ?? Date.now();

  const offer = await activeOfferAt(now);
  const discounts = offer
    ? [{ coupon: await ensureOfferCoupon(offer, keys.secretKey, post) }]
    : undefined;

  const session = await post(keys.secretKey, "/checkout/sessions", {
    mode: "subscription",
    client_reference_id: String(user.id),
    customer_email: user.email,
    success_url: `${await appUrl()}/console/billing?checkout=success`,
    cancel_url: `${await appUrl()}/pricing?checkout=cancelled`,
    ...(discounts ? { discounts } : {}),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: price.price_cents,
          recurring: { interval: "month" },
          product_data: { name: "Lonora Full Access" },
        },
      },
    ],
    subscription_data: {
      metadata: { user_id: String(user.id), price_row_id: String(price.id) },
    },
    metadata: {
      user_id: String(user.id),
      purpose: "subscription",
      // The pinned terms: the webhook grants from THESE, never from
      // whatever the plan points at by the time the payment confirms.
      price_row_id: String(price.id),
      credits_per_cycle: String(price.credits_per_cycle),
      cycle_days: String(price.cycle_days),
      ...(offer ? { offer_id: String(offer.id) } : {}),
    },
  });
  return {
    url: String(session.url),
    pinned: { priceRowId: price.id, offerId: offer?.id ?? null },
  };
}

/** Top-up checkout: ACTIVE subscribers only, terms pinned from the pack row. */
export async function startTopupCheckout(
  user: Pick<PublicUser, "id" | "email" | "role" | "status">,
  packId: number,
  deps: PaymentDeps = {},
): Promise<CheckoutStart> {
  const keys = await getStripeKeys();
  if (!keys) throw new PaymentError("payments_unconfigured");
  const snapshot = await getEntitlementForUser(user);
  if (!snapshot.isAdmin && !snapshot.hasPaidAccess) {
    // The spec's rule: an expired (or trial) account buys nothing here —
    // renewal/subscription is the offered action instead.
    throw new PaymentError("subscription_expired");
  }
  const pack = await getTopupPack(packId);
  if (!pack || !pack.active || pack.archived_at != null) {
    throw new PaymentError("pack_not_found");
  }
  const post = deps.post ?? stripePost;
  const session = await post(keys.secretKey, "/checkout/sessions", {
    mode: "payment",
    client_reference_id: String(user.id),
    customer_email: user.email,
    success_url: `${await appUrl()}/console/billing?topup=success`,
    cancel_url: `${await appUrl()}/console/billing?topup=cancelled`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: pack.price_cents,
          product_data: { name: `Lonora credits ×${pack.credits}` },
        },
      },
    ],
    metadata: {
      user_id: String(user.id),
      purpose: "topup",
      pack_id: String(pack.id),
      credits: String(pack.credits),
    },
  });
  return { url: String(session.url), pinned: { packId: pack.id } };
}

/** Customer portal for a known Stripe customer (unchanged raw call). */
export async function startPortal(
  userId: number,
  deps: PaymentDeps = {},
): Promise<string> {
  const keys = await getStripeKeys();
  if (!keys) throw new PaymentError("payments_unconfigured");
  const row = await queryOne<{ stripe_customer_id: string | null }>(
    "SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?",
    [userId],
  );
  if (!row?.stripe_customer_id) throw new PaymentError("pack_not_found");
  const post = deps.post ?? stripePost;
  const session = await post(keys.secretKey, "/billing_portal/sessions", {
    customer: row.stripe_customer_id,
    return_url: `${await appUrl()}/console/billing`,
  });
  return String(session.url);
}
