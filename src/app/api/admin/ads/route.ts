import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { auditAdminAction, requireAdminWith } from "@/lib/adminRoles";
import { initDb } from "@/lib/db";
import {
  createAd,
  deleteAd,
  listAds,
  updateAd,
} from "@/lib/ads/adsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slideSchema = z
  .object({
    text: z.string().max(2000).optional(),
    image_path: z.string().max(200).optional(),
  })
  .strict();

const createSchema = z
  .object({
    slides: z.array(slideSchema).min(1).max(10),
    audience: z.enum(["all", "subscribers", "non_subscribers", "trial"]),
    active: z.boolean().optional(),
    starts_at: z.number().int().positive().nullable().optional(),
    ends_at: z.number().int().positive().nullable().optional(),
  })
  .strict();

export async function GET() {
  try {
    await requireAdminWith("billing_write");
    await initDb();
    return NextResponse.json({ ok: true, ads: await listAds() });
  } catch (err) {
    return handleError(err);
  }
}

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
    const id = await createAd({
      slides: parsed.data.slides,
      audience: parsed.data.audience,
      active: parsed.data.active,
      startsAt: parsed.data.starts_at ?? null,
      endsAt: parsed.data.ends_at ?? null,
      createdBy: admin.id,
    });
    await auditAdminAction(admin.id, "ad_create", String(id), parsed.data.audience);
    return NextResponse.json({ ok: true, id, ads: await listAds() });
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z
  .object({
    id: z.number().int().positive(),
    active: z.boolean().optional(),
    audience: z.enum(["all", "subscribers", "non_subscribers", "trial"]).optional(),
    starts_at: z.number().int().positive().nullable().optional(),
    ends_at: z.number().int().positive().nullable().optional(),
    slides: z.array(slideSchema).min(1).max(10).optional(),
    remove: z.boolean().optional(),
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
    if (parsed.data.remove) {
      await deleteAd(parsed.data.id);
      await auditAdminAction(admin.id, "ad_delete", String(parsed.data.id), "");
    } else {
      await updateAd(parsed.data.id, {
        active: parsed.data.active,
        audience: parsed.data.audience,
        startsAt: parsed.data.starts_at,
        endsAt: parsed.data.ends_at,
        slides: parsed.data.slides,
      });
      await auditAdminAction(admin.id, "ad_update", String(parsed.data.id), "");
    }
    return NextResponse.json({ ok: true, ads: await listAds() });
  } catch (err) {
    return handleError(err);
  }
}
