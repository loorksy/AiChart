import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  eaKillCloseFlagKey,
  queueEaCloseAllPositions,
} from "@/lib/eaTradeCommands";
import { logAudit, setFlag, updateSettings } from "@/lib/store";
import { closeAllOpenTrades } from "@/lib/tradeClose";

const schema = z.object({
  on: z.boolean(),
  /** "user" stops this account; "master" stops the whole platform. */
  scope: z.enum(["user", "master"]).default("user"),
  /** Also close all open trades when switching on. */
  close_open_trades: z.boolean().default(false),
});

/** Bridge: emergency stop. The Risk Guard blocks all execution while on. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    if (body.scope === "master") {
      await setFlag("master_kill", body.on ? "1" : "0");
    } else {
      await updateSettings(userId, { kill_switch: body.on ? 1 : 0 });
    }
    await logAudit(
      userId,
      "agent_kill_switch",
      `${body.scope}=${body.on ? "on" : "off"}`,
    );

    let closed = null;
    if (body.on && body.close_open_trades) {
      await queueEaCloseAllPositions(userId);
      await setFlag(eaKillCloseFlagKey(userId), "1");
      closed = await closeAllOpenTrades(userId);
    }

    return NextResponse.json({ ok: true, scope: body.scope, on: body.on, closed });
  } catch (e) {
    return handleError(e);
  }
}
