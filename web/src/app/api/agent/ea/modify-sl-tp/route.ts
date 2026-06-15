import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { queueEaModifySlTp } from "@/lib/eaTradeCommands";
import { waitForEaCommandAck } from "@/lib/eaCommandWait";

const schema = z.object({
  ticket: z.number().int().positive(),
  stop_loss: z.number().positive(),
  take_profit: z.number().positive().optional(),
});

/** Bridge: modify SL/TP on open MT5 position. */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = schema.parse(await req.json());

    const command = await queueEaModifySlTp(
      userId,
      body.ticket,
      body.stop_loss,
      body.take_profit,
    );
    const ack = await waitForEaCommandAck(command.id);

    return NextResponse.json({
      ok: ack.ok,
      command_id: command.id,
      result: ack.result,
      reason: ack.reason,
    });
  } catch (e) {
    return handleError(e);
  }
}
