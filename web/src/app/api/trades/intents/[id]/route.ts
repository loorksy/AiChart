import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePaidAccess, handleError, ApiError } from "@/lib/api";
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
    const user = await requirePaidAccess();
    const { id } = await ctx.params;
    const intentId = Number(id);
    if (!Number.isInteger(intentId)) throw new ApiError(400, "معرّف غير صالح.");

    const intent = await getIntent(intentId, user.id);
    if (!intent || intent.user_id !== user.id) {
      throw new ApiError(404, "الطلب غير موجود.");
    }
    if (intent.status !== "pending") {
      throw new ApiError(409, "تمّت معالجة هذا الطلب مسبقاً.");
    }

    const { action, stream } = schema.parse(await req.json());

    // A trade-management intent proposes an SL/TP modify for an ALREADY-OPEN
    // position. Approving it must go to the broker's modify path — executing
    // it as an order would open a second position on top of the live one.
    if (intent.authorization_source === "trade_management") {
      const { respondToTradeManagementIntent } = await import(
        "@/lib/recommendations/tradeManagement"
      );
      const result = await respondToTradeManagementIntent(user.id, intent, action);
      return NextResponse.json(result);
    }

    if (action === "reject") {
      await updateIntentStatus(intentId, "rejected", "رفضه المستخدم.", user.id);
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    await updateIntentStatus(intentId, "approved", "وافق المستخدم.", user.id);

    if (stream) {
      const body = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(sseEncode(event, data));
          };
          try {
            const result = await executeIntent(user.id, intentId, {
              onActivity: (a) => send("activity", a),
              // The operator pressed approve on this specific trade.
              explicitApproval: true,
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

    const result = await executeIntent(user.id, intentId, { explicitApproval: true });
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
