import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getStripeKeys, verifyStripeSignature } from "@/lib/billing/stripe";
import { applyStripeEvent, type StripeEventLike } from "@/lib/billing/stripeWebhook";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("billing.webhook");

/**
 * V2-A3 (#92): the Stripe webhook. Signature verified over the RAW body;
 * events applied idempotently (stripe_events); always answers 2xx once the
 * signature checks out so Stripe stops retrying — application outcomes are
 * our concern, not Stripe's.
 */
export async function POST(req: Request) {
  const keys = await getStripeKeys();
  if (!keys?.webhookSecret) {
    return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 503 });
  }
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!verifyStripeSignature(payload, signature, keys.webhookSecret)) {
    log.warn("signature.rejected", {});
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 400 });
  }

  let event: StripeEventLike;
  try {
    event = JSON.parse(payload) as StripeEventLike;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  await initDb();
  try {
    const outcome = await applyStripeEvent(event);
    log.info("event.applied", { id: event.id, type: event.type, outcome });
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    // 500 makes Stripe redeliver — idempotency makes the retry safe.
    log.error("event.failed", {
      id: event.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
