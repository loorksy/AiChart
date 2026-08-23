import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import {
  AD_IMAGE_ACCEPTED,
  AD_IMAGE_MAX_BYTES,
  storeAdImage,
  validateAdImage,
} from "@/lib/ads/adsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonSchema = z.object({ image_base64: z.string().min(8) }).strict();

/**
 * Ad image upload — a real file, or a base64 string.
 *
 * The console used to ask the operator to paste base64 or a data URL into a
 * text box, which is not a thing anyone can do with a picture on their phone.
 * It now sends the file itself as multipart; the base64 branch stays because
 * it costs nothing and keeps any older client working.
 *
 * The bounds are enforced HERE and only here, whichever branch is used. A
 * client-side filter is a convenience for the person choosing a file, never a
 * limit: the size cap and the MAGIC BYTE type check are the limit, and the
 * claimed filename, extension and Content-Type are all ignored on purpose.
 */

/** What the picker may offer and what the server will accept. */
export async function GET() {
  try {
    await requireAdminWith("billing_write");
    return NextResponse.json({
      ok: true,
      max_bytes: AD_IMAGE_MAX_BYTES,
      accepted: AD_IMAGE_ACCEPTED,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdminWith("billing_write");

    const contentType = req.headers.get("content-type") ?? "";
    let bytes: Buffer;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ ok: false, error: "no_file" }, { status: 400 });
      }
      // Refuse on the declared size before buffering the body: a 2 MB cap is
      // not a reason to hold 50 MB in memory first.
      if (file.size > AD_IMAGE_MAX_BYTES) {
        return NextResponse.json(
          { ok: false, error: "too_large", max_bytes: AD_IMAGE_MAX_BYTES },
          { status: 413 },
        );
      }
      bytes = Buffer.from(await file.arrayBuffer());
    } else {
      const parsed = jsonSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return NextResponse.json({ ok: false, error: "invalid payload" }, { status: 400 });
      }
      // Base64 expands ~4/3 — reject early before decoding something huge.
      if (parsed.data.image_base64.length > AD_IMAGE_MAX_BYTES * 1.4) {
        return NextResponse.json(
          { ok: false, error: "too_large", max_bytes: AD_IMAGE_MAX_BYTES },
          { status: 413 },
        );
      }
      // `Buffer.from(str, "base64")` never throws — garbage simply yields a
      // short buffer, which then fails the magic-byte check below. The old
      // try/catch and its `bad_base64` branch were unreachable code.
      bytes = Buffer.from(parsed.data.image_base64, "base64");
    }

    const verdict = validateAdImage(bytes);
    if (!verdict.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: verdict.reason,
          max_bytes: AD_IMAGE_MAX_BYTES,
          accepted: AD_IMAGE_ACCEPTED,
        },
        { status: verdict.reason === "too_large" ? 413 : 415 },
      );
    }

    const name = storeAdImage(bytes, verdict.ext);
    return NextResponse.json({
      ok: true,
      image_path: name,
      ext: verdict.ext,
      bytes: verdict.bytes,
      // Measured from the file, not guessed from its format: the operator can
      // see before publishing whether the thing they chose actually moves.
      animated: verdict.animated,
      animated_capable: verdict.animatedCapable,
    });
  } catch (err) {
    return handleError(err);
  }
}
