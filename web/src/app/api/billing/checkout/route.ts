import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import {
  createSubscriptionCheckout,
  createTopupCheckout,
  getStripeKeys,
  TOPUP_USD_OPTIONS,
} from "@/lib/billing/stripe";
import { getPlatformValueAsync } from "@/lib/platformConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({ tier: z.enum(["lite", "plus", "pro", "promax"]) }),
  z.object({ topup_usd: z.number().refine((v) => TOPUP_USD_OPTIONS.includes(v as 20 | 50 | 100), "invalid top-up amount") }),
]);

/** V2-A3 (#92): start a Stripe Checkout for a tier or a credit top-up. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();

  if (!(await getStripeKeys())) {
    return NextResponse.json(
      {
        ok: false,
        error: "stripe_not_configured",
        message:
          "الدفع الإلكتروني غير مفعَّل بعد. تواصل مع الإدارة لتفعيل اشتراكك يدوياً.",
      },
      { status: 503 },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
      { status: 400 },
    );
  }

  const appUrl =
    (await getPlatformValueAsync("APP_URL")) ?? "https://aichart.lork.cloud";
  try {
    const url =
      "tier" in parsed.data
        ? await createSubscriptionCheckout({
            userId: user.id,
            email: user.email,
            tier: parsed.data.tier,
            appUrl,
          })
        : await createTopupCheckout({
            userId: user.id,
            email: user.email,
            amountUsd: parsed.data.topup_usd,
            appUrl,
          });
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "checkout_failed" },
      { status: 502 },
    );
  }
}
