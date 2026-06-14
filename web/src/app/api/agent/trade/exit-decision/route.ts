import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { logAudit } from "@/lib/store";

const schema = z.object({
  trade_id: z.number().int().positive(),
  decision: z.enum(["hold", "close", "adjust_sl"]),
  reason: z.string().min(3).max(500),
  new_stop_loss: z.number().positive().optional(),
});

/** Bridge: agent records hold/close/adjust_sl decision (audit trail). */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = schema.parse(await req.json());

    const detail = JSON.stringify({
      trade_id: body.trade_id,
      decision: body.decision,
      reason: body.reason,
      new_stop_loss: body.new_stop_loss ?? null,
    });

    await logAudit(userId, `trade_exit_${body.decision}`, detail);

    return NextResponse.json({
      ok: true,
      recorded: true,
      trade_id: body.trade_id,
      decision: body.decision,
      hint:
        body.decision === "close"
          ? "نفّذ الإغلاق عبر POST /api/agent/trade/close"
          : body.decision === "adjust_sl"
            ? "عدّل SL عبر futures/modify أو أبلغ المشغّل"
            : "استمر في المراقبة",
    });
  } catch (e) {
    return handleError(e);
  }
}
