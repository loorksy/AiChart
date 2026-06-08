import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser, handleError, ApiError } from "@/lib/api";
import { getIntent, updateIntentStatus } from "@/lib/store";
import { executeIntent } from "@/lib/execution";
import { notifyUser } from "@/lib/telegram";

const schema = z.object({ action: z.enum(["approve", "reject"]) });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireActiveUser();
    const { id } = await ctx.params;
    const intentId = Number(id);
    if (!Number.isInteger(intentId)) throw new ApiError(400, "معرّف غير صالح.");

    const intent = getIntent(intentId);
    if (!intent || intent.user_id !== user.id) {
      throw new ApiError(404, "الطلب غير موجود.");
    }
    if (intent.status !== "pending") {
      throw new ApiError(409, "تمّت معالجة هذا الطلب مسبقاً.");
    }

    const { action } = schema.parse(await req.json());

    if (action === "reject") {
      updateIntentStatus(intentId, "rejected", "رفضه المستخدم.");
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    // approve → execute through the Risk Guard.
    updateIntentStatus(intentId, "approved", "وافق المستخدم.");
    const result = await executeIntent(user.id, intentId);
    await notifyUser(
      user.id,
      result.ok
        ? `✅ نُفّذت صفقة ${intent.symbol}.`
        : `⚠️ تعذّر تنفيذ ${intent.symbol}: ${result.reason}`,
    );
    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      reason: result.reason,
      tradeId: result.tradeId,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "إجراء غير صالح." }, { status: 400 });
    }
    return handleError(err);
  }
}
