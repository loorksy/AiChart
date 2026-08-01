import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { execute, initDb, query, queryOne } from "@/lib/db";
import { requireAdminWith, setAdminRole } from "@/lib/adminRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** V2-A6 (#95): list and assign fine-grained admin roles. Owner-only. */
export async function GET() {
  try {
    await requireAdminWith("roles_write");
    await initDb();
    // Every role='admin' account, with its fine-grained role when pinned —
    // a missing row means implicit owner.
    const rows = await query(
      `SELECT u.id as user_id, u.email, ar.admin_role, ar.granted_at
       FROM users u LEFT JOIN admin_roles ar ON ar.user_id = u.id
       WHERE u.role = 'admin' ORDER BY u.id`,
    );
    return NextResponse.json({ ok: true, admins: rows });
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

/**
 * Assigning a role PROMOTES the target to users.role='admin' (the outer
 * gate every admin surface checks first) and pins the fine-grained role.
 * role=null fully DEMOTES: the admin_roles row goes away AND users.role
 * returns to 'user' — never leave an unconstrained implicit owner behind.
 * Self-demotion is refused so the owner cannot lock themselves out.
 */
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
    const { user_id, role } = parsed.data;
    if (user_id === admin.id) {
      return NextResponse.json(
        { ok: false, error: "لا يمكنك تعديل دورك بنفسك." },
        { status: 400 },
      );
    }
    const target = await queryOne<{ id: number; role: string }>(
      "SELECT id, role FROM users WHERE id = ?",
      [user_id],
    );
    if (!target) {
      return NextResponse.json({ ok: false, error: "المستخدم غير موجود." }, { status: 404 });
    }
    if (role === null) {
      await execute("UPDATE users SET role = 'user' WHERE id = ?", [user_id]);
    } else {
      await execute("UPDATE users SET role = 'admin' WHERE id = ?", [user_id]);
    }
    await setAdminRole(user_id, role, admin.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
