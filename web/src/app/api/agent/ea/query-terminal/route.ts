import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { queueEaCommandAndWait } from "@/lib/eaAgentCommands";

/** Bridge: MT5 terminal snapshot (margin, pending orders) via EA query_terminal. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);

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
