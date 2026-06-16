import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { queueEaCommandAndWait } from "@/lib/eaAgentCommands";

const schema = z.object({
  ticket: z.number().int().positive(),
});

/** Bridge: cancel MT5 pending order by ticket. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    const ack = await queueEaCommandAndWait(userId, "cancel_order", {
      ticket: body.ticket,
    });

    return NextResponse.json({
      ok: ack.ok,
      command_id: ack.command.id,
      result: ack.result,
      reason: ack.reason,
    });
  } catch (e) {
    return handleError(e);
  }
}
