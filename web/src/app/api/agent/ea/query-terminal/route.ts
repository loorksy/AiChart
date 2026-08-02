import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { queueEaCommandAndWait } from "@/lib/eaAgentCommands";
import { resolveForexBackendForUser } from "@/lib/store";

/**
 * Bridge: MT5 terminal snapshot (margin, pending orders) via EA query_terminal.
 *
 * The snapshot comes from the trader's own terminal, so it exists only on the
 * EA backend. A cloud or bridge account is told that immediately and pointed at
 * the account tools that do work there — queueing the command instead meant
 * waiting out the timeout to be told the EA is offline, which it never was.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);

    const backend = await resolveForexBackendForUser(userId);
    if (backend !== "ea") {
      return NextResponse.json({
        ok: false,
        backend,
        applies: false,
        terminal: null,
        reason:
          "لقطة الطرفية متاحة عبر جسر EA فقط — حسابك مربوط عبر المنصة؛ استخدم get_live_account و get_open_trades.",
      });
    }

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
