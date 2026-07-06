import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  eaKillCloseFlagKey,
  queueEaCloseAllPositions,
} from "@/lib/eaTradeCommands";
import { getFlag, logAudit, setFlag } from "@/lib/store";

const schema = z.object({
  /** true = enable kill switch and queue close-all; false = re-enable trading. */
  enabled: z.boolean(),
});

/**
 * Bridge: per-user emergency stop — blocks new trades and queues EA close-all.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const flagKey = eaKillCloseFlagKey(userId);

    if (body.enabled) {
      await setFlag(flagKey, "1");
      const commands = await queueEaCloseAllPositions(userId);
      await logAudit(userId, "kill_switch", "enabled");
      return NextResponse.json({
        ok: true,
        killSwitch: true,
        closeCommandsQueued: commands.length,
      });
    }

    await setFlag(flagKey, "0");
    await logAudit(userId, "kill_switch", "disabled");
    return NextResponse.json({ ok: true, killSwitch: false });
  } catch (e) {
    return handleError(e);
  }
}

/** Bridge: read whether the user's kill switch is active. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const active = (await getFlag(eaKillCloseFlagKey(userId))) === "1";
    return NextResponse.json({ ok: true, killSwitch: active });
  } catch (e) {
    return handleError(e);
  }
}
