import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "stripe-wh-")), "test.db");
delete process.env.DATABASE_URL;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let stripe: any;
let webhook: any;
let ledger: any;

before(async () => {
  db = await import("@/lib/db");
  stripe = await import("../stripe");
  webhook = await import("../stripeWebhook");
  ledger = await import("../creditLedger");
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

describe("applyStripeEvent", () => {
  it("activates a subscription and grants the month exactly once on replay", async () => {
    const event = {
      id: "evt_sub_1",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_1",
          subscription: "sub_1",
          metadata: { user_id: "7", tier: "plus", purpose: "subscription" },
        },
      },
    };
    assert.equal(await webhook.applyStripeEvent(event), "subscription_activated");
    assert.equal(await webhook.applyStripeEvent(event), "duplicate_skipped");

    const balance = await ledger.getBalance(7);
    assert.equal(balance.monthlyUsd, 120, "the plan grants $120 once, not twice");
    const sub = await db.queryOne("SELECT * FROM subscriptions WHERE user_id = 7");
    // Legacy Stripe metadata ("plus") normalizes to the one plan at write time.
    assert.equal(sub.tier, "full");
    assert.equal(sub.status, "active");
    assert.equal(sub.stripe_customer_id, "cus_1");
  });

  it("grants a top-up once and never on redelivery", async () => {
    const event = {
      id: "evt_topup_1",
      type: "checkout.session.completed",
      data: {
        object: { metadata: { user_id: "7", topup_usd: "50", purpose: "topup" } },
      },
    };
    assert.equal(await webhook.applyStripeEvent(event), "topup_granted");
    assert.equal(await webhook.applyStripeEvent(event), "duplicate_skipped");
    const balance = await ledger.getBalance(7);
    assert.equal(balance.topupUsd, 50);
  });

  it("renews on invoice.payment_succeeded but skips the creation invoice", async () => {
    const first = {
      id: "evt_inv_create",
      type: "invoice.payment_succeeded",
      data: { object: { subscription: "sub_1", billing_reason: "subscription_create" } },
    };
    assert.equal(await webhook.applyStripeEvent(first), "first_invoice_skipped");

    await ledger.burn(7, 120, "spend-the-month");
    const renewal = {
      id: "evt_inv_cycle",
      type: "invoice.payment_succeeded",
      data: { object: { subscription: "sub_1", billing_reason: "subscription_cycle" } },
    };
    assert.equal(await webhook.applyStripeEvent(renewal), "renewal_granted");
    const balance = await ledger.getBalance(7);
    assert.equal(balance.monthlyUsd, 120, "fresh month replaces the drained bucket");
    assert.equal(balance.topupUsd, 50, "topup untouched");
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
