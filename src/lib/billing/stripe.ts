import { createHmac, timingSafeEqual } from "node:crypto";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { tierDef, type TierId } from "./tiers";

/**
 * V2-A3 (#92): Stripe over raw REST — deliberately no SDK.
 *
 * The dependency would drag a lockfile churn through the VPS deploy for four
 * endpoints that are plain form-encoded POSTs, and webhook verification is a
 * documented HMAC-SHA256 over `{t}.{payload}`. Keys live in platform_config
 * (encrypted, editable at /console/platform?tab=keys) — paste them and this
 * goes live, no deploy needed. Without keys every entry point degrades to an
 * explicit "not configured" answer.
 */

const API = "https://api.stripe.com/v1";

export interface StripeKeys {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string | null;
}

export async function getStripeKeys(): Promise<StripeKeys | null> {
  const [secretKey, webhookSecret, publishableKey] = await Promise.all([
    getPlatformValueAsync("STRIPE_SECRET_KEY"),
    getPlatformValueAsync("STRIPE_WEBHOOK_SECRET"),
    getPlatformValueAsync("STRIPE_PUBLISHABLE_KEY"),
  ]);
  if (!secretKey) return null;
  return {
    secretKey,
    webhookSecret: webhookSecret ?? "",
    publishableKey: publishableKey ?? null,
  };
}

/** Flatten nested params into Stripe's form encoding (a[b][0][c]=v). */
export function formEncode(params: Record<string, unknown>, prefix = ""): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          parts.push(...formEncode(item as Record<string, unknown>, `${name}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(...formEncode(value as Record<string, unknown>, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

export async function stripePost(
  secretKey: string,
  path: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formEncode(params).join("&"),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (data.error ?? {}) as { message?: string; type?: string };
    throw new Error(`stripe ${path}: ${err.message ?? res.status}`);
  }
  return data;
}

export const TOPUP_USD_OPTIONS = [20, 50, 100] as const;

/** Subscription checkout with inline price_data — no dashboard setup needed. */
export async function createSubscriptionCheckout(input: {
  userId: number;
  email: string;
  tier: TierId;
  appUrl: string;
}): Promise<string> {
  const keys = await getStripeKeys();
  if (!keys) throw new Error("stripe_not_configured");
  const def = tierDef(input.tier)!;
  const session = await stripePost(keys.secretKey, "/checkout/sessions", {
    mode: "subscription",
    client_reference_id: String(input.userId),
    customer_email: input.email,
    success_url: `${input.appUrl}/console/billing?checkout=success`,
    cancel_url: `${input.appUrl}/pricing?checkout=cancelled`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: def.priceUsd * 100,
          recurring: { interval: "month" },
          product_data: { name: `Lonora ${def.nameEn}` },
        },
      },
    ],
    subscription_data: {
      metadata: { user_id: String(input.userId), tier: def.id },
    },
    metadata: { user_id: String(input.userId), tier: def.id, purpose: "subscription" },
  });
  return String(session.url);
}

/** One-off top-up checkout for a fixed SKU amount. */
export async function createTopupCheckout(input: {
  userId: number;
  email: string;
  amountUsd: number;
  appUrl: string;
}): Promise<string> {
  const keys = await getStripeKeys();
  if (!keys) throw new Error("stripe_not_configured");
  if (!TOPUP_USD_OPTIONS.includes(input.amountUsd as (typeof TOPUP_USD_OPTIONS)[number])) {
    throw new Error("invalid_topup_amount");
  }
  const session = await stripePost(keys.secretKey, "/checkout/sessions", {
    mode: "payment",
    client_reference_id: String(input.userId),
    customer_email: input.email,
    success_url: `${input.appUrl}/console/billing?topup=success`,
    cancel_url: `${input.appUrl}/console/billing?topup=cancelled`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.amountUsd * 100,
          product_data: { name: `Lonora credit top-up $${input.amountUsd}` },
        },
      },
    ],
    metadata: {
      user_id: String(input.userId),
      topup_usd: String(input.amountUsd),
      purpose: "topup",
    },
  });
  return String(session.url);
}

/** Customer portal (cancel/upgrade) for a known Stripe customer. */
export async function createPortalSession(
  customerId: string,
  appUrl: string,
): Promise<string> {
  const keys = await getStripeKeys();
  if (!keys) throw new Error("stripe_not_configured");
  const session = await stripePost(keys.secretKey, "/billing_portal/sessions", {
    customer: customerId,
    return_url: `${appUrl}/console/billing`,
  });
  return String(session.url);
}

/**
 * Stripe-Signature verification: `t=<ts>,v1=<hmac_sha256(secret, "{t}.{body}")>`.
 * Constant-time compare; 5-minute tolerance against replay.
 */
export function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string,
  toleranceMs = 5 * 60 * 1000,
  now = Date.now(),
): boolean {
  if (!sigHeader || !secret) return false;
  const parts = new Map<string, string[]>();
  for (const piece of sigHeader.split(",")) {
    const [k, v] = piece.split("=", 2);
    if (!k || !v) continue;
    const list = parts.get(k.trim()) ?? [];
    list.push(v.trim());
    parts.set(k.trim(), list);
  }
  const t = Number(parts.get("t")?.[0]);
  const signatures = parts.get("v1") ?? [];
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(now - t * 1000) > toleranceMs) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  return signatures.some((sig) => {
    try {
      const buf = Buffer.from(sig, "hex");
      return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
    } catch {
      return false;
    }
  });
}
