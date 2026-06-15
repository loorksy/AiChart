import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { queueEaCommandAndWait } from "@/lib/eaAgentCommands";

/** Bridge: MT5 terminal snapshot (margin, pending orders) via EA query_terminal. */
export async function GET(_req: NextRequest) {
  try {
    requireAgentAuth(_req);
    const userId = await resolveAgentUserId();

    const ack = await queueEaCommandAndWait(userId, "query_terminal", {});

    return NextResponse.json({
      ok: ack.ok,
      command_id: ack.command.id,
      terminal: ack.result,
      reason: ack.reason,
    });
  } catch (e) {
    return handleError(e);
  }
}
