import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES: Record<string, { type: string; disposition?: string; cache: string }> = {
  "version.json": {
    type: "application/json; charset=utf-8",
    cache: "no-store, must-revalidate",
  },
  "lonora-admin.apk": {
    type: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="lonora-admin.apk"',
    cache: "public, max-age=300",
  },
};

/**
 * Serve the admin WebView APK and its version manifest with the MIME
 * WhatsApp / Android browsers expect. Files live in public/admin-android/
 * so a static deploy still has them; this route exists because Next's
 * static map does not know `.apk`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const spec = FILES[file];
  if (!spec) return new NextResponse(null, { status: 404 });

  const disk = path.join(process.cwd(), "public", "admin-android", file);
  if (!existsSync(disk)) {
    return NextResponse.json({ ok: false, error: "not_built" }, { status: 404 });
  }

  const bytes = readFileSync(disk);
  return new NextResponse(bytes, {
    headers: {
      "content-type": spec.type,
      ...(spec.disposition ? { "content-disposition": spec.disposition } : {}),
      "cache-control": spec.cache,
      "x-content-type-options": "nosniff",
    },
  });
}
