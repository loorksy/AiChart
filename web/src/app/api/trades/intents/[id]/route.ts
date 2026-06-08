import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser, handleError, ApiError } from "@/lib/api";
import { getIntent, updateIntentStatus } from "@/lib/store";
import { executeIntent } from "@/lib/execution";
import { notifyUser } from "@/lib/telegram";
import { sseEncode } from "@/lib/sse";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  stream: z.boolean().optional(),
});

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

    const { action, stream } = schema.parse(await req.json());

    if (action === "reject") {
      updateIntentStatus(intentId, "rejected", "رفضه المستخدم.");
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    updateIntentStatus(intentId, "approved", "وافق المستخدم.");

    if (stream) {
      const body = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(sseEncode(event, data));
          };
          try {
            const result = await executeIntent(user.id, intentId, {
              onActivity: (a) => send("activity", a),
            });
            await notifyUser(
              user.id,
              result.ok
                ? `✅ نُفّذت صفقة ${intent.symbol}. · Executed.`
                : `⚠️ تعذّر تنفيذ ${intent.symbol} · Not executed: ${result.reason}`,
            );
            send("done", {
              ok: result.ok,
              status: result.status,
              reason: result.reason,
              tradeId: result.tradeId,
              activities: result.activities,
            });
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "حدث خطأ غير متوقع.";
            send("error", { error: message });
          }
          controller.close();
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const result = await executeIntent(user.id, intentId);
    await notifyUser(
      user.id,
      result.ok
        ? `✅ نُفّذت صفقة ${intent.symbol}. · Executed.`
        : `⚠️ تعذّر تنفيذ ${intent.symbol} · Not executed: ${result.reason}`,
    );
    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      reason: result.reason,
      tradeId: result.tradeId,
      activities: result.activities,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "إجراء غير صالح." }, { status: 400 });
    }
    return handleError(err);
  }
}
