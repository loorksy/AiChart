import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { initDb, query } from "@/lib/db";
import { requireAdminWith, setAdminRole } from "@/lib/adminRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** V2-A6 (#95): list and assign fine-grained admin roles. Owner-only. */
export async function GET() {
  try {
    await requireAdminWith("roles_write");
    await initDb();
    const rows = await query(
      `SELECT ar.user_id, ar.admin_role, ar.granted_at, u.email
       FROM admin_roles ar JOIN users u ON u.id = ar.user_id ORDER BY ar.granted_at DESC`,
    );
    return NextResponse.json({ ok: true, roles: rows });
  } catch (err) {
    return handleError(err);
  }
}

const postSchema = z.object({
  user_id: z.number().int().positive(),
  role: z
    .enum(["owner", "support", "user_manager", "content_manager", "finance"])
    .nullable(),
});

export async function POST(req: Request) {
  try {
    const { admin } = await requireAdminWith("roles_write");
    await initDb();
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
        { status: 400 },
      );
    }
    await setAdminRole(parsed.data.user_id, parsed.data.role, admin.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
