import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { auditAdminAction, requireAdminWith } from "@/lib/adminRoles";
import { initDb } from "@/lib/db";
import {
  SPEND_OPS,
  bustBillingConfigCache,
  getBillingPlan,
  getCreditPrice,
  getCurrentPlanPrice,
  listOffers,
  listTopupPacks,
  setCreditPrice,
  setPlanPrice,
  updateBillingPlanSettings,
  type SpendOp,
} from "@/lib/billing/planConfig";
import { paymentStatus } from "@/lib/billing/paymentProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Billing v3 admin configuration — every priced or bounded number the
 * platform uses, readable and writable HERE and nowhere in code. The plan
 * price itself is written through setPlanPrice (immutable rows), never
 * edited in place.
 */
export async function GET() {
  try {
    await requireAdminWith("billing_write");
    await initDb();
    const [plan, price, packs, offers, payments] = await Promise.all([
      getBillingPlan(),
      getCurrentPlanPrice(),
      listTopupPacks(true),
      listOffers(),
      paymentStatus(),
    ]);
    const prices: Record<string, number> = {};
    for (const op of SPEND_OPS) prices[op] = await getCreditPrice(op);
    return NextResponse.json({
      ok: true,
      plan,
      current_price: price,
      credit_prices: prices,
      packs,
      offers,
      payments_configured: payments.configured,
    });
  } catch (err) {
    return handleError(err);
  }
}

const putSchema = z
  .object({
    trial_recommendations: z.number().int().min(0).max(1000).optional(),
    trial_duration_minutes: z.number().int().min(0).max(30 * 24 * 60).optional(),
    low_balance_threshold: z.number().int().min(0).max(1_000_000).optional(),
    expiry_warn_days: z.number().int().min(0).max(90).optional(),
    credit_prices: z
      .record(z.enum(["recommendation", "chat_turn", "mt5_link"]), z.number().int().min(0).max(1_000_000))
      .optional(),
  })
  .strict();

export async function PUT(req: Request) {
  try {
    const { admin } = await requireAdminWith("billing_write");
    await initDb();
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
        { status: 400 },
      );
    }
    const { credit_prices, ...planPatch } = parsed.data;
    if (Object.keys(planPatch).length) {
      await updateBillingPlanSettings(planPatch, admin.id);
    }
    if (credit_prices) {
      for (const [op, credits] of Object.entries(credit_prices)) {
        await setCreditPrice(op as SpendOp, credits, admin.id);
      }
    }
    bustBillingConfigCache();
    await auditAdminAction(admin.id, "billing_config", "plan", JSON.stringify(parsed.data));
    return GET();
  } catch (err) {
    return handleError(err);
  }
}

const priceSchema = z
  .object({
    price_cents: z.number().int().min(0).max(100_000_000),
    credits_per_cycle: z.number().int().min(0).max(10_000_000),
    cycle_days: z.number().int().min(1).max(366),
  })
  .strict();

/** "Change the price" = a NEW immutable row; the old one is archived. */
export async function POST(req: Request) {
  try {
    const { admin } = await requireAdminWith("billing_write");
    await initDb();
    const parsed = priceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
        { status: 400 },
      );
    }
    const row = await setPlanPrice(
      {
        priceCents: parsed.data.price_cents,
        creditsPerCycle: parsed.data.credits_per_cycle,
        cycleDays: parsed.data.cycle_days,
      },
      admin.id,
    );
    await auditAdminAction(admin.id, "billing_plan_price", String(row.id), JSON.stringify(parsed.data));
    return NextResponse.json({ ok: true, price: row });
  } catch (err) {
    return handleError(err);
  }
}
