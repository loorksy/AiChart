import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { query, execute, getDbBackend } from "@/lib/db";

export async function GET() {
  try {
    await requireAdmin();
    const rows = await query("SELECT * FROM dynamic_pages ORDER BY created_at DESC");
    // Normalize boolean values for is_published
    const normalized = rows.map((r: any) => ({
      ...r,
      is_published: typeof r.is_published === "boolean" ? r.is_published : Boolean(r.is_published)
    }));
    return NextResponse.json({ pages: normalized });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json();
    const { slug, title_ar, title_en, content_ar, content_en, is_published, metadata_json } = body;

    if (!slug || !title_ar || !title_en) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const backend = getDbBackend();
    const isPubVal = backend === "postgres" ? Boolean(is_published) : (is_published ? 1 : 0);
    const meta = metadata_json || "{}";

    await execute(
      `INSERT INTO dynamic_pages (slug, title_ar, title_en, content_ar, content_en, is_published, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cleanSlug, title_ar, title_en, content_ar || "", content_en || "", isPubVal, meta]
    );

    return NextResponse.json({ success: true, slug: cleanSlug });
  } catch (err) {
    return handleError(err);
  }
}
