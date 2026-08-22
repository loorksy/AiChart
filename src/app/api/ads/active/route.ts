import { NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { initDb } from "@/lib/db";
import { eligibleAdFor } from "@/lib/ads/adsStore";
import { getEntitlementForUser } from "@/lib/subscription/entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The one eligible ad for this signed-in user right now (or none). */
export async function GET() {
  try {
    const user = await requireUser();
    await initDb();
    const snapshot = await getEntitlementForUser(user);
    const ad = await eligibleAdFor(user.id, {
      hasPaidAccess: snapshot.hasPaidAccess,
      planStatus: snapshot.planStatus,
    });
    if (!ad) return NextResponse.json({ ok: true, ad: null });
    return NextResponse.json({
      ok: true,
      ad: {
        id: ad.id,
        slides: ad.slides.map((slide) => ({
          text: slide.text ?? null,
          image_url: slide.image_path ? `/api/ads/image/${slide.image_path}` : null,
          animated: slide.image_path
            ? /\.(gif|webp)$/i.test(slide.image_path)
            : false,
        })),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
