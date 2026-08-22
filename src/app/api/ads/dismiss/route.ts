import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { initDb } from "@/lib/db";
import { dismissAd } from "@/lib/ads/adsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ ad_id: z.number().int().positive() }).strict();

/** The X button: this ad never comes back for this user. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await initDb();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid payload" }, { status: 400 });
    }
    await dismissAd(user.id, parsed.data.ad_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
