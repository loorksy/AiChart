import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { queryOne, execute, getDbBackend } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireAdmin();
    const { slug } = await params;
    const row: any = await queryOne("SELECT * FROM dynamic_pages WHERE slug = ?", [slug]);
    if (!row) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }
    
    row.is_published = typeof row.is_published === "boolean" ? row.is_published : Boolean(row.is_published);
    return NextResponse.json({ page: row });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireAdmin();
    const { slug } = await params;
    const body = await req.json();
    const { title_ar, title_en, content_ar, content_en, is_published, metadata_json } = body;

    const row = await queryOne("SELECT slug FROM dynamic_pages WHERE slug = ?", [slug]);
    if (!row) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const backend = getDbBackend();
    const isPubVal = backend === "postgres" ? Boolean(is_published) : (is_published ? 1 : 0);
    const meta = metadata_json || "{}";
    const now = new Date().toISOString();

    await execute(
      `UPDATE dynamic_pages
       SET title_ar = ?, title_en = ?, content_ar = ?, content_en = ?, is_published = ?, metadata_json = ?, updated_at = ?
       WHERE slug = ?`,
      [title_ar, title_en, content_ar || "", content_en || "", isPubVal, meta, now, slug]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requireAdmin();
    const { slug } = await params;
    const row = await queryOne("SELECT slug FROM dynamic_pages WHERE slug = ?", [slug]);
    if (!row) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    await execute("DELETE FROM dynamic_pages WHERE slug = ?", [slug]);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleError(err);
  }
}
