import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { modifyStopsForUser } from "@/lib/brokers/tradeManagementDispatch";
import { getTrade, logAudit } from "@/lib/store";

const schema = z.object({
  trade_id: z.number().int().positive(),
  decision: z.enum(["hold", "close", "adjust_sl"]),
  reason: z.string().min(3).max(500),
  new_stop_loss: z.number().positive().optional(),
});

/** Bridge: agent records hold/close/adjust_sl decision (audit trail). */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    const detail = JSON.stringify({
      trade_id: body.trade_id,
      decision: body.decision,
      reason: body.reason,
      new_stop_loss: body.new_stop_loss ?? null,
    });

    await logAudit(userId, `trade_exit_${body.decision}`, detail);

    if (body.decision === "adjust_sl" && body.new_stop_loss) {
      const trade = await getTrade(userId, body.trade_id);
      if (!trade) {
        return NextResponse.json(
          { ok: false, reason: "الصفقة غير موجودة." },
          { status: 404 },
        );
      }
      const ticket = Number(trade.order_id);
      if (!Number.isFinite(ticket) || ticket <= 0) {
        return NextResponse.json({
          ok: false,
          recorded: true,
          reason: "لا توجد تذكرة MT5 مسجلة لهذه الصفقة.",
        });
      }

      const result = await modifyStopsForUser(userId, {
        ticket,
        stopLoss: body.new_stop_loss,
      });

      return NextResponse.json({
        ok: result.ok,
        recorded: true,
        trade_id: body.trade_id,
        decision: body.decision,
        command_id: result.command_id,
        executed: result.ok,
        reason: result.ok ? undefined : result.reason,
        hint: result.ok
          ? "تم تعديل وقف الخسارة على الوسيط."
          : (result.reason ?? "فشل تعديل SL."),
      });
    }

    return NextResponse.json({
      ok: true,
      recorded: true,
      trade_id: body.trade_id,
      decision: body.decision,
      hint:
        body.decision === "close"
          ? "نفّذ الإغلاق عبر POST /api/agent/trade/close"
          : body.decision === "adjust_sl"
            ? "حدّد new_stop_loss لتعديل SL على MetaTrader"
            : "استمر في المراقبة",
    });
  } catch (e) {
    return handleError(e);
  }
}
