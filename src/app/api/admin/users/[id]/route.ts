import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError, ApiError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import {
  setUserAccess,
  deleteUser,
  getPublicUser,
  logAudit,
  updateAdminLimits,
} from "@/lib/store";
import { getBrokerLink } from "@/lib/brokerLink/store";
import { deleteAccount, MetaapiClientError } from "@/lib/brokerLink/metaapiClient";
import { metaapiToken } from "@/lib/brokerLink/token";
import { DEFAULT_ACCESS_DAYS } from "@/lib/platformAccess";

const schema = z.object({
  status: z.enum(["pending", "active", "suspended"]).optional(),
  access_days: z.number().int().min(1).max(3650).optional(),
  renew: z.boolean().optional(),
  can_execute: z.boolean().optional(),
  claude_quota: z.number().int().min(0).optional(),
}).strict();

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { admin } = await requireAdminWith("users_write");
    const { id } = await ctx.params;
    const userId = Number(id);
    if (!Number.isInteger(userId)) throw new ApiError(400, "معرّف غير صالح.");

    const input = schema.parse(await req.json());
    const before = await getPublicUser(userId);

    if (input.status || input.access_days !== undefined) {
      if (userId === admin.id && input.status && input.status !== "active") {
        throw new ApiError(400, "لا يمكنك تعطيل حسابك الإداري.");
      }
      const accessDays =
        input.access_days ??
        (input.status === "active" ? DEFAULT_ACCESS_DAYS : undefined);
      await setUserAccess(userId, {
        status: input.status,
        access_days: accessDays,
        renew: input.renew ?? input.access_days !== undefined,
      });

      if (input.status === "active" || input.access_days !== undefined) {
        const after = await getPublicUser(userId);
        const action =
          before?.status === "active" && before.access_expires_at
            ? "user_access_renewed"
            : "user_access_granted";
        await logAudit(
          admin.id,
          action,
          JSON.stringify({
            target_user_id: userId,
            email: after?.email,
            access_expires_at: after?.access_expires_at,
            access_days: accessDays,
          }),
        );
      }
    }

    const limitPatch: Record<string, unknown> = {};
    if (typeof input.can_execute === "boolean")
      limitPatch.can_execute = input.can_execute ? 1 : 0;
    if (typeof input.claude_quota === "number")
      limitPatch.claude_quota = input.claude_quota;
    if (Object.keys(limitPatch).length > 0) {
      await updateAdminLimits(userId, limitPatch);
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
    const { admin } = await requireAdminWith("users_write");
    const { id } = await ctx.params;
    const userId = Number(id);
    if (!Number.isInteger(userId)) throw new ApiError(400, "معرّف غير صالح.");
    if (userId === admin.id) {
      throw new ApiError(400, "لا يمكنك حذف حسابك الإداري.");
    }

    const target = await getPublicUser(userId);
    if (!target) throw new ApiError(404, "المستخدم غير موجود.");
    if (target.role === "admin") {
      throw new ApiError(400, "لا يمكن حذف حساب إداري.");
    }

    const link = await getBrokerLink(userId);
    if (link) {
      const token = await metaapiToken();
      if (token) {
        try {
          await deleteAccount({
            token,
            accountId: link.metaapi_account_id,
          });
        } catch (err) {
          if (!(err instanceof MetaapiClientError)) throw err;
        }
      }
    }

    await deleteUser(userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
