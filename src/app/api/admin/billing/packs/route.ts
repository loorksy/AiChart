import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { auditAdminAction, requireAdminWith } from "@/lib/adminRoles";
import { initDb } from "@/lib/db";
import {
  archiveTopupPack,
  createTopupPack,
  listTopupPacks,
  updateTopupPack,
} from "@/lib/billing/planConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Billing v3: top-up pack CRUD. Packs archive, never vanish — an open
 *  checkout carries its own pinned terms and history keeps its reference. */
export async function GET() {
  try {
    await requireAdminWith("billing_write");
    await initDb();
    return NextResponse.json({ ok: true, packs: await listTopupPacks(true) });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z
  .object({
    credits: z.number().int().min(1).max(10_000_000),
    price_cents: z.number().int().min(0).max(100_000_000),
    sort: z.number().int().min(0).max(1000).optional(),
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
    const id = await createTopupPack({
      credits: parsed.data.credits,
      priceCents: parsed.data.price_cents,
      sort: parsed.data.sort,
    });
    await auditAdminAction(admin.id, "topup_pack_create", String(id), JSON.stringify(parsed.data));
    return NextResponse.json({ ok: true, id, packs: await listTopupPacks(true) });
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z
  .object({
    id: z.number().int().positive(),
    active: z.boolean().optional(),
    sort: z.number().int().min(0).max(1000).optional(),
    archive: z.boolean().optional(),
  })
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
    if (parsed.data.archive) {
      await archiveTopupPack(parsed.data.id);
    } else {
      await updateTopupPack(parsed.data.id, {
        active: parsed.data.active,
        sort: parsed.data.sort,
      });
    }
    await auditAdminAction(admin.id, "topup_pack_update", String(parsed.data.id), JSON.stringify(parsed.data));
    return NextResponse.json({ ok: true, packs: await listTopupPacks(true) });
  } catch (err) {
    return handleError(err);
  }
}
