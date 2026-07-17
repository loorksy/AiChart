import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError, requireAdmin } from "@/lib/api";
import { initDb, queryOne } from "@/lib/db";
import { logAudit } from "@/lib/store";
import {
  activateSubscription,
  restoreTrial,
  suspendSubscription,
} from "@/lib/subscription/entitlement";

const schema = z.object({
  action: z.enum(["activate", "suspend", "restore_trial"]),
  expiresAt: z.string().min(1).max(64).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    await initDb();
    const { id } = await ctx.params;
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new ApiError(400, "معرّف مستخدم غير صالح.");
    }

    const target = await queryOne<{ id: number; role: string; email: string }>(
      "SELECT id, role, email FROM users WHERE id = ?",
      [userId],
    );
    if (!target) throw new ApiError(404, "المستخدم غير موجود.");
    if (target.role === "admin") {
      throw new ApiError(400, "لا يمكن تعديل اشتراك حساب إداري عبر هذه الواجهة.");
    }

    const body = schema.parse(await req.json());
    let row;
    if (body.action === "activate") {
      row = await activateSubscription({
        userId,
        adminId: admin.id,
        expiresAt: body.expiresAt ?? null,
        note: body.note ?? null,
      });
    } else if (body.action === "suspend") {
      row = await suspendSubscription({
        userId,
        adminId: admin.id,
        note: body.note ?? null,
      });
    } else {
      row = await restoreTrial({
        userId,
        adminId: admin.id,
        note: body.note ?? null,
      });
    }

    await logAudit(
      admin.id,
      `subscription.${body.action}`,
      JSON.stringify({
        target_user_id: userId,
        target_email: target.email,
        plan_status: row.plan_status,
        expires_at: row.subscription_expires_at,
      }),
    );

    return NextResponse.json({
      ok: true,
      entitlement: {
        plan_status: row.plan_status,
        trial_interactions_used: row.trial_interactions_used,
        subscription_expires_at: row.subscription_expires_at,
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}
