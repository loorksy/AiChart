import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "stripe-wh-")), "test.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "stripe-test-secret";
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let stripe: any;
let webhook: any;
let credits: any;
let planConfig: any;
let provider: any;

before(async () => {
  db = await import("@/lib/db");
  stripe = await import("../stripe");
  webhook = await import("../stripeWebhook");
  credits = await import("../credits");
  planConfig = await import("../planConfig");
  provider = await import("../paymentProvider");
  await db.initDb();
  await db.execute(
    "INSERT INTO users (id, email, password_hash, role, status) VALUES (7, 'sub@test.local', 'x', 'user', 'active')",
  );
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_testsecret";
  const sign = (payload: string, t: number) =>
    `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

  it("accepts a fresh, correctly signed payload", () => {
    const t = Math.floor(Date.now() / 1000);
    assert.equal(
      stripe.verifyStripeSignature('{"a":1}', sign('{"a":1}', t), secret),
      true,
    );
  });

  it("rejects a tampered payload, a wrong secret, and a stale timestamp", () => {
    const t = Math.floor(Date.now() / 1000);
    assert.equal(
      stripe.verifyStripeSignature('{"a":2}', sign('{"a":1}', t), secret),
      false,
      "tampered body",
    );
    assert.equal(
      stripe.verifyStripeSignature('{"a":1}', sign('{"a":1}', t), "whsec_other"),
      false,
      "wrong secret",
    );
    const stale = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
    assert.equal(
      stripe.verifyStripeSignature('{"a":1}', sign('{"a":1}', stale), secret),
      false,
      "replayed after tolerance",
    );
    assert.equal(stripe.verifyStripeSignature('{"a":1}', null, secret), false);
  });
});

describe("formEncode", () => {
  it("flattens nested objects and arrays into Stripe's bracket form", () => {
    const parts = stripe.formEncode({
      mode: "subscription",
      line_items: [{ quantity: 1, price_data: { currency: "usd" } }],
    });
    assert.ok(parts.includes("mode=subscription"));
    assert.ok(parts.includes(encodeURIComponent("line_items[0][quantity]") + "=1"));
    assert.ok(
      parts.includes(encodeURIComponent("line_items[0][price_data][currency]") + "=usd"),
    );
  });
});

describe("payments unconfigured — named refusal, never a crash", () => {
  it("checkout entry points answer payments_unconfigured with no keys", async () => {
    assert.deepEqual(await provider.paymentStatus(), { configured: false });
    await assert.rejects(
      () => provider.startSubscriptionCheckout({ id: 7, email: "sub@test.local" }),
      (e: unknown) =>
        e instanceof provider.PaymentError &&
        (e as { code: string }).code === "payments_unconfigured",
    );
    await assert.rejects(
      () =>
        provider.startTopupCheckout(
          { id: 7, email: "sub@test.local", role: "user", status: "active" },
          1,
        ),
      (e: unknown) =>
        e instanceof provider.PaymentError &&
        (e as { code: string }).code === "payments_unconfigured",
    );
  });
});

describe("applyStripeEvent — credit era", () => {
  it("activates a subscription from PINNED metadata and grants once on replay", async () => {
    // The checkout froze these terms at session-create time.
    const event = {
      id: "evt_sub_1",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_1",
          subscription: "sub_1",
          metadata: {
            user_id: "7",
            purpose: "subscription",
            price_row_id: "1",
            credits_per_cycle: "1200",
            cycle_days: "30",
          },
        },
      },
    };
    assert.equal(await webhook.applyStripeEvent(event), "subscription_activated");
    assert.equal(await webhook.applyStripeEvent(event), "duplicate_skipped");

    assert.equal(await credits.getCreditBalance(7), 1200, "granted once, not twice");
    const sub = await db.queryOne("SELECT * FROM subscriptions WHERE user_id = 7");
    assert.equal(sub.tier, "full");
    assert.equal(sub.status, "active");
    assert.equal(sub.stripe_customer_id, "cus_1");
    assert.equal(Number(sub.price_id), 1, "the subscriber pins the price row they bought");
    const ent = await db.queryOne(
      "SELECT plan_status, subscription_expires_at FROM user_entitlements WHERE user_id = 7",
    );
    assert.equal(ent.plan_status, "active", "entitlements — the access truth — extended");
    assert.ok(ent.subscription_expires_at, "expiry date recorded");
  });

  it("grants a top-up pack once and never on redelivery", async () => {
    const event = {
      id: "evt_topup_1",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { user_id: "7", purpose: "topup", pack_id: "3", credits: "500" },
        },
      },
    };
    assert.equal(await webhook.applyStripeEvent(event), "topup_granted");
    assert.equal(await webhook.applyStripeEvent(event), "duplicate_skipped");
    assert.equal(await credits.getCreditBalance(7), 1700);
  });

  it("a renewal ADDS the pinned row's credits to what remains — rollover, no reset", async () => {
    // The user's pinned price row (id from the subscription event above).
    await db.execute(
      "INSERT INTO plan_prices (id, price_cents, credits_per_cycle, cycle_days, created_at) VALUES (1, 18000, 1200, 30, ?)",
      [Date.now()],
    );
    const first = {
      id: "evt_inv_create",
      type: "invoice.payment_succeeded",
      data: { object: { subscription: "sub_1", billing_reason: "subscription_create" } },
    };
    assert.equal(await webhook.applyStripeEvent(first), "first_invoice_skipped");

    const before = await credits.getCreditBalance(7); // 1700 remaining
    const renewal = {
      id: "evt_inv_cycle",
      type: "invoice.payment_succeeded",
      data: { object: { subscription: "sub_1", billing_reason: "subscription_cycle" } },
    };
    assert.equal(await webhook.applyStripeEvent(renewal), "renewal_granted");
    assert.equal(
      await credits.getCreditBalance(7),
      before + 1200,
      "remaining balance + the cycle grant — never a replacement",
    );
  });

  it("an admin price change never touches an existing subscriber's renewal", async () => {
    // Admin publishes a NEW price (more expensive, fewer credits).
    await planConfig.setPlanPrice(
      { priceCents: 30000, creditsPerCycle: 700, cycleDays: 30 },
      1,
    );
    const before = await credits.getCreditBalance(7);
    const renewal = {
      id: "evt_inv_cycle_2",
      type: "invoice.payment_succeeded",
      data: { object: { subscription: "sub_1", billing_reason: "subscription_cycle" } },
    };
    assert.equal(await webhook.applyStripeEvent(renewal), "renewal_granted");
    assert.equal(
      await credits.getCreditBalance(7),
      before + 1200,
      "the PINNED row's 1200, not the new price's 700",
    );
    const oldRow = await planConfig.getPlanPriceById(1);
    assert.equal(oldRow.credits_per_cycle, 1200, "the old row's numbers never moved");
  });

  it("marks past_due on failed payment and canceled on deletion", async () => {
    await webhook.applyStripeEvent({
      id: "evt_fail_1",
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_1" } },
    });
    let sub = await db.queryOne("SELECT status FROM subscriptions WHERE user_id = 7");
    assert.equal(sub.status, "past_due");

    await webhook.applyStripeEvent({
      id: "evt_del_1",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1" } },
    });
    sub = await db.queryOne("SELECT status FROM subscriptions WHERE user_id = 7");
    assert.equal(sub.status, "canceled");
  });
});

describe("offers apply only inside their window", () => {
  it("an expired offer never reaches a new checkout session", async () => {
    // Configure keys via env so the facade runs; capture the raw POSTs.
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const { clearPlatformConfigCache } = await import("@/lib/platformConfig");
    clearPlatformConfigCache();
    await planConfig.setPlanPrice(
      { priceCents: 18000, creditsPerCycle: 1000, cycleDays: 30 },
      1,
    );
    const now = Date.now();
    // One offer already ENDED, one not started yet — neither may apply.
    await planConfig.createOffer({
      kind: "percent",
      value: 50,
      startsAt: now - 10 * 86_400_000,
      endsAt: now - 86_400_000,
      createdBy: 1,
    });
    await planConfig.createOffer({
      kind: "percent",
      value: 30,
      startsAt: now + 86_400_000,
      endsAt: now + 10 * 86_400_000,
      createdBy: 1,
    });

    const calls: Array<{ path: string; params: Record<string, unknown> }> = [];
    const fakePost = async (_key: string, path: string, params: Record<string, unknown>) => {
      calls.push({ path, params });
      return { id: "obj_1", url: "https://checkout.stripe.test/s" };
    };
    const start = await provider.startSubscriptionCheckout(
      { id: 7, email: "sub@test.local" },
      { post: fakePost },
    );
    assert.equal(start.pinned.offerId, null, "no live offer → nothing pinned");
    const session = calls.find((c) => c.path === "/checkout/sessions");
    assert.ok(session, "a session was created");
    assert.equal("discounts" in session!.params, false, "no coupon on the session");
    assert.equal(
      calls.some((c) => c.path === "/coupons"),
      false,
      "no coupon was even created",
    );

    // And a LIVE offer does apply — created as a coupon, never a price edit.
    await planConfig.createOffer({
      kind: "percent",
      value: 20,
      startsAt: now - 1000,
      endsAt: now + 86_400_000,
      createdBy: 1,
    });
    const withOffer = await provider.startSubscriptionCheckout(
      { id: 7, email: "sub@test.local" },
      { post: fakePost },
    );
    assert.ok(withOffer.pinned.offerId, "the live offer is pinned");
    const couponCall = calls.find((c) => c.path === "/coupons");
    assert.ok(couponCall, "the offer became a Stripe coupon");
    const sessionWith = calls.filter((c) => c.path === "/checkout/sessions").at(-1)!;
    assert.ok(Array.isArray(sessionWith.params.discounts), "applied as a discount");
    const lineItems = sessionWith.params.line_items as Array<{
      price_data: { unit_amount: number };
    }>;
    assert.equal(
      lineItems[0]!.price_data.unit_amount,
      18000,
      "the base price is NEVER edited by an offer",
    );
    delete process.env.STRIPE_SECRET_KEY;
    clearPlatformConfigCache();
  });
});
