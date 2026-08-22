import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import {
  AD_IMAGE_MAX_BYTES,
  storeAdImage,
  validateAdImage,
} from "@/lib/ads/adsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ image_base64: z.string().min(8) }).strict();

/**
 * Ad image upload. Server-enforced bounds: the byte size cap and a MAGIC
 * BYTE type check (png/jpeg/gif/webp) — the claimed extension and
 * Content-Type are ignored entirely.
 */
export async function POST(req: Request) {
  try {
    await requireAdminWith("billing_write");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid payload" }, { status: 400 });
    }
    // Base64 expands ~4/3 — reject early before decoding something huge.
    if (parsed.data.image_base64.length > AD_IMAGE_MAX_BYTES * 1.4) {
      return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(parsed.data.image_base64, "base64");
    } catch {
      return NextResponse.json({ ok: false, error: "bad_base64" }, { status: 400 });
    }
    const verdict = validateAdImage(bytes);
    if (!verdict.ok) {
      return NextResponse.json(
        { ok: false, error: verdict.reason },
        { status: verdict.reason === "too_large" ? 413 : 415 },
      );
    }
    const name = storeAdImage(bytes, verdict.ext);
    return NextResponse.json({
      ok: true,
      image_path: name,
      animated_capable: verdict.animatedCapable,
    });
  } catch (err) {
    return handleError(err);
  }
}
