import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { auditAdminAction, requireAdminWith } from "@/lib/adminRoles";
import { initDb } from "@/lib/db";
import { createOffer, listOffers, setOfferActive } from "@/lib/billing/planConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Billing v3: offers. An offer applies ONLY to checkouts created inside its
 * window — evaluated at session-create time, no retroactivity, no effect
 * once ended even while the row exists. Deactivation is immediate.
 */
export async function GET() {
  try {
    await requireAdminWith("billing_write");
    await initDb();
    return NextResponse.json({ ok: true, offers: await listOffers() });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z
  .object({
    kind: z.enum(["percent", "fixed_cents"]),
    value: z.number().int().min(1).max(100_000_000),
    starts_at: z.number().int().positive(),
    ends_at: z.number().int().positive(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const { admin } = await requireAdminWith("billing_write");
    await initDb();
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
        { status: 400 },
      );
    }
    const id = await createOffer({
      kind: parsed.data.kind,
      value: parsed.data.value,
      startsAt: parsed.data.starts_at,
      endsAt: parsed.data.ends_at,
      createdBy: admin.id,
    });
    await auditAdminAction(admin.id, "offer_create", String(id), JSON.stringify(parsed.data));
    return NextResponse.json({ ok: true, id, offers: await listOffers() });
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z
  .object({ id: z.number().int().positive(), active: z.boolean() })
  .strict();

export async function PATCH(req: Request) {
  try {
    const { admin } = await requireAdminWith("billing_write");
    await initDb();
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
        { status: 400 },
      );
    }
    await setOfferActive(parsed.data.id, parsed.data.active);
    await auditAdminAction(admin.id, "offer_toggle", String(parsed.data.id), String(parsed.data.active));
    return NextResponse.json({ ok: true, offers: await listOffers() });
  } catch (err) {
    return handleError(err);
  }
}
