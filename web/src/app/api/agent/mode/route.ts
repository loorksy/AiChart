import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getSettings, logAudit, updateSettings } from "@/lib/store";
import { TRADING_MODES, type TradingMode } from "@/lib/types";

/** Bridge: read the current trading mode. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const settings = await getSettings(userId);
    return NextResponse.json({ mode: settings.mode });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({
  mode: z.enum(TRADING_MODES),
});

/** Bridge: switch trading mode (auto / approval / direct) by user request. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    await updateSettings(userId, { mode: body.mode as TradingMode });
    await logAudit(userId, "agent_mode_change", `mode=${body.mode}`);
    return NextResponse.json({ ok: true, mode: body.mode });
  } catch (e) {
    return handleError(e);
  }
}
