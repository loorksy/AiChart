import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { queueEaCommandAndWait } from "@/lib/eaAgentCommands";

const schema = z.object({
  ticket: z.number().int().positive(),
  lots: z.number().positive(),
});

/** Bridge: partial close MT5 position. */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = schema.parse(await req.json());

    const ack = await queueEaCommandAndWait(userId, "close_partial", {
      ticket: body.ticket,
      lots: body.lots,
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
