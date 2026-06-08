import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError, ApiError } from "@/lib/api";
import { setUserStatus, updateAdminLimits, deleteUser, getPublicUser } from "@/lib/store";

const schema = z.object({
  status: z.enum(["pending", "active", "suspended"]).optional(),
  can_execute: z.boolean().optional(),
  max_capital_cap: z.number().min(0).optional(),
  max_open_trades_cap: z.number().int().min(1).max(50).optional(),
  claude_quota: z.number().int().min(0).optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const userId = Number(id);
    if (!Number.isInteger(userId)) throw new ApiError(400, "معرّف غير صالح.");

    const input = schema.parse(await req.json());

    if (input.status) {
      if (userId === admin.id && input.status !== "active") {
        throw new ApiError(400, "لا يمكنك تعطيل حسابك الإداري.");
      }
      setUserStatus(userId, input.status);
    }

    const limitPatch: Record<string, unknown> = {};
    if (typeof input.can_execute === "boolean")
      limitPatch.can_execute = input.can_execute ? 1 : 0;
    if (typeof input.max_capital_cap === "number")
      limitPatch.max_capital_cap = input.max_capital_cap;
    if (typeof input.max_open_trades_cap === "number")
      limitPatch.max_open_trades_cap = input.max_open_trades_cap;
    if (typeof input.claude_quota === "number")
      limitPatch.claude_quota = input.claude_quota;
    if (Object.keys(limitPatch).length > 0) {
      updateAdminLimits(userId, limitPatch);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const userId = Number(id);
    if (!Number.isInteger(userId)) throw new ApiError(400, "معرّف غير صالح.");
    if (userId === admin.id) {
      throw new ApiError(400, "لا يمكنك حذف حسابك الإداري.");
    }

    const target = getPublicUser(userId);
    if (!target) throw new ApiError(404, "المستخدم غير موجود.");
    if (target.role === "admin") {
      throw new ApiError(400, "لا يمكن حذف حساب إداري.");
    }

    deleteUser(userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
