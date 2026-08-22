import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireUser, handleError } from "@/lib/api";
import { adsUploadDir } from "@/lib/ads/adsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Serves a stored ad image to signed-in users. Basename-only, no traversal. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  try {
    await requireUser();
    const { name } = await ctx.params;
    const base = path.basename(name);
    const ext = base.split(".").pop()?.toLowerCase() ?? "";
    const type = CONTENT_TYPES[ext];
    if (!type || base !== name) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const bytes = await readFile(path.join(adsUploadDir(), base)).catch(() => null);
    if (!bytes) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
