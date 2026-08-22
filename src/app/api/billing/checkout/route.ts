import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import {
  PaymentError,
  startSubscriptionCheckout,
  startTopupCheckout,
} from "@/lib/billing/paymentProvider";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({ purpose: z.literal("subscription") }),
  z.object({ purpose: z.literal("topup"), pack_id: z.number().int().positive() }),
  // Legacy tier payloads stay ACCEPTED (an open pricing tab from before the
  // collapse must not 400) — they all resolve to the one plan.
  z.object({ tier: z.enum(["full", "lite", "plus", "pro", "promax"]) }),
]);

/** Refusal → HTTP + i18n key. Top-up for expired accounts points at renewal. */
const REFUSAL: Record<string, { status: number; key: string }> = {
  payments_unconfigured: { status: 503, key: "billing.payments_unconfigured" },
  plan_price_unset: { status: 503, key: "billing.pricing_pending" },
  pack_not_found: { status: 404, key: "billing.pack_unavailable" },
};

/** Billing v3: start a Stripe Checkout for the plan or a credit pack. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
      { status: 400 },
    );
  }

  try {
    const start =
      "purpose" in parsed.data && parsed.data.purpose === "topup"
        ? await startTopupCheckout(user, parsed.data.pack_id)
        : await startSubscriptionCheckout(user);
    return NextResponse.json({ ok: true, url: start.url });
  } catch (e) {
    if (e instanceof PaymentError) {
      if (e.code === "subscription_expired") {
        // The spec's rule: buying credits needs a LIVE subscription — the
        // offered action is renewal, never a purchase on a dead account.
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "subscription_expired",
              message: t("ar", "billing.refusal.subscription_expired"),
            },
          },
          { status: 403 },
        );
      }
      const mapped = REFUSAL[e.code];
      return NextResponse.json(
        {
          ok: false,
          error: { code: e.code, message: mapped ? t("ar", mapped.key) : e.code },
        },
        { status: mapped?.status ?? 502 },
      );
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "checkout_failed" },
      { status: 502 },
    );
  }
}
