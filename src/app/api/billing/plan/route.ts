import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getBillingPlan, getCurrentPlanPrice } from "@/lib/billing/planConfig";
import { AICHART_PLAN } from "@/lib/subscription/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC plan facts — the one place every surface reads pricing from, so no
 * page can drift from what billing actually enforces. Price null = the admin
 * has not configured a price yet; surfaces degrade to the contact CTA.
 */
export async function GET() {
  await initDb();
  const [plan, price] = await Promise.all([getBillingPlan(), getCurrentPlanPrice()]);
  return NextResponse.json({
    title_ar: AICHART_PLAN.titleAr,
    title_en: AICHART_PLAN.titleEn,
    currency: AICHART_PLAN.currency,
    telegram_url: AICHART_PLAN.telegramUrl,
    telegram_handle: AICHART_PLAN.telegramHandle,
    price_cents: price?.price_cents ?? null,
    credits_per_cycle: price?.credits_per_cycle ?? null,
    cycle_days: price?.cycle_days ?? null,
    /** What a NEW account is handed once — the only "free" there is. */
    signup_grant_credits: plan.signup_grant_credits,
  });
}
